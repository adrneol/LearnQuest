import { describe, expect, it } from 'vitest';
import { axisIndices, chartMarks, clampViewport, markBudget, playlistPoints, positionIndex, rangePoints } from '../src/components/charts/playlistSeries';
import { niceTicks } from '../src/components/charts/scale';

const entry = (position: number, durationSec: number | null) => ({
  position, durationSec, entryId: 'occurrence-' + position, videoId: 'same-video', title: 'Lesson ' + position,
});

describe('inclusive chart axes', () => {
  it('CHART-1: the highest duration tick covers the longest lesson', () => {
    expect(niceTicks(12).at(-1)).toBeGreaterThanOrEqual(12);
    expect(niceTicks(111).at(-1)).toBeGreaterThanOrEqual(111);
  });

  it.each([0, 1, 0.000003, 0.07, 1e9, 1e20, Number.MAX_VALUE])('covers %s with ordered finite ticks', (max) => {
    const ticks = niceTicks(max);
    expect(ticks[0]).toBe(0);
    expect(ticks.at(-1)).toBeGreaterThanOrEqual(max);
    expect(ticks.every((tick, i) => Number.isFinite(tick) && (!i || tick > ticks[i - 1]))).toBe(true);
  });

  it('retains both observed endpoints when thinning labels', () => {
    expect(axisIndices(0, 250)).toEqual([]);
    expect(axisIndices(1, 250)).toEqual([0]);
    expect(axisIndices(2, 250)).toEqual([0, 1]);
    expect(axisIndices(139, 250)).toEqual([0, 46, 92, 138]);
  });
});

describe('playlist chart contracts', () => {
  it('sorts occurrences by actual position and distinguishes missing values from genuine zero', () => {
    const inputs = [entry(100, 90001), entry(55, null), entry(25, 0), entry(59, 73)];
    const points = playlistPoints('p', inputs);
    expect(inputs.map(({ position }) => position)).toEqual([100, 55, 25, 59]);
    expect(points.map(({ pos, durationSec, cumSec, incomplete }) => [pos, durationSec, cumSec, incomplete]))
      .toEqual([[25, 0, 0, false], [55, null, 0, true], [59, 73, 73, true], [100, 90001, 90074, true]]);
    expect(new Set(points.map(({ id }) => id)).size).toBe(4);
    expect(playlistPoints('p', [entry(100, 90001)])[0].id).toBe(points[3].id);
    expect(positionIndex(points, 56)).toBe(2);
    expect(rangePoints(points, 59, 100).map(({ cumSec, incomplete }) => [cumSec, incomplete])).toEqual([[73, false], [90074, false]]);
    expect(chartMarks(points, { start: 0, length: 4 }, 4, 'cumulative').map(({ value }) => value)).toEqual([0, null, 73, 90074]);
    expect(chartMarks(playlistPoints('p', [entry(25, null)]), { start: 0, length: 1 }, 1, 'duration')[0].max).toBeNull();
    expect(chartMarks([], clampViewport(0, 0, 0), 15, 'duration')).toEqual([]);
  });

  it.each([1, 2, 8, 139, 500, 1000, 2000, 5000])('preserves every entry and exact extrema for %s positions', (count) => {
    const data = playlistPoints('p', Array.from({ length: count }, (_, i) => entry(i + 25, i === count - 1 ? 90001 : i % 11 === 0 ? null : i % 7)));
    const view = clampViewport(count, -3, count);
    const limit = markBudget(256);
    const marks = chartMarks(data, view, limit, 'duration');
    expect(marks.length).toBe(Math.min(count, limit));
    expect(marks.flatMap((mark) => data.slice(mark.start, mark.end).map(({ id }) => id))).toEqual(data.map(({ id }) => id));
    for (const mark of marks) {
      const resolved = data.slice(mark.start, mark.end).flatMap(({ durationSec }) => durationSec === null ? [] : [durationSec]);
      expect(mark.min).toBe(resolved.length ? Math.min(...resolved) : null);
      expect(mark.max).toBe(resolved.length ? Math.max(...resolved) : null);
      expect(mark.total).toBe(resolved.reduce((a, b) => a + b, 0));
      expect(mark.unresolved).toBe(mark.end - mark.start - resolved.length);
    }
    expect(marks.at(-1)?.max).toBe(90001);
    expect(chartMarks(data, view, limit, 'duration')).toEqual(marks);
  });

  it('clamps pan and zoom while preserving the requested window length', () => {
    expect(clampViewport(76, 999, 15)).toEqual({ start: 61, length: 15 });
    expect(clampViewport(76, -999, 15)).toEqual({ start: 0, length: 15 });
    expect(clampViewport(76, 12, 999)).toEqual({ start: 0, length: 76 });
    expect(clampViewport(76, 12, 0)).toEqual({ start: 12, length: 1 });
  });

  it('retains the source reason for unavailable entries', () => {
    const points = playlistPoints('p', [{ ...entry(1, null), unresolvedReason: 'private' }, entry(2, null)]);
    expect(points.map((point) => point.unresolvedReason)).toEqual(['private', undefined]);
  });
});
