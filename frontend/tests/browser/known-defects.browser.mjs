import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startBrowserFixture, waitForLibrary } from './helpers/isolated-browser.mjs';

// Allow for a cold Vite build; individual locator timeouts remain bounded.
test('known browser defects', { timeout: 240_000 }, async (t) => {
  const fixture = await startBrowserFixture(t);

  await t.test('CHART-2: the detail viewport reports actual playlist positions', async (subtest) => {
    const page = await fixture.open(subtest);
    await waitForLibrary(page);
    await page.getByRole('textbox', { name: /^Start / }).fill('25');
    await page.getByRole('textbox', { name: /^End / }).fill('100');
    await page.getByRole('button', { name: 'Explore individual videos' }).first().click();
    const readout = page.getByText(/^Positions — /);
    await readout.waitFor();
    assert.match(await readout.innerText(), /^Positions — 25–\d+ of 76$/);
  });

  await t.test('NAV-1: the skip link keeps Library open and moves focus into main', async (subtest) => {
    const page = await fixture.open(subtest);
    await waitForLibrary(page);
    await page.getByRole('link', { name: 'Skip to main content' }).press('Enter');
    await page.evaluate(() => new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.getByRole('button', { name: 'Library', exact: true }).getAttribute('aria-current'), 'page');
    assert.ok(await page.evaluate(() => document.querySelector('main').contains(document.activeElement)));
  });

  await t.test('NAV-2: resizing an open mobile drawer releases the desktop', async (subtest) => {
    const page = await fixture.open(subtest, { width: 390, height: 844 });
    await waitForLibrary(page);
    await page.getByRole('button', { name: 'Open menu' }).click();
    const drawer = page.getByRole('dialog', { name: 'Menu', exact: true });
    await drawer.waitFor();
    await page.setViewportSize({ width: 1440, height: 900 });
    await drawer.waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => ({
      inertBackground: Boolean(document.querySelector('[data-app-background][inert]')),
      lockedScroll: document.body.style.overflow === 'hidden',
    })), { inertBackground: false, lockedScroll: false });
  });

  await t.test('A11Y-2: normal-sized dark-theme help text meets 4.5:1 contrast', async (subtest) => {
    const page = await fixture.open(subtest);
    await waitForLibrary(page);
    const contrast = await page.getByText(/^Session length only estimates/).evaluate((element) => {
      const luminance = (color) => color.match(/\d+(?:\.\d+)?/g).slice(0, 3)
        .map((value) => Number(value) / 255)
        .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
        .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const foreground = luminance(getComputedStyle(element).color);
      const background = luminance(getComputedStyle(element.closest('section')).backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    assert.ok(contrast >= 4.5, `Expected contrast of at least 4.5:1; received ${contrast.toFixed(2)}:1`);
  });
});
