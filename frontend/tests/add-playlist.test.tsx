import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { openDB } from 'idb';
import { StoreProvider, useStore } from '../src/app/store.js';
import { AddPlaylist } from '../src/features/playlists/AddPlaylist.js';

vi.mock('../src/services/api/playlistApi.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/api/playlistApi.js')>();
  return {
    ...actual,
    fetchPlaylistFromServer: vi.fn(async (target: string) => {
      if (target === 'bad-url') throw new Error('Could not resolve the playlist.');
      return {
        cached: false,
        snapshot: {
          playlistId: 'PLaddedplaylist0000',
          title: 'Added Course',
          reportedCount: 2,
          entries: [
            { position: 1, entryId: 'a1', videoId: 'av1', title: 'One', durationSec: 300 },
            { position: 2, entryId: 'a2', videoId: 'av2', title: 'Two', durationSec: 400 },
          ],
          source: 'imported',
          fetchedAt: '2026-11-13T00:00:00.000Z',
          snapshotVersion: 2,
        },
      };
    }),
  };
});

function Probe() {
  const s = useStore();
  return <div data-testid="probe">{JSON.stringify({ ready: s.ready, playlists: Object.keys(s.playlists), activeId: s.activeId })}</div>;
}

async function seed() {
  const db = await openDB('learnquest-db', 2, {
    upgrade(d) { if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); },
  });
  await db.clear('kv');
  await db.put('kv', {}, 'playlists');
  await db.put('kv', {}, 'meta');
  await db.put('kv', null, 'activeId');
}

beforeEach(async () => {
  window.location.hash = '';
  await seed();
});

describe('AddPlaylist (canonical add)', () => {
  it('adds a playlist through the shared fetch service', async () => {
    render(<StoreProvider mode="local"><AddPlaylist /><Probe /></StoreProvider>);
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toContain('"ready":true'));
    fireEvent.change(screen.getByLabelText('Playlist URL or ID'), { target: { value: 'PL-any-id' } });
    fireEvent.click(screen.getByRole('button', { name: /Add playlist/i }));
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toContain('PLaddedplaylist0000'));
    expect(await screen.findByRole('status')).toHaveTextContent(/Added Added Course/);
  });

  it('surfaces a fetch failure without claiming success', async () => {
    render(<StoreProvider mode="local"><AddPlaylist /><Probe /></StoreProvider>);
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toContain('"ready":true'));
    fireEvent.change(screen.getByLabelText('Playlist URL or ID'), { target: { value: 'bad-url' } });
    fireEvent.click(screen.getByRole('button', { name: /Add playlist/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not resolve the playlist.');
    expect(screen.getByTestId('probe').textContent).not.toContain('PLaddedplaylist0000');
  });

  it('disables Add while a fetch is in flight', async () => {
    render(<StoreProvider mode="local"><AddPlaylist /><Probe /></StoreProvider>);
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toContain('"ready":true'));
    expect(screen.getByRole('button', { name: /Add playlist/i })).toHaveProperty('disabled', true);
  });
});
