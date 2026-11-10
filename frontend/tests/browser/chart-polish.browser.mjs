import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { test } from 'node:test';
import { startBrowserFixture, waitForLibrary } from './helpers/isolated-browser.mjs';

const output = 'test-results/visual/phase-c1';
const plot = (page, name = 'Video duration chart.') => page.getByRole('region', { name, exact: true });
const tooltip = (page) => page.locator('[data-chart-tooltip]');
const table = (chart) => chart.locator('..').getByRole('table');
const longTitle = 'An intentionally long lesson title about comparing exact video duration values, resolving incomplete records, and inspecting each distinct playlist occurrence without losing the full title in a narrow table';
const entry = (position, durationSec, title = 'Lesson ' + position) => ({
  position, entryId: 'precision-' + position, videoId: 'fixture-' + position, durationSec, title,
});
const band = (box, index, count) => ({
  x: box.x + 48 + (box.width - 64) * (index + .5) / count,
  y: box.y + box.height / 2,
});
const snap = (page, name) => page.screenshot({ path: `${output}/${name}.png`, animations: 'disabled', caret: 'hide' });
const paint = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function withinViewport(page, locator) {
  const bounds = await locator.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(bounds && viewport && bounds.x >= 7 && bounds.y >= 7
    && bounds.x + bounds.width <= viewport.width - 7 && bounds.y + bounds.height <= viewport.height - 7);
  return bounds;
}

test('precision tooltip and chart table', { timeout: 360_000 }, async (t) => {
  const fixture = await startBrowserFixture(t);
  await mkdir(output, { recursive: true });

  await t.test('pointer and keyboard previews stay separate from selection', async (subtest) => {
    const entries = Array.from({ length: 8 }, (_, i) => entry(i + 1, i === 1 ? null : i === 7 ? 90001 : 73,
      i === 0 ? longTitle : undefined));
    const page = await fixture.open(subtest, { entries, width: 1440, alternateEntries: [entry(1, 89, 'Different playlist lesson')] });
    await waitForLibrary(page);
    const chart = plot(page);
    await chart.locator('svg').waitFor();
    await chart.scrollIntoViewIfNeeded();
    const box = await chart.boundingBox();
    const view = chart.locator('..');
    const inspector = view.locator('[data-chart-inspector]');
    const first = band(box, 0, 8);
    await page.mouse.move(first.x, first.y);
    await tooltip(page).waitFor({ state: 'visible' });
    assert.match(await tooltip(page).innerText(), /Video #1[\s\S]*0:01:13/);
    assert.ok((await withinViewport(page, tooltip(page))).x > first.x);
    assert.match(await inspector.innerText(), /Preview Video #1[\s\S]*0:01:13/);
    assert.ok(await tooltip(page).locator('.line-clamp-2').evaluate((node) => node.scrollHeight > node.clientHeight));
    await snap(page, 'tooltip-left');
    await page.mouse.move(8, 8);
    await tooltip(page).waitFor({ state: 'hidden' });
    assert.match(await inspector.innerText(), /Select a mark/);
    await page.mouse.click(first.x, first.y);
    assert.match(await inspector.locator('[role=status]').textContent(), /Video #1/);
    const second = band(box, 1, 8);
    await page.mouse.move(second.x, second.y);
    assert.match(await tooltip(page).innerText(), /Video #2[\s\S]*Unresolved/);
    assert.match(await inspector.innerText(), /Preview Video #2[\s\S]*Unresolved/);
    assert.match(await inspector.locator('[role=status]').textContent(), /Video #1/);
    const last = band(box, 7, 8);
    await page.mouse.move(last.x, last.y);
    await tooltip(page).getByText('25:00:01', { exact: true }).waitFor();
    const right = await withinViewport(page, tooltip(page));
    assert.ok(right.x + right.width < last.x);
    await snap(page, 'tooltip-right-outlier-selected');
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await tooltip(page).waitFor({ state: 'hidden' });
    assert.match(await inspector.locator('[role=status]').textContent(), /Video #1/);
    await page.getByRole('button', { name: 'Close navigation' }).press('Escape');
    await page.mouse.move(8, 8);
    await tooltip(page).waitFor({ state: 'hidden' });
    await chart.press('End');
    await tooltip(page).getByText('Video #8', { exact: true }).waitFor();
    assert.match(await inspector.innerText(), /Keyboard Video #8[\s\S]*25:00:01/);
    await page.mouse.move(first.x, first.y);
    assert.match(await tooltip(page).innerText(), /Video #8/);
    assert.match(await inspector.locator('[role=status]').textContent(), /Video #8/);
    await chart.press('Escape');
    await tooltip(page).waitFor({ state: 'hidden' });
    assert.match(await inspector.locator('[role=status]').textContent(), /Video #1/);
    await chart.press('End');
    await chart.press('Space');
    await chart.press('Escape');
    assert.match(await inspector.innerText(), /Pinned Video #8/);
    await chart.press('Home');
    await chart.press('Enter');
    await chart.press('Escape');
    assert.match(await inspector.innerText(), /Pinned Video #1/);
    await page.getByRole('button', { name: 'Cumulative duration' }).click();
    const cumulative = plot(page, 'Cumulative duration chart.');
    await cumulative.press('Home');
    await tooltip(page).getByText('Known subtotal 0:01:13', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Active playlist' }).click();
    await page.getByRole('option', { name: /Alternate synthetic playlist/ }).click();
    const newInspector = cumulative.locator('..').locator('[data-chart-inspector]');
    await newInspector.filter({ hasText: /Select a mark/ }).waitFor();
    await tooltip(page).waitFor({ state: 'hidden' });
    await cumulative.press('Home');
    await tooltip(page).getByText('Different playlist lesson', { exact: true }).waitFor();
    assert.match(await newInspector.innerText(), /0:01:29/);
  });

  await t.test('cumulative groups retain duration bounds and the mobile table scrolls locally', async (subtest) => {
    const page = await fixture.open(subtest, { entryCount: 139, width: 320, height: 800, theme: 'light' });
    await waitForLibrary(page);
    await page.getByRole('button', { name: /^Full playlist/ }).click();
    await page.getByRole('button', { name: 'Cumulative duration' }).click();
    const chart = plot(page, 'Cumulative duration chart.');
    const view = chart.locator('..');
    await chart.scrollIntoViewIfNeeded();
    await chart.press('Home');
    const tip = tooltip(page);
    await tip.waitFor({ state: 'visible' });
    assert.match(await tip.innerText(), /Group · Videos 1–\d+[\s\S]*Duration min–max[\s\S]*Known subtotal/);
    await withinViewport(page, tip);
    await snap(page, 'tooltip-cumulative-group');
    await chart.press('Enter');
    await view.getByText(/^Positions — 1–/).waitFor();
    await view.getByText('View chart data as a table', { exact: true }).click();
    const scroll = view.getByRole('region', { name: 'Scrollable cumulative data table' });
    await scroll.getByRole('columnheader', { name: 'Known subtotal' }).waitFor();
    const dimensions = await scroll.evaluate((element) => [element.clientWidth, element.scrollWidth]);
    assert.ok(dimensions[1] > dimensions[0]);
    await scroll.press('ArrowRight');
    await paint(page);
    assert.ok(await scroll.evaluate((element) => element.scrollLeft > 0));
    assert.equal(await page.evaluate(() => scrollX), 0);
  });

  await t.test('touch inspection and large overview hover keep the plot stable', async (subtest) => {
    const page = await fixture.open(subtest, { entryCount: 2000, width: 390, height: 844, touch: true, theme: 'light' });
    await waitForLibrary(page);
    await page.getByRole('button', { name: /^Full playlist/ }).click();
    const chart = plot(page);
    await chart.getByText('2000', { exact: true }).waitFor();
    await chart.scrollIntoViewIfNeeded();
    let box = await chart.boundingBox();
    const baseline = await page.evaluate(() => scrollY);
    await chart.evaluate((node) => {
      window.chartSvgMutations = 0;
      const observer = new MutationObserver((records) => { window.chartSvgMutations += records.length; });
      observer.observe(node.querySelector('svg'), { attributes: true, childList: true, subtree: true });
    });
    const start = performance.now();
    for (let step = 0; step < 12; step++) {
      await page.mouse.move(box.x + 51 + (box.width - 72) * step / 12, box.y + box.height / 2);
    }
    await paint(page);
    const elapsed = Math.round(performance.now() - start);
    assert.equal(await page.evaluate(() => window.chartSvgMutations), 0);
    assert.equal(await page.evaluate(() => scrollY), baseline);
    subtest.diagnostic(`12 pointer moves plus two frames: ${elapsed} ms; 0 SVG mutations`);
    await tooltip(page).getByText(/Group · Videos/).waitFor();
    assert.match(await tooltip(page).innerText(), /entries[\s\S]*Duration min–max[\s\S]*0:01:13 – 0:08:31/);
    assert.match(await chart.locator('..').locator('[data-chart-inspector]').innerText(), /Videos 1715–1809[\s\S]*0:01:13 – 0:08:31/);
    await withinViewport(page, tooltip(page));
    await snap(page, 'tooltip-group-mobile');
    const group = await tooltip(page).locator('p').first().innerText();
    const groupStart = Number(group.match(/Videos (\d+)/)[1]);
    await page.touchscreen.tap(box.x + 51 + (box.width - 72) * 11 / 12, box.y + box.height / 2);
    await chart.locator('..').getByText(new RegExp('^Positions — ' + groupStart + '–')).waitFor();
    await chart.locator('..').getByRole('spinbutton', { name: 'Video position' }).fill('1001');
    await chart.locator('..').getByRole('button', { name: 'Jump to video' }).click();
    await chart.scrollIntoViewIfNeeded();
    box = await chart.boundingBox();
    const readout = await chart.locator('..').getByText(/^Positions — /).innerText();
    const [, first, last] = readout.match(/(\d+)–(\d+)/).map(Number);
    const spot = band(box, 1001 - first, last - first + 1);
    await page.touchscreen.tap(spot.x, spot.y);
    await tooltip(page).getByText('25:00:01', { exact: true }).waitFor();
    await page.touchscreen.tap(385, 30);
    await tooltip(page).waitFor({ state: 'hidden' });
    assert.match(await chart.locator('..').locator('[data-chart-inspector]').innerText(), /Video #1001/);
  });

  for (const [count, width] of [[1, 1920], [8, 1440], [139, 1024], [1000, 768], [2000, 390], [5000, 320]]) {
    await t.test(`table at ${width}px with ${count} entries`, async (subtest) => {
      const page = await fixture.open(subtest, { width, theme: width <= 768 ? 'light' : 'dark',
        entries: Array.from({ length: count }, (_, i) => entry(i + 1, i === 0 ? 0 : i === count - 1 ? null : 73,
          i === 0 ? longTitle : undefined)) });
      await waitForLibrary(page);
      await page.getByRole('button', { name: /^Full playlist/ }).click();
      const chart = plot(page);
      const view = chart.locator('..');
      const summary = view.getByText('View chart data as a table', { exact: true });
      await summary.click();
      const rows = table(chart).getByRole('row');
      await rows.last().waitFor();
      assert.equal(await rows.count(), Math.min(count, 25) + 1);
      assert.deepEqual(await table(chart).getByRole('columnheader').allTextContents(), ['Position', 'Video title', 'Duration']);
      const row = rows.nth(1);
      await row.getByText('0:00:00', { exact: true }).waitFor();
      if (count > 1) {
        const numericAlignment = await table(chart).evaluate((element) => {
          const head = element.tHead.rows[0].cells[2];
          const cell = element.tBodies[0].rows[0].cells[2];
          return [getComputedStyle(head).textAlign, getComputedStyle(cell).textAlign, getComputedStyle(cell).fontVariantNumeric,
            getComputedStyle(element.tBodies[0].rows[1]).backgroundColor !== getComputedStyle(element.tBodies[0].rows[0]).backgroundColor];
        });
        assert.deepEqual(numericAlignment, ['right', 'right', 'tabular-nums', true]);
      }
      const title = row.getByRole('button', { name: longTitle });
      assert.equal(await title.getAttribute('aria-expanded'), 'false');
      await title.press('Enter');
      assert.equal(await title.getAttribute('aria-expanded'), 'true');
      assert.equal(await title.getAttribute('aria-pressed'), 'true');
      assert.ok(await row.getAttribute('data-selected'));
      const inspector = view.locator('[data-chart-inspector]');
      assert.match(await inspector.innerText(), /Video #1/);
      assert.ok(await title.locator('.line-clamp-2').count());
      if (width === 1440 || width === 390 || width === 320) {
        await table(chart).evaluate((element) => { element.scrollIntoView({ block: 'start' }); window.scrollBy(0, -220); });
        await snap(page, `table-${width}-long-title`);
      }
      const find = view.getByRole('spinbutton', { name: 'Table position' });
      await find.fill(String(count));
      const findButton = view.getByRole('button', { name: 'Find in table' });
      await findButton.scrollIntoViewIfNeeded();
      const tableScroll = await page.evaluate(() => scrollY);
      await findButton.press('Enter');
      await table(chart).getByRole('rowheader', { name: '#' + count, exact: true }).waitFor();
      if (count > 1) await table(chart).getByText('Unresolved', { exact: true }).waitFor();
      assert.ok(await findButton.evaluate((node) => document.activeElement === node));
      assert.match(await inspector.innerText(), /Video #1/);
      assert.ok(Math.abs(await page.evaluate(() => scrollY) - tableScroll) < 120, 'No programmatic page jump');
      if (count > 50) {
        await view.getByLabel('Rows per page').selectOption('50');
        assert.ok(await rows.count() <= 51);
        const pagination = view.getByText(/^Rows \d/);
        assert.match(await pagination.innerText(), new RegExp('of ' + count + ' · Page'));
        if (width === 320) {
          await pagination.scrollIntoViewIfNeeded();
          await snap(page, 'table-320-last-page');
        }
      }
      await view.getByRole('button', { name: 'Show chart selection' }).click();
      await table(chart).getByRole('rowheader', { name: '#1', exact: true }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    });
  }
});
