import { describe, it, expect } from 'vitest';
import {
  idleFocusState, startFocus, pauseFocus, resumeFocus, activeMs, wallMs, finishFocus,
  recoverFocusState, sanitizeFocusState, isRecordableFocusSession, FOCUS_MIN_RECORDED_SEC,
} from '../src/domain/focus/focus.js';
import { focusSessionDaySlices } from '../src/domain/time/time.js';

const T0 = Date.parse('2026-10-27T23:40:00.000Z');

describe('deterministic focus timer state machine', () => {
  it('tracks real timestamps, excludes pauses, and finishes exactly once', () => {
    let s = idleFocusState(T0, 'timer-test');
    s = startFocus(s, T0);
    expect(s.phase).toBe('running');
    expect(s.startedAtMs).toBe(T0);
    expect(activeMs(s, T0 + 60_000)).toBe(60_000);
    expect(wallMs(s, T0 + 60_000)).toBe(60_000);

    s = pauseFocus(s, T0 + 90_000);
    expect(s.phase).toBe('paused');
    expect(activeMs(s, T0 + 5 * 60_000)).toBe(90_000);
    expect(wallMs(s, T0 + 5 * 60_000)).toBe(5 * 60_000);

    s = resumeFocus(s, T0 + 5 * 60_000);
    expect(s.phase).toBe('running');
    expect(activeMs(s, T0 + 6 * 60_000)).toBe(150_000);

    const at = T0 + 6 * 60_000;
    const draft = finishFocus(s, at)!;
    expect(draft.startedAt).toBe(new Date(T0).toISOString());
    expect(draft.finishedAt).toBe(new Date(at).toISOString());
    expect(draft.activeSec).toBe(150);
    expect(draft.elapsedSec).toBe(360);
    expect(draft.pausedSec).toBe(210);
    expect(draft.estimated).toBe(false);
    expect(draft.intervals?.filter((i) => i.kind === 'active')).toHaveLength(2);
    expect(draft.intervals?.filter((i) => i.kind === 'paused')).toHaveLength(1);

    // Duplicate Finish clicks cannot produce a second session.
    const finished = { ...s, phase: 'finished' as const };
    expect(finishFocus(finished, at + 1000)).toBeNull();
  });

  it('preserves wall-clock start/finish across repeated pause/resume cycles', () => {
    let s = startFocus(idleFocusState(T0, 'timer-cycle'), T0);
    s = pauseFocus(s, T0 + 10_000);
    s = resumeFocus(s, T0 + 20_000);
    s = pauseFocus(s, T0 + 30_000);
    s = resumeFocus(s, T0 + 40_000);
    s = pauseFocus(s, T0 + 50_000);
    const draft = finishFocus(s, T0 + 60_000)!;
    expect(draft.activeSec).toBe(30);
    expect(draft.elapsedSec).toBe(60);
    expect(draft.intervals?.filter((i) => i.kind === 'active').map((i) => i.endMs - i.startMs)).toEqual([10_000, 10_000, 10_000]);
  });

  it('attributes a cross-midnight session to both calendar days without inventing time', () => {
    const start = Date.parse('2026-10-27T23:50:00.000Z');
    const end = Date.parse('2026-10-28T00:20:00.000Z');
    let s = startFocus(idleFocusState(start, 'timer-midnight'), start);
    s = pauseFocus(s, end);
    const draft = finishFocus(s, end)!;
    const slices = focusSessionDaySlices(draft, 'UTC');
    expect(slices).toEqual([
      { dateKey: '2026-10-27', sec: 600 },
      { dateKey: '2026-10-28', sec: 1200 },
    ]);
    expect(slices.reduce((a, x) => a + x.sec, 0)).toBe(draft.activeSec);
  });

  it('recovers a running timer as paused at the last persisted tick (closed-tab time never counts)', () => {
    const running = startFocus(idleFocusState(T0, 'timer-recover'), T0);
    const persisted = { ...running, lastUpdatedMs: T0 + 15_000 };
    const { state, recovered } = recoverFocusState(persisted, T0 + 2 * 3600_000);
    expect(recovered).toBe(true);
    expect(state.phase).toBe('paused');
    expect(activeMs(state, T0 + 2 * 3600_000)).toBe(15_000);
    // Closed-tab time is not wall-clock study either: the displayed/finished
    // elapsed time matches the last persisted tick, not the two-hour gap.
    expect(wallMs(state, T0 + 2 * 3600_000)).toBe(15_000);
    const draft = finishFocus(state, T0 + 2 * 3600_000)!;
    expect(draft.elapsedSec).toBe(15);
    expect(draft.activeSec).toBe(15);
    expect(draft.pausedSec).toBe(0);
  });

  it('repairs invalid persisted state instead of corrupting a session', () => {
    expect(sanitizeFocusState(null, T0).phase).toBe('idle');
    expect(sanitizeFocusState({ phase: 'running', startedAtMs: Number.NaN }, T0).phase).toBe('idle');
    expect(sanitizeFocusState({ phase: 'running', startedAtMs: T0, segmentStartedAtMs: T0 + 999_999 }, T0).phase).toBe('paused');
    const fixed = sanitizeFocusState({
      phase: 'paused',
      startedAtMs: T0,
      pausedAtMs: T0 + 10_000,
      activeAccumMs: -50,
      intervals: [{ startMs: Number.NaN, endMs: T0, kind: 'active' }],
      timerId: '',
    }, T0 + 20_000);
    expect(fixed.activeAccumMs).toBe(0);
    expect(fixed.intervals).toEqual([]);
    expect(fixed.timerId).toBeTruthy();
  });

  it('requires at least 10 whole active seconds to record', () => {
    expect(FOCUS_MIN_RECORDED_SEC).toBe(10);
    expect(isRecordableFocusSession(9)).toBe(false);
    expect(isRecordableFocusSession(9.5)).toBe(false);
    expect(isRecordableFocusSession(10)).toBe(true);
  });

  it('finish on a paused session adds the final pause interval but not phantom active time', () => {
    let s = startFocus(idleFocusState(T0, 'timer-paused-finish'), T0);
    s = pauseFocus(s, T0 + 30_000);
    const draft = finishFocus(s, T0 + 90_000)!;
    expect(draft.activeSec).toBe(30);
    expect(draft.elapsedSec).toBe(90);
    expect(draft.intervals?.find((i) => i.kind === 'paused')).toMatchObject({ startMs: T0 + 30_000, endMs: T0 + 90_000 });
  });
});
