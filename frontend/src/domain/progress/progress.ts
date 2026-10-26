import { sumEntries } from '../playlist/playlist.js';
import { buildEntryProgressIndex, isProgressComplete } from './identity.js';
import type { PlaylistSnapshot, ProgressRecord } from '../../types/index.js';

export interface PlaylistProgress {
  n: number;
  completedCount: number;
  remainingCount: number;
  unresolvedCount: number;
  /** null when incomplete — never present partial as complete */
  completedSec: number | null;
  remainingSec: number | null;
  totalSec: number | null;
  isDurationComplete: boolean;
  countPct: number; // 0-100
  durationPct: number | null; // null when incomplete
  nextPosition: number | null;
}

/**
 * Progress keyed by stable playlist-occurrence identity. Legacy position keys
 * are still read when their stored videoId agrees; an uncompleted record or a
 * note-only record is never treated as completion.
 */
export function computePlaylistProgress(
  snapshot: PlaylistSnapshot,
  progress: Map<string, ProgressRecord> | Record<string, ProgressRecord>,
): PlaylistProgress {
  const records: Record<string, ProgressRecord> =
    progress instanceof Map ? Object.fromEntries(progress) : progress;
  const entries = [...snapshot.entries].sort((a, b) => a.position - b.position);
  const index = buildEntryProgressIndex(snapshot, records);
  const n = entries.length;
  const total = sumEntries(entries);
  let completedCount = 0;
  let completedSec = 0;
  let nextPosition: number | null = null;
  for (const e of entries) {
    const rec = index.get(e.position);
    if (isProgressComplete(rec)) {
      completedCount += 1;
      if (e.durationSec !== null) completedSec += e.durationSec;
    } else if (nextPosition === null) {
      // The first unfinished entry is a valid next action even when unresolved.
      nextPosition = e.position;
    }
  }
  const remainingCount = n - completedCount;
  const unresolvedCount = total.unresolved;
  const isDurationComplete = total.isComplete;
  const totalSec = isDurationComplete ? total.totalSec : null;
  const completedSecOut = isDurationComplete ? completedSec : null;
  const remainingSecOut = isDurationComplete && completedSecOut !== null && totalSec !== null ? totalSec - completedSecOut : null;
  const countPct = n === 0 ? 0 : (completedCount / n) * 100;
  // A zero-duration playlist is not "100% watched"; it has no meaningful
  // duration ratio, so the percentage is withheld rather than fabricated.
  const durationPct =
    isDurationComplete && totalSec !== null && totalSec > 0 && completedSecOut !== null
      ? (completedSecOut / totalSec) * 100
      : null;
  return {
    n,
    completedCount,
    remainingCount,
    unresolvedCount,
    completedSec: completedSecOut,
    remainingSec: remainingSecOut,
    totalSec,
    isDurationComplete,
    countPct,
    durationPct,
    nextPosition,
  };
}

export interface RangeProgress {
  count: number;
  done: number;
  remaining: number;
  totalSec: number | null;
  doneSec: number | null;
  remainingSec: number | null;
  isComplete: boolean;
  pct: number | null;
}

export function computeRangeProgress(
  snapshot: PlaylistSnapshot,
  start: number,
  end: number,
  progress: Map<string, ProgressRecord> | Record<string, ProgressRecord>,
): RangeProgress {
  const records: Record<string, ProgressRecord> =
    progress instanceof Map ? Object.fromEntries(progress) : progress;
  const index = buildEntryProgressIndex(snapshot, records);
  const byPos = new Map(snapshot.entries.map((e) => [e.position, e]));
  let done = 0;
  let doneSec = 0;
  let totalSec = 0;
  let isComplete = true;
  const count = end - start + 1;
  for (let i = start; i <= end; i++) {
    const e = byPos.get(i);
    const rec = index.get(i);
    if (!e || e.durationSec === null) {
      isComplete = false;
      if (isProgressComplete(rec)) done += 1;
      continue;
    }
    totalSec += e.durationSec;
    if (isProgressComplete(rec)) {
      done += 1;
      doneSec += e.durationSec;
    }
  }
  return {
    count,
    done,
    remaining: count - done,
    totalSec: isComplete ? totalSec : null,
    doneSec: isComplete ? doneSec : null,
    remainingSec: isComplete ? totalSec - doneSec : null,
    isComplete,
    pct: isComplete && totalSec > 0 ? (doneSec / totalSec) * 100 : null,
  };
}
