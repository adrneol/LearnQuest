import { useEffect, useState } from 'react';
import { Play, CheckCircle2, Trash2, Timer as TimerIcon } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { formatHuman, computePlaylistProgress, sessionsNeeded, dateKeyInTimezone, calendarWindowDates, attributeFocusByDay } from '../../domain/index.js';
import { useStore } from '../../app/store.js';
import { useDayTick } from '../../app/dayTick.js';
import { notify } from '../../services/notifications/notify.js';
import { Dropdown } from '../../components/ui/Dropdown.js';
import { Card, Btn, Field, inputCls } from '../../components/ui/ui.js';

export function Focus() {
  const s = useStore();
  const snap = s.activeId ? s.playlists[s.activeId] : undefined;
  const todayKey = useDayTick(s.prefs.timezone);
  const [targetMin, setTargetMin] = useState(30);
  const [minViable, setMinViable] = useState(s.prefs.minViableMin);
  const [note, setNote] = useState('');
  // timer state (timestamp-based, survives throttling)
  const [runningSince, setRunningSince] = useState<number | null>(null);
  const [accumSec, setAccumSec] = useState(0);
  const [elapsedBase, setElapsedBase] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [manualMin, setManualMin] = useState('');
  useEffect(() => {
    if (runningSince === null) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [runningSince]);
  void tick;
  const activeSec = accumSec + (runningSince ? Math.floor((Date.now() - runningSince) / 1000) : 0);

  const start = () => {
    if (runningSince !== null) return; // idempotent: repeated Start never double-counts
    if (accumSec === 0) setElapsedBase(Date.now());
    setRunningSince(Date.now());
  };
  const pause = () => {
    if (runningSince) {
      setAccumSec((a) => a + Math.floor((Date.now() - runningSince) / 1000));
      setRunningSince(null);
    }
  };
  const resume = () => {
    if (runningSince === null && (accumSec > 0 || elapsedBase !== null)) setRunningSince(Date.now());
  };
  const finish = () => {
    if (runningSince) {
      const extra = Math.floor((Date.now() - runningSince) / 1000);
      setAccumSec((a) => a + extra);
    }
    setRunningSince(null);
    const finalSec = runningSince ? activeSec : accumSec;
    if (finalSec < 10) {
      notify('Session under 10s — not recorded. Study a little more.');
      setAccumSec(0);
      return;
    }
    s.addSession({
      playlistId: s.activeId,
      startedAt: new Date(Date.now() - finalSec * 1000).toISOString(),
      finishedAt: new Date().toISOString(),
      activeSec: finalSec,
      elapsedSec: elapsedBase ? Math.floor((Date.now() - elapsedBase) / 1000) : finalSec,
      note: note || undefined,
    });
    setAccumSec(0);
    setElapsedBase(null);
    setNote('');
    notify(`Focus session recorded.`);
  };

  const saveGoal = () => {
    s.setGoal({ dateKey: todayKey, targetFocusSec: targetMin * 60, minViableSec: minViable * 60 });
  };

  const focusByDay = attributeFocusByDay(s.sessions, s.prefs.timezone);
  const week = last7(focusByDay, s.prefs.timezone);
  const planned = (s.goals[todayKey]?.targetFocusSec ?? 0) / 60;
  const actual = (focusByDay.get(todayKey) ?? 0) / 60;

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="flex items-center gap-1.5 text-base font-bold"><TimerIcon size={16} /> Focus timer <span className="font-normal text-slate-400">(focused time ≠ video length)</span></h2>
        <p className="mt-1 font-mono text-5xl font-bold tabular-nums">{fmtClock(activeSec)}</p>
        <p className="text-xs text-slate-400">Elapsed includes pauses; only active time is recorded. Finishing never auto-marks videos complete.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {runningSince === null ? <Btn variant="primary" onClick={accumSec > 0 ? resume : start}><Play size={14} /> {accumSec > 0 ? 'Resume' : 'Start'}</Btn> : <Btn onClick={pause}>Pause</Btn>}
          <Btn variant="primary" onClick={finish} disabled={activeSec < 1}><CheckCircle2 size={14} /> Finish & record</Btn>
          <Btn onClick={() => { setRunningSince(null); setAccumSec(0); setElapsedBase(null); }}>Reset</Btn>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Field label="Session note"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you work on?" /></Field>
          <Field label="Manual correction (minutes, applied on finish)">
            <input className={inputCls} value={manualMin} onChange={(e) => {
              setManualMin(e.target.value);
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 0) setAccumSec(Math.round(v * 60) - (runningSince ? Math.floor((Date.now() - runningSince) / 1000) : 0));
            }} placeholder="e.g. 22" inputMode="numeric" />
          </Field>
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-bold">Today's plan ({todayKey})</h3>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Field label="Target focus (min)"><input type="number" className={inputCls} value={targetMin} min={5} onChange={(e) => setTargetMin(Number(e.target.value))} /></Field>
          <Field label="Minimum viable (min)"><input type="number" className={inputCls} value={minViable} min={1} onChange={(e) => setMinViable(Number(e.target.value))} /></Field>
          <div>
            <Dropdown
              label="Session length (min)"
              value={String(s.prefs.sessionLenMin)}
              options={[10, 15, 25, 45, 60].map((m) => ({ value: String(m), label: `${m} min` }))}
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
        {(() => {
          const g = s.goals[todayKey];
          if (!g) return <p className="mt-1 text-xs text-slate-500">No goal yet today. Even {minViable} focused minutes keeps the habit alive.</p>;
          const done = s.sessions.filter((x) => x.dateKey === todayKey).reduce((a, x) => a + x.activeSec, 0);
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
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
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
  // Calendar-correct week start in the display timezone (not a UTC slice).
  const weekKeys = new Set(days.map((d) => d.key));
  const inWeek = (iso: string | null | undefined) => {
    if (!iso) return false;
    try {
      return weekKeys.has(dateKeyInTimezone(new Date(iso), s.prefs.timezone));
    } catch {
      return false;
    }
  };
  const vids = Object.values(s.progress).filter((p) => inWeek(p.completedAt)).length;
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

/* ---------------- Revision ---------------- */
