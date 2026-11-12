import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { openDB } from 'idb';
import { StoreProvider, useStore } from '../src/app/store.js';
import { Player } from '../src/features/player/Player.js';

const P = 'PLplayerrecord0000000';
const SNAP: any = {
  playlistId: P,
  title: 'Record Course',
  reportedCount: 2,
  entries: [
    { position: 1, entryId: 'e1', videoId: 'shared01', title: 'Shared A', durationSec: 300 },
    { position: 2, entryId: 'e2', videoId: 'shared01', title: 'Shared B', durationSec: 300 },
  ],
  source: 'imported',
  fetchedAt: '2026-11-01T00:00:00.000Z',
  snapshotVersion: 2,
};

async function seed(progress: Record<string, any> = {}) {
  const db = await openDB('learnquest-db', 2, {
    upgrade(d) { if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); },
  });
  await db.clear('kv');
  await db.put('kv', { [P]: SNAP }, 'playlists');
  await db.put('kv', { [P]: { archived: false, addedAt: '2026-11-01T00:00:00.000Z' } }, 'meta');
  await db.put('kv', P, 'activeId');
  await db.put('kv', { timezone: 'UTC' }, 'prefs');
  await db.put('kv', progress, 'progress');
  await db.put('kv', [], 'sessions');
  await db.put('kv', [], 'segments');
  await db.put('kv', [], 'playSessions');
  await db.put('kv', [], 'checkpoints');
  await db.put('kv', [], 'modules');
  await db.put('kv', { verifiedThreshold: 0.9 }, 'settings');
}

function Probe() {
  const s = useStore();
  return <div data-testid="probe">{JSON.stringify({ ready: s.ready, progress: s.progress })}</div>;
}

async function ready() {
  await waitFor(() => expect(screen.getByTestId('probe').textContent).toContain('"ready":true'));
}

function jumpTo(value: string) {
  const input = screen.getByLabelText(/Jump to position/i);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

beforeEach(async () => {
  window.location.hash = '';
  const record = {
    playlistId: P, position: 2, entryId: 'e2', videoId: 'shared01',
    status: 'in-progress', source: 'manual', notes: 'occurrence-two-only',
  };
  await seed({ [`${P}::e2`]: record });
});

describe('Player learning-record access', () => {
  it('keeps the editor hidden initially and out of the tab order', async () => {
    render(<StoreProvider mode="local"><Player /><Probe /></StoreProvider>);
    await ready();
    const region = document.getElementById('player-learning-record');
    expect(region?.hasAttribute('hidden')).toBe(true);
    expect(screen.getByRole('button', { name: 'Open record' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens on demand, moving focus to the editor heading', async () => {
    render(<StoreProvider mode="local"><Player /><Probe /></StoreProvider>);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Open record' }));
    const region = document.getElementById('player-learning-record');
    expect(region?.hasAttribute('hidden')).toBe(false);
    expect(document.activeElement).toBe(document.getElementById('player-learning-record-title'));
    expect(screen.getByRole('button', { name: 'Hide record' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('returns focus to the aside toggle when the editor hides itself', async () => {
    render(<StoreProvider mode="local"><Player /><Probe /></StoreProvider>);
    await ready();
    const toggle = screen.getByRole('button', { name: 'Open record' });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Hide learning record' }));
    expect(document.activeElement).toBe(toggle);
  });

  it('shows the summary for the selected occurrence only (duplicates stay distinct)', async () => {
    render(<StoreProvider mode="local"><Player /><Probe /></StoreProvider>);
    await ready();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0); // occurrence 1 has no record
    jumpTo('2');
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy());
    jumpTo('1');
    await waitFor(() => expect(screen.queryByText('Saved')).toBeNull());
  });

  it('saves a draft into the correct occurrence and survives occurrence switches', async () => {
    render(<StoreProvider mode="local"><Player /><Probe /></StoreProvider>);
    await ready();
    jumpTo('2');
    fireEvent.click(screen.getByRole('button', { name: 'Open record' }));
    const notes = screen.getByLabelText('Notes');
    fireEvent.change(notes, { target: { value: 'drafted for occurrence two' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save learning record' }));
    await waitFor(() => {
      const probe = JSON.parse(screen.getByTestId('probe').textContent ?? '{}');
      expect(probe.progress[`${P}::e2`]?.notes).toBe('drafted for occurrence two');
    });
    jumpTo('1');
    await waitFor(() => expect(screen.getByLabelText('Notes')).toHaveValue(''));
    jumpTo('2');
    await waitFor(() => expect(screen.getByLabelText('Notes')).toHaveValue('drafted for occurrence two'));
  });
});
