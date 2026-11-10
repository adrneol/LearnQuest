import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { waitForLibrary } from './isolated-browser.mjs';

const routes = [
  ['Dashboard', /Synthetic learning playlist/], ['Library', /Range explorer/],
  ['Player', /This lesson/], ['Goals', /Flexible goals/], ['Checkpoints', /New checkpoint/],
  ['Focus', /Focus timer/], ['Analytics', /Cumulative content/], ['Efficiency', /Learning throughput/],
  ['History', /Study history/], ['Revision', /Queue clear/], ['Modules', /Create a module/],
  ['Arena', /Study Arena/], ['Reports', /Playlists \(/], ['Settings', /Appearance/], ['Account', /This browser has no account/],
];
const directory = join('test-results', 'visual', 'phase-b5-cohesion');

async function capture(page, name, width) {
  await mkdir(directory, { recursive: true });
  await page.mouse.move(width - 2, 4);
  await page.clock.runFor(2_000);
  await page.screenshot({ path: join(directory, `${width}-${name}.png`), animations: 'disabled', caret: 'hide' });
}

async function openPages(page) {
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('button', { name: 'All pages' }).click();
  return page.getByRole('region', { name: 'All pages' });
}

async function navigate(page, name, heading) {
  const nav = await openPages(page);
  await nav.getByRole('link', { name, exact: true }).click();
  await page.getByRole('main').getByRole('heading', { name: heading }).first().waitFor();
}

export async function checkShell(t, fixture, review) {
  await t.test('Settings navigation preserves appearance', async (subtest) => {
    for (const [width, theme] of [[1440, 'dark'], [320, 'light']]) {
      const page = await fixture.open(subtest, { width, theme, touch: width < 768 });
      await waitForLibrary(page);
      await navigate(page, 'Settings', /Appearance/);
      const radio = page.getByRole('radio', { name: theme === 'dark' ? 'Dark' : 'Light' });
      await radio.press(theme === 'dark' ? 'ArrowLeft' : 'ArrowRight');
      const chosen = theme === 'dark' ? 'light' : 'dark';
      await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, chosen);
      await navigate(page, 'Account', /This browser has no account/);
      assert.equal(await page.locator('html').getAttribute('data-theme'), chosen);
    }
  });

  await t.test('NAV-1: the skip link preserves the current route and focuses main', async (subtest) => {
    const page = await fixture.open(subtest);
    await waitForLibrary(page);
    const originalUrl = page.url();
    await page.getByRole('link', { name: 'Skip to main content' }).press('Enter');
    await page.waitForFunction(() => document.querySelector('main').contains(document.activeElement));
    assert.equal(page.url(), originalUrl);
    await page.evaluate(() => new Promise((resolve) => {
      window.addEventListener('hashchange', resolve, { once: true });
      window.location.hash = '#main-content';
    }));
    const nav = await openPages(page);
    assert.equal(await nav.getByRole('link', { name: 'Library', exact: true }).getAttribute('aria-current'), 'page');
  });

  await t.test('NAV-2: edge navigation preserves background interaction and focus order', async (subtest) => {
    const page = await fixture.open(subtest, { width: 390, height: 844, touch: true });
    await waitForLibrary(page);
    const dock = page.locator('.lq-dock-trigger');
    await dock.click();
    const panel = page.getByRole('navigation', { name: 'Workspace navigation' });
    assert.equal(await panel.getAttribute('aria-modal'), null);
    assert.equal(await page.locator('dialog:modal, [aria-modal="true"]').count(), 0);
    assert.equal(await panel.evaluate((element) => getComputedStyle(element, '::backdrop').backgroundColor), 'rgba(0, 0, 0, 0)');
    assert.ok((await dock.boundingBox()).height >= 44);
    await panel.getByRole('link', { name: 'Focus', exact: true }).press('Tab');
    const playlist = page.getByRole('button', { name: 'Active playlist' });
    assert.ok(await playlist.evaluate((element) => document.activeElement === element));
    await page.setViewportSize({ width: 1440, height: 900 });
    await panel.waitFor();
    await page.mouse.move(950, 600);
    await page.mouse.wheel(0, 380);
    await page.waitForFunction(() => scrollY > 0);
    assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');
    await panel.getByRole('button', { name: 'Learn', exact: true }).focus();
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'detached' });
    assert.ok(await dock.evaluate((element) => document.activeElement === element));
    await dock.click();
    await playlist.click();
    await panel.waitFor({ state: 'detached' });
    assert.equal(await playlist.getAttribute('aria-expanded'), 'true');
  });

  for (const theme of ['dark', 'light']) {
    await t.test('A11Y-2: ' + theme + ' help text meets 4.5:1 contrast', async (subtest) => {
      const page = await fixture.open(subtest, { theme });
      await waitForLibrary(page);
      const contrast = await page.getByText(/^Session length only estimates/).evaluate((element) => {
        const rgba = (color) => color.match(/\d+(?:\.\d+)?/g).map(Number);
        const luminance = (rgb) => rgb.map((value) => value / 255)
          .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
          .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
        const foreground = luminance(rgba(getComputedStyle(element).color).slice(0, 3));
        const layers = [];
        for (let surface = element; surface; surface = surface.parentElement) {
          const color = rgba(getComputedStyle(surface).backgroundColor);
          layers.push(color);
          if ((color[3] ?? 1) === 1) break;
        }
        const background = luminance(layers.reduceRight((below, [r, g, b, alpha = 1]) =>
          [r, g, b].map((channel, index) => channel * alpha + below[index] * (1 - alpha)), [255, 255, 255]));
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      });
      assert.ok(contrast >= 4.5, `Expected contrast of at least 4.5:1; received ${contrast.toFixed(2)}:1`);
      subtest.diagnostic(`Measured contrast ${contrast.toFixed(2)}:1`);
    });
  }

  for (const width of [1920, 1440, 1024, 768, 390, 320]) {
    await t.test(`shell layout at ${width}px`, async (subtest) => {
      const theme = width === 320 || width === 768 ? 'light' : 'dark';
      const page = await fixture.open(subtest, { width, height: 900, theme, touch: width < 768 });
      await waitForLibrary(page);
      const selected = width === 1440 || width === 320
        ? routes : routes.filter(([name]) => ['Dashboard', 'Library', 'Player', 'Analytics', 'Focus', 'Settings', 'Account'].includes(name));
      for (const [name, heading] of selected) {
        await navigate(page, name, heading);
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme, `Opening ${name} preserves the theme`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 0, `${name} overflows the ${width}px viewport by ${overflow}px`);
        const dock = await page.getByRole('button', { name: 'Open navigation' }).boundingBox();
        assert.ok(dock && dock.x >= 0 && dock.x + dock.width <= width && dock.y >= 0 && dock.y + dock.height <= 900,
          `${name} has a clipped dock at ${width}px: ${JSON.stringify(dock)}`);
        if (name === 'Dashboard') {
          const course = await page.getByRole('region', { name: /Synthetic learning playlist/ }).boundingBox();
          const activity = await page.getByRole('complementary', { name: 'Learning activity' }).boundingBox();
          assert.ok(course && activity);
          if (width >= 1024) {
            assert.ok(course.width > activity.width * 2 && course.x + course.width < activity.x);
            assert.ok(course.width + activity.width >= width * .75);
          } else {
            assert.ok(activity.y >= course.y + course.height);
          }
        }
        if (name === 'Player') {
          const stage = page.getByRole('region', { name: /Lesson 1: Synthetic/ });
          const actions = page.getByRole('complementary', { name: 'This lesson' });
          const record = page.getByRole('heading', { name: /Learning record/ });
          const [stageBox, actionsBox, recordBox] = await Promise.all([stage.boundingBox(), actions.boundingBox(), record.boundingBox()]);
          assert.ok(stageBox && actionsBox && recordBox);
          assert.ok(await stage.getByRole('group', { name: 'Playback controls' }).isVisible());
          assert.ok(await actions.getByRole('heading', { name: /Queue/ }).isVisible());
          assert.ok(recordBox.y > Math.max(stageBox.y + stageBox.height, actionsBox.y + actionsBox.height));
          if (width >= 1024) assert.ok(stageBox.x + stageBox.width < actionsBox.x && actionsBox.width >= 300);
          else assert.ok(actionsBox.y > stageBox.y + stageBox.height);
          if (width < 640) {
            const jump = await actions.getByRole('textbox', { name: /Jump to position/ }).boundingBox();
            const note = await actions.getByRole('textbox', { name: 'Pause note' }).boundingBox();
            assert.ok(jump && note && note.y > jump.y + jump.height);
          }
        }
        if (name === 'Library') {
          const summary = page.locator('dl[aria-label="Selected range summary"]');
          const chart = page.getByRole('region', { name: 'Video duration chart.', exact: true });
          const [summaryBox, chartBox] = await Promise.all([summary.boundingBox(), chart.boundingBox()]);
          assert.ok(summaryBox && chartBox && summaryBox.y + summaryBox.height < chartBox.y);
          assert.ok(chartBox.width >= summaryBox.width * .9, 'The chart uses the analysis width');
        }
        if (review) {
          await capture(page, name.toLowerCase(), width);
          if (width === 320 && name === 'Player') {
            await page.getByRole('button', { name: 'Open learning record' }).press('Enter');
            assert.ok(await page.getByRole('heading', { name: /Learning record/ }).evaluate((element) => document.activeElement === element));
            await capture(page, 'player-record', width);
          }
        }
        if (name === 'Settings') {
          const startsDark = theme === 'dark';
          const active = page.getByRole('radio', { name: startsDark ? 'Dark' : 'Light' });
          const alternate = page.getByRole('radio', { name: startsDark ? 'Light' : 'Dark' });
          await active.press(startsDark ? 'ArrowLeft' : 'ArrowRight');
          await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, startsDark ? 'light' : 'dark');
          await alternate.press(startsDark ? 'ArrowRight' : 'ArrowLeft');
          await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, theme);
        }
      }
    });
  }

  for (const width of [1440, 390]) {
    await t.test(`Arena active practice layout at ${width}px`, async (subtest) => {
      const page = await fixture.open(subtest, { width, route: 'competition', resolvedDurations: true, theme: width === 390 ? 'light' : 'dark' });
      await page.getByRole('button', { name: 'Enable competition' }).click();
      await page.getByRole('heading', { name: 'Practice simulation' }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
      if (width < 640) {
        const description = await page.getByText(/^Change these settings to explore/).boundingBox();
        const action = await page.getByRole('button', { name: 'Start private fixed run' }).boundingBox();
        assert.ok(description && action && action.y > description.y + description.height);
      }
      if (review) await capture(page, 'arena-enabled', width);
    });

    await t.test(`Account security layout at ${width}px`, async (subtest) => {
      const page = await fixture.open(subtest, { width, route: 'account/security', cloud: true, theme: width === 390 ? 'light' : 'dark' });
      for (const name of ['Password', 'Email address', 'Active sessions']) {
        await page.getByRole('heading', { name, exact: true }).waitFor();
      }
      await page.getByText('This device', { exact: false }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
      if (review) await capture(page, 'account-security', width);
    });
  }
}
