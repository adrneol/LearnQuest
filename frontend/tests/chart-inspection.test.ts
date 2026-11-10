import { expect, it } from 'vitest';
import { inspectionFor, markKey, resolvePin } from '../src/components/charts/chartInspection';
import { chartMarks, playlistPoints } from '../src/components/charts/playlistSeries';

const data = playlistPoints('playlist', [
  { position: 25, entryId: 'a', videoId: 'duplicate', title: 'First', durationSec: 73 },
  { position: 55, entryId: 'b', videoId: 'duplicate', title: 'Second', durationSec: null },
  { position: 100, entryId: 'c', videoId: 'other', title: 'Third', durationSec: 90001 },
]);

it('uses the same exact group model after resolving a pin from occurrence boundaries', () => {
  const view = { start: 0, length: data.length };
  const [mark] = chartMarks(data, view, 1, 'cumulative');
  const [durations] = chartMarks(data, view, 1, 'duration');
  const inspection = inspectionFor(mark, durations, 'cumulative');
  expect(inspection).toMatchObject({
    heading: 'Videos 25–100', detail: '3 entries · 1 unresolved',
    value: '0:01:13 – 25:00:01', subtotal: 'Known subtotal 0:01:13 → 25:01:14',
  });
  expect(resolvePin(data, markKey(mark), 'cumulative')?.inspection).toEqual(inspection);
  expect(resolvePin(data.slice(1), markKey(mark), 'cumulative')).toBeUndefined();
});

it('resolves a video pin by occurrence rather than position or duplicate video ID', () => {
  const first = resolvePin(data, { first: data[0].id }, 'duration')?.inspection;
  const second = resolvePin(data, { first: data[1].id }, 'duration')?.inspection;
  expect(first).toMatchObject({ heading: 'Video #25', value: '0:01:13' });
  expect(second).toMatchObject({ heading: 'Video #55', value: 'Unresolved' });
  expect(second?.id).not.toBe(first?.id);
});
