// Deterministic focus-timer state machine.
//
// The timer stores real wall-clock anchors plus active/paused intervals. Active
// duration excludes pauses; elapsed duration includes them. Recovery/finish are
// idempotent so repeated clicks cannot double-save a session or award XP twice.

import type { FocusInterval, StudySession } from '../../types/index.js';

export type FocusPhase = 'idle' | 'running' | 'paused' | 'finished';

export interface FocusTimerState {
  phase: FocusPhase;
  /** Idempotency key for the timer instance; reused by the saved session. */
  timerId: string;
  startedAtMs: number | null;
  segmentStartedAtMs: number | null;
  pausedAtMs: number | null;
  activeAccumMs: number;
  intervals: FocusInterval[];
  lastUpdatedMs: number;
  /**
   * Wall-clock time spent with the page closed (or otherwise interrupted)
   * during recovery. It is excluded from displayed/finished elapsed time while
   * the real startedAt anchor and active intervals remain truthful.
   */
  excludedWallMs: number;
}

export type FocusSessionDraft = Omit<StudySession, 'id' | 'dateKey' | 'playlistId'>;

const MAX_SESSION_MS = 24 * 3600 * 1000;
const MIN_RECORDED_SEC = 10;

function uid(now: number): string {
  return `focus-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function idleFocusState(now = Date.now(), timerId = uid(now)): FocusTimerState {
  return {
    phase: 'idle',
    timerId,
    startedAtMs: null,
    segmentStartedAtMs: null,
    pausedAtMs: null,
    activeAccumMs: 0,
    intervals: [],
    lastUpdatedMs: now,
    excludedWallMs: 0,
  };
}

export function startFocus(state: FocusTimerState, now = Date.now()): FocusTimerState {
  if (state.phase === 'running') return state;
  if (state.phase === 'paused') return resumeFocus(state, now);
  if (state.phase === 'finished') return state;
  return {
    ...state,
    phase: 'running',
    timerId: state.timerId || uid(now),
    startedAtMs: now,
    segmentStartedAtMs: now,
    pausedAtMs: null,
    activeAccumMs: 0,
    intervals: [],
    lastUpdatedMs: now,
    excludedWallMs: 0,
  };
}

export function pauseFocus(state: FocusTimerState, now = Date.now()): FocusTimerState {
  if (state.phase !== 'running' || state.segmentStartedAtMs === null) return state;
  const end = Math.max(state.segmentStartedAtMs, Math.min(now, state.segmentStartedAtMs + MAX_SESSION_MS));
  const delta = Math.max(0, end - state.segmentStartedAtMs);
  return {
    ...state,
    phase: 'paused',
    activeAccumMs: state.activeAccumMs + delta,
    segmentStartedAtMs: null,
    pausedAtMs: end,
    intervals: [
      ...state.intervals,
      { startMs: state.segmentStartedAtMs, endMs: end, kind: 'active' },
    ],
    lastUpdatedMs: end,
  };
}

export function resumeFocus(state: FocusTimerState, now = Date.now()): FocusTimerState {
  if (state.phase !== 'paused' || state.startedAtMs === null) return state;
  const at = Math.max(state.pausedAtMs ?? now, now);
  return {
    ...state,
    phase: 'running',
    segmentStartedAtMs: at,
    intervals: state.pausedAtMs !== null
      ? [...state.intervals, { startMs: state.pausedAtMs, endMs: at, kind: 'paused' }]
      : state.intervals,
    pausedAtMs: null,
    lastUpdatedMs: at,
  };
}

export function activeMs(state: FocusTimerState, now = Date.now()): number {
  if (state.phase !== 'running' || state.segmentStartedAtMs === null) return Math.max(0, state.activeAccumMs);
  return Math.max(0, state.activeAccumMs + Math.max(0, now - state.segmentStartedAtMs));
}

export function wallMs(state: FocusTimerState, now = Date.now()): number {
  if (state.startedAtMs === null) return 0;
  return Math.max(0, now - state.startedAtMs - Math.max(0, state.excludedWallMs || 0));
}

/**
 * Close the open interval and produce a session draft. Returns null for
 * idle/finished states, making duplicate Finish clicks idempotent.
 */
export function finishFocus(state: FocusTimerState, now = Date.now()): FocusSessionDraft | null {
  if (state.phase === 'idle' || state.phase === 'finished' || state.startedAtMs === null) return null;
  let closed = state;
  if (state.phase === 'running') closed = pauseFocus(state, now);
  else if (state.phase === 'paused' && state.pausedAtMs !== null) {
    // Do not write a synthetic multi-hour pause interval for time the page was
    // closed. The observed pause ends at the last persisted tick.
    const observedNow = Math.max(state.pausedAtMs, now - Math.max(0, state.excludedWallMs || 0));
    const end = Math.min(now, observedNow);
    closed = {
      ...state,
      phase: 'finished',
      intervals: [...state.intervals, { startMs: state.pausedAtMs, endMs: end, kind: 'paused' as const }].filter((i) => i.endMs > i.startMs),
      lastUpdatedMs: end,
    };
  }
  const activeSec = Math.floor(Math.max(0, closed.activeAccumMs) / 1000);
  const elapsedSec = Math.max(
    activeSec,
    Math.floor(Math.max(0, now - state.startedAtMs - Math.max(0, state.excludedWallMs || 0)) / 1000),
  );
  const intervals = closed.intervals
    .filter((i) => Number.isFinite(i.startMs) && Number.isFinite(i.endMs) && i.endMs >= i.startMs)
    .map((i) => ({ ...i, endMs: Math.max(i.startMs, i.endMs) }));
  return {
    clientId: state.timerId,
    startedAt: new Date(state.startedAtMs).toISOString(),
    finishedAt: new Date(now).toISOString(),
    activeSec,
    elapsedSec,
    pausedSec: Math.max(0, elapsedSec - activeSec),
    intervals,
    estimated: false,
  };
}

/**
 * Recover persisted state after reload. A session that was running is closed
 * at the last persisted tick and returned as paused: time while the page was
 * closed is never counted as focus.
 */
export function recoverFocusState(raw: unknown, now = Date.now()): { state: FocusTimerState; recovered: boolean } {
  const sanitized = sanitizeFocusState(raw, now);
  const closedMs = Math.max(0, now - sanitized.lastUpdatedMs);
  if (sanitized.phase !== 'running') {
    return {
      state: {
        ...sanitized,
        // A paused timer is still "open"; time while the page was closed is
        // not wall-clock study and must not inflate elapsed/paused time.
        excludedWallMs: Math.max(0, sanitized.excludedWallMs) + closedMs,
        lastUpdatedMs: now,
      },
      recovered: sanitized.phase === 'paused',
    };
  }
  const last = Math.min(now, Math.max(sanitized.segmentStartedAtMs ?? sanitized.lastUpdatedMs, sanitized.lastUpdatedMs));
  const recovered = pauseFocus({ ...sanitized, lastUpdatedMs: last }, last);
  return {
    state: {
      ...recovered,
      excludedWallMs: Math.max(0, sanitized.excludedWallMs) + Math.max(0, now - last),
      lastUpdatedMs: now,
    },
    recovered: true,
  };
}

export function sanitizeFocusState(raw: unknown, now = Date.now()): FocusTimerState {
  const empty = idleFocusState(now);
  if (typeof raw !== 'object' || raw === null) return empty;
  const r = raw as Record<string, unknown>;
  const phase: FocusPhase = r.phase === 'running' || r.phase === 'paused' || r.phase === 'finished' ? r.phase : 'idle';
  if (phase === 'idle' || phase === 'finished') return { ...empty, phase };
  const startedAtMs = Number(r.startedAtMs);
  if (!Number.isFinite(startedAtMs) || startedAtMs <= 0 || startedAtMs > now + 300_000) return empty;
  const lastUpdatedMs = Number.isFinite(Number(r.lastUpdatedMs))
    ? Math.max(startedAtMs, Math.min(now, Number(r.lastUpdatedMs)))
    : now;
  const activeAccumMs = Number.isFinite(Number(r.activeAccumMs))
    ? Math.max(0, Math.min(MAX_SESSION_MS, Number(r.activeAccumMs)))
    : 0;
  const intervals: FocusInterval[] = Array.isArray(r.intervals)
    ? (r.intervals as unknown[])
      .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null)
      .map((i) => ({
        startMs: Number(i.startMs),
        endMs: Number(i.endMs),
        kind: i.kind === 'paused' ? 'paused' as const : 'active' as const,
      }))
      .filter((i) => Number.isFinite(i.startMs) && Number.isFinite(i.endMs) && i.endMs >= i.startMs)
      .slice(-1000)
    : [];
  const seg = Number(r.segmentStartedAtMs);
  const segmentStartedAtMs = phase === 'running' && Number.isFinite(seg) && seg >= startedAtMs && seg <= now ? seg : null;
  const pausedAtMs = phase === 'paused' && Number.isFinite(Number(r.pausedAtMs))
    ? Math.max(startedAtMs, Math.min(now, Number(r.pausedAtMs)))
    : null;
  const excludedWallMs = Number.isFinite(Number(r.excludedWallMs))
    ? Math.max(0, Math.min(MAX_SESSION_MS, Number(r.excludedWallMs)))
    : 0;
  return {
    phase: segmentStartedAtMs === null && phase === 'running' ? 'paused' : phase,
    timerId: typeof r.timerId === 'string' && r.timerId ? r.timerId : empty.timerId,
    startedAtMs,
    segmentStartedAtMs,
    pausedAtMs: segmentStartedAtMs === null && phase === 'running' ? lastUpdatedMs : pausedAtMs,
    activeAccumMs: Math.min(activeAccumMs, Math.max(0, now - startedAtMs)),
    intervals,
    lastUpdatedMs,
    excludedWallMs,
  };
}

export function isRecordableFocusSession(activeSec: number): boolean {
  return Number.isSafeInteger(activeSec) && activeSec >= MIN_RECORDED_SEC;
}

export const FOCUS_MIN_RECORDED_SEC = MIN_RECORDED_SEC;
