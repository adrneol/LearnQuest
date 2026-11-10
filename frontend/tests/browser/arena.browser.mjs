import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { test } from 'node:test';
import { startBrowserFixture, waitForLibrary } from './helpers/isolated-browser.mjs';

const directory = 'test-results/visual/phase-d';
const capture = (page, name) => page.screenshot({ path: `${directory}/${name}.png`, animations: 'disabled', caret: 'hide' });

async function create(page, name) {
  await page.getByRole('textbox', { name: 'Simulation name' }).fill(name);
  await page.getByRole('button', { name: 'Create simulation', exact: true }).click();
  await page.getByRole('heading', { name, exact: true }).waitFor();
}

async function management(page) {
  const disclosure = page.getByText('Simulation details and management', { exact: true });
  if (!await disclosure.evaluate((node) => node.parentElement.open)) await disclosure.click();
}

async function confirm(page, action) {
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('button', { name: action, exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
}

test('Arena lifecycle and responsive verification', { timeout: 360_000 }, async (t) => {
  const fixture = await startBrowserFixture(t);
  await mkdir(directory, { recursive: true });

  await t.test('onboarding, 2,000 opponents, comparison and six viewport widths', async (subtest) => {
    const page = await fixture.open(subtest, { route: 'competition', width: 1440, resolvedDurations: true });
    await page.getByRole('heading', { name: 'Create a simulation' }).waitFor();
    await capture(page, 'onboarding-dark');
    await page.getByRole('textbox', { name: 'Fictional opponents' }).fill('2000');
    const start = performance.now();
    await create(page, 'Algorithms practice');
    const board = page.getByRole('region', { name: 'Leaderboard' });
    await board.getByText(/2001 learners/).waitFor();
    subtest.diagnostic(`2,000-opponent setup to leaderboard via Playwright: ${Math.round(performance.now() - start)} ms`);
    assert.equal(await board.getByRole('table').getByRole('row').count(), 26);
    await board.getByRole('button', { name: 'My row' }).press('Enter');
    await board.getByRole('rowheader', { name: 'You', exact: true }).waitFor();
    await board.getByRole('textbox', { name: 'Search leaderboard' }).fill('not-a-rival-12345');
    await board.getByText('No learners match that search.').waitFor();
    await board.getByRole('textbox', { name: 'Search leaderboard' }).fill('');
    await board.getByRole('table').getByRole('button').first().click();
    await page.getByRole('region', { name: 'Rival comparison' }).waitFor();
    for (const width of [1920, 1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForFunction(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
      await page.evaluate(() => scrollTo(0, 0));
      await capture(page, `practice-${width}`);
    }
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('navigation', { name: 'Workspace navigation' }).waitFor();
    await page.getByRole('button', { name: 'Close navigation' }).press('Escape');
    await page.getByRole('heading', { name: 'Algorithms practice' }).waitFor();
  });

  await t.test('pause, reset, cancel, delete a selected archive and preserve learning data', async (subtest) => {
    const page = await fixture.open(subtest, { route: 'competition', width: 390, resolvedDurations: true, touch: true, theme: 'light' });
    await create(page, 'Practice to keep');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByText('Practice · paused', { exact: true }).waitFor();
    await capture(page, 'practice-paused-light');
    await page.reload();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await management(page);
    await page.getByRole('button', { name: 'Reset practice' }).click();
    await confirm(page, 'Archive and restart');
    const history = page.getByRole('region', { name: 'Simulation history' });
    await history.getByRole('button', { name: 'Practice to keep' }).click();
    await page.getByText('Practice · archived', { exact: true }).waitFor();
    await management(page);
    await page.getByRole('button', { name: 'Delete simulation' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).press('Enter');
    await page.getByRole('alertdialog').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Delete simulation');
    await history.getByRole('button', { name: 'Practice to keep' }).waitFor();
    await page.getByRole('button', { name: 'Delete simulation' }).click();
    await capture(page, 'delete-confirmation-light');
    await confirm(page, 'Delete simulation');
    await page.getByText('Simulation removed from the Arena.').waitFor();
    await history.waitFor({ state: 'hidden' });
    await page.getByText('Practice · active', { exact: true }).waitFor();
    await management(page);
    await page.getByRole('button', { name: 'Delete simulation' }).click();
    await confirm(page, 'Delete simulation');
    await page.getByRole('heading', { name: 'Create a simulation' }).waitFor();
    await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'New simulation');
    await page.reload();
    await page.getByRole('heading', { name: 'Create a simulation' }).waitFor();
    await create(page, 'Recreated practice');
    await page.goto(new URL('#/learn', page.url()).href);
    await waitForLibrary(page);
    await page.getByRole('button', { name: /Full playlist \(1–150\)/ }).waitFor();
  });

  await t.test('fixed scheduling, finalization, archived replay and reload', async (subtest) => {
    const page = await fixture.open(subtest, { route: 'competition', width: 768, resolvedDurations: true, theme: 'light' });
    await page.getByRole('button', { name: 'Mode' }).click();
    await page.getByRole('option', { name: 'Fixed challenge' }).click();
    await page.getByRole('textbox', { name: 'Calendar days' }).fill('1');
    await create(page, 'Closed-day challenge');
    await page.getByText('Fixed challenge · scheduled', { exact: true }).waitFor();
    await capture(page, 'fixed-scheduled');
    await page.clock.setSystemTime(new Date('2026-11-11T12:00:00Z'));
    await page.reload();
    await page.getByText('Fixed challenge · active', { exact: true }).waitFor();
    await page.clock.setSystemTime(new Date('2026-11-12T12:00:00Z'));
    await page.reload();
    await page.getByRole('button', { name: 'Finalize challenge' }).click();
    await confirm(page, 'Save final result');
    await page.getByText('Fixed challenge · completed', { exact: true }).waitFor();
    await management(page);
    await page.getByRole('button', { name: 'Archive result' }).click();
    await page.getByText('Fixed challenge · archived', { exact: true }).waitFor();
    await page.getByText('Unranked', { exact: true }).waitFor();
    await page.evaluate(() => scrollTo(0, 0));
    await capture(page, 'fixed-archive');
    await page.reload();
    await page.getByRole('region', { name: 'Simulation history' }).getByRole('button', { name: 'Closed-day challenge' }).click();
    await page.getByText('Fixed challenge · archived', { exact: true }).waitFor();
    assert.equal(await page.getByText(/Replay did not match/).count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  });

  await t.test('unresolved playlist cannot start a simulation', async (subtest) => {
    const page = await fixture.open(subtest, { route: 'competition', width: 320, touch: true });
    await page.getByRole('textbox', { name: 'Simulation name' }).fill('Unavailable fixture');
    await page.getByText(/Arena needs every video duration/).waitFor();
    assert.ok(await page.getByRole('button', { name: 'Create simulation', exact: true }).isDisabled());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await capture(page, 'unresolved-320');
  });

  await t.test('failed deletion keeps the selected run intact', async (subtest) => {
    const page = await fixture.open(subtest, { route: 'competition', width: 1024, resolvedDurations: true });
    await create(page, 'Keep on write failure');
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value, key) {
        if (key === 'challenge' && value?.arena?.active === null) throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
        return put.call(this, value, key);
      };
    });
    await management(page);
    await page.getByRole('button', { name: 'Delete simulation' }).click();
    await confirm(page, 'Delete simulation');
    await page.getByText('The Arena change could not be saved. The existing simulation was kept.').waitFor();
    await page.getByRole('heading', { name: 'Keep on write failure' }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Keep on write failure' }).waitFor();
  });

  await t.test('ranked fixtures locate the learner near the top and bottom', async (subtest) => {
    const playlistId = 'PLbrowserfixture0001';
    const entries = Array.from({ length: 100 }, (_, index) => ({
      position: index + 1, entryId: 'rank-' + index, videoId: 'rank-video-' + index, durationSec: 600, title: 'Synthetic lesson ' + index,
    }));
    for (const [days, count] of [[14, 100], [3, 3]]) {
      const sessions = Array.from({ length: days }, (_, index) => {
        const start = Date.parse('2026-11-09T09:00:00Z') - index * 86400_000;
        return { id: 'focus-' + index, playlistId, startedAt: new Date(start).toISOString(),
          finishedAt: new Date(start + 600_000).toISOString(), activeSec: 600, elapsedSec: 600,
          dateKey: new Date(start).toISOString().slice(0, 10) };
      });
      const progress = Object.fromEntries(entries.slice(0, count).map((item, index) =>
        [playlistId + '::' + item.entryId, { ...item, playlistId, status: 'done', source: 'manual',
          completedAt: sessions[index % days].finishedAt }]));
      const page = await fixture.open(subtest, { route: 'competition', width: 1024, entries, learning: { progress, sessions } });
      const name = days === 14 ? 'Ranked leader fixture' : 'Ranked trailing fixture';
      await create(page, name);
      const board = page.getByRole('region', { name: 'Leaderboard' });
      await board.getByRole('button', { name: 'My row' }).click();
      const row = board.getByRole('rowheader', { name: 'You', exact: true }).locator('..');
      const rank = Number(await row.getByRole('cell').first().innerText());
      if (days === 14) assert.equal(rank, 1);
      else assert.ok(rank > 60, `Expected a trailing rank, got ${rank}`);
      subtest.diagnostic(name + ' rank: ' + rank);
      await board.scrollIntoViewIfNeeded();
      await capture(page, days === 14 ? 'ranked-leader' : 'ranked-trailing');
    }
  });
});
