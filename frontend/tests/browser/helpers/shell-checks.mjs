import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { waitForLibrary } from './isolated-browser.mjs';

const routes = [
  ['Dashboard', /Synthetic learning playlist/], ['Library', /Range explorer/],
  ['Player', /This lesson/], ['Goals', /Flexible goals/], ['Checkpoints', /New checkpoint/],
  ['Focus', /Focus timer/], ['Analytics', /Cumulative content/], ['Efficiency', /Learning throughput/],
  ['History', /Study history/], ['Revision', /Queue clear/], ['Modules', /optional grouping/],
  ['Arena', /Study Arena/], ['Reports', /Playlists \(/], ['Settings', /Appearance/], ['Account', /This browser has no account/],
];

async function navigate(page, width, name, heading) {
  if (width < 1024) await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name, exact: true }).click();
  await page.getByRole('main').getByRole('heading', { name: heading }).first().waitFor();
}

export async function checkShell(t, fixture, review) {
  await t.test('NAV-1: the skip link keeps Library open and moves focus into main', async (subtest) => {
    const page = await fixture.open(subtest);
    await waitForLibrary(page);
    const originalUrl = page.url();
    await page.getByRole('link', { name: 'Skip to main content' }).press('Enter');
    await page.waitForFunction(() => document.querySelector('main').contains(document.activeElement));
    assert.equal(await page.getByRole('link', { name: 'Library', exact: true }).getAttribute('aria-current'), 'page');
    assert.ok(await page.evaluate(() => document.querySelector('main').contains(document.activeElement)));
    assert.equal(page.url(), originalUrl);
    await page.evaluate(() => new Promise((resolve) => {
      window.addEventListener('hashchange', resolve, { once: true });
      window.location.hash = '#main-content';
    }));
    assert.equal(await page.getByRole('link', { name: 'Library', exact: true }).getAttribute('aria-current'), 'page');
  });

  await t.test('NAV-2: resizing an open mobile drawer releases the desktop', async (subtest) => {
    const page = await fixture.open(subtest, { width: 390, height: 844, touch: true });
    await waitForLibrary(page);
    await page.getByRole('button', { name: 'Open menu' }).click();
    const drawer = page.getByRole('dialog', { name: 'Menu', exact: true });
    await drawer.waitFor();
    const close = drawer.getByRole('button', { name: 'Close menu' });
    assert.ok(await close.evaluate((element) => document.activeElement === element));
    assert.ok((await close.boundingBox()).height >= 44);
    if (review) {
      const directory = join('test-results', 'visual', 'phase-b');
      await mkdir(directory, { recursive: true });
      await page.screenshot({ path: join(directory, '390-drawer.png'), animations: 'disabled', caret: 'hide' });
    }
    await close.press('Shift+Tab');
    assert.ok(await drawer.getByRole('link', { name: 'Account' }).evaluate((element) => document.activeElement === element));
    await page.keyboard.press('Escape');
    const opener = page.getByRole('button', { name: 'Open menu' });
    assert.ok(await opener.evaluate((element) => document.activeElement === element));
    await opener.click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('#workspace-drawer').waitFor({ state: 'detached' });
    assert.deepEqual(await page.evaluate(() => ({
      inertBackground: Boolean(document.querySelector('[data-app-background][inert]')),
      lockedScroll: document.body.style.overflow === 'hidden',
    })), { inertBackground: false, lockedScroll: false });
    assert.ok(await page.getByRole('link', { name: 'Library', exact: true }).evaluate((element) => document.activeElement === element));
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await page.getByRole('button', { name: 'Active playlist' }).waitFor();
    await page.getByRole('link', { name: 'Library', exact: true }).waitFor();
  });

  for (const theme of ['dark', 'light']) {
    await t.test('A11Y-2: ' + theme + ' help text meets 4.5:1 contrast', async (subtest) => {
      const page = await fixture.open(subtest, { theme });
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
      subtest.diagnostic(`Measured contrast ${contrast.toFixed(2)}:1`);
    });
  }

  for (const width of [1440, 1024, 768, 390, 320]) {
    await t.test(`shell layout at ${width}px`, async (subtest) => {
      const theme = width === 320 || width === 768 ? 'light' : 'dark';
      const page = await fixture.open(subtest, { width, height: 900, theme, touch: width < 768 });
      await waitForLibrary(page);
      const selected = width === 1440 || width === 320
        ? routes : routes.filter(([name]) => ['Dashboard', 'Library', 'Analytics', 'Settings', 'Account'].includes(name));
      for (const [name, heading] of selected) {
        await navigate(page, width, name, heading);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 0, `${name} overflows the ${width}px viewport by ${overflow}px`);
        if (review && ['Dashboard', 'Analytics', 'Settings'].includes(name)) {
          const directory = join('test-results', 'visual', 'phase-b');
          await mkdir(directory, { recursive: true });
          await page.clock.runFor(2_000);
          await page.screenshot({ path: join(directory, `${width}-${name.toLowerCase()}.png`), animations: 'disabled', caret: 'hide' });
        }
        if (name === 'Settings') {
          const radio = page.getByRole('radio', { name: theme === 'dark' ? 'Dark' : 'Light' });
          await radio.focus();
          await radio.press(theme === 'dark' ? 'ArrowLeft' : 'ArrowRight');
          await page.waitForFunction((original) => document.documentElement.dataset.theme !== original, theme);
        }
      }
    });
  }
}
