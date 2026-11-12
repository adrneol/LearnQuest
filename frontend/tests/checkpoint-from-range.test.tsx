import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { openDB } from 'idb';
import { StoreProvider, useStore } from '../src/app/store.js';
import { Checkpoints } from '../src/features/checkpoints/Checkpoints.js';
import { setPendingIntent } from '../src/app/pendingIntent.js';

const P = 'PLcheckpointnotice000';
const SNAP: any = {
  playlistId: P,
  title: 'Checkpoint Course',
  reportedCount: 10,
  entries: Array.from({ length: 10 }, (_, i) => ({
    position: i + 1, entryId: `c${i + 1}`, videoId: `cv${i + 1}`, title: `Lesson ${i + 1}`, durationSec: 300,
  })),
  source: 'imported',
  fetchedAt: '2026-11-01T00:00:00.000Z',
  snapshotVersion: 2,
};

async function seed() {
  const db = await openDB('learnquest-db', 2, {
    upgrade(d) { if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); },
  });
  await db.clear('kv');
  await db.put('kv', { [P]: SNAP }, 'playlists');
  await db.put('kv', { [P]: { archived: false, addedAt: '2026-11-01T00:00:00.000Z' } }, 'meta');
  await db.put('kv', P, 'activeId');
  await db.put('kv', { timezone: 'UTC' }, 'prefs');
  await db.put('kv', [], 'checkpoints');
  await db.put('kv', [{ id: 'range-1', playlistId: P, label: 'Foundation block', start: 1, end: 5, createdAt: '2026-11-05T00:00:00.000Z' }], 'ranges');
}

function Probe() {
  const s = useStore();
  return <div data-testid="probe">{JSON.stringify({ ready: s.ready, checkpoints: s.checkpoints.map((c: any) => `${c.start}-${c.end}`), ranges: s.ranges.length })}</div>;
}

async function ready() {
  await waitFor(() => expect(screen.getByTestId('probe').textContent).toContain('"ready":true'));
}

beforeEach(async () => {
  window.location.hash = '';
  await seed();
});

describe('Create checkpoint from a range', () => {
  it('prefills the form from a pending Library intent and preapproves nothing silently', async () => {
    setPendingIntent({ kind: 'checkpoint-from-range', playlistId: P, start: 3, end: 8, label: 'Foundation block' });
    render(<StoreProvider mode="local"><Checkpoints /><Probe /></StoreProvider>);
    await ready();
    // Event-driven: the intent is consumed when the store applies the snapshot,
    // which can land on either side of the ready flag.
    await waitFor(() => expect(screen.getByLabelText('Video range')).toHaveValue('3-8'));
    expect(screen.getByLabelText('Custom checkpoint name (optional)')).toHaveValue('Foundation block');
    expect(screen.getByTestId('probe').textContent).toContain('"checkpoints":[]');
  });

  it('creates a checkpoint through the existing validated flow', async () => {
    setPendingIntent({ kind: 'checkpoint-from-range', playlistId: P, start: 1, end: 5, label: 'Videos 1–5' });
    render(<StoreProvider mode="local"><Checkpoints /><Probe /></StoreProvider>);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Add checkpoint/i }));
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toContain('"checkpoints":["1-5"]'));
    expect(screen.getByTestId('probe').textContent).toContain('"ranges":1');
  });

  it('ignores an intent saved for a different playlist', async () => {
    setPendingIntent({ kind: 'checkpoint-from-range', playlistId: 'PLOTHER', start: 2, end: 4, label: 'Other' });
    render(<StoreProvider mode="local"><Checkpoints /><Probe /></StoreProvider>);
    await ready();
    expect(screen.getByLabelText('Video range')).toHaveValue('');
    expect(screen.getByTestId('probe').textContent).toContain('"checkpoints":[]');
  });

  it('offers a per-range checkpoint action on the saved-ranges list that does not consume an intent', async () => {
    render(<StoreProvider mode="local"><Checkpoints /><Probe /></StoreProvider>);
    await ready();
    fireEvent.click(screen.getAllByRole('button', { name: 'Checkpoint' })[0]);
    expect(screen.getByLabelText('Video range')).toHaveValue('1-5');
    expect(screen.getByLabelText('Custom checkpoint name (optional)')).toHaveValue('Foundation block');
  });
});
