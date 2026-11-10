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
});
