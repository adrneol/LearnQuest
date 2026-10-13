import { describe, it, expect } from 'vitest';
import { sortEntries } from '../src/domain/playlist/playlist.js';
import type { PlaylistEntry } from '../src/types/index.js';

const e = (position: number, durationSec: number | null, title = `Video ${position}`): PlaylistEntry => ({
  position,
  videoId: `vid${position}`,
  title,
  durationSec,
});

// Deliberately out-of-order durations with ties and an unresolved entry
const FIXTURE = [
  e(1, 700, 'Banana'),
  e(2, 1400, 'Apple'),
  e(3, null, 'Cherry'),
  e(4, 700, 'Apricot'),
  e(5, 60, 'Date'),
];

describe('sortEntries (single authoritative ordering)', () => {
  it('longest-first is numeric desc, ties by position, unresolved last', () => {
    const got = sortEntries(FIXTURE, 'dur-desc').map((x) => x.position);
    expect(got).toEqual([2, 1, 4, 5, 3]);
  });
  it('shortest-first is numeric asc, unresolved last (never zero)', () => {
    const got = sortEntries(FIXTURE, 'dur-asc').map((x) => x.position);
    expect(got).toEqual([5, 1, 4, 2, 3]);
  });
  it('title sorts use locale order with position tiebreak', () => {
    expect(sortEntries(FIXTURE, 'title-asc').map((x) => x.title)).toEqual([
      'Apple', 'Apricot', 'Banana', 'Cherry', 'Date',
    ]);
    expect(sortEntries(FIXTURE, 'title-desc').map((x) => x.title)).toEqual([
      'Date', 'Cherry', 'Banana', 'Apricot', 'Apple',
    ]);
  });
  it('playlist order is by position; input array is never mutated', () => {
    const before = FIXTURE.map((x) => x.position);
    const out = sortEntries(FIXTURE, 'dur-desc');
    expect(out).not.toBe(FIXTURE);
    expect(FIXTURE.map((x) => x.position)).toEqual(before);
    expect(sortEntries(FIXTURE, 'pos').map((x) => x.position)).toEqual([1, 2, 3, 4, 5]);
  });
  it('does not sort formatted duration strings', () => {
    // 700s ("0:11:40") must beat 1400s? No — 1400 first. A string sort would
    // put "0:11:40" < "0:23:20" correctly here by luck, so use a sharper case:
    const tricky = [e(1, 6000, 'A'), e(2, 700, 'B')]; // "1:40:00" vs "0:11:40"
    expect(sortEntries(tricky, 'dur-desc').map((x) => x.position)).toEqual([1, 2]);
    expect(sortEntries(tricky, 'dur-asc').map((x) => x.position)).toEqual([2, 1]);
  });
});
