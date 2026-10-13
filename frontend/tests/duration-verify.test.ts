import { describe, it, expect } from 'vitest';
import {
  rangeDuration,
  validateRange,
  sumEntries,
  rangeStatus,
} from '../src/domain/playlist/playlist.js';
import { formatSecondsHHMMSS } from '../src/domain/duration/duration.js';
import type { PlaylistSnapshot, PlaylistEntry } from '../src/types/index.js';

// Independent fixture: hand-summed durations (no engine used for expectations)
// 62 + 3600 + 59 + 3723 + 0 + 90061 = 97505
const DURATIONS = [62, 3600, 59, 3723, 0, 90061];
const FULL = 97505;

function entry(position: number, durationSec: number | null, videoId?: string): PlaylistEntry {
  return { position, videoId: videoId ?? `vid${position}`, title: `Video ${position}`, durationSec };
}

function snap(durations: (number | null)[], ids?: string[]): PlaylistSnapshot {
  return {
    playlistId: 'PLverify1234567890',
    title: 'Verify',
    reportedCount: durations.length,
    entries: durations.map((d, i) => entry(i + 1, d, ids?.[i])),
    source: 'api',
    fetchedAt: new Date().toISOString(),
    snapshotVersion: 1,
  };
}

describe('independent duration verification (hand-computed totals)', () => {
  const s = snap(DURATIONS);
  it('single-video playlist and one-entry ranges hit endpoints exactly', () => {
    expect(rangeDuration(snap([62]), 1, 1).totalSec).toBe(62);
    expect(rangeDuration(s, 1, 1).totalSec).toBe(62); // first video
    expect(rangeDuration(s, 6, 6).totalSec).toBe(90061); // last video
    expect(rangeDuration(s, 3, 3).totalSec).toBe(59); // one-entry middle
  });
  it('complete playlist total equals hand sum; display format exact', () => {
    const r = rangeDuration(s, 1, 6);
    expect(r.totalSec).toBe(FULL);
    expect(r.isComplete).toBe(true);
    expect(formatSecondsHHMMSS(FULL)).toBe('27:05:05');
  });
  it('arbitrary middle range sums endpoints inclusively, nothing omitted/doubled', () => {
    // 3600 + 59 + 3723 = 7382
    const r = rangeDuration(s, 2, 4);
    expect(r.totalSec).toBe(7382);
    expect(r.count).toBe(3);
  });
  it('adjacent non-overlapping ranges covering the playlist sum to the full total', () => {
    for (const k of [1, 2, 5]) {
      const a = rangeDuration(s, 1, k);
      const b = rangeDuration(s, k + 1, 6);
      expect(a.totalSec + b.totalSec).toBe(FULL);
    }
  });
  it('invalid boundaries rejected (never clamped silently)', () => {
    expect(() => validateRange(0, 3, 6)).toThrow();
    expect(() => validateRange(4, 3, 6)).toThrow();
    expect(() => validateRange(1, 7, 6)).toThrow();
    expect(() => validateRange(7, 7, 6)).toThrow();
    expect(() => rangeDuration(s, 1, 7)).toThrow();
  });
  it('missing duration inside range: resolved subtotal + incomplete flag, never zero-filled', () => {
    const m = snap([100, null, 300]);
    const r = rangeDuration(m, 1, 3);
    expect(r.totalSec).toBe(400);
    expect(r.isComplete).toBe(false);
    expect(r.unresolvedPositions).toEqual([2]);
    expect(sumEntries(m.entries).isComplete).toBe(false);
  });
  it('duplicate video IDs at distinct positions counted independently', () => {
    const d = snap([100, 200, 100], ['same', 'other', 'same']);
    expect(rangeDuration(d, 1, 3).totalSec).toBe(400);
    expect(rangeDuration(d, 1, 1).totalSec).toBe(100);
    expect(rangeDuration(d, 3, 3).totalSec).toBe(100);
  });
  it('reordered entry arrays do not corrupt positional sums', () => {
    const reordered: PlaylistSnapshot = { ...s, entries: [...s.entries].reverse() };
    expect(rangeDuration(reordered, 1, 6).totalSec).toBe(FULL);
    expect(rangeDuration(reordered, 2, 4).totalSec).toBe(7382);
  });
  it('playlist shrink after refresh flags saved ranges for review', () => {
    expect(rangeStatus(1, 6, 6)).toBe('valid');
    expect(rangeStatus(1, 6, 4)).toBe('needsReview'); // was 6 long, now 4
    expect(rangeStatus(2, 4, 4)).toBe('valid');
  });
});
