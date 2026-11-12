import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { openDB } from 'idb';
import { StoreProvider, useStore } from '../src/app/store.js';
import { Dashboard } from '../src/features/dashboard/Dashboard.js';

const P = 'PLdashboardresume000';
const NOW = Date.parse('2026-11-13T12:00:00Z');
const ENTRY = (position: number, entryId: string, videoId: string, durationSec = 300) => ({
  position, entryId, videoId, durationSec, title: `Lesson ${position}`,
});

function makeSnapshot(entries: ReturnType<typeof ENTRY>[]) {
  return {
    playlistId: P,
    title: 'Resume Course',
    reportedCount: entries.length,
    entries,
    source: 'imported',
    fetchedAt: '2026-11-01T00:00:00.000Z',
    snapshotVersion: 2,
  };
}

async function seed({ entries = [ENTRY(1, 'e1', 'v1'), ENTRY(2, 'e2', 'v2'), ENTRY(3, 'e3', 'v3')], progress = {} } = {}) {
  const snap = makeSnapshot(entries);
  const db = await openDB('learnquest-db', 2, {
    upgrade(d) { if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); },
  });
  await db.clear('kv');
  await db.put('kv', { [P]: snap }, 'playlists');
  await db.put('kv', { [P]: { archived: false, addedAt: '2026-11-01T00:00:00.000Z' } }, 'meta');
  await db.put('kv', P, 'activeId');
  await db.put('kv', { timezone: 'UTC' }, 'prefs');
  await db.put('kv', progress, 'progress');
  await db.put('kv', [], 'sessions');
  await db.put('kv', {}, 'goals');
  await db.put('kv', [], 'xp');
  await db.put('kv', {}, 'achievements');
  await db.put('kv', [], 'segments');
  await db.put('kv', [], 'playSessions');
  await db.put('kv', {}, 'queue');
  await db.put('kv', [], 'flexGoals');
  await db.put('kv', { verifiedThreshold: 0.9 }, 'settings');
  await db.put('kv', {}, 'ranges');
  await db.put('kv', [], 'checkpoints');
  await db.put('kv', [], 'modules');
}

function Probe() {
  const s = useStore();
  return <div data-testid="probe">{JSON.stringify({ ready: s.ready })}</div>;
}

function renderDashboard() {
  render(
    <StoreProvider mode="local">
      <Dashboard />
      <Probe />
    </StoreProvider>,
  );
}

async function ready() {
  await waitFor(() => expect(screen.getByTestId('probe').textContent).toContain('"ready":true'));
}

const doneRecord = (position: number, videoId: string, entryId: string) => ({
  [`${P}::${entryId}`]: {
    playlistId: P, position, entryId, videoId,
    status: 'done' as const, source: 'manual' as const,
    completedAt: '2026-11-12T10:00:00.000Z',
  },
});

beforeEach(async () => {
  window.location.hash = '';
  await seed();
});

describe('Dashboard Resume action', () => {
  it('navigates in-app to the Player at the first unfinished occurrence', async () => {
    await seed({ progress: { ...doneRecord(1, 'v1', 'e1') } });
    renderDashboard();
    await ready();
    const resume = screen.getByRole('link', { name: 'Resume lesson #2' });
    expect(resume).toBeTruthy();
    expect(resume).toHaveAttribute('href', '#/player');
    expect(screen.getByRole('link', { name: 'Open on YouTube (untracked)' })).toHaveAttribute('href', expect.stringContaining('youtube.com/watch?v=v2'));
  });

  it('keeps selection correct when two entries share a video ID', async () => {
    const entries = [ENTRY(1, 'e1', 'shared01', 300), ENTRY(2, 'e2', 'shared01', 300)];
    // Only the second occurrence is complete; the first stays unfinished.
    await seed({ entries, progress: doneRecord(2, 'shared01', 'e2') });
    renderDashboard();
    await ready();
    expect(screen.getByRole('link', { name: 'Resume lesson #1' })).toBeTruthy();
  });

  it('shows Course complete instead of Resume when the playlist is finished', async () => {
    const entries = [ENTRY(1, 'e1', 'v1', 300), ENTRY(2, 'e2', 'v2', 300)];
    await seed({ entries, progress: { ...doneRecord(1, 'v1', 'e1'), ...doneRecord(2, 'v2', 'e2') } });
    renderDashboard();
    await ready();
    expect(screen.getAllByText('Course complete').length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: /Resume lesson/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Review from lesson #1' })).toHaveAttribute('href', '#/player');
  });

  it('starts at lesson 1 for a brand-new playlist', async () => {
    renderDashboard();
    await ready();
    expect(screen.getByRole('link', { name: 'Resume lesson #1' })).toHaveAttribute('href', '#/player');
  });

  it('offers an add-playlist path in the empty state', async () => {
    const db = await openDB('learnquest-db', 2, {
      upgrade(d) { if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); },
    });
    await db.clear('kv');
    renderDashboard();
    await ready();
    expect(screen.getByRole('link', { name: /Add your first playlist/ })).toHaveAttribute('href', '#/learn');
  });
});

describe('Orphan notice', () => {
  const orphan = (position: number, videoId: string, entryId: string) => ({
    playlistId: P, position, entryId, videoId,
    status: 'done' as const, source: 'manual' as const,
    completedAt: '2026-11-05T10:00:00.000Z',
    orphaned: true, reviewReason: 'removed' as const,
  });

  it('shows an accurate count and links to the review surface when orphans exist', async () => {
    await seed({
      progress: {
        [`${P}::e1`]: orphan(1, 'v1', 'e1'),
        [`${P}::e2`]: orphan(2, 'v2', 'e2'),
        [`${P}::e3`]: { ...doneRecord(3, 'v3', 'e3')[`${P}::e3`] },
      },
    });
    renderDashboard();
    await ready();
    const link = screen.getByRole('link', { name: 'Review playlist changes' });
    expect(link).toHaveAttribute('href', '#/reports');
    expect(link.closest('[role="status"]')?.textContent).toMatch(/2 records need review after playlist changes/);
  });

  it('renders nothing when there are no orphans', async () => {
    renderDashboard();
    await ready();
    expect(screen.queryByRole('link', { name: 'Review playlist changes' })).toBeNull();
  });
});
