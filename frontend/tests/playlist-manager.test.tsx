import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { openDB } from 'idb';
import { StoreProvider, useStore } from '../src/app/store.js';
import { PlaylistManager } from '../src/features/dashboard/PlaylistManager.js';

const P = 'PLmanagerP0000000000';
const Q = 'PLmanagerQ0000000000';

const P_SNAP: any = {
  playlistId: P, title: 'Course P', reportedCount: 3,
  entries: [
    { position: 1, entryId: 'p1', videoId: 'pv1', title: 'P one', durationSec: 600 },
    { position: 2, entryId: 'p2', videoId: 'pv2', title: 'P two', durationSec: 600 },
    { position: 3, entryId: 'p3', videoId: 'pv3', title: 'P three', durationSec: 600 },
  ],
  source: 'api', fetchedAt: '2026-10-01T00:00:00.000Z', snapshotVersion: 2,
};
const Q_SNAP: any = {
  playlistId: Q, title: 'Course Q', reportedCount: 1,
  entries: [{ position: 1, entryId: 'q1', videoId: 'qv1', title: 'Q one', durationSec: 300 }],
  source: 'api', fetchedAt: '2026-10-01T00:00:00.000Z', snapshotVersion: 2,
};

const META = {
  [P]: { archived: false, customTitle: 'Renamed P', addedAt: '2026-10-01T00:00:00.000Z' },
  [Q]: { archived: false, addedAt: '2026-10-01T00:00:00.000Z' },
};

const PROGRESS: any = {
  [`${P}::p1`]: {
    playlistId: P, position: 1, entryId: 'p1', videoId: 'pv1', status: 'done',
    completedAt: '2026-10-02T00:00:00.000Z', source: 'manual', notes: 'keep me',
  },
  [`${P}::p2`]: {
    playlistId: P, position: 2, entryId: 'p2', videoId: 'pv2', status: 'in-progress',
    completedAt: null, notes: 'draft',
  },
  [`${Q}::q1`]: {
    playlistId: Q, position: 1, entryId: 'q1', videoId: 'qv1', status: 'done',
    completedAt: '2026-10-02T00:00:00.000Z', source: 'manual', notes: 'Q note',
  },
};

const CHECKPOINTS = [
  { id: 'cpP', playlistId: P, label: 'Videos 1–2', start: 1, end: 2, createdAt: '2026-10-01T00:00:00.000Z', completedAt: null, snapshotVersion: 2 },
  { id: 'cpQ', playlistId: Q, label: 'Video 1', start: 1, end: 1, createdAt: '2026-10-01T00:00:00.000Z', completedAt: null, snapshotVersion: 2 },
];
const RANGES = [
  { id: 'rangeP', playlistId: P, label: 'P range', start: 1, end: 2, createdAt: '2026-10-01T00:00:00.000Z', snapshotVersion: 2 },
];
const MODULES = [{ id: 'modP', playlistId: P, name: 'P module', positions: [1, 2] }];
const SESSIONS = [{
  id: 'sessP', clientId: 'clientP', playlistId: P, startedAt: '2026-10-02T10:00:00.000Z',
  finishedAt: '2026-10-02T10:25:00.000Z', activeSec: 1500, elapsedSec: 1500, dateKey: '2026-10-02', note: 'focus',
}, {
  id: 'sessQ', clientId: 'clientQ', playlistId: Q, startedAt: '2026-10-02T11:00:00.000Z',
  finishedAt: '2026-10-02T11:25:00.000Z', activeSec: 1500, elapsedSec: 1500, dateKey: '2026-10-02', note: 'focus',
}];
const SEGMENTS = [{ id: 'segP', playlistId: P, videoId: 'pv1', entryId: 'p1', wallStartMs: 1, wallEndMs: 2, timelineStartSec: 0, timelineEndSec: 60, source: 'verified' }];
const PLAY_SESSIONS = [{
  id: 'playP', playlistId: P, position: 1, videoId: 'pv1', startedAt: '2026-10-02T10:00:00.000Z',
  finishedAt: '2026-10-02T10:05:00.000Z', activePlaybackSec: 300, contentSec: 300, uniqueGainSec: 300, pauseSec: 0, source: 'verified',
}];
const FLEX_GOALS = [
  {
    id: 'goalP', playlistId: P, metric: 'video-count', target: 2,
    createdAt: '2026-10-01T00:00:00.000Z', achievedAt: null, achievedValue: null,
  },
  {
    id: 'goalQ', playlistId: Q, metric: 'video-count', target: 1,
    createdAt: '2026-10-01T00:00:00.000Z', achievedAt: null, achievedValue: null,
  },
  {
    id: 'goal-cpP', playlistId: null, checkpointId: 'cpP', metric: 'video-count', target: 1,
    createdAt: '2026-10-01T00:00:00.000Z', achievedAt: null, achievedValue: null,
  },
  {
    id: 'goal-cpQ', playlistId: null, checkpointId: 'cpQ', metric: 'video-count', target: 1,
    createdAt: '2026-10-01T00:00:00.000Z', achievedAt: null, achievedValue: null,
  },
];
const XP = [
  { id: 'x1', reason: 'videoDone', points: 10, dedupKey: `done:${P}:p1`, at: '2026-10-02T00:00:00.000Z' },
  { id: 'x2', reason: 'checkpoint', points: 20, dedupKey: 'cp:cpP:done', at: '2026-10-02T00:00:00.000Z' },
  { id: 'x3', reason: 'goal', points: 15, dedupKey: 'goal:goalP:achieved', at: '2026-10-02T00:00:00.000Z' },
  { id: 'x4', reason: 'achievement', points: 25, dedupKey: `ach:${P}:first`, at: '2026-10-02T00:00:00.000Z' },
  { id: 'x5', reason: 'videoDone', points: 10, dedupKey: `done:${Q}:q1`, at: '2026-10-02T00:00:00.000Z' },
  { id: 'x6', reason: 'studyDay', points: 5, dedupKey: 'day:2026-10-02', at: '2026-10-02T00:00:00.000Z' },
  { id: 'x7', reason: 'code', points: 5, dedupKey: `code:${P}:p1`, at: '2026-10-02T00:00:00.000Z' },
  { id: 'x8', reason: 'ex', points: 5, dedupKey: `ex:${P}:p2`, at: '2026-10-02T00:00:00.000Z' },
  { id: 'x9', reason: 'built', points: 5, dedupKey: `built:${P}:p1`, at: '2026-10-02T00:00:00.000Z' },
  { id: 'x10', reason: 'focus', points: 5, dedupKey: 'focus:clientP', at: '2026-10-02T00:00:00.000Z' },
  { id: 'x11', reason: 'goal', points: 5, dedupKey: 'goal:goal-cpP:done', at: '2026-10-02T00:00:00.000Z' },
  { id: 'x12', reason: 'code', points: 5, dedupKey: `code:${Q}:q1`, at: '2026-10-02T00:00:00.000Z' },
  { id: 'x13', reason: 'focus', points: 5, dedupKey: 'focus:clientQ', at: '2026-10-02T00:00:00.000Z' },
  { id: 'x14', reason: 'goal', points: 5, dedupKey: 'goal:goal-cpQ:done', at: '2026-10-02T00:00:00.000Z' },
  { id: 'x15', reason: 'checkpoint', points: 20, dedupKey: 'cp:cpQ:done', at: '2026-10-02T00:00:00.000Z' },
];

async function seed() {
  const db = await openDB('learnquest-db', 2, {
    upgrade(d) { if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); },
  });
  await db.clear('kv');
  await db.put('kv', { [P]: P_SNAP, [Q]: Q_SNAP }, 'playlists');
  await db.put('kv', META, 'meta');
  await db.put('kv', P, 'activeId');
  await db.put('kv', PROGRESS, 'progress');
  await db.put('kv', CHECKPOINTS, 'checkpoints');
  await db.put('kv', RANGES, 'ranges');
  await db.put('kv', MODULES, 'modules');
  await db.put('kv', SESSIONS, 'sessions');
  await db.put('kv', SEGMENTS, 'segments');
  await db.put('kv', PLAY_SESSIONS, 'playSessions');
  await db.put('kv', FLEX_GOALS, 'flexGoals');
  await db.put('kv', { [P]: [1, 2] }, 'queue');
  await db.put('kv', XP, 'xp');
}

function Probe() {
  const s = useStore();
  return (
    <div data-testid="probe">
      {JSON.stringify({
        ready: s.ready,
        activeId: s.activeId,
        archived: s.meta[P]?.archived ?? null,
        hasP: Boolean(s.playlists[P]),
        progressKeys: Object.keys(s.progress).sort(),
        xpKeys: s.xp.map((x) => x.dedupKey).sort(),
        checkpoints: s.checkpoints.map((c) => c.playlistId).sort(),
        ranges: s.ranges.map((r) => r.playlistId).sort(),
        modules: s.modules.map((m) => m.playlistId).sort(),
        sessions: s.sessions.map((x) => x.playlistId).sort(),
        segments: s.segments.map((x) => x.playlistId).sort(),
        playSessions: s.playSessions.map((x) => x.playlistId).sort(),
        flexGoals: s.flexGoals.map((g) => g.playlistId).sort(),
      })}
    </div>
  );
}

function renderManager() {
  return render(
    <StoreProvider mode="local">
      <PlaylistManager />
      <Probe />
    </StoreProvider>,
  );
}

async function probe() {
  await waitFor(() => expect(screen.getByTestId('probe').textContent).toContain('"ready":true'));
  return JSON.parse(screen.getByTestId('probe').textContent ?? '{}');
}

async function openRemoveDialog() {
  const buttons = screen.getAllByRole('button', { name: /Manage \/ Remove/ });
  fireEvent.click(buttons[0]);
  const dialog = screen.getByRole('dialog', { name: /Remove or delete this playlist/i });
  // The playlist title identifies the target in the dialog description even
  // though the accessible name stays stable for screen-reader consistency.
  expect(dialog).toHaveTextContent(/Renamed P/);
  return dialog;
}

beforeEach(async () => {
  await seed();
});

describe('playlist manager: archive versus permanent delete', () => {
  it('archives custom-titled playlists without losing records and restores without new XP', async () => {
    renderManager();
    await screen.findByText(/Renamed P/);
    const before = await probe();
    expect(before.activeId).toBe(P);
    expect(before.progressKeys).toEqual([`${P}::p1`, `${P}::p2`, `${Q}::q1`]);

    await openRemoveDialog();
    fireEvent.click(screen.getByRole('button', { name: /Archive playlist \(keep data\)/ }));

    await screen.findByText(/was removed from the dashboard and archived/i);
    const archived = await probe();
    expect(archived.archived).toBe(true);
    expect(archived.activeId).toBe(Q);
    expect(archived.progressKeys).toEqual(before.progressKeys);
    expect(archived.hasP).toBe(true);
    expect(archived.xpKeys).toEqual(expect.arrayContaining(before.xpKeys));

    fireEvent.click(screen.getByRole('button', { name: /Restore/ }));
    await screen.findByText(/Playlist restored with its preserved learning records/i);
    await waitFor(async () => {
      const restored = await probe();
      expect(restored.archived).toBe(false);
      // Restoring never recreates or duplicates XP; compare against the
      // already-settled archive state (achievement effects may run on load).
      expect(restored.xpKeys).toEqual(archived.xpKeys);
      expect(restored.progressKeys).toEqual(before.progressKeys);
    });
  });

  it('requires the exact displayed title before permanent deletion (custom title included)', async () => {
    renderManager();
    await screen.findByText(/Renamed P/);
    await openRemoveDialog();
    fireEvent.click(screen.getByRole('button', { name: /Permanently delete playlist and all its learning data/ }));

    const confirm = screen.getByRole('button', { name: /Permanently delete playlist$/ });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Type "Renamed P" to confirm/), { target: { value: 'Course P' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Type "Renamed P" to confirm/), { target: { value: 'Renamed P' } });
    expect(confirm).toBeEnabled();
  });

  it('permanently deletes one playlist and only reliably attributable records', async () => {
    renderManager();
    await screen.findByText(/Renamed P/);
    await openRemoveDialog();
    fireEvent.click(screen.getByRole('button', { name: /Permanently delete playlist and all its learning data/ }));
    fireEvent.change(screen.getByLabelText(/Type "Renamed P" to confirm/), { target: { value: 'Renamed P' } });
    fireEvent.click(screen.getByRole('button', { name: /Permanently delete playlist$/ }));

    await screen.findByText(/and its reliably attributable account-owned records were permanently deleted/i);
    await waitFor(async () => {
      const after = await probe();
      expect(after.hasP).toBe(false);
      expect(after.activeId).toBe(Q);
      expect(after.progressKeys).toEqual([`${Q}::q1`]);
      // Every attributable P XP key is gone; Q and account-wide XP remain.
      expect(after.xpKeys.every((key: string) => !key.includes(P))).toBe(true);
      for (const key of [
        `code:${P}:p1`, `ex:${P}:p2`, `built:${P}:p1`, 'focus:clientP', 'goal:goal-cpP:done',
      ]) {
        expect(after.xpKeys).not.toContain(key);
      }
      expect(after.xpKeys).toContain(`done:${Q}:q1`);
      expect(after.xpKeys).toContain(`code:${Q}:q1`);
      expect(after.xpKeys).toContain('focus:clientQ');
      expect(after.xpKeys).toContain('goal:goal-cpQ:done');
      expect(after.xpKeys).toContain('cp:cpQ');
      expect(after.xpKeys).toContain('day:2026-10-02');
      expect(after.checkpoints).toEqual([Q]);
      expect(after.ranges).toEqual([]);
      expect(after.modules).toEqual([]);
      expect(after.sessions).toEqual([Q]);
      expect(after.segments).toEqual([]);
      expect(after.playSessions).toEqual([]);
      expect(after.flexGoals).toEqual([Q, null]);
    });
  });

  it('portals the destructive dialog to a viewport-centered, scrollable overlay', async () => {
    const { container } = renderManager();
    await screen.findByText(/Renamed P/);
    const dialog = await openRemoveDialog();

    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
    const overlay = dialog.parentElement!;
    expect(overlay.className).toContain('fixed');
    expect(overlay.className).toContain('inset-0');
    expect(overlay.className).toContain('place-items-center');
    expect(overlay.className).toContain('overflow-y-auto');
    expect(dialog.className).toContain('max-h-[calc(100dvh-1.5rem)]');
    expect(dialog.className).toContain('overflow-y-auto');
  });

  it('cancel closes the dialog without changing anything', async () => {
    renderManager();
    await screen.findByText(/Renamed P/);
    const before = await probe();
    const dialog = await openRemoveDialog();
    expect(dialog).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Remove or delete this playlist/i })).not.toBeInTheDocument());
    const after = await probe();
    expect(after).toEqual(before);
  });
});
