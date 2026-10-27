import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { openDB } from 'idb';
import { StoreProvider, useStore } from '../src/app/store.js';
import { Revision } from '../src/features/revision/Revision.js';
import { findProgressForEntry } from '../src/domain/index.js';

const P = 'PLrevisionlife000000';
const SNAP: any = {
  playlistId: P,
  title: 'Lifecycle Course',
  reportedCount: 2,
  entries: [
    { position: 1, entryId: 'r1', videoId: 'v1', title: 'Lifecycle Variables', durationSec: 600 },
    { position: 2, entryId: 'r2', videoId: 'v2', title: 'Unrelated Closures', durationSec: 600 },
  ],
  source: 'api',
  fetchedAt: '2026-10-01T00:00:00.000Z',
  snapshotVersion: 2,
};

const PROGRESS: any = {
  [`${P}::r1`]: {
    playlistId: P, position: 1, entryId: 'r1', videoId: 'v1',
    status: 'done', completedAt: '2026-10-01T10:00:00.000Z', source: 'verified',
  },
};

beforeEach(async () => {
  (window as any).scrollTo = vi.fn();
  const db = await openDB('learnquest-db', 2, {
    upgrade(d) { if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); },
  });
  await db.clear('kv');
  await db.put('kv', { [P]: SNAP }, 'playlists');
  await db.put('kv', { [P]: { archived: false, addedAt: '2026-10-01T00:00:00.000Z' } }, 'meta');
  await db.put('kv', P, 'activeId');
  await db.put('kv', PROGRESS, 'progress');
  await db.put('kv', [], 'xp');
});

function Harness() {
  const s = useStore();
  if (!s.ready || !s.activeId) return <p>loading</p>;
  const entry = s.playlists[s.activeId].entries[0];
  const rec = findProgressForEntry(s.progress, s.activeId, entry);
  return (
    <div>
      <Revision />
      <pre data-testid="store-probe">{JSON.stringify({ rec: rec ?? null, xp: s.xp })}</pre>
    </div>
  );
}

async function mount() {
  const utils = render(<StoreProvider><Harness /></StoreProvider>);
  await screen.findByText(/Revision queue/);
  return utils;
}

function probe(): any {
  return JSON.parse(screen.getByTestId('store-probe').textContent || '{}');
}

async function flagFirst() {
  fireEvent.change(screen.getByLabelText('Position to flag for revision'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Flag' }));
  await screen.findByLabelText('Revision lesson 1: Lifecycle Variables');
}

async function allLessons() {
  fireEvent.click(screen.getByRole('button', { name: /All lessons/ }));
}

async function queue() {
  fireEvent.click(screen.getByRole('button', { name: /Revision queue/ }));
}

function search(text: string) {
  const field = screen.getByLabelText('Find lesson by position or title');
  fireEvent.change(field, { target: { value: text } });
  fireEvent.keyDown(field, { key: 'Enter' });
}

describe('revision review lifecycle and all-lessons discovery', () => {
  it('preserves annotations through review, queue exit, search, reflag, and reload', async () => {
    const first = await mount();

    await flagFirst();
    const card = screen.getByLabelText('Revision lesson 1: Lifecycle Variables');
    fireEvent.change(within(card).getByLabelText('Notes'), { target: { value: 'persistent lifecycle note' } });
    fireEvent.change(within(card).getByLabelText('Key concepts'), { target: { value: 'scope and hoisting' } });
    fireEvent.change(within(card).getByLabelText('Questions to investigate'), { target: { value: '' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Mark revised' }));

    await waitFor(() => expect(screen.queryByLabelText('Revision lesson 1: Lifecycle Variables')).toBeNull());
    expect(screen.getByText(/0 of 0 queued lessons/)).toBeTruthy();
    const saved = probe().rec;
    expect(saved.notes).toBe('persistent lifecycle note');
    expect(saved.keyConcepts).toBe('scope and hoisting');
    expect(saved.needsRevision).toBe(false);
    expect(saved.completedAt).toBe('2026-10-01T10:00:00.000Z');
    expect(saved.revisionDoneAt).toBeTruthy();
    expect(saved.reviewHistory).toHaveLength(1);

    // A direct search for a reviewed lesson must reveal its annotations even
    // though it is no longer in the active queue.
    search('lifecycle');
    const revealed = await screen.findByLabelText('Revision lesson 1: Lifecycle Variables');
    expect(screen.getByText(/Showing All lessons/)).toBeTruthy();
    expect((within(revealed).getByLabelText('Notes') as HTMLTextAreaElement).value)
      .toBe('persistent lifecycle note');
    expect(within(revealed).getByText(/revised /)).toBeTruthy();

    // Edit the previously reviewed lesson, then flag it again.
    fireEvent.change(within(revealed).getByLabelText('Notes'), { target: { value: 'edited after review' } });
    fireEvent.click(within(revealed).getByRole('button', { name: 'Needs revision' }));
    await waitFor(() => expect(probe().rec.needsRevision).toBe(true));
    await queue();
    const requeued = await screen.findByLabelText('Revision lesson 1: Lifecycle Variables');
    expect(within(requeued).getByText(/Reviewed on .* and flagged again/)).toBeTruthy();
    expect(within(requeued).getByText(/Review history \(1\)/)).toBeTruthy();

    // Re-reviewing on the same day clears the current flag but must not add a
    // duplicate history entry or revision XP.
    const xpBefore = probe().xp.filter((x: any) => x.reason === 'revision').length;
    fireEvent.click(within(requeued).getByRole('button', { name: 'Mark revised' }));
    await waitFor(() => expect(probe().rec.needsRevision).toBe(false));
    expect(probe().rec.reviewHistory).toHaveLength(1);
    expect(probe().xp.filter((x: any) => x.reason === 'revision')).toHaveLength(xpBefore);

    // Wait for the debounced IndexedDB write before remounting.
    await waitFor(async () => {
      const db = await openDB('learnquest-db', 2);
      const savedRaw = await db.get('kv', 'progress');
      expect(savedRaw[`${P}::r1`].notes).toBe('edited after review');
      expect(savedRaw[`${P}::r1`].needsRevision).toBe(false);
      expect(savedRaw[`${P}::r1`].reviewHistory).toHaveLength(1);
    });

    first.unmount();
    await mount();
    await allLessons();
    const reloaded = await screen.findByLabelText('Revision lesson 1: Lifecycle Variables');
    expect((within(reloaded).getByLabelText('Notes') as HTMLTextAreaElement).value)
      .toBe('edited after review');
    const stored = probe().rec;
    expect(stored.needsRevision).toBe(false);
    expect(stored.reviewHistory).toHaveLength(1);
    expect(stored.completedAt).toBe('2026-10-01T10:00:00.000Z');
    expect(stored.source).toBe('verified');
  });

  it('labels scope honestly and does not queue historical notes or high confidence alone', async () => {
    const db = await openDB('learnquest-db', 2);
    await db.put('kv', {
      [`${P}::r1`]: {
        playlistId: P, position: 1, entryId: 'r1', videoId: 'v1',
        status: 'done', completedAt: '2026-10-01T10:00:00.000Z', source: 'verified',
        notes: 'historical note only', keyConcepts: 'historical concept', confidence: 4,
        revisionDoneAt: '2026-10-02T10:00:00.000Z',
        reviewHistory: [{ id: 'old', reviewedAt: '2026-10-02T10:00:00.000Z', dateKey: '2026-10-02', source: 'revision' }],
      },
    }, 'progress');

    await mount();
    expect(screen.getByText(/0 of 0 queued lessons/)).toBeTruthy();
    expect(screen.queryByLabelText('Revision lesson 1: Lifecycle Variables')).toBeNull();
    await allLessons();
    const card = await screen.findByLabelText('Revision lesson 1: Lifecycle Variables');
    expect((within(card).getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('historical note only');
    fireEvent.click(screen.getByRole('button', { name: /Reviewed \(1\)/ }));
    expect(await screen.findByLabelText('Revision lesson 1: Lifecycle Variables')).toBeTruthy();
    expect(screen.queryByLabelText('Revision lesson 2: Unrelated Closures')).toBeNull();
    // The "All lessons" label really includes entries with no record too.
    fireEvent.click(screen.getByRole('button', { name: /All lessons \(2\)/ }));
    expect(screen.getByText('2 of 2 lessons in playlist')).toBeTruthy();
  });
});
