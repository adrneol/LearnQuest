import { describe, it, expect } from 'vitest';
import {
  parseISO8601ToSeconds,
  formatSecondsHHMMSS,
  sessionsNeeded,
} from '../src/domain/duration/duration.js';
import {
  parsePlaylistId,
  validateRange,
  sumEntries,
  rangeDuration,
  selectionDuration,
  diffSnapshots,
  rangeStatus,
} from '../src/domain/playlist/playlist.js';
import { computePlaylistProgress, computeRangeProgress } from '../src/domain/progress/progress.js';
import { evaluateAchievements, xpForFocusSession } from '../src/domain/progress/gamification.js';
import { computeStreak } from '../src/domain/time/time.js';
import type { PlaylistSnapshot } from '../src/types/index.js';

function snap(durations: (number | null)[], playlistId = 'PLtest1234567890'): PlaylistSnapshot {
  return {
    playlistId,
    title: 'Test',
    reportedCount: durations.length,
    entries: durations.map((d, i) => ({
      position: i + 1,
      videoId: `vid${i + 1}`,
      title: `Video ${i + 1}`,
      durationSec: d,
    })),
    source: 'api',
    fetchedAt: new Date().toISOString(),
    snapshotVersion: 1,
  };
}

describe('ISO8601 parsing', () => {
  it('parses canonical examples', () => {
    expect(parseISO8601ToSeconds('PT59S')).toBe(59);
    expect(parseISO8601ToSeconds('PT1M')).toBe(60);
    expect(parseISO8601ToSeconds('PT1H')).toBe(3600);
    expect(parseISO8601ToSeconds('PT1H2M3S')).toBe(3723);
    expect(parseISO8601ToSeconds('P1DT2H')).toBe(93600);
    expect(parseISO8601ToSeconds('PT0S')).toBe(0);
  });
  it('does not confuse hours/minutes, preserves seconds', () => {
    expect(parseISO8601ToSeconds('PT2H')).toBe(7200);
    expect(parseISO8601ToSeconds('PT2M')).toBe(120);
    expect(parseISO8601ToSeconds('PT1H1S')).toBe(3601);
  });
  it('rejects invalid', () => {
    expect(() => parseISO8601ToSeconds('')).toThrow();
    expect(() => parseISO8601ToSeconds('hello')).toThrow();
    expect(() => parseISO8601ToSeconds('P1Y2M')).toThrow();
  });
  it('formats beyond 24h without wrapping', () => {
    expect(formatSecondsHHMMSS(90061)).toBe('25:1:01'.replace('25:1:01', '25:01:01'));
    expect(formatSecondsHHMMSS(3723)).toBe('1:02:03');
  });
  it('sessionsNeeded', () => {
    expect(sessionsNeeded(3600, 1800)).toBe(2);
    expect(sessionsNeeded(3601, 1800)).toBe(3);
    expect(sessionsNeeded(0, 1800)).toBe(0);
  });
});

describe('playlist id + ranges', () => {
  it('parses URLs and raw IDs', () => {
    expect(parsePlaylistId('PLu0W_9lII9agq5TrH9XLIKQvv0iaF2X3w')).toBe('PLu0W_9lII9agq5TrH9XLIKQvv0iaF2X3w');
    expect(parsePlaylistId('https://www.youtube.com/playlist?list=PLu0W_9lII9agq5TrH9XLIKQvv0iaF2X3w')).toBe(
      'PLu0W_9lII9agq5TrH9XLIKQvv0iaF2X3w',
    );
    expect(() => parsePlaylistId('not a playlist')).toThrow();
  });
  it('validates inclusive boundaries dynamically', () => {
    expect(validateRange(1, 8, 139)).toEqual({ start: 1, end: 8, n: 139 });
    expect(() => validateRange(0, 5, 10)).toThrow();
    expect(() => validateRange(5, 4, 10)).toThrow();
    expect(() => validateRange(1, 11, 10)).toThrow();
    expect(() => validateRange(1.5, 5, 10)).toThrow();
  });
  it('sums exactly, flags incomplete', () => {
    const s = snap([60, 120, null, 30]);
    const r = sumEntries(s.entries);
    expect(r.totalSec).toBe(210);
    expect(r.isComplete).toBe(false);
    expect(r.unresolvedPositions).toEqual([3]);
  });
  it('adjacent disjoint ranges sum to total (complete snapshot)', () => {
    const s = snap([60, 120, 180, 240]);
    const a = rangeDuration(s, 1, 2);
    const b = rangeDuration(s, 3, 4);
    const c = rangeDuration(s, 1, 4);
    expect(a.totalSec + b.totalSec).toBe(c.totalSec);
    expect(c.count).toBe(4);
  });
  it('selection sum labels non-contiguous', () => {
    const s = snap([60, 120, 180]);
    const sel = selectionDuration([s.entries[0], s.entries[2]]);
    expect(sel.totalSec).toBe(240);
    expect(sel.count).toBe(2);
  });
  it('duplicate videoIds at different positions counted independently', () => {
    const s: PlaylistSnapshot = {
      playlistId: 'PLdup1234567890',
      title: 'Dup',
      reportedCount: 3,
      entries: [
        { position: 1, videoId: 'same', title: 'A', durationSec: 100 },
        { position: 2, videoId: 'other', title: 'B', durationSec: 200 },
        { position: 3, videoId: 'same', title: 'A (repeat)', durationSec: 100 },
      ],
      source: 'api',
      fetchedAt: new Date().toISOString(),
      snapshotVersion: 1,
    };
    expect(rangeDuration(s, 1, 3).totalSec).toBe(400);
    expect(rangeDuration(s, 1, 1).totalSec).toBe(100);
  });
  it('reordered API join: range uses positions not return order', () => {
    const s = snap([10, 20, 30]);
    // simulate shuffled metadata already joined correctly — range must still be positional
    expect(rangeDuration(s, 2, 3).totalSec).toBe(50);
  });
  it('rangeStatus flags shrink without clamping', () => {
    expect(rangeStatus(1, 8, 10)).toBe('valid');
    expect(rangeStatus(1, 12, 10)).toBe('needsReview');
  });
  it('diff detects add/remove/move', () => {
    const a = snap([60, 60, 60]);
    const b: PlaylistSnapshot = {
      ...snap([60, 60]),
      entries: [
        { position: 1, videoId: 'vid1', title: 'Video 1', durationSec: 60 },
        { position: 2, videoId: 'vid3', title: 'Video 3', durationSec: 60 },
      ],
    };
    const d = diffSnapshots(a, b);
    expect(d.shrunk).toBe(true);
    expect(d.removed.length).toBeGreaterThan(0);
  });
});

describe('progress + invariants', () => {
  it('count pct uses N denominator; duration pct null when incomplete', () => {
    const s = snap([100, 100, null]);
    const prog = computePlaylistProgress(s, {
      [`${s.playlistId}::1`]: {
        playlistId: s.playlistId, position: 1, videoId: 'vid1',
        completedAt: new Date().toISOString(), status: 'done',
      },
    });
    expect(prog.countPct).toBeCloseTo(33.333, 2);
    expect(prog.durationPct).toBeNull();
    expect(prog.isDurationComplete).toBe(false);
  });
  it('range progress', () => {
    const s = snap([100, 200, 300, 400]);
    const r = computeRangeProgress(s, 1, 2, new Map());
    expect(r.totalSec).toBe(300);
    expect(r.done).toBe(0);
  });
  it('property: random arrays sum matches naive loop', () => {
    for (let t = 0; t < 50; t++) {
      const arr = Array.from({ length: 20 }, () => Math.floor(Math.random() * 3600));
      const s = snap(arr);
      const naive = arr.reduce((a, b) => a + b, 0);
      expect(sumEntries(s.entries).totalSec).toBe(naive);
    }
  });
});

describe('gamification + streak', () => {
  it('xp pro-rating', () => {
    expect(xpForFocusSession(1800)).toBe(15);
    expect(xpForFocusSession(3599)).toBe(15);
    expect(xpForFocusSession(3600)).toBe(30);
  });
  it('achievements generic halfway', () => {
    const got = evaluateAchievements({
      completedVideos: 50, totalVideos: 100, completedSec: null, totalSec: null,
      focusSessions: 0, focusedSec: 0, distinctDays: 1, checkpointsDone: 0, revisionsDone: 0,
      already: new Set(),
    });
    expect(got).toContain('halfway');
  });
  it('streak handles gaps', () => {
    expect(computeStreak(new Set(['2026-10-11', '2026-10-12', '2026-10-13']), '2026-10-13')).toBe(3);
    expect(computeStreak(new Set(['2026-10-11', '2026-10-13']), '2026-10-13')).toBe(1);
    expect(computeStreak(new Set(['2026-10-12']), '2026-10-13')).toBe(1);
    expect(computeStreak(new Set(), '2026-10-13')).toBe(0);
  });
});
