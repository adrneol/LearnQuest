import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { openDB } from 'idb';
import { StoreProvider, useStore } from '../src/app/store.js';
import { Reports } from '../src/features/reports/Reports.js';
import { Settings } from '../src/features/settings/Settings.js';

const confirmDialog = vi.fn(async (_opts?: unknown) => true);

vi.mock('../src/components/ui/dialog.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/components/ui/dialog.js')>();
  return { ...actual, confirmDialog: (opts: unknown) => confirmDialog(opts) };
});

vi.mock('../src/services/api/playlistApi.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/services/api/playlistApi.js')>();
  return { ...actual, checkApiHealth: vi.fn(async () => ({ ok: true, hasKey: true })) };
});

const P = 'PLboundary000000000';
const SNAP: any = {
  playlistId: P,
  title: 'Boundary Course',
  reportedCount: 1,
  entries: [{ position: 1, entryId: 'b1', videoId: 'bv1', title: 'One', durationSec: 300 }],
  source: 'imported',
  fetchedAt: '2026-11-01T00:00:00.000Z',
  snapshotVersion: 2,
};

function Probe() {
  const s = useStore();
  return <div data-testid="probe">{JSON.stringify({ ready: s.ready, playlists: Object.keys(s.playlists), sessions: s.sessions.length, focusSessions: s.playSessions.length })}</div>;
}

async function seed() {
  const db = await openDB('learnquest-db', 2, {
    upgrade(d) { if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); },
  });
  await db.clear('kv');
  await db.put('kv', { [P]: SNAP }, 'playlists');
  await db.put('kv', { [P]: { archived: false, addedAt: '2026-11-01T00:00:00.000Z' } }, 'meta');
  await db.put('kv', P, 'activeId');
  await db.put('kv', { timezone: 'UTC' }, 'prefs');
  await db.put('kv', [{ id: 'sess-1', playlistId: P, dateKey: '2026-11-12', activeSec: 300, startedAt: '2026-11-12T10:00:00.000Z', finishedAt: '2026-11-12T10:05:00.000Z' }], 'sessions');
  await db.put('kv', [], 'xp');
  window.location.hash = '';
}

beforeEach(async () => {
  vi.clearAllMocks();
  await seed();
});

describe('Reports ↔ Settings boundary', () => {
  it('Reports no longer renders preference controls or the destructive clears', async () => {
    render(<StoreProvider mode="local"><Reports /><Probe /></StoreProvider>);
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toContain('"ready":true'));
    expect(screen.queryByText('Preferences')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear all learning data…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear cached metadata (keep progress)' })).toBeNull();
    expect(screen.getByRole('link', { name: /Add a playlist in Library/ })).toHaveAttribute('href', '#/learn');
  });

  it('Settings hosts the destructive clear behind the shared confirm dialog', async () => {
    render(<StoreProvider mode="local"><Settings /><Probe /></StoreProvider>);
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toContain('"ready":true'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear all learning data…' }));
    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
    expect(confirmDialog.mock.calls[0][0]).toMatchObject({ title: 'Clear all learning data?', danger: true });
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toContain('"playlists":[]'));
    expect(screen.getByTestId('probe').textContent).toContain('"sessions":0');
  });

  it('offers Clear cached metadata without confirming (records are kept)', async () => {
    render(<StoreProvider mode="local"><Settings /><Probe /></StoreProvider>);
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toContain('"ready":true'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear cached metadata (keep progress)' }));
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toContain('"playlists":[]'));
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(screen.getByTestId('probe').textContent).toContain('"sessions":1');
  });
});
