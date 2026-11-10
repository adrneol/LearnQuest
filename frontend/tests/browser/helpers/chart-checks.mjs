import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { waitForLibrary } from './isolated-browser.mjs';

const durationChart = (page) => page.getByRole('region', { name: 'Video duration chart.', exact: true });
const currentChart = (chart) => chart.locator('..');
const settledTicks = (chart) => chart.locator('.recharts-xAxis .recharts-cartesian-axis-tick-value');

export async function checkChartPosition(t, fixture) {
  await t.test('CHART-2: the detail viewport reports actual playlist positions', async (subtest) => {
    const page = await fixture.open(subtest);
    await waitForLibrary(page);
    await page.getByRole('textbox', { name: /^Start / }).fill('25');
    await page.getByRole('textbox', { name: /^End / }).fill('100');
    const chart = durationChart(page);
    const view = currentChart(chart);
    await view.getByRole('button', { name: 'Explore individual videos' }).click();
    const readout = view.getByText(/^Positions — /);
    await readout.waitFor();
    assert.match(await readout.innerText(), /^Positions — 25–\d+ of 76$/);
    await settledTicks(chart).first().waitFor();
    assert.equal(await settledTicks(chart).first().textContent(), '25');
    const geometry = await chart.evaluate((element) => {
      const tick = element.querySelector('.recharts-xAxis .recharts-cartesian-axis-tick-value').getBoundingClientRect();
      const bar = element.querySelector('.recharts-bar-rectangle path').getBoundingClientRect();
      return Math.abs(tick.x + tick.width / 2 - bar.x - bar.width / 2);
    });
    assert.ok(geometry < 1.5, `The first X tick and bar share a center (delta ${geometry}px)`);
    await chart.press('Home');
    assert.match(await view.getByRole('status').first().textContent(), /Video #25/);
    await view.getByRole('spinbutton', { name: 'Video position' }).fill('100');
    await view.getByRole('button', { name: 'Jump to video' }).click();
    assert.match(await view.getByRole('status').first().textContent(), /Video #100/);
    assert.equal(await settledTicks(chart).last().textContent(), '100');
    await view.getByRole('button', { name: 'Zoom in' }).click();
    assert.match(await readout.innerText(), /–100 of 76$/);
    await view.getByRole('button', { name: 'Return to full overview' }).click();
    assert.equal(await view.getByText(/^Overview — /).innerText(), 'Overview — 25–100 of 76');
    await page.getByRole('button', { name: 'Cumulative duration' }).click();
    const cumulative = page.getByRole('region', { name: 'Cumulative duration chart.', exact: true });
    await cumulative.press('Home');
    assert.match(await currentChart(cumulative).getByRole('status').first().textContent(), /Video #25.*0:04:52.*Known subtotal 0:04:52/);
    await page.getByRole('textbox', { name: /^Start / }).fill('55');
    await cumulative.press('Home');
    assert.match(await currentChart(cumulative).getByRole('status').first().textContent(), /Video #55.*Known subtotal 0:07:18/);
  });
}

export async function checkCharts(t, fixture, review) {
  await checkChartPosition(t, fixture);
  await t.test('empty, single unknown and equal-duration plots are explicit', async (subtest) => {
    for (const values of [[], [null], [6660, 6660]]) {
      const entries = values.map((durationSec, index) => ({
        position: index + 1, durationSec, entryId: 'entry-' + index, videoId: 'duplicate-video', title: 'Lesson ' + (index + 1),
      }));
      const page = await fixture.open(subtest, { width: 768, entries, route: 'analytics' });
      if (!values.length) {
        await page.getByText('No videos to chart.', { exact: true }).waitFor();
        continue;
      }
      const chart = page.getByRole('region', { name: 'Minutes per resolved video' });
      await settledTicks(chart).last().waitFor();
      await chart.press('End');
      assert.match(await currentChart(chart).getByRole('status').first().textContent(),
        values.length === 1 ? /Video #1.*Unresolved/ : /Video #2.*1:51:00/);
      if (values.length === 2) {
        const yTicks = await chart.locator('.recharts-yAxis .recharts-cartesian-axis-tick-value').allTextContents();
        assert.ok(Number(yTicks.at(-1)) >= 6660 / 3600);
      }
    }
  });
  await t.test('large overview exposes an outlier, drills down, and keeps touch scrolling local', async (subtest) => {
    const page = await fixture.open(subtest, { width: 390, height: 844, touch: true, entryCount: 2000, theme: 'light' });
    await waitForLibrary(page);
    await page.getByRole('button', { name: /^Full playlist/ }).click();
    const chart = durationChart(page);
    const view = currentChart(chart);
    await chart.getByText('2000', { exact: true }).waitFor();
    assert.ok(await chart.locator('svg *').count() < 220);
    const edgePositions = await settledTicks(chart).evaluateAll((elements) => {
      const bounds = elements[0].closest('svg').getBoundingClientRect();
      return elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return [element.textContent, rect.left >= bounds.left && rect.right <= bounds.right];
      });
    });
    assert.deepEqual(edgePositions.at(0), ['1', true]);
    assert.deepEqual(edgePositions.at(-1), ['2000', true]);
    await chart.press('Home');
    assert.match(await view.getByRole('status').first().textContent(), /^Videos 1–/);
    await chart.press('Enter');
    await view.getByText(/^Positions — 1–/).waitFor();
    await view.getByRole('button', { name: 'Zoom in' }).click();
    await chart.press('Home');
    assert.match(await view.getByRole('status').first().textContent(), /Videos? #?1/);
    await view.getByRole('spinbutton', { name: 'Video position' }).fill('1001');
    await view.getByRole('button', { name: 'Jump to video' }).click();
    assert.match(await view.getByRole('status').first().textContent(), /Video #1001.*25:00:01/);
    await view.getByRole('button', { name: 'Visible scale' }).click();
    await view.getByText(/Visible-range scale starts at 0:00:00/).waitFor();
    const readout = view.getByText(/^Positions — /);
    const before = await readout.innerText();
    await chart.scrollIntoViewIfNeeded();
    const box = await chart.boundingBox();
    const y = box.y + box.height / 2;
    const x = box.x + box.width * .8;
    const cdp = await page.context().newCDPSession(page);
    const scroll = await page.evaluate(() => scrollY);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (const delta of [30, 60, 90]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - delta, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.notEqual(await readout.innerText(), before);
    assert.equal(await page.evaluate(() => scrollY), scroll);
    const afterTouch = await readout.innerText();
    await chart.focus();
    await page.mouse.move(x, y);
    await page.mouse.wheel(100, 0);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.notEqual(await readout.innerText(), afterTouch);
    assert.equal(await page.evaluate(() => scrollY), scroll);
    const afterWheelPan = await readout.innerText();
    await page.mouse.wheel(0, 160);
    await page.waitForFunction((previous) => scrollY > previous, scroll);
    assert.equal(await readout.innerText(), afterWheelPan);
    await page.evaluate(() => {
      localStorage.setItem('lq-theme', 'dark');
      dispatchEvent(new StorageEvent('storage', { key: 'lq-theme' }));
    });
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    const panned = await readout.innerText();
    await page.setViewportSize({ width: 320, height: 720 });
    assert.equal(await readout.innerText(), panned);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    if (review) {
      await mkdir('test-results/visual/phase-c', { recursive: true });
      await view.screenshot({ path: 'test-results/visual/phase-c/mobile-detail.png', animations: 'disabled' });
    }
    await view.getByText('View chart data as a table', { exact: true }).click();
    const rows = view.getByRole('table').getByRole('rowheader');
    await rows.last().waitFor();
    assert.equal(await rows.count(), 25);
    assert.equal(await rows.last().textContent(), '#25');
    await view.getByRole('button', { name: 'Next rows' }).click();
    assert.equal(await rows.first().textContent(), '#26');
  });

  await t.test('gapped and reordered playlist keeps every exact row available', async (subtest) => {
    const entries = [[100, 90001], [55, null], [1, 0], [25, 73]].map(([position, durationSec]) => ({
      position, durationSec, entryId: 'distinct-' + position, videoId: 'same-video', title: 'Lesson ' + position,
      ...(position === 55 ? { unresolvedReason: 'private' } : {}),
    }));
    const page = await fixture.open(subtest, { width: 320, entries, route: 'analytics' });
    const chart = page.getByRole('region', { name: 'Minutes per resolved video' });
    const view = currentChart(chart);
    await settledTicks(chart).last().waitFor();
    assert.equal(await settledTicks(chart).last().textContent(), '100');
    await chart.press('Home');
    assert.match(await view.getByRole('status').first().textContent(), /Video #1.*0:00:00/);
    await chart.press('ArrowRight');
    assert.match(await view.getByRole('status').first().textContent(), /Video #25.*0:01:13/);
    await chart.press('ArrowRight');
    assert.match(await view.getByRole('status').first().textContent(), /Video #55.*Unavailable \(private video\)/);
    await view.getByText('View chart data as a table', { exact: true }).click();
    const table = view.getByRole('table');
    assert.deepEqual(await table.getByRole('rowheader').allTextContents(), ['#1', '#25', '#55', '#100']);
  });
}
