import { formatSecondsHHMMSS as time } from '../../domain/duration/duration.js';
import { chartDuration } from './chartDuration.js';
import { chartMarks, type ChartMark, type PlaylistMetric, type PlaylistPoint } from './playlistSeries.js';

/** Occurrence keys define a point or the boundaries of a group. */
export type MarkKey = { first: string; last?: string };

export function markKey(mark: ChartMark): MarkKey {
  return { first: mark.first.id, last: mark.end > mark.start + 1 ? mark.last.id : undefined };
}

export function markId(key: MarkKey): string {
  return JSON.stringify([key.first, key.last]);
}

export interface ChartInspection {
  id: string;
  heading: string;
  detail?: string;
  value: string;
  valueLabel?: string;
  subtotal?: string;
  completed?: boolean;
  group: boolean;
}

export function inspectionFor(mark: ChartMark, durations: ChartMark, metric: PlaylistMetric): ChartInspection {
  const id = markId(markKey(mark));
  if (mark.end > mark.start + 1) {
    return {
      id,
      heading: `Videos ${mark.first.pos}–${mark.last.pos}`,
      detail: `${mark.end - mark.start} entries${mark.unresolved ? ` · ${mark.unresolved} unresolved` : ''}`,
      valueLabel: durations.min === null ? undefined : 'Duration min–max',
      value: durations.min === null || durations.max === null
        ? 'No resolved durations' : `${time(durations.min)} – ${time(durations.max)}`,
      subtotal: metric === 'cumulative' ? `Known subtotal ${time(mark.first.cumSec)} → ${time(mark.last.cumSec)}` : undefined,
      group: true,
    };
  }
  const point = mark.first;
  return {
    id,
    heading: `Video #${point.pos}`,
    detail: point.title,
    value: chartDuration(point),
    subtotal: metric === 'cumulative' ? `Known subtotal ${time(point.cumSec)}${point.incomplete ? ' (incomplete)' : ''}` : undefined,
    completed: point.done,
    group: false,
  };
}

export function resolvePin(data: readonly PlaylistPoint[], key: MarkKey, metric: PlaylistMetric) {
  const start = data.findIndex((point) => point.id === key.first);
  const end = key.last === undefined ? start : data.findIndex((point) => point.id === key.last);
  if (start < 0 || end < start) return undefined;
  const range = { start, length: end - start + 1 };
  const [mark] = chartMarks(data, range, 1, metric);
  const [durations] = metric === 'duration' ? [mark] : chartMarks(data, range, 1, 'duration');
  return { start, end: key.last === undefined ? undefined : end + 1, inspection: inspectionFor(mark, durations, metric) };
}
