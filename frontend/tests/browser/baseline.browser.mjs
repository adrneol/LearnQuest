import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startBrowserFixture, waitForLibrary } from './helpers/isolated-browser.mjs';
import { checkShell } from './helpers/shell-checks.mjs';
import { checkInteractions } from './helpers/interaction-checks.mjs';

const mode = process.env.LQ_VISUAL_MODE ?? 'smoke';
assert.ok(['smoke', 'review', 'verify', 'update'].includes(mode), 'LQ_VISUAL_MODE must be smoke, review, verify, or update');
const scenarios = [
  { name: 'library-desktop-dark', width: 1440, height: 900, theme: 'dark' },
  { name: 'library-mobile-light', width: 390, height: 844, theme: 'light' },
];

// The suite budget includes a cold Vite build on a busy Windows host.
test('isolated browser baseline', { timeout: 480_000 }, async (t) => {
  const fixture = await startBrowserFixture(t);
  const target = `${process.platform}-${process.arch}-${fixture.browserVersion}`;
  for (const scenario of scenarios) {
    await t.test(scenario.name, async (subtest) => {
      const capture = async () => {
        const page = await fixture.open(subtest, scenario);
        await waitForLibrary(page);
        const chart = page.getByRole('region', { name: 'Video duration chart.', exact: true });
        await chart.locator('.recharts-cartesian-axis-tick-value').first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        // Advance the virtual clock through Recharts' JS animation, which is
        // independent of CSS reduced motion and screenshot animation options.
        await page.clock.runFor(2_000);
        assert.equal(await page.locator('html').getAttribute('data-theme'), scenario.theme);
        assert.ok(await page.evaluate(() =>
          document.documentElement.scrollWidth <= document.documentElement.clientWidth),
        'The fixture must fit its viewport');
        return page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' });
      };
      const actual = await capture();
      assert.ok(actual.equals(await capture()), 'Independent browser contexts must render identical screenshots');
      if (mode === 'smoke') return;

      const baseline = fileURLToPath(new URL(`./visual-baselines/${target}/${scenario.name}.png`, import.meta.url));
      if (mode === 'update') {
        await mkdir(dirname(baseline), { recursive: true });
        await writeFile(baseline, actual);
        return;
      }
      const expected = await readFile(baseline).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        throw new Error(`No visual baseline for ${target}; use the recorded browser/platform or review an explicit update.`);
      });
      if (mode === 'review' || !actual.equals(expected)) {
        const output = join('test-results', 'visual', target, `${scenario.name}-actual.png`);
        await mkdir(dirname(output), { recursive: true });
        await writeFile(output, actual);
        if (mode === 'review') {
          subtest.diagnostic(`${actual.equals(expected) ? 'Matches' : 'Differs from'} reference. Review ${output}.`);
        } else {
          assert.fail(`Visual baseline changed. Compare ${output} with ${baseline}.`);
        }
      }
    });
  }
  await checkShell(t, fixture, mode === 'review');
  await checkInteractions(t, fixture, mode === 'review');
});
