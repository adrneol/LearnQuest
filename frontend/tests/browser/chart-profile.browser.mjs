import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir } from 'node:fs/promises';
import { startBrowserFixture, waitForLibrary } from './helpers/isolated-browser.mjs';

test('playlist chart profile', { timeout: 480_000 }, async (t) => {
  const fixture = await startBrowserFixture(t);
  const phase = process.env.LQ_CHART_PROFILE ?? 'after';
  const output = 'test-results/visual/phase-c';
  await mkdir(output, { recursive: true });
  for (const [count, width] of [[1, 390], [2, 320], [8, 1440], [139, 1440], [500, 1024], [1000, 1440], [2000, 390], [5000, 320]]) {
    await t.test(`${count} videos at ${width}px`, async (subtest) => {
      const page = await fixture.open(subtest, { entryCount: count, width, theme: width < 600 ? 'light' : 'dark' });
      await waitForLibrary(page);
      const chart = page.getByRole('region', { name: 'Video duration chart.', exact: true });
      await chart.locator('.recharts-cartesian-axis-tick-value').first().waitFor();
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Performance.enable');
      const resource = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics
        .filter(({ name }) => name === 'JSHeapUsedSize' || name === 'TaskDuration').map(({ name, value }) => [name, value]));
      const startResource = await resource();
      const paint = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const time = async (action) => {
        const start = performance.now();
        await action();
        await paint();
        return Math.round(performance.now() - start);
      };
      const overviewMs = await time(() => page.getByRole('button', { name: /^Full playlist/ }).click());
      const overviewNodes = await chart.locator('svg *').count();
      if (count === 139 || count === 2000) await chart.screenshot({ path: `${output}/${phase}-${count}-${width}.png`, animations: 'disabled' });
      const detailMs = await time(() => page.getByRole('button', { name: 'Explore individual videos' }).first().click());
      const detailNodes = await chart.locator('svg *').count();
      const next = page.getByRole('button', { name: 'Next positions' }).first();
      const panMs = await next.isEnabled() ? await time(() => next.click()) : null;
      const box = await chart.boundingBox();
      const pointerMs = await time(() => page.mouse.move(box.x + box.width * .7, box.y + box.height * .35));
      const zoom = page.getByRole('button', { name: 'Zoom in', exact: true }).first();
      const zoomMs = await zoom.count() && await zoom.isEnabled() ? await time(() => zoom.click()) : null;
      const resizeMs = await time(() => page.setViewportSize({ width: width + 40, height: 900 }));
      const endResource = await resource();
      const rendererTaskMs = Math.round((endResource.TaskDuration - startResource.TaskDuration) * 1000);
      const rendererHeapMiB = Number((endResource.JSHeapUsedSize / 1024 ** 2).toFixed(1));
      subtest.diagnostic(JSON.stringify({ phase, chromium: fixture.browserVersion, count, width, overviewMs, overviewNodes,
        detailMs, detailNodes, panMs, pointerMs, zoomMs, resizeMs, rendererTaskMs, rendererHeapMiB }));
    });
  }
  if (phase === 'after') {
    await t.test('ordinary 139-video overview, dock coexistence and playlist switching', async (subtest) => {
      const entry = (position) => ({
        position, entryId: `regular-${position}`, videoId: `regular-video-${position}`,
        title: `Synthetic video ${position}`, durationSec: 49 + (position * 137) % 600,
      });
      const page = await fixture.open(subtest, {
        entries: Array.from({ length: 139 }, (_, index) => entry(index + 1)),
        alternateEntries: [entry(1), entry(2)],
      });
      await waitForLibrary(page);
      const chart = page.getByRole('region', { name: 'Video duration chart.', exact: true });
      const view = chart.locator('..');
      await page.getByRole('button', { name: /^Full playlist/ }).click();
      await chart.getByText('139', { exact: true }).waitFor();
      await view.screenshot({ path: `${output}/139-typical-overview.png`, animations: 'disabled' });
      await view.getByRole('button', { name: 'Explore individual videos' }).click();
      await view.getByRole('button', { name: 'Next positions' }).click();
      const readout = view.getByText(/^Positions — /);
      const before = await readout.innerText();
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await page.setViewportSize({ width: 1024, height: 900 });
      assert.equal(await readout.innerText(), before);
      await page.getByRole('button', { name: 'Close navigation' }).press('Escape');
      await page.getByRole('button', { name: 'Active playlist' }).click();
      await page.getByRole('option', { name: /Alternate synthetic playlist/ }).click();
      await view.getByText('Overview — 1–2 of 2', { exact: true }).waitFor();
      assert.equal(await readout.count(), 0);
    });
  }
});
