import { describe, it, expect } from 'vitest';
import {
  contentEfficiency,
  overallEfficiency,
  playbackUtilization,
  filterFocusByEvidence,
  summarizeSegments,
  type PlaybackSegment,
} from '../src/domain/index.js';

// Hand-written expectations only; no implementation helper is used to produce
// an expected value below.

const seg = (o: Partial<PlaybackSegment>): PlaybackSegment => ({
  id: Math.random().toString(36),
  playlistId: 'PLx',
  position: 1,
  videoId: 'v',
  sessionId: 's',
  wallStartMs: 0,
  wallEndMs: 60_000,
  timelineStartSec: 0,
  timelineEndSec: 60,
  playbackRate: 1,
  source: 'verified',
  ...o,
});

describe('efficiency formulas: independent arithmetic', () => {
  it('content efficiency is unique ÷ focused × 100; zero focus is undefined, real zero focus is not fabricated', () => {
    expect(contentEfficiency({ uniqueContentSec: 752, focusedSec: 0 })).toBeNull();
    expect(contentEfficiency({ uniqueContentSec: 752, focusedSec: 1504 })).toBe(50);
    expect(contentEfficiency({ uniqueContentSec: 0, focusedSec: 600 })).toBe(0);
    expect(contentEfficiency({ uniqueContentSec: -1, focusedSec: 600 })).toBeNull();
    expect(contentEfficiency({ uniqueContentSec: 600, focusedSec: Number.NaN })).toBeNull();
  });

  it('aggregate is the ratio of sums, never the mean of daily percentages', () => {
    const inputs = [
      { uniqueContentSec: 300, focusedSec: 900 }, // 33.333%
      { uniqueContentSec: 300, focusedSec: 300 }, // 100%
    ];
    const aggregate = overallEfficiency(inputs);
    expect(aggregate).not.toBeNull();
    expect(aggregate!).toBeCloseTo(50, 10); // 600 / 1200
    const meanOfDailies = (100 / 3 + 100) / 2;
    expect(aggregate!).not.toBeCloseTo(meanOfDailies, 3);
  });

  it('playback utilization uses active playback (no pause/buffer) over focused time', () => {
    // Only playing intervals become segments; pause and buffering never do.
    const playing = [
      seg({ timelineStartSec: 0, timelineEndSec: 300, wallStartMs: 0, wallEndMs: 300_000 }),
      seg({ timelineStartSec: 0, timelineEndSec: 100, wallStartMs: 900_000, wallEndMs: 1_000_000 }),
    ];
    const summary = summarizeSegments(playing);
    expect(summary.activeSec).toBe(400); // 300 + 100 wall seconds while playing
    expect(summary.totalContentSec).toBe(400);
    expect(playbackUtilization(summary.activeSec, 800)).toBe(50);
    expect(playbackUtilization(0, 800)).toBe(0);
    expect(playbackUtilization(400, 0)).toBeNull(); // no denominator
    expect(playbackUtilization(120, 60)).toBeCloseTo(200, 10); // reported, not clamped
  });

  it('evidence filter separates timer-observed focus from manual corrections', () => {
    const sessions = [
      { id: 'observed', activeSec: 600, estimated: false },
      { id: 'corrected', activeSec: 300, estimated: true },
      { id: 'legacy-observed', activeSec: 120 },
    ];
    expect(filterFocusByEvidence(sessions, 'verified').map((s) => s.id)).toEqual(['observed', 'legacy-observed']);
    expect(filterFocusByEvidence(sessions, 'manual').map((s) => s.id)).toEqual(['corrected']);
    expect(filterFocusByEvidence(sessions, 'all')).toHaveLength(3);
  });

  it('a mixed verified/manual example keeps numerator and denominator aligned', () => {
    // Verified: 10 min content / 10 min observed focus = 100%.
    // Manual: 5 min content / 10 min corrected focus = 50%.
    // All: 15 / 20 = 75% (not the mean of 100 and 50).
    const all = contentEfficiency({ uniqueContentSec: 900, focusedSec: 1200 });
    expect(all).toBe(75);
    expect(contentEfficiency({ uniqueContentSec: 600, focusedSec: 600 })).toBe(100);
    expect(contentEfficiency({ uniqueContentSec: 300, focusedSec: 600 })).toBe(50);
    expect(overallEfficiency([
      { uniqueContentSec: 600, focusedSec: 600 },
      { uniqueContentSec: 300, focusedSec: 600 },
    ])).toBe(75);
  });
});
