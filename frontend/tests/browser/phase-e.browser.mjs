import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { test } from 'node:test';
import { startBrowserFixture } from './helpers/isolated-browser.mjs';

const directory = 'test-results/visual/phase-e';
const capture = (page, name) => page.screenshot({ path: `${directory}/${name}.png`, animations: 'disabled', caret: 'hide' });
const playlistId = 'PLbrowserfixture0001';
const doneRecord = (position, videoId, entryId, orphaned = false) => ({
  playlistId, position, entryId, videoId,
  status: 'done', source: 'manual', completedAt: '2026-11-10T09:00:00.000Z',
  ...(orphaned ? { orphaned: true, reviewReason: 'removed' } : {}),
});
const allDone = () => {
  const progress = {};
  for (let index = 0; index < 150; index += 1) {
    const position = index + 1;
    const videoId = position <= 2 ? 'duplicate01' : `test${String(position - 1).padStart(7, '0')}`;
    progress[`${playlistId}::fixture-entry-${position}`] = doneRecord(position, videoId, `fixture-entry-${position}`);
  }
  return progress;
};

test('Phase E learning-flow verification', { timeout: 360_000 }, async (t) => {
  const fixture = await startBrowserFixture(t);
  await mkdir(directory, { recursive: true });

  await t.test('Dashboard Resume opens the correct in-app lesson (desktop)', async (subtest) => {
    const page = await fixture.open(subtest, { route: 'dash', width: 1440, resolvedDurations: true });
    await page.getByRole('link', { name: 'Resume lesson #1' }).click();
    await page.getByRole('heading', { name: /Lesson 1: Synthetic learning fixture/ }).waitFor();
    assert.equal(new URL(page.url()).hash, '#/player');
  });

  await t.test('duplicate occurrences keep distinct records (mobile, second occurrence done)', async (subtest) => {
    const progress = { [`${playlistId}::fixture-entry-2`]: doneRecord(2, 'duplicate01', 'fixture-entry-2') };
    const page = await fixture.open(subtest, { route: 'dash', width: 390, resolvedDurations: true, touch: true, learning: { progress } });
    await page.getByRole('link', { name: 'Resume lesson #1' }).waitFor();
    await page.getByRole('link', { name: 'Resume lesson #1' }).click();
    await page.getByRole('heading', { name: /Lesson 1/ }).waitFor();
  });

  await t.test('a completed playlist offers review, not a misleading Resume', async (subtest) => {
    const page = await fixture.open(subtest, { route: 'dash', width: 768, resolvedDurations: true, learning: { progress: allDone() } });
    await page.getByRole('link', { name: 'Review from lesson #1' }).waitFor();
    await page.getByRole('link', { name: 'Review from lesson #1' }).click();
    await page.getByRole('heading', { name: /Lesson 1/ }).waitFor();
    assert.equal(await page.getByRole('link', { name: /Resume lesson/ }).count(), 0);
  });

  await t.test('Library shows the canonical add-playlist entry and exposes the input', async (subtest) => {
    const page = await fixture.open(subtest, { route: 'learn', width: 1440, resolvedDurations: true });
    await page.getByRole('button', { name: /Add playlist/ }).click();
    await page.getByLabel('Playlist URL or ID').waitFor();
    await page.getByText(/Import snapshot JSON/).waitFor();
    await capture(page, 'library-add-open-dark');
  });

  await t.test('Goals shows the daily focus goal and links to Focus', async (subtest) => {
    const page = await fixture.open(subtest, { route: 'goals', width: 1440, resolvedDurations: true });
    await page.getByText("Today's focus goal").waitFor();
    await page.getByRole('heading', { name: 'Flexible goals' }).waitFor();
    await capture(page, 'goals-integration-dark');
    await page.getByRole('link', { name: 'Manage in Focus →' }).click();
    await page.getByRole('heading', { name: 'Focus timer' }).waitFor();
    assert.equal(new URL(page.url()).hash, '#/focus');
  });

  await t.test('orphan affordance navigates to the review section and focuses it', async (subtest) => {
    const progress = { [`${playlistId}::fixture-entry-5`]: doneRecord(5, 'test0000004', 'fixture-entry-5', true) };
    const page = await fixture.open(subtest, { route: 'dash', width: 1440, resolvedDurations: true, learning: { progress } });
    await page.getByText(/1 record needs review after playlist changes/).waitFor();
    await page.getByRole('link', { name: 'Review playlist changes' }).click();
    await page.getByRole('heading', { name: /Playlist changes need review/ }).waitFor();
    assert.equal(new URL(page.url()).hash, '#/reports');
    await page.waitForFunction(() => document.activeElement?.hasAttribute('data-orphan-heading'));
  });

  await t.test('a saved range can be promoted to a checkpoint and confirms before creating', async (subtest) => {
    const page = await fixture.open(subtest, { route: 'learn', width: 1440, resolvedDurations: true });
    const end = page.getByLabel(/^End/);
    await end.fill('5');
    // NumberField commits on blur; move focus to commit the value.
    await end.blur();
    await page.getByRole('button', { name: 'Create checkpoint' }).click();
    assert.equal(new URL(page.url()).hash, '#/checks');
    await page.getByLabel('Video range').waitFor();
    assert.equal(await page.getByLabel('Video range').inputValue(), '1-5');
    assert.equal(await page.getByRole('button', { name: 'Add checkpoint' }).count() > 0 ? 1 : 0, 1);
    await page.getByRole('button', { name: 'Add checkpoint' }).click();
    await page.getByText('Videos 1–5', { exact: false }).first().waitFor();
  });

  await t.test('learning record opens from the Player aside with focus management', async (subtest) => {
    const page = await fixture.open(subtest, { route: 'player', width: 1024, resolvedDurations: true });
    const record = page.locator('#player-learning-record');
    assert.ok(await record.getAttribute('hidden') !== null, 'editor is hidden initially');
    await page.getByRole('button', { name: 'Open record' }).click();
    const heading = page.locator('#player-learning-record-title');
    await heading.waitFor();
    assert.equal(await heading.evaluate((node) => document.activeElement === node), true);
    assert.equal(await record.getAttribute('hidden'), null);
    await capture(page, 'player-record-open-dark');
    await page.getByRole('button', { name: 'Hide learning record' }).click();
    assert.equal(await page.getByRole('button', { name: 'Open record' }).evaluate((node) => document.activeElement === node), true);
    assert.equal(await record.getAttribute('hidden') !== null, true);
  });
});
