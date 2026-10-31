// Deterministic focus-timer state machine.
//
// The timer stores real wall-clock anchors plus active/paused intervals. Active
// duration excludes pauses; elapsed duration includes them. Recovery/finish are
// idempotent so repeated clicks cannot double-save a session or award XP twice.

import type { FocusInterval, StudySession } from '../../types/index.js';

export type FocusPhase = 'idle' | 'running' | 'paused' | 'finished';

/**
 * Current timing semantics. v1 records wall-clock anchors only. v2 adds a
 * monotonic segment anchor plus explicit gap/recovery metadata so a clock jump,
 * sleep, or closed tab cannot silently become focus time.
 */
export const FOCUS_TIMER_VERSION = 2;
/** Maximum time a suspect 60s–5min gap may contribute. */
export const FOCUS_MAX_GAP_COUNT_MS = 60_000;
/** Gaps at or above this need an explicit recovery review. */
export const FOCUS_GAP_REVIEW_MS = 60_000;
/** Gaps at or above this are excluded rather than counted. */
export const FOCUS_GAP_EXCLUDE_MS = 5 * 60_000;

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
  /** Semantics version; missing values are legacy v1 records. */
  timerVersion?: number;
  /** `performance.now()` at the start of the open active segment. */
  segmentMonoStartMs?: number | null;
  /** Last persisted monotonic/wall anchors used to detect clock jumps. */
  lastGoodMonoMs?: number;
  lastGoodWallMs?: number;
  /** Time deliberately excluded because it was a suspect gap. */
  gapExcludedMs?: number;
  interruptionCount?: number;
  /** A recovered session older than a normal pause needs explicit review. */
  recoveredReview?: boolean;
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
    timerVersion: FOCUS_TIMER_VERSION,
    segmentMonoStartMs: null,
    lastGoodMonoMs: 0,
    lastGoodWallMs: now,
    gapExcludedMs: 0,
    interruptionCount: 0,
    recoveredReview: false,
  };
}

export function startFocus(state: FocusTimerState, now = Date.now(), monoNow?: number): FocusTimerState {
  if (state.phase === 'running') return state;
  if (state.phase === 'paused') return resumeFocus(state, now, monoNow);
  if (state.phase === 'finished') return state;
  const mono = Number.isFinite(monoNow) ? Number(monoNow) : null;
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
    timerVersion: FOCUS_TIMER_VERSION,
    segmentMonoStartMs: mono,
    lastGoodMonoMs: mono ?? 0,
    lastGoodWallMs: now,
    gapExcludedMs: 0,
    interruptionCount: 0,
    recoveredReview: false,
  };
}

/**
 * Resolve one active segment against the wall and (when supplied) monotonic
 * clocks. A wall jump that monotonic time does not confirm is not counted. A
 * genuinely long segment with agreeing clocks is normal and is fully counted.
 */
export function resolveFocusSegment(args: {
  wallDeltaMs: number;
  monoDeltaMs?: number | null;
  hidden?: boolean;
}): { countedMs: number; excludedMs: number; review: boolean; reason: string } {
  const wall = Number.isFinite(args.wallDeltaMs) ? args.wallDeltaMs : 0;
  if (wall <= 0) {
    return { countedMs: 0, excludedMs: 0, review: wall < 0, reason: wall < 0 ? 'clock-backward' : 'empty' };
  }
  // A page that was hidden cannot prove the user was present, even when both
  // clocks advanced together across a sleep. Count at most one minute and keep
  // the rest as an explicit, reviewable gap.
  if (args.hidden && wall > FOCUS_MAX_GAP_COUNT_MS) {
    return {
      countedMs: FOCUS_MAX_GAP_COUNT_MS,
      excludedMs: wall - FOCUS_MAX_GAP_COUNT_MS,
      review: true,
      reason: 'hidden-gap',
    };
  }
  const mono = args.monoDeltaMs;
  if (mono === undefined || mono === null || !Number.isFinite(mono)) {
    // Legacy callers have no monotonic clock. A user-requested pause after a
    // long continuous segment is legitimate, so trust the wall anchor.
    return { countedMs: wall, excludedMs: 0, review: false, reason: 'wall-only' };
  }
  if (mono < 0) {
    return { countedMs: 0, excludedMs: wall, review: true, reason: 'clock-backward' };
  }
  const discrepancy = Math.abs(wall - mono);
  if (discrepancy <= 2_000) {
    return { countedMs: mono, excludedMs: 0, review: false, reason: 'clocks-agree' };
  }
  // The wall clock moved without the monotonic clock: honour elapsed monotonic
  // time and exclude the artificial jump.
  if (mono <= FOCUS_GAP_EXCLUDE_MS) {
    return { countedMs: mono, excludedMs: Math.max(0, wall - mono), review: true, reason: 'clock-jump' };
  }
  // Both clocks advanced across a long gap (sleep/suspend). Count at most one
  // minute, exclude the rest, and require review.
  const counted = Math.min(mono, FOCUS_MAX_GAP_COUNT_MS);
  return {
    countedMs: counted,
    excludedMs: Math.max(0, mono - counted),
    review: true,
    reason: args.hidden ? 'hidden-gap' : 'suspect-gap',
  };
}

export function pauseFocus(
  state: FocusTimerState,
  now = Date.now(),
  monoNow?: number,
  opts?: { hidden?: boolean },
): FocusTimerState {
  if (state.phase !== 'running' || state.segmentStartedAtMs === null) return state;
  const end = Math.max(state.segmentStartedAtMs, now);
  const mono = Number.isFinite(monoNow) && Number.isFinite(state.segmentMonoStartMs)
    ? Number(monoNow) - Number(state.segmentMonoStartMs)
    : undefined;
  const resolved = resolveFocusSegment({
    wallDeltaMs: end - state.segmentStartedAtMs,
    monoDeltaMs: mono,
    hidden: opts?.hidden,
  });
  const countedEnd = Math.min(end, state.segmentStartedAtMs + resolved.countedMs);
  return {
    ...state,
    phase: 'paused',
    activeAccumMs: state.activeAccumMs + resolved.countedMs,
    segmentStartedAtMs: null,
    segmentMonoStartMs: null,
    pausedAtMs: countedEnd,
    intervals: resolved.countedMs > 0
      ? [
        ...state.intervals,
        { startMs: state.segmentStartedAtMs, endMs: countedEnd, kind: 'active' },
      ]
      : state.intervals,
    lastUpdatedMs: end,
    lastGoodWallMs: end,
    lastGoodMonoMs: Number.isFinite(monoNow) ? Number(monoNow) : state.lastGoodMonoMs,
    gapExcludedMs: Math.max(0, state.gapExcludedMs ?? 0) + resolved.excludedMs,
    interruptionCount: (state.interruptionCount ?? 0) + (resolved.excludedMs > 0 ? 1 : 0),
    recoveredReview: Boolean(state.recoveredReview || resolved.review),
  };
}

export function resumeFocus(state: FocusTimerState, now = Date.now(), monoNow?: number): FocusTimerState {
  if (state.phase !== 'paused' || state.startedAtMs === null) return state;
  const at = Math.max(state.pausedAtMs ?? now, now);
  const mono = Number.isFinite(monoNow) ? Number(monoNow) : null;
  return {
    ...state,
    phase: 'running',
    segmentStartedAtMs: at,
    segmentMonoStartMs: mono,
    intervals: state.pausedAtMs !== null
      ? [...state.intervals, { startMs: state.pausedAtMs, endMs: at, kind: 'paused' }]
      : state.intervals,
    pausedAtMs: null,
    lastUpdatedMs: at,
    lastGoodWallMs: at,
    lastGoodMonoMs: mono ?? state.lastGoodMonoMs,
    recoveredReview: false,
  };
}

/** Persist a heartbeat without changing the phase. */
export function touchFocus(state: FocusTimerState, now = Date.now(), monoNow?: number): FocusTimerState {
  return {
    ...state,
    lastUpdatedMs: now,
    lastGoodWallMs: now,
    lastGoodMonoMs: Number.isFinite(monoNow) ? Number(monoNow) : state.lastGoodMonoMs,
  };
}

export function activeMs(state: FocusTimerState, now = Date.now()): number {
  if (state.phase !== 'running' || state.segmentStartedAtMs === null) return Math.max(0, state.activeAccumMs);
  return Math.max(0, state.activeAccumMs + Math.max(0, now - state.segmentStartedAtMs));
}

/** Merge overlapping active or paused intervals; never double-count. */
export function mergeFocusIntervals(intervals: FocusInterval[], kind: FocusInterval['kind'] = 'active'): FocusInterval[] {
  const sorted = intervals
    .filter((i) => i.kind === kind && Number.isFinite(i.startMs) && Number.isFinite(i.endMs) && i.endMs > i.startMs)
    .map((i) => ({ startMs: i.startMs, endMs: i.endMs, kind }))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const out: FocusInterval[] = [];
  for (const interval of sorted) {
    const last = out[out.length - 1];
    if (last && interval.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, interval.endMs);
    } else {
      out.push({ ...interval });
    }
  }
  return out;
}

export function intervalUnionMs(intervals: FocusInterval[], kind: FocusInterval['kind'] = 'active'): number {
  return mergeFocusIntervals(intervals, kind).reduce((sum, i) => sum + (i.endMs - i.startMs), 0);
}

/** Subtract the paused union from the active union. */
export function qualifiedFocusMs(intervals: FocusInterval[]): number {
  const active = mergeFocusIntervals(intervals, 'active');
  const paused = mergeFocusIntervals(intervals, 'paused');
  let total = 0;
  for (const interval of active) {
    let segments: Array<[number, number]> = [[interval.startMs, interval.endMs]];
    for (const pause of paused) {
      if (pause.endMs <= interval.startMs || pause.startMs >= interval.endMs) continue;
      const next: Array<[number, number]> = [];
      for (const [start, end] of segments) {
        if (pause.endMs <= start || pause.startMs >= end) {
          next.push([start, end]);
          continue;
        }
        if (pause.startMs > start) next.push([start, Math.min(end, pause.startMs)]);
        if (pause.endMs < end) next.push([Math.max(start, pause.endMs), end]);
      }
      segments = next;
    }
    total += segments.reduce((sum, [start, end]) => sum + Math.max(0, end - start), 0);
  }
  return total;
}

export function wallMs(state: FocusTimerState, now = Date.now()): number {
  if (state.startedAtMs === null) return 0;
  return Math.max(0, now - state.startedAtMs - Math.max(0, state.excludedWallMs || 0));
}

/**
 * Close the open interval and produce a session draft. Returns null for
 * idle/finished states, making duplicate Finish clicks idempotent.
 */
export function finishFocus(state: FocusTimerState, now = Date.now(), monoNow?: number): FocusSessionDraft | null {
  if (state.phase === 'idle' || state.phase === 'finished' || state.startedAtMs === null) return null;
  let closed = state;
  if (state.phase === 'running') closed = pauseFocus(state, now, monoNow);
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
  const unionActiveMs = intervalUnionMs(closed.intervals, 'active');
  const baseActiveMs = closed.intervals.some((i) => i.kind === 'active')
    ? Math.min(closed.activeAccumMs, unionActiveMs)
    : closed.activeAccumMs;
  const activeSec = Math.floor(Math.max(0, baseActiveMs) / 1000);
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
    timerVersion: FOCUS_TIMER_VERSION,
    monotonicActiveMs: unionActiveMs,
    gapExcludedMs: Math.max(0, state.gapExcludedMs ?? 0),
    interruptionCount: Math.max(0, state.interruptionCount ?? 0),
    recovered: Boolean(state.recoveredReview),
    qualified: Math.floor(Math.max(0, qualifiedFocusMs(intervals)) / 1000) >= activeSec,
    saveState: 'confirmed',
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
  const agedOut = sanitized.startedAtMs !== null && now - sanitized.startedAtMs > 24 * 3600_000;
  const review = closedMs >= FOCUS_GAP_REVIEW_MS || agedOut;
  if (sanitized.phase !== 'running') {
    return {
      state: {
        ...sanitized,
        // A paused timer is still "open"; time while the page was closed is
        // not wall-clock study and must not inflate elapsed/paused time.
        excludedWallMs: Math.max(0, sanitized.excludedWallMs) + closedMs,
        gapExcludedMs: Math.max(0, sanitized.gapExcludedMs ?? 0) + closedMs,
        interruptionCount: (sanitized.interruptionCount ?? 0) + (closedMs >= FOCUS_GAP_REVIEW_MS ? 1 : 0),
        recoveredReview: Boolean(sanitized.recoveredReview || review),
        lastUpdatedMs: now,
        lastGoodWallMs: now,
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
      gapExcludedMs: Math.max(0, sanitized.gapExcludedMs ?? 0) + Math.max(0, now - last),
      interruptionCount: (sanitized.interruptionCount ?? 0) + (Math.max(0, now - last) >= FOCUS_GAP_REVIEW_MS ? 1 : 0),
      recoveredReview: Boolean(recovered.recoveredReview || review),
      lastUpdatedMs: now,
      lastGoodWallMs: now,
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
  const segmentMonoStartMs = phase === 'running' && Number.isFinite(Number(r.segmentMonoStartMs))
    ? Math.max(0, Number(r.segmentMonoStartMs))
    : null;
  const lastGoodMonoMs = Number.isFinite(Number(r.lastGoodMonoMs)) ? Math.max(0, Number(r.lastGoodMonoMs)) : 0;
  const lastGoodWallMs = Number.isFinite(Number(r.lastGoodWallMs))
    ? Math.max(startedAtMs, Math.min(now, Number(r.lastGoodWallMs)))
    : lastUpdatedMs;
  const gapExcludedMs = Number.isFinite(Number(r.gapExcludedMs))
    ? Math.max(0, Math.min(MAX_SESSION_MS, Number(r.gapExcludedMs)))
    : 0;
  const interruptionCount = Number.isFinite(Number(r.interruptionCount))
    ? Math.max(0, Math.min(10_000, Math.floor(Number(r.interruptionCount))))
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
    timerVersion: Number(r.timerVersion) === FOCUS_TIMER_VERSION ? FOCUS_TIMER_VERSION : 1,
    segmentMonoStartMs,
    lastGoodMonoMs,
    lastGoodWallMs,
    gapExcludedMs,
    interruptionCount,
    recoveredReview: r.recoveredReview === true,
  };
}

export function isRecordableFocusSession(activeSec: number): boolean {
  return Number.isSafeInteger(activeSec) && activeSec >= MIN_RECORDED_SEC;
}

export const FOCUS_MIN_RECORDED_SEC = MIN_RECORDED_SEC;
