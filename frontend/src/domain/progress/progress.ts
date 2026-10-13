import { sumEntries } from '../playlist/playlist.js';
import type { PlaylistEntry, PlaylistSnapshot, ProgressRecord } from '../../types/index.js';

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

function progressKey(playlistId: string, position: number): string {
  return `${playlistId}::${position}`;
}

/** Progress keyed by (playlistId, position) — duplicate videoIds at different positions stay distinct. */
export function computePlaylistProgress(
  snapshot: PlaylistSnapshot,
  progress: Map<string, ProgressRecord> | Record<string, ProgressRecord>,
): PlaylistProgress {
  const map: Map<string, ProgressRecord> =
    progress instanceof Map ? progress : new Map(Object.entries(progress));
  const entries = [...snapshot.entries].sort((a, b) => a.position - b.position);
  const n = entries.length;
  const total = sumEntries(entries);
  let completedCount = 0;
  let completedSec = 0;
  let completedResolved = 0;
  let nextPosition: number | null = null;
  const completedEntries: PlaylistEntry[] = [];
  for (const e of entries) {
    const rec = map.get(progressKey(snapshot.playlistId, e.position));
    // Also accept legacy keying by videoId only if position key missing AND videoId unique — but never conflate duplicates.
    const isDone = rec?.completedAt != null && rec.status === 'done';
    if (isDone) {
      completedCount += 1;
      if (e.durationSec !== null) {
        completedSec += e.durationSec;
        completedResolved += 1;
      }
      completedEntries.push(e);
    } else if (nextPosition === null && e.durationSec !== null) {
      nextPosition = e.position;
    } else if (nextPosition === null && e.durationSec === null) {
      // Still a valid next action even if unresolved
      nextPosition = e.position;
    }
  }
  void completedEntries;
  const remainingCount = n - completedCount;
  const unresolvedCount = total.unresolved;
  const isDurationComplete = total.isComplete;
  const totalSec = isDurationComplete ? total.totalSec : null;
  const completedSecOut = isDurationComplete ? completedSec : null;
  const remainingSecOut = isDurationComplete && completedSecOut !== null && totalSec !== null ? totalSec - completedSecOut : null;
  const countPct = n === 0 ? 0 : (completedCount / n) * 100;
  const durationPct =
    isDurationComplete && totalSec !== null && totalSec > 0 && completedSecOut !== null
      ? (completedSecOut / totalSec) * 100
      : isDurationComplete && totalSec === 0
        ? 100
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
  const map = progress instanceof Map ? progress : new Map(Object.entries(progress));
  const byPos = new Map(snapshot.entries.map((e) => [e.position, e]));
  let done = 0;
  let doneSec = 0;
  let totalSec = 0;
  let isComplete = true;
  const count = end - start + 1;
  for (let i = start; i <= end; i++) {
    const e = byPos.get(i);
    if (!e || e.durationSec === null) {
      isComplete = false;
      const rec = map.get(`${snapshot.playlistId}::${i}`);
      if (rec?.status === 'done') done += 1;
      continue;
    }
    totalSec += e.durationSec;
    const rec = map.get(`${snapshot.playlistId}::${i}`);
    if (rec?.status === 'done' && rec.completedAt) {
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
