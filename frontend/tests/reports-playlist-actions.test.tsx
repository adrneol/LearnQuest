import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { openDB } from 'idb';
import { StoreProvider, useStore } from '../src/app/store.js';
import { Reports } from '../src/features/reports/Reports.js';

const P = 'PLreportsactions0000';
const SNAP: any = {
  playlistId: P,
  title: 'Reports Course',
  reportedCount: 1,
  entries: [{ position: 1, entryId: 'r1', videoId: 'rv1', title: 'One', durationSec: 300 }],
  source: 'api',
  fetchedAt: '2026-10-01T00:00:00.000Z',
  snapshotVersion: 2,
};

async function seed() {
  const db = await openDB('learnquest-db', 2, {
    upgrade(d) { if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); },
  });
  await db.clear('kv');
  await db.put('kv', { [P]: SNAP }, 'playlists');
  await db.put('kv', { [P]: { archived: false, addedAt: '2026-10-01T00:00:00.000Z' } }, 'meta');
  await db.put('kv', P, 'activeId');
  await db.put('kv', [], 'xp');
}

function Probe() {
  const s = useStore();
  return <div data-testid="probe">{JSON.stringify({ ready: s.ready, archived: s.meta[P]?.archived ?? null, hasP: Boolean(s.playlists[P]) })}</div>;
}

function renderReports() {
  render(
    <StoreProvider mode="local">
      <Reports />
      <Probe />
    </StoreProvider>,
  );
}

async function ready() {
  await waitFor(() => expect(screen.getByTestId('probe').textContent).toContain('"ready":true'));
}

beforeEach(async () => {
  window.location.hash = '';
  await seed();
});

describe('Reports playlist actions use the managed removal flow', () => {
  it('archives through the managed action and preserves the playlist', async () => {
    renderReports();
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Reports Course' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toContain('"archived":true'));
    expect(screen.getByTestId('probe').textContent).toContain('"hasP":true');
  });

  it('never offers a one-click permanent delete; it points to the typed-confirmation manager', async () => {
    renderReports();
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Reports Course' }));
    expect(screen.queryByRole('menuitem', { name: /^Remove…$/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Manage removal…' }));
    await waitFor(() => expect(window.location.hash).toBe('#/dash'));
    expect(screen.getByTestId('probe').textContent).toContain('"hasP":true');
  });
});
