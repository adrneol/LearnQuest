import { describe, expect, it } from 'vitest';
import { summarizeByEntry, splitPlaybackSegmentByDay } from '../src/domain/index.js';
import type { PlaybackSegment } from '../src/domain/index.js';

const DAY = Date.parse('2026-10-27T00:00:00.000Z');

function segment(over: Partial<PlaybackSegment> & { id: string }): PlaybackSegment {
  return {
    playlistId: 'PL1',
    position: 1,
    entryId: 'e1',
    videoId: 'v1',
    sessionId: 's1',
    wallStartMs: DAY,
    wallEndMs: DAY + 300_000,
    timelineStartSec: 0,
    timelineEndSec: 300,
    playbackRate: 1,
    source: 'verified',
    ...over,
  };
}

describe('Analytics playback coverage', () => {
  it('unions overlapping and repeated evidence for the same occurrence', () => {
    const summary = summarizeByEntry([
      segment({ id: 'a', timelineStartSec: 0, timelineEndSec: 300 }),
      segment({
        id: 'b', timelineStartSec: 200, timelineEndSec: 600,
        wallStartMs: DAY + 200_000, wallEndMs: DAY + 600_000,
      }),
      // Rewatching 0–300 adds watched time but no new coverage.
      segment({
        id: 'c', timelineStartSec: 0, timelineEndSec: 300,
        wallStartMs: DAY + 600_000, wallEndMs: DAY + 900_000,
      }),
    ]);
    expect(summary.uniqueSec).toBe(600);
    expect(summary.totalContentSec).toBe(1000);
    expect(summary.rewatchedSec).toBe(400);
  });

  it('keeps duplicate playlist occurrences separate', () => {
    const summary = summarizeByEntry([
      segment({ id: 'a', entryId: 'e1', position: 1 }),
      segment({ id: 'b', entryId: 'e2', position: 2 }),
    ]);
    expect(summary.uniqueSec).toBe(600);
  });

  it('does not invent coverage when a cross-midnight segment is split', () => {
    const slices = splitPlaybackSegmentByDay(segment({
      id: 'midnight',
      timelineStartSec: 0,
      timelineEndSec: 600,
      wallStartMs: Date.parse('2026-10-27T23:55:00.000Z'),
      wallEndMs: Date.parse('2026-10-28T00:05:00.000Z'),
    }), 'UTC');
    expect(slices).toHaveLength(2);
    expect(slices.reduce((sum, slice) => sum + (slice.segment.timelineEndSec - slice.segment.timelineStartSec), 0)).toBe(600);
    expect(summarizeByEntry(slices.map((slice) => slice.segment)).uniqueSec).toBe(600);
  });
});
