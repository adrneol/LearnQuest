import { assertSafeNonNegativeInt } from '../duration/duration.js';
import type { PlaylistEntry, PlaylistSnapshot, SnapshotCompleteness } from '../../types/index.js';

export const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{10,64}$/;
export const MAX_ENTRIES = 1000;

/** Accept raw ID or common YouTube URLs; throw with user-friendly message otherwise. */
export function parsePlaylistId(input: string): string {
  if (typeof input !== 'string') throw new Error('Playlist input must be text.');
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Enter a YouTube playlist URL or playlist ID.');
  // Raw ID fast path
  if (PLAYLIST_ID_RE.test(trimmed)) return trimmed;
  // Try URL parse
  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '').toLowerCase();
    if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com')) {
      const list = url.searchParams.get('list');
      if (list && PLAYLIST_ID_RE.test(list)) return list;
    }
  } catch {
    // fall through to error below
  }
  // Last resort: extract list= param via regex (handles pasted text with extra params)
  const m = /[?&]list=([A-Za-z0-9_-]{10,64})/.exec(trimmed);
  if (m) return m[1];
  throw new Error('Invalid playlist. Paste a youtube.com/playlist?list=ID link or the playlist ID itself.');
}

export interface RangeValidation {
  start: number;
  end: number;
  n: number;
}

/** Validate 1-indexed inclusive range against N. Returns normalized {start,end,n}. */
export function validateRange(start: unknown, end: unknown, n: number): RangeValidation {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid playlist length.');
  if (!Number.isInteger(start as number) || !Number.isInteger(end as number)) {
    throw new Error('Range start and end must be integers.');
  }
  const s = start as number;
  const e = end as number;
  if (n === 0) throw new Error('Playlist is empty; no valid range exists.');
  if (s < 1) throw new Error(`Range start must be >= 1 (got ${s}).`);
  if (e < s) throw new Error(`Range end (${e}) must be >= start (${s}).`);
  if (s > n) throw new Error(`Range start (${s}) exceeds playlist length (${n}).`);
  if (e > n) throw new Error(`Range end (${e}) exceeds playlist length (${n}).`);
  return { start: s, end: e, n };
}

export interface SumResult {
  totalSec: number;
  resolved: number;
  unresolved: number;
  unresolvedPositions: number[];
  isComplete: boolean;
}

/** Sum integer seconds over entries (each counted once per position). Missing = unresolved, NOT zero. */
export function sumEntries(entries: PlaylistEntry[]): SumResult {
  let total = 0;
  let resolved = 0;
  let unresolved = 0;
  const unresolvedPositions: number[] = [];
  for (const e of entries) {
    if (e.durationSec === null || e.durationSec === undefined) {
      unresolved += 1;
      unresolvedPositions.push(e.position);
      continue;
    }
    assertSafeNonNegativeInt(e.durationSec, `duration at position ${e.position}`);
    total += e.durationSec;
    if (!Number.isSafeInteger(total)) throw new Error('Duration sum overflow.');
    resolved += 1;
  }
  return { totalSec: total, resolved, unresolved, unresolvedPositions, isComplete: unresolved === 0 };
}

export function snapshotCompleteness(snapshot: PlaylistSnapshot): SnapshotCompleteness {
  const entries = [...snapshot.entries].sort((a, b) => a.position - b.position);
  const s = sumEntries(entries);
  return { n: entries.length, resolved: s.resolved, unresolved: s.unresolved, unresolvedPositions: s.unresolvedPositions, isComplete: s.isComplete };
}

/** Inclusive range sum over positions. Validates boundaries dynamically against snapshot length. */
export function rangeDuration(snapshot: PlaylistSnapshot, start: number, end: number): SumResult & { count: number } {
  const n = snapshot.entries.length;
  validateRange(start, end, n);
  const byPos = new Map(snapshot.entries.map((e) => [e.position, e]));
  const slice: PlaylistEntry[] = [];
  for (let i = start; i <= end; i++) {
    const e = byPos.get(i);
    if (!e) {
      // Gap in positions — treat as unresolved placeholder
      slice.push({ position: i, videoId: '', title: '(missing entry)', durationSec: null, unresolvedReason: 'unknown' });
    } else {
      slice.push(e);
    }
  }
  const s = sumEntries(slice);
  return { ...s, count: end - start + 1 };
}

/** Non-contiguous selection sum (row-selected videos). Labelled as selection, not continuous range. */
export function selectionDuration(entries: PlaylistEntry[]): SumResult & { count: number } {
  const s = sumEntries(entries);
  return { ...s, count: entries.length };
}

export interface PlaylistDiff {
  added: { position: number; videoId: string; title: string }[];
  removed: { position: number; videoId: string; title: string }[];
  moved: { videoId: string; from: number; to: number }[];
  unresolvedNow: number[];
  grown: boolean;
  shrunk: boolean;
}

/** Compare old vs new snapshot by (position,videoId). Preserves history; only reports. */
export function diffSnapshots(oldSnap: PlaylistSnapshot, newSnap: PlaylistSnapshot): PlaylistDiff {
  const oldByPos = new Map(oldSnap.entries.map((e) => [e.position, e]));
  const newByPos = new Map(newSnap.entries.map((e) => [e.position, e]));
  const oldIds = new Map<string, number[]>();
  const newIds = new Map<string, number[]>();
  for (const e of oldSnap.entries) {
    if (!e.videoId) continue;
    const arr = oldIds.get(e.videoId) ?? [];
    arr.push(e.position);
    oldIds.set(e.videoId, arr);
  }
  for (const e of newSnap.entries) {
    if (!e.videoId) continue;
    const arr = newIds.get(e.videoId) ?? [];
    arr.push(e.position);
    newIds.set(e.videoId, arr);
  }
  const added: PlaylistDiff['added'] = [];
  const removed: PlaylistDiff['removed'] = [];
  const moved: PlaylistDiff['moved'] = [];
  const maxN = Math.max(oldSnap.entries.length, newSnap.entries.length);
  for (let i = 1; i <= maxN; i++) {
    const o = oldByPos.get(i);
    const n = newByPos.get(i);
    if (o && !n) removed.push({ position: i, videoId: o.videoId, title: o.title });
    else if (!o && n) added.push({ position: i, videoId: n.videoId, title: n.title });
    else if (o && n && o.videoId !== n.videoId) {
      removed.push({ position: i, videoId: o.videoId, title: o.title });
      added.push({ position: i, videoId: n.videoId, title: n.title });
    }
  }
  // Detect moves: same videoId, different first position
  for (const [vid, oldPos] of oldIds) {
    const newPos = newIds.get(vid);
    if (newPos && oldPos.length === 1 && newPos.length === 1 && oldPos[0] !== newPos[0]) {
      moved.push({ videoId: vid, from: oldPos[0], to: newPos[0] });
    }
  }
  const unresolvedNow = newSnap.entries.filter((e) => e.durationSec === null).map((e) => e.position);
  return {
    added,
    removed,
    moved,
    unresolvedNow,
    grown: newSnap.entries.length > oldSnap.entries.length,
    shrunk: newSnap.entries.length < oldSnap.entries.length,
  };
}

/** Check saved range/checkpoint validity against current N without silently clamping. */
export function rangeStatus(start: number, end: number, n: number): 'valid' | 'needsReview' {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return 'needsReview';
  if (start < 1 || end < start || end > n || start > n) return 'needsReview';
  return 'valid';
}

export type EntrySortKey = 'pos' | 'dur-desc' | 'dur-asc' | 'title-asc' | 'title-desc';

/**
 * Deterministic entry ordering for display. Numeric durationSec comparison
 * (never formatted strings); unresolved (null) durations always sort LAST for
 * duration keys — never treated as zero-length videos. Ties break by playlist
 * position. Returns a new array; the canonical snapshot order is untouched.
 */
export function sortEntries(entries: PlaylistEntry[], sort: EntrySortKey): PlaylistEntry[] {
  const list = [...entries];
  switch (sort) {
    case 'dur-desc':
      list.sort((a, b) => {
        const da = a.durationSec === null ? -1 : a.durationSec;
        const db = b.durationSec === null ? -1 : b.durationSec;
        return db - da || a.position - b.position;
      });
      break;
    case 'dur-asc':
      list.sort((a, b) => {
        const da = a.durationSec === null ? Number.MAX_SAFE_INTEGER : a.durationSec;
        const db = b.durationSec === null ? Number.MAX_SAFE_INTEGER : b.durationSec;
        return da - db || a.position - b.position;
      });
      break;
    case 'title-asc':
      list.sort((a, b) => a.title.localeCompare(b.title) || a.position - b.position);
      break;
    case 'title-desc':
      list.sort((a, b) => b.title.localeCompare(a.title) || a.position - b.position);
      break;
    case 'pos':
    default:
      list.sort((a, b) => a.position - b.position);
      break;
  }
  return list;
}
