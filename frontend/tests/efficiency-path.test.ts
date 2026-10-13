import { describe, it, expect } from 'vitest';
import {
  summarizeSegments,
  type PlaybackSegment,
} from '../src/domain/playback/playback.js';
import {
  contentEfficiency,
  overallEfficiency,
} from '../src/domain/efficiency/efficiency.js';
import { splitIntervalByDay } from '../src/domain/time/time.js';

let n = 0;
const seg = (o: Partial<PlaybackSegment>): PlaybackSegment => ({
  id: `s${(n += 1)}`,
  playlistId: 'PLx',
  position: 1,
  videoId: 'v',
  sessionId: 'sess',
  wallStartMs: 0,
  wallEndMs: 60_000,
  timelineStartSec: 0,
  timelineEndSec: 60,
  playbackRate: 1,
  source: 'verified',
  ...o,
});

/**
 * Independent path test with hand-verified numbers (no shared helpers for
 * expectations — plain arithmetic below).
 *
 * Story: lesson is 600s long. Day 1: watch 0–300 (5 wall-min), pause 10 min
 * (not recorded), rewatch 0–100, seek-skip 400–500 (never credited), buffer
 * 2 min (never recorded). Focus recorded: 15 min. Day 2: watch 300–600.
 */
describe('efficiency data path (hand-verified story)', () => {
  const day1 = [
    seg({ timelineStartSec: 0, timelineEndSec: 300, wallStartMs: 0, wallEndMs: 300_000 }),
    seg({ timelineStartSec: 0, timelineEndSec: 100, wallStartMs: 900_000, wallEndMs: 1_000_000 }), // rewatch
  ];
  const day2 = [seg({ timelineStartSec: 300, timelineEndSec: 600, wallStartMs: 0, wallEndMs: 300_000 })];

  it('unique counts each second once; totals include repeats; pauses/buffers/seeks excluded', () => {
    const d1 = summarizeSegments(day1);
    expect(d1.uniqueSec).toBe(300); // rewatch adds nothing unique
    expect(d1.totalContentSec).toBe(400); // 300 + 100 repeat
    expect(d1.activeSec).toBe(400); // 300 + 100 wall; pause/buffer never became segments
    expect(d1.rewatchedSec).toBe(100);
    const all = summarizeSegments([...day1, ...day2]);
    expect(all.uniqueSec).toBe(600); // full lesson, seek-skipped span covered on day 2 genuinely
  });

  it('daily efficiency uses attributed values; overall uses aggregates', () => {
    // day1: 300 unique / 900 focused (15 min) = 33.33%; day2: 300 / 300 (5 min) = 100%
    const e1 = contentEfficiency({ uniqueContentSec: 300, focusedSec: 900 });
    const e2 = contentEfficiency({ uniqueContentSec: 300, focusedSec: 300 });
    expect(e1).toBeCloseTo(33.333, 2);
    expect(e2).toBe(100);
    // aggregate: 600 / 1200 = 50% — NOT the (33.33+100)/2 = 66.67 mean
    expect(overallEfficiency([
      { uniqueContentSec: 300, focusedSec: 900 },
      { uniqueContentSec: 300, focusedSec: 300 },
    ])).toBe(50);
  });

  it('zero focus and zero coverage stay unavailable, not fabricated', () => {
    expect(contentEfficiency({ uniqueContentSec: 0, focusedSec: 0 })).toBeNull();
    expect(contentEfficiency({ uniqueContentSec: 0, focusedSec: 600 })).toBe(0);
  });

  it('verified and manual evidence separate cleanly', () => {
    const mixed = [
      seg({ timelineStartSec: 0, timelineEndSec: 200, source: 'verified' }),
      seg({ timelineStartSec: 200, timelineEndSec: 400, source: 'manual' }),
    ];
    expect(summarizeSegments(mixed.filter((s) => s.source === 'verified')).uniqueSec).toBe(200);
    expect(summarizeSegments(mixed.filter((s) => s.source === 'manual')).uniqueSec).toBe(200);
    expect(summarizeSegments(mixed).uniqueSec).toBe(400);
  });

  it('cross-midnight focus attributes per-day slices that sum to the whole', () => {
    const slices = splitIntervalByDay(
      Date.UTC(2026, 9, 12, 23, 0),
      Date.UTC(2026, 9, 13, 1, 0),
      'UTC',
    );
    expect(slices.reduce((a, s) => a + s.seconds, 0)).toBe(7200);
    expect(slices.map((s) => s.dateKey)).toEqual(['2026-10-12', '2026-10-13']);
  });
});
