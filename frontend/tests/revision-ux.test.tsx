import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { openDB } from 'idb';
import { StoreProvider } from '../src/app/store.js';
import { Revision } from '../src/features/revision/Revision.js';

const P = 'PLrevision0000000000';
const SNAP: any = {
  playlistId: P,
  title: 'Revision Course',
  reportedCount: 3,
  entries: [
    { position: 1, entryId: 'e1', videoId: 'v1', title: 'Intro Variables', durationSec: 60 },
    { position: 2, entryId: 'e2', videoId: 'v2', title: 'Middle Functions', durationSec: 120 },
    { position: 3, entryId: 'e3', videoId: 'v3', title: 'Finale Closures', durationSec: 180 },
  ],
  source: 'api',
  fetchedAt: new Date().toISOString(),
  snapshotVersion: 2,
};

const PROGRESS: any = {
  [`${P}::e1`]: {
    playlistId: P, position: 1, entryId: 'e1', videoId: 'v1', status: 'done',
    completedAt: '2026-10-01T10:00:00.000Z', source: 'manual', confidence: 2, notes: 'low confidence note',
    exerciseDone: false,
  },
  [`${P}::e2`]: {
    playlistId: P, position: 2, entryId: 'e2', videoId: 'v2', status: 'done',
    completedAt: '2026-10-01T11:00:00.000Z', source: 'verified', needsRevision: true,
  },
  [`${P}::e3`]: {
    playlistId: P, position: 3, entryId: 'e3', videoId: 'v3', status: 'done',
    completedAt: '2026-10-01T12:00:00.000Z', source: 'manual', questions: 'Why closures?',
  },
};

beforeEach(async () => {
  (window as any).scrollTo = vi.fn();
  const db = await openDB('learnquest-db', 2, {
    upgrade(d) { if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); },
  });
  await db.clear('kv');
  await db.put('kv', { [P]: SNAP }, 'playlists');
  await db.put('kv', { [P]: { archived: false, addedAt: new Date().toISOString() } }, 'meta');
  await db.put('kv', P, 'activeId');
  await db.put('kv', PROGRESS, 'progress');
});

async function renderRevision() {
  const utils = render(<StoreProvider><Revision /></StoreProvider>);
  await screen.findByText('3 of 3 queued lessons');
  return utils;
}

function findField(): HTMLInputElement {
  return screen.getByLabelText('Find lesson by position or title') as HTMLInputElement;
}

describe('Revision sticky toolbar, search, jump, and filters', () => {
  it('searches by title and jumps to the matching revision card', async () => {
    await renderRevision();
    fireEvent.change(findField(), { target: { value: 'finale' } });
    fireEvent.keyDown(findField(), { key: 'Enter' });
    await waitFor(() => expect(screen.getByLabelText('Revision lesson 3: Finale Closures')).toBeTruthy());
    expect(screen.getByText('Jumped to lesson #3.')).toBeTruthy();
  });

  it('treats a pure numeric query as a position, including leading zeros', async () => {
    await renderRevision();
    fireEvent.change(findField(), { target: { value: '002' } });
    fireEvent.click(screen.getByRole('button', { name: 'Jump' }));
    await waitFor(() => expect(screen.getByText('Jumped to lesson #2.')).toBeTruthy());
  });

  it('shows an inline error for an invalid or missing position', async () => {
    await renderRevision();
    fireEvent.change(findField(), { target: { value: '99' } });
    fireEvent.keyDown(findField(), { key: 'Enter' });
    expect(await screen.findByText(/does not exist in this playlist/)).toBeTruthy();
    fireEvent.change(findField(), { target: { value: 'NoSuchTitle' } });
    fireEvent.keyDown(findField(), { key: 'Enter' });
    expect(await screen.findByText(/No lesson title matches/)).toBeTruthy();
  });

  it('filters accurately, reports counts, and clears a hiding filter when jumping', async () => {
    await renderRevision();
    fireEvent.click(screen.getByRole('button', { name: /Low confidence/ }));
    await waitFor(() => expect(screen.getByText('1 of 3 queued lessons')).toBeTruthy());
    expect(screen.queryByLabelText('Revision lesson 2: Middle Functions')).toBeNull();

    fireEvent.change(findField(), { target: { value: '2' } });
    fireEvent.keyDown(findField(), { key: 'Enter' });
    await waitFor(() => expect(screen.getByLabelText('Revision lesson 2: Middle Functions')).toBeTruthy());
    expect(screen.getByText(/hid lesson #2; filter cleared/)).toBeTruthy();
    expect(screen.getByText('3 of 3 queued lessons')).toBeTruthy();
  });

  it('offers to flag a missing queue lesson directly from the message', async () => {
    await renderRevision();
    fireEvent.change(findField(), { target: { value: '2' } });
    // Remove lesson 2 from the queue display by marking it revised first.
    const card2 = screen.getByLabelText('Revision lesson 2: Middle Functions');
    fireEvent.click(within(card2).getByRole('button', { name: 'Mark revised' }));
    await waitFor(() => expect(screen.queryByLabelText('Revision lesson 2: Middle Functions')).toBeNull());
    fireEvent.change(findField(), { target: { value: '2' } });
    fireEvent.keyDown(findField(), { key: 'Enter' });
    expect(await screen.findByText(/not in the revision queue yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Flag it now' }));
    await waitFor(() => expect(screen.getByLabelText('Revision lesson 2: Middle Functions')).toBeTruthy());
  });

  it('preserves annotations and removes a revised lesson from the queue', async () => {
    await renderRevision();
    const card3 = screen.getByLabelText('Revision lesson 3: Finale Closures');
    const questions = within(card3).getByLabelText('Questions to investigate') as HTMLTextAreaElement;
    expect(questions.value).toBe('Why closures?');
    fireEvent.change(questions, { target: { value: 'Why closures, exactly?' } });
    expect(screen.getByText('3 of 3 queued lessons')).toBeTruthy();

    fireEvent.click(within(card3).getByRole('button', { name: 'Mark revised' }));
    // Other signals (questions) keep the card queued, and the edit persists.
    const updated = await screen.findByLabelText('Revision lesson 3: Finale Closures');
    expect((within(updated).getByLabelText('Questions to investigate') as HTMLTextAreaElement).value)
      .toBe('Why closures, exactly?');
    expect(within(updated).getByText(/^revised /)).toBeTruthy();
  });

  it('renders a compact sticky toolbar without a nested scroll container', async () => {
    const { container } = await renderRevision();
    const toolbar = screen.getByLabelText('Find lesson by position or title').closest('.sticky');
    expect(toolbar).toBeTruthy();
    expect(container.querySelector('.overflow-y-auto')).toBeNull();
    expect((toolbar as HTMLElement).style.top).toBe('var(--lq-mobile-header-h, 0px)');
  });
});
