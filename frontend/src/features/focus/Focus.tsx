import { useEffect, useRef, useState } from 'react';
import { Play, Pause, CheckCircle2, Trash2, Timer as TimerIcon, Coffee, SkipForward } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import {
  formatHuman, computePlaylistProgress, sessionsNeeded, dateKeyInTimezone, calendarWindowDates,
  attributeFocusByDay, isProgressComplete,
  idleFocusState, startFocus, pauseFocus, resumeFocus, activeMs, wallMs, finishFocus,
  touchFocus, recoverFocusState, isRecordableFocusSession, FOCUS_MIN_RECORDED_SEC,
  type FocusTimerState,
} from '../../domain/index.js';
import { useStore } from '../../app/store.js';
import { useDayTick } from '../../app/dayTick.js';
import { notify } from '../../services/notifications/notify.js';
import { Dropdown } from '../../components/ui/Dropdown.js';
import { NumberField } from '../../components/ui/NumberField.js';
import { Card, Btn, Field, inputCls } from '../../components/ui/ui.js';

const TIMER_STORAGE_KEY_V1 = 'lq-focus-timer-v1';
const TIMER_STORAGE_PREFIX = 'lq-focus-timer-v2:';
const LOCK_LEASE_PREFIX = 'lq-focus-lock-v1:';
const LOCK_LEASE_MS = 15_000;

/**
 * Recovery snapshots are account-scoped. A stale timer from one account must
 * never appear after a different account signs in on the same browser.
 */
function focusStorageKey(mode: 'local' | 'cloud', userId: string | null): string {
  return `${TIMER_STORAGE_PREFIX}${mode === 'cloud' && userId ? userId : 'local'}`;
}

function monoNow(): number | undefined {
  try {
    return typeof performance !== 'undefined' && Number.isFinite(performance.now())
      ? performance.now()
      : undefined;
  } catch {
    return undefined;
  }
}

interface RestoredTimer {
  state: FocusTimerState;
  recovered: boolean;
  note: string;
  manualMin: number | null;
}

function loadTimer(key: string): RestoredTimer {
  try {
    let raw = localStorage.getItem(key);
    // Local-only installs may still carry the pre-account v1 snapshot. Never
    // migrate it in cloud mode because it is not bound to an account.
    if (!raw && key.endsWith(':local')) {
      raw = localStorage.getItem(TIMER_STORAGE_KEY_V1);
      if (raw) {
        localStorage.removeItem(TIMER_STORAGE_KEY_V1);
        localStorage.setItem(key, raw);
      }
    }
    if (!raw) return { state: idleFocusState(), recovered: false, note: '', manualMin: null };
    const parsed = JSON.parse(raw);
    const recovered = recoverFocusState(parsed, Date.now());
    const note = typeof parsed?.note === 'string' ? parsed.note : '';
    const manualMin = Number.isFinite(parsed?.manualMin) && parsed.manualMin > 0 && parsed.manualMin <= 960
      ? Number(parsed.manualMin)
      : null;
    return { ...recovered, note, manualMin };
  } catch {
    return { state: idleFocusState(), recovered: false, note: '', manualMin: null };
  }
}

function persistTimer(key: string, state: FocusTimerState, note = '', manualMin: number | null = null): void {
  try {
    localStorage.setItem(key, JSON.stringify({
      ...state,
      note,
      manualMin,
      lastUpdatedMs: Date.now(),
    }));
  } catch {
    /* quota/private mode: timer still works in memory */
  }
}

export function Focus() {
  const s = useStore();
  const storageKey = focusStorageKey(s.mode, s.authUser?.userId ?? null);
  const storageKeyRef = useRef(storageKey);
  storageKeyRef.current = storageKey;
  const snap = s.activeId ? s.playlists[s.activeId] : undefined;
  const todayKey = useDayTick(s.prefs.timezone);
  const [targetMin, setTargetMin] = useState<number | null>(s.prefs.sessionLenMin);
  const [minViable, setMinViable] = useState<number | null>(s.prefs.minViableMin);
  const [goalError, setGoalError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [manualMin, setManualMin] = useState<number | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);
  const [timer, setTimer] = useState<FocusTimerState>(() => idleFocusState());
  const [now, setNow] = useState(Date.now());
  const [hydrated, setHydrated] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [recoveredReview, setRecoveredReview] = useState(false);
  const [lockNotice, setLockNotice] = useState<string | null>(null);
  const [breakUntil, setBreakUntil] = useState<number | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const finishing = useRef(false);
  const finishedTimerIds = useRef<Set<string>>(new Set());
  const timerRef = useRef(timer);
  timerRef.current = timer;
  const noteRef = useRef(note);
  noteRef.current = note;
  const manualRef = useRef(manualMin);
  manualRef.current = manualMin;
  const lockHeldRef = useRef(false);
  const lockReleaseRef = useRef<(() => void) | null>(null);
  const tabIdRef = useRef(`tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

  const releaseTimerLock = () => {
    try {
      lockReleaseRef.current?.();
    } catch {
      /* release is best-effort */
    }
    lockReleaseRef.current = null;
    lockHeldRef.current = false;
    try {
      const key = `${LOCK_LEASE_PREFIX}${storageKeyRef.current}`;
      const raw = localStorage.getItem(key);
      const lease = raw ? JSON.parse(raw) : null;
      if (lease?.owner === tabIdRef.current) localStorage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  };

  /**
   * Synchronous fallback used when the Web Locks API is unavailable. Returning
   * `null` means the browser supports Web Locks and the caller must await the
   * real lock request instead.
   */
  const tryLocalTimerLock = (): boolean | null => {
    if (lockHeldRef.current) return true;
    const locks = (navigator as any)?.locks;
    if (locks && typeof locks.request === 'function') return null;
    try {
      const key = `${LOCK_LEASE_PREFIX}${storageKeyRef.current}`;
      const raw = localStorage.getItem(key);
      const lease = raw ? JSON.parse(raw) : null;
      const at = Date.now();
      if (lease && lease.owner !== tabIdRef.current && Number(lease.expires) > at) {
        const message = 'Another LearnQuest tab is already tracking focus. Resume or finish it there before starting another timer.';
        setLockNotice(message);
        notify(message);
        return false;
      }
      localStorage.setItem(key, JSON.stringify({ owner: tabIdRef.current, expires: at + LOCK_LEASE_MS }));
      lockHeldRef.current = true;
      lockReleaseRef.current = () => {
        try {
          const current = localStorage.getItem(key);
          const parsed = current ? JSON.parse(current) : null;
          if (parsed?.owner === tabIdRef.current) localStorage.removeItem(key);
        } catch {
          /* ignore */
        }
      };
      setLockNotice(null);
      return true;
    } catch {
      // Storage is unavailable; in-memory ownership still prevents duplicate
      // timers inside this tab. Cross-tab detection cannot be guaranteed here.
      lockHeldRef.current = true;
      return true;
    }
  };

  /**
   * Only one tab may own an active timer. Web Locks is primary; a short
   * localStorage lease with a 5s heartbeat is the fallback. The second tab is
   * told to continue in the owning tab instead of silently double-counting.
   */
  const acquireTimerLock = async (): Promise<boolean> => {
    if (lockHeldRef.current) return true;
    const locks = (navigator as any)?.locks;
    if (locks && typeof locks.request === 'function') {
      const acquired = await new Promise<boolean>((resolve) => {
        try {
          locks.request('lq-focus-timer', { mode: 'exclusive', ifAvailable: true }, (lock: unknown) => {
            if (!lock) {
              resolve(false);
              return;
            }
            lockHeldRef.current = true;
            resolve(true);
            return new Promise<void>((release) => {
              lockReleaseRef.current = () => {
                release();
                lockHeldRef.current = false;
              };
            });
          }).catch(() => resolve(false));
        } catch {
          resolve(false);
        }
      });
      if (!acquired) {
        const message = 'Another LearnQuest tab is already tracking focus. Resume or finish it there before starting another timer.';
        setLockNotice(message);
        notify(message);
      } else {
        setLockNotice(null);
      }
      return acquired;
    }
    return tryLocalTimerLock() === true;
  };

  // Recover a persisted timer after reload. A running session is closed at the
  // last persisted tick and shown as paused: closed-tab time is never counted.
  useEffect(() => {
    const loaded = loadTimer(storageKey);
    setTimer(loaded.state);
    setRecovered(loaded.recovered);
    setRecoveredReview(Boolean(loaded.state.recoveredReview));
    setNote(loaded.note);
    setManualMin(loaded.manualMin);
    setHydrated(true);
    setNow(Date.now());
    releaseTimerLock();
    if (loaded.recovered) {
      notify('Focus timer recovered in a paused state. Time while the page was closed was not counted.');
    }
    // A key change means a different account or storage mode; any lock from
    // the previous key must not carry over.
  }, [storageKey]);

  useEffect(() => () => releaseTimerLock(), []);

  useEffect(() => {
    if (!hydrated) return;
    const active = timer.phase === 'running' || timer.phase === 'paused';
    if (!active && breakUntil === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hydrated, timer.phase, breakUntil]);

  // Persist at most every five seconds while running (plus every explicit
  // transition), instead of rewriting localStorage on every 1s tick.
  useEffect(() => {
    if (!hydrated) return;
    const id = window.setInterval(() => {
      const current = timerRef.current;
      if (current.phase !== 'running') return;
      const at = Date.now();
      const touched = touchFocus(current, at, monoNow());
      setTimer((prev) => (prev.phase === 'running' ? touchFocus(prev, at, monoNow()) : prev));
      persistTimer(storageKeyRef.current, touched, noteRef.current, manualRef.current);
      if (!lockHeldRef.current) return;
      try {
        const key = `${LOCK_LEASE_PREFIX}${storageKeyRef.current}`;
        const raw = localStorage.getItem(key);
        const lease = raw ? JSON.parse(raw) : null;
        if (lease?.owner === tabIdRef.current || !lease) {
          localStorage.setItem(key, JSON.stringify({ owner: tabIdRef.current, expires: Date.now() + LOCK_LEASE_MS }));
        }
      } catch {
        /* ignore */
      }
    }, 5_000);
    return () => clearInterval(id);
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const hasDraft = note.length > 0 || manualMin !== null;
    if (timer.phase === 'idle' && timer.startedAtMs === null && !hasDraft) {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* noop */
      }
      return;
    }
    // Persist the in-progress note/correction with the timer state so a reload
    // cannot silently discard the user's unfinished session context.
    persistTimer(storageKey, timer, note, manualMin);
  }, [hydrated, storageKey, timer, note, manualMin]);

  useEffect(() => {
    if (breakUntil === null) return;
    if (now < breakUntil) return;
    setBreakUntil(null);
    notify('Break over — resume when you are ready.');
  }, [now, breakUntil]);

  // Hiding the tab automatically pauses the active timer. This prevents
  // background throttling/unload from inventing focus time; user resumes.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') return;
      const current = timerRef.current;
      if (current.phase !== 'running') return;
      const at = Date.now();
      const paused = pauseFocus(current, at, monoNow(), { hidden: true });
      setTimer(paused);
      persistTimer(storageKeyRef.current, paused, noteRef.current, manualRef.current);
      notify('Focus paused automatically when the tab was hidden. Resume when you return.');
    };
    const onUnload = () => {
      const current = timerRef.current;
      const at = Date.now();
      if (current.phase === 'running') {
        const paused = pauseFocus(current, at, monoNow(), { hidden: true });
        persistTimer(storageKeyRef.current, paused, noteRef.current, manualRef.current);
      } else if (current.phase !== 'idle') {
        persistTimer(storageKeyRef.current, touchFocus(current, at, monoNow()), noteRef.current, manualRef.current);
      }
    };
    const onPageHide = () => onUnload();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onUnload);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onUnload);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  // Clear-all wipes the recovery key so a stale timer cannot resurrect.
  useEffect(() => {
    const onClear = () => {
      setTimer(idleFocusState());
      setBreakUntil(null);
      setNote('');
      setManualMin(null);
      setRecovered(false);
      setRecoveredReview(false);
      releaseTimerLock();
      try {
        localStorage.removeItem(storageKeyRef.current);
        localStorage.removeItem(TIMER_STORAGE_KEY_V1);
      } catch {
        /* noop */
      }
    };
    window.addEventListener('lq:data-cleared', onClear);
    return () => window.removeEventListener('lq:data-cleared', onClear);
  }, []);

  const activeSec = Math.floor(activeMs(timer, now) / 1000);
  const wallSec = Math.floor(wallMs(timer, now) / 1000);
  const breakLeft = breakUntil ? Math.max(0, Math.ceil((breakUntil - now) / 1000)) : 0;

  const beginStart = () => {
    const at = Date.now();
    const mono = monoNow();
    setNow(at);
    setTimer((prev) => {
      const next = prev.phase === 'paused' ? resumeFocus(prev, at, mono) : startFocus(prev, at, mono);
      persistTimer(storageKeyRef.current, next, noteRef.current, manualRef.current);
      return next;
    });
    setRecovered(false);
    setRecoveredReview(false);
  };

  const start = () => {
    const local = tryLocalTimerLock();
    if (local === false) return;
    if (local === true) {
      beginStart();
      return;
    }
    // Web Locks can only be requested asynchronously; the timer starts after
    // the browser confirms this tab owns it.
    void acquireTimerLock().then((allowed) => {
      if (allowed) beginStart();
    });
  };

  const pause = () => {
    const at = Date.now();
    setNow(at);
    setTimer((prev) => {
      const next = pauseFocus(prev, at, monoNow());
      persistTimer(storageKeyRef.current, next, noteRef.current, manualRef.current);
      return next;
    });
  };

  const reset = () => {
    if (finishing.current) return;
    finishing.current = true;
    setConfirmReset(false);
    setTimer(idleFocusState());
    setBreakUntil(null);
    setManualMin(null);
    setManualError(null);
    setNote('');
    setRecovered(false);
    setRecoveredReview(false);
    releaseTimerLock();
    try {
      localStorage.removeItem(storageKeyRef.current);
    } catch {
      /* noop */
    }
    finishing.current = false;
  };

  const finish = () => {
    if (finishing.current) return;
    if (timer.phase === 'idle' || timer.phase === 'finished') return;
    finishing.current = true;
    const at = Date.now();
    const draft = finishFocus(timer, at, monoNow());
    if (!draft) {
      finishing.current = false;
      return;
    }
    let finalActive = draft.activeSec;
    let estimated = false;
    if (manualMin !== null) {
      if (!Number.isFinite(manualMin) || manualMin <= 0 || manualMin > 960) {
        setManualError('Correction must be between 1 and 960 minutes.');
        finishing.current = false;
        return;
      }
      finalActive = Math.round(manualMin * 60);
      estimated = true;
    }
    if (!isRecordableFocusSession(finalActive)) {
      notify(`Session under ${FOCUS_MIN_RECORDED_SEC}s — not recorded. Study a little more.`);
      setTimer(idleFocusState());
      setManualMin(null);
      setBreakUntil(null);
      setRecovered(false);
      setRecoveredReview(false);
      releaseTimerLock();
      try {
        localStorage.removeItem(storageKeyRef.current);
      } catch {
        /* noop */
      }
      finishing.current = false;
      return;
    }
    const finalElapsed = Math.max(draft.elapsedSec, finalActive);
    // A second event can fire before React commits the idle timer state. The
    // timer id is the idempotency key, so it is blocked here as well as in the
    // store; repeated Finish clicks can never create two sessions.
    const finishKey = draft.clientId ?? timer.timerId;
    if (finishedTimerIds.current.has(finishKey)) {
      finishing.current = false;
      return;
    }
    finishedTimerIds.current.add(finishKey);
    s.addSession({
      clientId: draft.clientId,
      playlistId: s.activeId,
      startedAt: draft.startedAt,
      finishedAt: draft.finishedAt,
      activeSec: finalActive,
      elapsedSec: finalElapsed,
      pausedSec: Math.max(0, finalElapsed - finalActive),
      // A manual correction is labelled estimated and uses proportional
      // wall-clock attribution instead of pretending the synthetic seconds
      // were observed intervals.
      intervals: estimated ? [] : draft.intervals,
      estimated,
      note: note || undefined,
      timerVersion: draft.timerVersion,
      monotonicActiveMs: estimated ? finalActive * 1000 : draft.monotonicActiveMs,
      gapExcludedMs: draft.gapExcludedMs,
      interruptionCount: draft.interruptionCount,
      recovered: Boolean(draft.recovered || recoveredReview),
      qualified: !estimated && Boolean(draft.qualified),
      tabId: tabIdRef.current,
      saveState: 'confirmed',
    });
    setTimer(idleFocusState());
    setBreakUntil(null);
    setConfirmReset(false);
    setManualMin(null);
    setManualError(null);
    setNote('');
    setRecovered(false);
    setRecoveredReview(false);
    releaseTimerLock();
    try {
      localStorage.removeItem(storageKeyRef.current);
    } catch {
      /* noop */
    }
    notify(estimated ? 'Focus session recorded with a manual correction (estimated).' : 'Focus session recorded.');
    finishing.current = false;
  };

  const startBreak = () => {
    if (!Number.isFinite(s.prefs.breakMin) || s.prefs.breakMin < 0) return;
    if (timer.phase === 'running') pause();
    setBreakUntil(Date.now() + Math.max(0, s.prefs.breakMin) * 60_000);
  };

  const saveGoal = () => {
    if (targetMin === null || targetMin <= 0 || minViable === null || minViable <= 0) {
      setGoalError('Target and minimum viable minutes must both be greater than zero.');
      return;
    }
    if (minViable > targetMin) {
      setGoalError('Minimum viable time cannot exceed the target.');
      return;
    }
    setGoalError(null);
    s.setGoal({ dateKey: todayKey, targetFocusSec: Math.round(targetMin * 60), minViableSec: Math.round(minViable * 60) });
  };

  const focusByDay = attributeFocusByDay(s.sessions, s.prefs.timezone);
  const week = last7(focusByDay, s.prefs.timezone);
  const planned = (s.goals[todayKey]?.targetFocusSec ?? 0) / 60;
  const actual = (focusByDay.get(todayKey) ?? 0) / 60;

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="flex items-center gap-1.5 text-base font-bold"><TimerIcon size={16} /> Focus timer <span className="font-normal text-slate-400">(focused time ≠ video length)</span></h2>
        {(recovered || recoveredReview) && timer.phase === 'paused' && (
          <div className="mt-1 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
            <p>
              Recovered paused session. Time while the page was closed was not counted; press Resume to continue.
            </p>
            {recoveredReview && (
              <p className="mt-1">
                This session needs review because the gap exceeded one minute. Excluded gap: {fmtClock(Math.floor((timer.gapExcludedMs ?? 0) / 1000))}. Finish or discard it explicitly.
              </p>
            )}
          </div>
        )}
        {lockNotice && <p role="alert" className="mt-1 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">{lockNotice}</p>}
        <p className="mt-1 font-mono text-5xl font-bold tabular-nums" aria-live="off">{fmtClock(activeSec)}</p>
        <p className="text-xs text-slate-400">
          Timer-active time excludes pauses. Elapsed time {fmtClock(wallSec)}. The timer auto-pauses when this tab is hidden; only real active intervals are saved.
          Finishing never auto-marks videos complete.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {timer.phase === 'running' ? <Btn onClick={pause}><Pause size={14} /> Pause</Btn> : (
            <Btn variant="primary" onClick={start}><Play size={14} /> {timer.phase === 'paused' ? 'Resume' : 'Start'}</Btn>
          )}
          <Btn variant="primary" onClick={finish} disabled={activeSec < 1 || timer.phase === 'idle'}><CheckCircle2 size={14} /> Finish &amp; record</Btn>
          <Btn onClick={() => setConfirmReset(true)} aria-expanded={confirmReset}>Reset</Btn>
          {timer.phase === 'paused' && breakUntil === null && s.prefs.breakMin > 0 && (
            <Btn onClick={startBreak}><Coffee size={14} /> {s.prefs.breakMin} min break</Btn>
          )}
          {breakUntil !== null && (
            <Btn onClick={() => setBreakUntil(null)}><SkipForward size={14} /> End break ({fmtClock(breakLeft)})</Btn>
          )}
        </div>
        {confirmReset && (
          <div
            role="group"
            aria-label="Confirm timer reset"
            className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200"
          >
            <p>
              Discard this timer? Recorded time, the draft note and any manual correction will be cleared. Finished sessions are not affected.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Btn onClick={reset}>Discard timer</Btn>
              <Btn variant="ghost" onClick={() => setConfirmReset(false)}>Keep timer</Btn>
            </div>
          </div>
        )}
        <details className="mt-2 rounded-xl bg-white/5 p-2 text-xs text-slate-300">
          <summary className="cursor-pointer font-semibold text-slate-200">Add a note or manual correction (optional)</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <Field label="Session note"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you work on?" /></Field>
            <NumberField
              label="Adjust recorded time (minutes, optional — applied on finish)"
              value={manualMin}
              onCommit={setManualMin}
              min={1}
              max={960}
              allowEmpty
              placeholder={`Timer-recorded: ${(activeSec / 60).toFixed(1)} min`}
              error={manualError}
            />
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Adjusted time is saved as an estimated session and is never presented as player-verified playback.
          </p>
        </details>
      </Card>

      <Card>
        <h3 className="text-sm font-bold">Today's plan ({todayKey})</h3>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <NumberField label="Daily study goal (min)" value={targetMin} onCommit={setTargetMin} min={5} max={720} error={goalError} />
          <NumberField label="Minimum daily goal (min)" value={minViable} onCommit={setMinViable} min={1} max={720} />
          <div>
            <Dropdown
              label="Study block length"
              value={String(s.prefs.sessionLenMin)}
              options={[15, 25, 30, 45, 60, 90, 120].map((m) => ({ value: String(m), label: `${m} min` }))}
              onChange={(v) => s.setPrefs({ sessionLenMin: Number(v) })}
            />
          </div>
          <div className="flex items-end"><Btn variant="primary" onClick={saveGoal}>Set goal</Btn></div>
        </div>
        {snap && (() => {
          const prog = computePlaylistProgress(snap, s.progress);
          const remaining = prog.remainingSec;
          return (
            <p className="mt-2 text-xs text-slate-400">
              {remaining !== null
                ? `Remaining content ${formatHuman(remaining)} fits ≈${sessionsNeeded(remaining, s.prefs.sessionLenMin * 60)} sessions of ${s.prefs.sessionLenMin} min (video time; real study with notes/practice usually takes longer).`
                : 'Remaining duration unknown (incomplete metadata) — plan by video count instead.'}
            </p>
          );
        })()}
        {goalError && <p className="mt-1 text-xs text-red-300" role="alert">{goalError}</p>}
        {(() => {
          const g = s.goals[todayKey];
          if (!g) return <p className="mt-1 text-xs text-slate-500">No goal yet today. Even {s.prefs.minViableMin} focused minutes keeps the habit alive.</p>;
          const done = focusByDay.get(todayKey) ?? 0;
          if (done < g.targetFocusSec && g.targetFocusSec - done > 3600) {
            return <p className="mt-1 text-xs text-cyan-300">Large remainder ({formatHuman(g.targetFocusSec - done)}). Consider shrinking to a {s.prefs.minViableMin}-minute minimum viable session — no shame, consistency wins.</p>;
          }
          return null;
        })()}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h3 className="text-sm font-bold">Planned vs actual (today)</h3>
          <p className="text-[11px] text-slate-500">Focused minutes: target vs recorded (pauses excluded)</p>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[{ name: 'Planned', v: Math.round(planned) }, { name: 'Actual', v: Math.round(actual) }]} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff14" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} label={{ value: 'min', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#64748b' }} />
                <Tooltip contentStyle={{ backgroundColor: '#141830', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 12, fontSize: 12, color: '#e8ecf6' }} formatter={(v: any) => [`${v} min`, 'focused']} />
                <Bar dataKey="v" fill="#34d399" radius={[4, 4, 0, 0]} maxBarSize={64} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <h3 className="text-sm font-bold">Session history</h3>
          {s.sessions.length === 0 ? <p className="text-xs text-slate-500">No sessions yet.</p> : (
            <ul className="mt-1 max-h-44 space-y-1 overflow-auto text-xs">
              {[...s.sessions].reverse().slice(0, 20).map((x) => (
                <li key={x.id} className="flex items-center gap-2 border-b border-white/5 pb-1">
                  <span className="font-mono">{x.dateKey}</span>
                  <span className="font-mono">{formatHuman(x.activeSec)}</span>
                  {x.estimated && <span className="text-amber-300">estimated</span>}
                  <span className="truncate text-slate-400">{x.note ?? ''}</span>
                  <button className="ml-auto text-slate-500" onClick={() => s.deleteSession(x.id)} aria-label="Delete session"><Trash2 size={13} /></button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <h3 className="text-sm font-bold">Weekly review (recorded data only)</h3>
        <WeeklyReview days={week} />
      </Card>
    </div>
  );
}

function fmtClock(sec: number) {
  const safe = Number.isFinite(sec) ? Math.max(0, Math.floor(sec)) : 0;
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function last7(focusByDay: Map<string, number>, tz: string) {
  const out: { day: string; sec: number; key: string }[] = [];
  for (const k of calendarWindowDates(7, tz)) {
    out.push({ day: k.slice(5), sec: focusByDay.get(k) ?? 0, key: k });
  }
  return out;
}

function WeeklyReview({ days }: { days: { day: string; sec: number; key: string }[] }) {
  const s = useStore();
  const total = days.reduce((a, d) => a + d.sec, 0);
  const weekKeys = new Set(days.map((d) => d.key));
  const inWeek = (iso: string | null | undefined) => {
    if (!iso) return false;
    try {
      return weekKeys.has(dateKeyInTimezone(new Date(iso), s.prefs.timezone));
    } catch {
      return false;
    }
  };
  const vids = Object.values(s.progress).filter((p) => isProgressComplete(p) && inWeek(p.completedAt)).length;
  const cps = s.checkpoints.filter((c) => inWeek(c.completedAt)).length;
  if (total === 0 && vids === 0) return <p className="text-xs text-slate-500">Insufficient data — finish a video or a focus session to generate a review.</p>;
  return (
    <div className="text-sm">
      <p>{formatHuman(total)} focused · {vids} videos completed · {cps} checkpoints.</p>
      <div className="mt-2 flex gap-1" role="img" aria-label="Study calendar, last 7 days">
        {days.map((d) => (
          <div key={d.key} title={`${d.key}: ${formatHuman(d.sec)}`} className={`h-8 flex-1 rounded ${d.sec === 0 ? 'bg-white/5' : d.sec < 900 ? 'bg-emerald-900' : d.sec < 3600 ? 'bg-emerald-600' : 'bg-emerald-400'}`} />
        ))}
      </div>
      <p className="mt-1 text-xs text-slate-400">Next week: aim for one more active day than this week. Missed days? Welcome back — progress is preserved.</p>
    </div>
  );
}
