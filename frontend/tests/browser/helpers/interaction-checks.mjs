import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

async function capture(page, review, name) {
  if (!review) return;
  const directory = join('test-results', 'visual', 'phase-b');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, name + '.png'), animations: 'disabled', caret: 'hide' });
}

async function expectFocus(locator) {
  assert.ok(await locator.evaluate((element) => document.activeElement === element));
}

export async function checkInteractions(t, fixture, review) {
  await t.test('Player focus, date keyboard selection, and draft integrity', async (subtest) => {
    const page = await fixture.open(subtest, { route: 'player', width: 1024 });
    const notes = page.getByLabel('Notes', { exact: true });
    const record = page.locator('section').filter({ has: page.getByRole('heading', { name: /Learning record/ }) });
    await notes.scrollIntoViewIfNeeded();
    await capture(record, review, 'player-record');
    await notes.focus();
    assert.deepEqual(await notes.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.outlineStyle, style.outlineWidth, style.boxShadow];
    }), ['solid', '2px', 'none']);
    await notes.fill('Synthetic learning note');
    await capture(record, review, 'player-editing');

    const trigger = page.getByRole('button', { name: 'Choose revision date' });
    await trigger.press('Enter');
    const calendar = page.getByRole('dialog', { name: 'Revision date calendar' });
    const today = calendar.getByRole('button', { name: /November 10, 2026/ });
    await expectFocus(today);
    await today.press('ArrowRight');
    const tomorrow = calendar.getByRole('button', { name: /November 11, 2026/ });
    await expectFocus(tomorrow);
    await tomorrow.press('Enter');
    assert.equal(await page.getByLabel('Revision date', { exact: true }).inputValue(), '2026-11-11');
    assert.equal(await notes.inputValue(), 'Synthetic learning note');
    await expectFocus(trigger);
    await trigger.press('Enter');
    assert.equal(await calendar.getByRole('gridcell', { selected: true }).innerText(), '11');
    await capture(page, review, 'player-calendar-selected');
    await page.keyboard.press('Escape');
    await calendar.waitFor({ state: 'hidden' });
    await expectFocus(trigger);
  });

  await t.test('Calendar stays inside a narrow touch viewport', async (subtest) => {
    const page = await fixture.open(subtest, { route: 'player', width: 320, height: 780, touch: true, theme: 'light' });
    const trigger = page.getByRole('button', { name: 'Choose revision date' });
    await trigger.tap();
    const calendar = page.getByRole('dialog', { name: 'Revision date calendar' });
    await calendar.waitFor();
    const box = await calendar.boundingBox();
    assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 320 && box.y + box.height <= 780);
    const close = await calendar.getByRole('button', { name: 'Close calendar' }).boundingBox();
    assert.ok(close && close.y + close.height <= box.y + box.height);
    await capture(page, review, 'player-calendar-320');
    await calendar.getByRole('button', { name: /November 10, 2026/ }).tap();
    assert.equal(await page.getByLabel('Revision date', { exact: true }).inputValue(), '2026-11-10');
  });

  for (const width of [1440, 768, 390]) {
    await t.test('Revision control alignment at ' + width + 'px', async (subtest) => {
      const page = await fixture.open(subtest, { route: 'revise', width, touch: width === 390, theme: width === 768 ? 'light' : 'dark' });
      const find = page.getByLabel('Find lesson by position or title');
      for (const [field, button] of [
        [find, page.getByRole('button', { name: 'Jump', exact: true })],
        [page.getByLabel('Position to flag for revision'), page.getByRole('button', { name: 'Flag', exact: true })],
      ]) {
        const inputBox = await field.boundingBox();
        const buttonBox = await button.boundingBox();
        assert.ok(inputBox && buttonBox);
        assert.ok(Math.abs(inputBox.y - buttonBox.y) < 1);
        assert.ok(Math.abs(inputBox.height - buttonBox.height) < 1);
        assert.ok(buttonBox.x + buttonBox.width <= width);
      }
      await capture(page, review, 'revision-' + width);
      await page.getByRole('button', { name: /^All lessons/ }).click();
      await find.fill('2');
      await find.press('Enter');
      await page.getByText('Jumped to lesson #2.').waitFor();
    });
  }

  await t.test('Account Appearance and Settings share theme state under CSP', async (subtest) => {
    const page = await fixture.open(subtest, { route: 'settings', cloud: true, motion: true, width: 768 });
    const shell = page.locator('.lq-shell');
    const trigger = page.getByRole('button', { name: 'Account menu for Fixture Learner' });
    await page.getByRole('heading', { name: 'Appearance' }).waitFor();
    assert.equal(await page.locator('html').getAttribute('data-theme-transition'), null);
    await trigger.click();
    await page.getByRole('menuitemradio', { name: 'Light', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    assert.equal(await page.getByRole('menuitemradio', { name: 'Light', exact: true }).getAttribute('aria-checked'), 'true');
    assert.equal(await shell.evaluate((element) => getComputedStyle(element).transitionDuration.split(',')[0]), '0.17s');
    await capture(page, review, 'account-appearance');
    await page.keyboard.press('Escape');
    await expectFocus(trigger);
    assert.ok(await page.getByRole('radio', { name: 'Light', exact: true }).isChecked());

    await page.getByRole('button', { name: 'Open navigation' }).press('Enter');
    const navigation = page.getByRole('navigation', { name: 'Workspace navigation' });
    await navigation.waitFor();
    await page.getByRole('radio', { name: 'Light', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    assert.ok(await navigation.isVisible());
    await trigger.click();
    await navigation.waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).getAttribute('aria-checked'), 'true');
    await page.getByRole('menuitemradio', { name: 'System', exact: true }).click();
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    const reducedDuration = await shell.evaluate((element) => parseFloat(getComputedStyle(element).transitionDuration));
    assert.ok(reducedDuration < 0.001);

    // Stop React from loading so the production CSP check proves the
    // same-origin bootstrap alone applied the persisted System preference.
    await page.route('**/assets/*.js', (request) => request.abort());
    await page.reload({ waitUntil: 'domcontentloaded' });
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    assert.equal(await page.locator('html').getAttribute('data-theme-transition'), null);
  });

  await t.test('Playlist actions are keyboard-operable and deletion requires the exact title', async (subtest) => {
    const page = await fixture.open(subtest, { route: 'reports', width: 390, touch: true });
    const trigger = page.getByRole('button', { name: 'Actions for Synthetic learning playlist' });
    await trigger.press('ArrowDown');
    const menu = page.getByRole('menu', { name: 'Actions for Synthetic learning playlist' });
    await expectFocus(menu.getByRole('menuitem', { name: 'Rename…' }));
    await page.keyboard.press('End');
    await expectFocus(menu.getByRole('menuitem', { name: 'Manage removal…' }));
    const box = await menu.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 390);
    await capture(page, review, 'playlist-actions');
    await page.keyboard.press('Escape');
    await expectFocus(trigger);
    await page.goto(page.url().replace('#/reports', '#/dash'), { waitUntil: 'domcontentloaded' });
    const manage = page.getByRole('button', { name: 'Manage / Remove' });
    await manage.click();
    const dialog = page.getByRole('dialog', { name: 'Remove or delete this playlist?' });
    await expectFocus(dialog.getByRole('button', { name: /^Remove from dashboard/ }));
    await dialog.getByRole('button', { name: /^Permanently delete playlist and all/ }).click();
    const deleteButton = dialog.getByRole('button', { name: 'Permanently delete playlist', exact: true });
    assert.ok(await deleteButton.isDisabled());
    await capture(page, review, 'playlist-delete');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await expectFocus(manage);
  });

  await t.test('Account deletion starts on Cancel and leaves failures visible', async (subtest) => {
    const page = await fixture.open(subtest, { route: 'account/settings', cloud: true, width: 390, touch: true });
    const trigger = page.getByRole('button', { name: 'Delete my account' });
    await trigger.click();
    const dialog = page.getByRole('alertdialog', { name: /Permanently delete this account/ });
    await expectFocus(dialog.getByRole('button', { name: 'Cancel', exact: true }));
    const submit = dialog.getByRole('button', { name: 'Delete permanently' });
    assert.ok(await submit.isDisabled());
    await capture(page, review, 'account-delete-confirmation');
    await dialog.getByLabel('Current password').fill('synthetic fixture value');
    await dialog.getByLabel('Type DELETE MY ACCOUNT to confirm').fill('DELETE MY ACCOUNT');
    await submit.click();
    await dialog.getByRole('alert').getByText('Synthetic deletion failure. Retry later.').waitFor();
    await capture(page, review, 'account-delete-error');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expectFocus(trigger);
  });
}
