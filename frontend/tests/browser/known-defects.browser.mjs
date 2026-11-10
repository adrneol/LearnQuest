import { test } from 'node:test';
import { startBrowserFixture } from './helpers/isolated-browser.mjs';
import { checkChartPosition } from './helpers/chart-checks.mjs';

test('focused chart regression', { timeout: 240_000 }, async (t) => {
  await checkChartPosition(t, await startBrowserFixture(t));
});
