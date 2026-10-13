import { describe, it, expect } from 'vitest';
import {
  mergeIntervals,
  summarizeSegments,
  completionFromCoverage,
  type PlaybackSegment,
} from '../src/domain/playback/playback.js';
import {
  contentEfficiency,
  playbackUtilization,
  overallEfficiency,
  compareWindows,
} from '../src/domain/efficiency/efficiency.js';
import { goalProgress, validateGoal } from '../src/domain/goals/goals.js';
import {
  mulberry32,
  validateChallenge,
  generateCompetitors,
  rankBoard,
  DEFAULT_CHALLENGE,
} from '../src/domain/competition/competition.js';
import { splitIntervalByDay } from '../src/domain/time/time.js';

function seg(partial: Partial<PlaybackSegment> & { id: string }): PlaybackSegment {
  return {
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
    ...partial,
  };
}

describe('playback telemetry', () => {
  it('merges overlaps; replays count once for unique, fully for totals', () => {
    expect(mergeIntervals([[0, 30], [20, 50], [60, 90]])).toEqual([[0, 50], [60, 90]]);
    // same 30s replayed 3x
    const r = summarizeSegments([seg({ id: 'a', timelineStartSec: 0, timelineEndSec: 30 }), seg({ id: 'b', timelineStartSec: 0, timelineEndSec: 30 }), seg({ id: 'c', timelineStartSec: 0, timelineEndSec: 30 })]);
    expect(r.uniqueSec).toBe(30);
    expect(r.totalContentSec).toBe(90);
    expect(r.rewatchedSec).toBe(60);
  });
  it('dedupes accidental duplicate events; ignores empty/invalid', () => {
    const r = summarizeSegments([seg({ id: 'a' }), seg({ id: 'a' }), seg({ id: 'b', timelineStartSec: 10, timelineEndSec: 10 })]);
    expect(r.totalContentSec).toBe(60);
  });
  it('seek-forward never credits skipped span (segments only cover observed ranges)', () => {
    // watched 0-10, jumped to 100-110: union is 20s, not 110s
    const r = summarizeSegments([
      seg({ id: 'a', timelineStartSec: 0, timelineEndSec: 10 }),
      seg({ id: 'b', timelineStartSec: 100, timelineEndSec: 110 }),
    ]);
    expect(r.uniqueSec).toBe(20);
  });
  it('completion thresholds: verified vs manual vs unavailable', () => {
    expect(completionFromCoverage(540, 600, { threshold: 0.9 })).toBe('verified');
    expect(completionFromCoverage(100, 600, { threshold: 0.9 })).toBe('in-progress');
    expect(completionFromCoverage(0, 600)).toBe('todo');
    expect(completionFromCoverage(0, 600, { manualDone: true })).toBe('manual');
    expect(completionFromCoverage(999, null)).toBe('unavailable');
    expect(completionFromCoverage(10, 600, { threshold: 0.3 })).toBe('in-progress'); // clamped to >=0.5
  });
});

describe('efficiency', () => {
  it('zero focused time => null, never NaN/Infinity', () => {
    expect(contentEfficiency({ uniqueContentSec: 100, focusedSec: 0 })).toBeNull();
    expect(contentEfficiency({ uniqueContentSec: 0, focusedSec: 0 })).toBeNull();
  });
  it('can exceed 100% at high playback rates', () => {
    expect(contentEfficiency({ uniqueContentSec: 3600, focusedSec: 1800 })).toBe(200);
  });
  it('overall is aggregate ratio, not mean of dailies', () => {
    // 5-min day at 100% + 3-h day at 50% => aggregate ≈ 50.7%, mean would be 75%
    const inputs = [
      { uniqueContentSec: 300, focusedSec: 300 },
      { uniqueContentSec: 5400, focusedSec: 10800 },
    ];
    const agg = overallEfficiency(inputs)!;
    expect(agg).toBeCloseTo((5700 / 11100) * 100, 5);
    expect(agg).not.toBeCloseTo(75, 0);
  });
  it('utilization caps at 100 and rejects impossible data', () => {
    expect(playbackUtilization(1800, 3600)).toBe(50);
    expect(playbackUtilization(3600, 3600)).toBe(100);
    expect(playbackUtilization(99999, 60)).toBeNull();
    expect(playbackUtilization(10, 0)).toBeNull();
  });
  it('trend needs minimum observations', () => {
    const t = compareWindows([1, 2], [1, 2, 3, 4], 3);
    expect(t.meaningful).toBe(false);
    expect(compareWindows([1, 2, 3], [1, 2, 3], 3).meaningful).toBe(true);
  });
});

describe('goals', () => {
  it('achieved exactly at target; exceeded above; missed past deadline', () => {
    const g: any = { id: 'g', label: 'G', metric: 'video-count', target: 5, playlistId: null, dateKey: '2026-10-13', createdAt: '', paused: false, achievedAt: null, achievedValue: null };
    expect(goalProgress(g, 5, { todayKey: '2026-10-13' }).status).toBe('achieved');
    expect(goalProgress(g, 7, { todayKey: '2026-10-13' }).status).toBe('achieved');
    expect(goalProgress(g, 3, { todayKey: '2026-10-14' }).status).toBe('missed');
    expect(goalProgress({ ...g, paused: true }, 9).status).toBe('paused');
  });
  it('validation rejects bad targets', () => {
    expect(validateGoal({ metric: 'video-count', target: 0 })).not.toHaveLength(0);
    expect(validateGoal({ metric: 'focus-time', target: 17 * 3600 })).not.toHaveLength(0);
    expect(validateGoal({ metric: 'focus-time', target: 3600 })).toHaveLength(0);
  });
});

describe('competition', () => {
  it('cohort bounds + tier sum validation', () => {
    expect(validateChallenge({ ...DEFAULT_CHALLENGE, cohortSize: 9 })).not.toHaveLength(0);
    expect(validateChallenge({ ...DEFAULT_CHALLENGE, cohortSize: 2001 })).not.toHaveLength(0);
    expect(validateChallenge(DEFAULT_CHALLENGE)).toHaveLength(0);
    expect(validateChallenge({ ...DEFAULT_CHALLENGE, tierDist: { ...DEFAULT_CHALLENGE.tierDist, Ultra: 50 } })).not.toHaveLength(0);
  });
  it('deterministic generation: same seed => same stable ranks', () => {
    const basis = { totalSec: 36000, n: 100, avgVideoSec: 360 };
    const a = generateCompetitors(DEFAULT_CHALLENGE, basis);
    const b = generateCompetitors(DEFAULT_CHALLENGE, basis);
    expect(a).toEqual(b);
    expect(a).toHaveLength(DEFAULT_CHALLENGE.cohortSize - 1);
    // bounded by what exists
    for (const c of a) {
      expect(c.uniqueContentSec).toBeLessThanOrEqual(36000);
      expect(c.verifiedCount).toBeLessThanOrEqual(100);
      // efficiency derived from generated time, consistent with formula
      if (c.focusSec > 0) expect((c.uniqueContentSec / c.focusSec) * 100).toBeLessThan(200);
    }
  });
  it('mulberry32 is stable', () => {
    expect(mulberry32(42)()).toBe(mulberry32(42)());
  });
  it('rank board: scored-only ordering, provisional user unranked', () => {
    const basis = { totalSec: 36000, n: 100, avgVideoSec: 360 };
    const comps = generateCompetitors({ ...DEFAULT_CHALLENGE, cohortSize: 50 }, basis);
    const { rows, userRank, percentile } = rankBoard(
      { ...DEFAULT_CHALLENGE, cohortSize: 50 },
      comps,
      { dailyEffs: [70, 75, 80], uniqueContentSec: 5000, verifiedCount: 10, focusSec: 3600, activeDays: 3 },
    );
    expect(rows).toHaveLength(50);
    expect(userRank).not.toBeNull();
    expect(percentile).toBeGreaterThanOrEqual(0);
    // scored section sorted desc
    const scoredVals = rows.filter((r) => r.value !== null).map((r) => r.value as number);
    for (let i = 1; i < scoredVals.length; i++) expect(scoredVals[i - 1]).toBeGreaterThanOrEqual(scoredVals[i]);
    // no data => provisional, unranked, no fabricated percentile
    const e = rankBoard(
      { ...DEFAULT_CHALLENGE },
      comps,
      { dailyEffs: [], uniqueContentSec: 0, verifiedCount: 0, focusSec: 0, activeDays: 0 },
    );
    expect(e.userRank).toBeNull();
    expect(e.percentile).toBeNull();
    const me = e.rows.find((r) => r.isUser)!;
    expect(me.provisional).toBe(true);
  });
  it('supports every cohort boundary 10..2000', () => {
    const basis = { totalSec: 3600, n: 10, avgVideoSec: 360 };
    for (const n of [10, 100, 500, 1000, 2000]) {
      const cfg = { ...DEFAULT_CHALLENGE, cohortSize: n };
      expect(validateChallenge(cfg)).toHaveLength(0);
      expect(generateCompetitors(cfg, basis)).toHaveLength(n - 1);
    }
  });
});

describe('midnight split', () => {
  it('attributes each day only its own elapsed time', () => {
    // 23:30 -> 00:30 UTC, 60 min each side
    const start = Date.UTC(2026, 9, 12, 23, 30);
    const end = Date.UTC(2026, 9, 13, 0, 30);
    const slices = splitIntervalByDay(start, end, 'UTC');
    expect(slices).toHaveLength(2);
    expect(slices[0].seconds).toBe(1800);
    expect(slices[1].seconds).toBe(1800);
  });
  it('empty/invalid intervals => []', () => {
    expect(splitIntervalByDay(100, 100, 'UTC')).toEqual([]);
    expect(splitIntervalByDay(200, 100, 'UTC')).toEqual([]);
  });
});
