import { entryKey, isProgressComplete } from '../../domain/progress/identity.js';
import type { PlaylistEntry, ProgressRecord } from '../../types/index.js';

export interface PlaylistPoint {
  id: string;
  pos: number;
  videoId: string;
  title: string;
  durationSec: number | null;
  unresolvedReason?: PlaylistEntry['unresolvedReason'];
  /** Known subtotal within the adapter's input range. */
  cumSec: number;
  incomplete: boolean;
  done?: boolean;
}

export function playlistPoints(playlistId: string, entries: readonly PlaylistEntry[], progress?: ReadonlyMap<number, ProgressRecord>): PlaylistPoint[] {
  let cumSec = 0;
  let incomplete = false;
  return [...entries].sort((a, b) => a.position - b.position).map((entry) => {
    cumSec += entry.durationSec ?? 0;
    incomplete ||= entry.durationSec === null;
    return {
      id: entryKey(playlistId, entry), pos: entry.position, videoId: entry.videoId,
      title: entry.title, durationSec: entry.durationSec, unresolvedReason: entry.unresolvedReason, cumSec, incomplete,
      done: progress ? isProgressComplete(progress.get(entry.position)) : undefined,
    };
  });
}

/** Slice by actual position and rebase only the known subtotal. */
export function rangePoints(data: readonly PlaylistPoint[], start: number, end: number): PlaylistPoint[] {
  const first = positionIndex(data, start);
  const after = positionIndex(data, end + 1);
  const before = data[first - 1]?.cumSec ?? 0;
  let incomplete = false;
  return data.slice(first, after).map((point) => {
    incomplete ||= point.durationSec === null;
    return { ...point, cumSec: point.cumSec - before, incomplete };
  });
}

/** Lower bound in the ordered position index, including positions in gaps. */
export function positionIndex(data: readonly PlaylistPoint[], position: number): number {
  let low = 0;
  let high = data.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (data[mid].pos < position) low = mid + 1;
    else high = mid;
  }
  return low;
}

export interface Viewport { start: number; length: number }
export type PlaylistMetric = 'duration' | 'cumulative';
export type ChartMark = {
  start: number;
  end: number;
  first: PlaylistPoint;
  last: PlaylistPoint;
  value: number | null;
  min: number | null;
  max: number | null;
  total: number;
  unresolved: number;
};

export function clampViewport(count: number, start: number, length: number): Viewport {
  const size = Math.min(count, Math.max(1, Math.round(length)));
  return { start: Math.max(0, Math.min(count - size, Math.round(start))), length: size };
}

export function markBudget(width: number, slot = 12): number {
  return Math.max(1, Math.min(120, Math.floor(width / slot)));
}

export function chartMarks(data: readonly PlaylistPoint[], window: Viewport, budget: number, metric: PlaylistMetric): ChartMark[] {
  const bins = Math.min(window.length, Math.max(1, Math.floor(budget)));
  return Array.from({ length: bins }, (_, i) => {
    const start = window.start + Math.floor(i * window.length / bins);
    const end = window.start + Math.floor((i + 1) * window.length / bins);
    let min = Infinity;
    let max = -Infinity;
    let total = 0;
    let unresolved = 0;
    for (let j = start; j < end; j++) {
      const point = data[j];
      if (point.durationSec === null) { unresolved++; continue; }
      const value = metric === 'duration' ? point.durationSec : point.cumSec;
      min = Math.min(min, value);
      max = Math.max(max, value);
      total += point.durationSec;
    }
    const available = unresolved < end - start;
    return {
      start, end, first: data[start], last: data[end - 1],
      value: end - start === 1 && available ? max : null,
      min: available ? min : null, max: available ? max : null, total, unresolved,
    };
  });
}

export function axisIndices(count: number, width: number): number[] {
  const labels = Math.min(count, Math.max(2, Math.floor(width / 54)));
  return Array.from({ length: labels }, (_, i) => labels === 1 ? 0 : Math.round(i * (count - 1) / (labels - 1)));
}
