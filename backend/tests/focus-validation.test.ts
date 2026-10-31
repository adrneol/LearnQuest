import { describe, it, expect } from 'vitest';
import { validateRecordValue } from '../src/services/userData.js';

const START = Date.parse('2026-10-27T10:00:00.000Z');

function session(over: Record<string, unknown> = {}) {
  return {
    id: 'focus-test-1',
    clientId: 'focus-test-1',
    playlistId: null,
    startedAt: new Date(START).toISOString(),
    finishedAt: new Date(START + 120_000).toISOString(),
    activeSec: 100,
    elapsedSec: 120,
    pausedSec: 20,
    intervals: [
      { startMs: START, endMs: START + 60_000, kind: 'active' },
      { startMs: START + 60_000, endMs: START + 80_000, kind: 'paused' },
      { startMs: START + 80_000, endMs: START + 120_000, kind: 'active' },
    ],
    timerVersion: 2,
    monotonicActiveMs: 100_000,
    gapExcludedMs: 0,
    interruptionCount: 1,
    estimated: false,
    recovered: false,
    qualified: true,
    saveState: 'confirmed',
    ...over,
  };
}

function accepts(value: unknown) {
  expect(() => validateRecordValue('sessions', value)).not.toThrow();
}

function rejects(value: unknown) {
  expect(() => validateRecordValue('sessions', value)).toThrow();
}

describe('focus session cross-field validation', () => {
  it('accepts a coherent v2 session and merges same-kind overlaps for the sum', () => {
    accepts(session());
    accepts(session({
      intervals: [
        { startMs: START, endMs: START + 70_000, kind: 'active' },
        { startMs: START + 60_000, endMs: START + 80_000, kind: 'active' },
        { startMs: START + 80_000, endMs: START + 120_000, kind: 'paused' },
      ],
      activeSec: 80,
      elapsedSec: 120,
      pausedSec: 40,
      monotonicActiveMs: 80_000,
    }));
  });

  it('accepts legacy v1 sessions without intervals', () => {
    accepts({
      id: 'legacy-1',
      playlistId: 'PLlegacy',
      startedAt: new Date(START).toISOString(),
      finishedAt: new Date(START + 3_600_000).toISOString(),
      activeSec: 3600,
      elapsedSec: 3600,
    });
    accepts({
      id: 'legacy-manual',
      playlistId: null,
      startedAt: new Date(START).toISOString(),
      finishedAt: new Date(START + 600_000).toISOString(),
      activeSec: 900,
      elapsedSec: 900,
      estimated: true,
      intervals: [],
    });
  });

  it('rejects active time above elapsed time and inconsistent paused time', () => {
    rejects(session({ activeSec: 130 }));
    rejects(session({ pausedSec: 5 }));
  });

  it('rejects a finish before the start and zero-length sessions with focus time', () => {
    rejects(session({ finishedAt: new Date(START - 1_000).toISOString() }));
    rejects(session({
      finishedAt: new Date(START).toISOString(),
      elapsedSec: 100,
      pausedSec: 0,
      intervals: [{ startMs: START, endMs: START + 100_000, kind: 'active' }],
    }));
  });

  it('rejects overlapping active and paused intervals', () => {
    rejects(session({
      intervals: [
        { startMs: START, endMs: START + 80_000, kind: 'active' },
        { startMs: START + 50_000, endMs: START + 90_000, kind: 'paused' },
      ],
      activeSec: 80,
      elapsedSec: 120,
      pausedSec: 40,
      monotonicActiveMs: 80_000,
    }));
  });

  it('rejects interval and monotonic sums that disagree with recorded durations', () => {
    rejects(session({ activeSec: 60 }));
    rejects(session({ monotonicActiveMs: 40_000 }));
    rejects(session({
      intervals: [
        { startMs: START, endMs: START + 60_000, kind: 'active' },
        { startMs: START + 60_000, endMs: START + 110_000, kind: 'paused' },
      ],
      activeSec: 60,
      elapsedSec: 90,
      pausedSec: 30,
      monotonicActiveMs: 60_000,
    }));
  });

  it('rejects intervals outside the session and implausibly long v2 durations', () => {
    rejects(session({
      intervals: [{ startMs: START - 10_000, endMs: START + 60_000, kind: 'active' }],
      activeSec: 70,
    }));
    rejects(session({
      startedAt: new Date(START).toISOString(),
      finishedAt: new Date(START + 25 * 3600_000).toISOString(),
      activeSec: 25 * 3600,
      elapsedSec: 25 * 3600,
      pausedSec: 0,
      intervals: [],
      monotonicActiveMs: 25 * 3600_000,
    }));
  });

  it('rejects malformed v2 metadata and save states', () => {
    rejects(session({ timerVersion: 2, interruptionCount: -1 }));
    rejects(session({ timerVersion: 2, estimated: 'yes' }));
    rejects(session({ timerVersion: 2, saveState: 'maybe' }));
    rejects(session({ timerVersion: 2, gapExcludedMs: Number.POSITIVE_INFINITY }));
  });

  it('does not apply interval-sum checks to a manual estimated session', () => {
    accepts(session({
      estimated: true,
      intervals: [{ startMs: START, endMs: START + 60_000, kind: 'active' }],
      activeSec: 600,
      elapsedSec: 600,
      pausedSec: 0,
      monotonicActiveMs: 60_000,
    }));
  });
});
