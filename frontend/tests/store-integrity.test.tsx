import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { openDB } from 'idb';
import { StoreProvider, useStore } from '../src/app/store.js';
import { buildBackup, type BackupState } from '../src/services/persistence/backup.js';
import { defaultPreferences } from '../src/domain/settings/preferences.js';
import { DEFAULT_CHALLENGE, createFixedChallenge } from '../src/domain/competition/competition.js';
import { findProgressForEntry, isProgressComplete, countCompletedEntries } from '../src/domain/index.js';

const P = 'PLstorep000000000000';
const Q = 'PLstoreq000000000000';

const P_SNAP: any = {
  playlistId: P, title: 'Course P', reportedCount: 3,
  entries: [
    { position: 1, entryId: 'eA', videoId: 'A', title: 'A', durationSec: 60 },
    { position: 2, entryId: 'eB', videoId: 'B', title: 'B', durationSec: 60 },
    { position: 3, entryId: 'eC', videoId: 'C', title: 'C', durationSec: 60 },
  ],
  source: 'api', fetchedAt: '2026-10-01T00:00:00.000Z', snapshotVersion: 2,
};
const Q_SNAP: any = {
  playlistId: Q, title: 'Course Q', reportedCount: 1,
  entries: [{ position: 1, entryId: 'eZ', videoId: 'Z', title: 'Z', durationSec: 60 }],
  source: 'api', fetchedAt: '2026-10-01T00:00:00.000Z', snapshotVersion: 2,
};

const PROGRESS: any = {
  [`${P}::eA`]: {
    playlistId: P, position: 1, entryId: 'eA', videoId: 'A', status: 'done',
    completedAt: '2026-10-01T10:00:00.000Z', source: 'verified', notes: 'A note', confidence: 3,
    revisionDate: '2026-12-01',
  },
  [`${P}::eB`]: {
    playlistId: P, position: 2, entryId: 'eB', videoId: 'B', status: 'in-progress',
    completedAt: null, notes: 'B draft', keyConcepts: 'state machines',
  },
  [`${Q}::eZ`]: {
    playlistId: Q, position: 1, entryId: 'eZ', videoId: 'Z', status: 'done',
    completedAt: '2026-10-01T11:00:00.000Z', source: 'manual', notes: 'Q note',
  },
};

const wrapper = ({ children }: { children: ReactNode }) => <StoreProvider>{children}</StoreProvider>;

async function seed() {
  const db = await openDB('learnquest-db', 2, {
    upgrade(d) { if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); },
  });
  await db.clear('kv');
  await db.put('kv', { [P]: P_SNAP, [Q]: Q_SNAP }, 'playlists');
  await db.put('kv', {
    [P]: { archived: false, addedAt: '2026-10-01T00:00:00.000Z' },
    [Q]: { archived: false, addedAt: '2026-10-01T00:00:00.000Z' },
  }, 'meta');
  await db.put('kv', P, 'activeId');
  await db.put('kv', PROGRESS, 'progress');
  await db.put('kv', [], 'xp');
  await db.put('kv', [], 'segments');
  await db.put('kv', [], 'playSessions');
}

async function readyHook() {
  const hook = renderHook(() => useStore(), { wrapper });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return hook;
}

beforeEach(async () => {
  await seed();
});

describe('store data-integrity boundaries', () => {
  it('locks a private fixed Arena run and can explicitly end it without losing practice settings', async () => {
    const { result } = await readyHook();
    const dates = Array.from({ length: 14 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
    act(() => result.current.setChallenge(createFixedChallenge(DEFAULT_CHALLENGE, {
      playlistId: P,
      playlistSnapshotVersion: P_SNAP.snapshotVersion,
      playlistDurationSec: 180,
      windowDates: dates,
      now: new Date('2026-10-01T00:00:00.000Z'),
    })));
    await waitFor(() => expect(result.current.challenge.mode).toBe('fixed'));
    const frozen = result.current.challenge.fixed!;
    expect(frozen.playlistId).toBe(P);

    // Any attempt to edit settings while the run is frozen is ignored.
    act(() => result.current.setChallenge({ seed: 12345, cohortSize: 500 }));
    expect(result.current.challenge.seed).toBe(frozen.seed);
    expect(result.current.challenge.fixed?.cohortSize).toBe(frozen.cohortSize);

    act(() => result.current.endFixedChallenge());
    await waitFor(() => expect(result.current.challenge.mode).toBe('practice'));
    expect(result.current.challenge.fixed).toBeNull();
    expect(result.current.challenge.seed).toBe(frozen.seed);

    act(() => result.current.setChallenge({ seed: 12345 }));
    await waitFor(() => expect(result.current.challenge.seed).toBe(12345));
  });

  it('keeps at most 100 local Arena rank snapshots', async () => {
    const { result } = await readyHook();
    act(() => {
      for (let i = 0; i < 120; i += 1) {
        result.current.pushRank({
          at: new Date(2026, 0, 1, 0, i).toISOString(),
          rank: i + 1,
          of: 100,
          metric: 'arena-v2',
        });
      }
    });
    await waitFor(() => expect(result.current.rankHistory).toHaveLength(100));
    expect(result.current.rankHistory[0].rank).toBe(21);
    expect(result.current.rankHistory[99].rank).toBe(120);
  });

  it('refreshes one playlist by identity without orphaning another playlist', async () => {
    const { result } = await readyHook();
    const reordered = {
      ...P_SNAP,
      entries: [
        { position: 1, entryId: 'eC', videoId: 'C', title: 'C', durationSec: 60 },
        { position: 2, entryId: 'eA', videoId: 'A', title: 'A', durationSec: 60 },
        { position: 3, entryId: 'eB', videoId: 'B', title: 'B', durationSec: 60 },
      ],
    };
    act(() => result.current.addSnapshot(reordered));

    await waitFor(() => expect(result.current.playlists[P].entries[0].videoId).toBe('C'));
    const a = findProgressForEntry(result.current.progress, P, result.current.playlists[P].entries[1]);
    const b = findProgressForEntry(result.current.progress, P, result.current.playlists[P].entries[2]);
    expect(a?.notes).toBe('A note');
    expect(a?.position).toBe(2);
    expect(b?.notes).toBe('B draft');
    expect(b?.position).toBe(3);

    const q = findProgressForEntry(result.current.progress, Q, result.current.playlists[Q].entries[0]);
    expect(q?.notes).toBe('Q note');
    expect(q?.orphaned).toBeFalsy();
    expect(isProgressComplete(q)).toBe(true);
    expect(countCompletedEntries(result.current.playlists[Q], result.current.progress)).toBe(1);
  });

  it('unmarking preserves every annotation, and re-marking does not duplicate XP', async () => {
    const { result } = await readyHook();
    act(() => result.current.toggleDone(P, 1, 'A'));
    await waitFor(() => {
      const rec = findProgressForEntry(result.current.progress, P, result.current.playlists[P].entries[0]);
      expect(rec?.completedAt).toBeNull();
      expect(rec?.status).toBe('in-progress');
    });
    let rec = findProgressForEntry(result.current.progress, P, result.current.playlists[P].entries[0]);
    expect(rec?.notes).toBe('A note');
    expect(rec?.confidence).toBe(3);
    expect(rec?.revisionDate).toBe('2026-12-01');

    act(() => result.current.toggleDone(P, 1, 'A'));
    await waitFor(() => expect(result.current.xp.filter((x) => x.reason === 'videoDone')).toHaveLength(1));
    rec = findProgressForEntry(result.current.progress, P, result.current.playlists[P].entries[0]);
    expect(rec?.notes).toBe('A note');
    expect(rec?.confidence).toBe(3);

    // Unmark/re-mark again: the XP ledger key is stable, never duplicated.
    act(() => result.current.toggleDone(P, 1, 'A'));
    await waitFor(() => expect(findProgressForEntry(result.current.progress, P, result.current.playlists[P].entries[0])?.completedAt).toBeNull());
    act(() => result.current.toggleDone(P, 1, 'A'));
    await waitFor(() => expect(findProgressForEntry(result.current.progress, P, result.current.playlists[P].entries[0])?.completedAt).toBeTruthy());
    expect(result.current.xp.filter((x) => x.reason === 'videoDone')).toHaveLength(1);
  });

  it('persists patched annotations and progress across a provider remount', async () => {
    const first = await readyHook();
    act(() => first.result.current.toggleDone(P, 1, 'A'));
    await waitFor(() => expect(findProgressForEntry(first.result.current.progress, P, first.result.current.playlists[P].entries[0])?.completedAt).toBeNull());
    // Wait for the debounced IndexedDB write.
    await waitFor(async () => {
      const db = await openDB('learnquest-db', 2);
      const saved = await db.get('kv', 'progress');
      expect(saved[`${P}::eA`].notes).toBe('A note');
      expect(saved[`${P}::eA`].completedAt).toBeNull();
    }, { timeout: 2000 });
    first.unmount();

    const second = await readyHook();
    const rec = findProgressForEntry(second.result.current.progress, P, second.result.current.playlists[P].entries[0]);
    expect(rec?.notes).toBe('A note');
    expect(rec?.confidence).toBe(3);
    expect(rec?.completedAt).toBeNull();
  });

  it('rejects an invalid restore without changing any in-memory state', async () => {
    const { result } = await readyHook();
    const before = JSON.stringify({ playlists: result.current.playlists, progress: result.current.progress });
    await act(async () => {
      await expect(result.current.importBackup('{"version":99,"data":{}}')).rejects.toThrow(/Unsupported backup/i);
    });
    expect(JSON.stringify({ playlists: result.current.playlists, progress: result.current.progress })).toBe(before);
    expect(result.current.playlists[P]).toBeTruthy();
    expect(result.current.playlists[Q]).toBeTruthy();
  });

  it('applies a valid full restore and drops collections omitted from the backup', async () => {
    const { result } = await readyHook();
    const empty: BackupState = {
      playlists: {}, meta: {}, activeId: null, progress: {}, ranges: [], checkpoints: [],
      modules: [], sessions: [], goals: {}, xp: [], achievements: {}, prefs: defaultPreferences(),
      segments: [], playSessions: [], queue: {}, flexGoals: [], challenge: DEFAULT_CHALLENGE,
      challengeEnabled: false, rankHistory: [], settings: { verifiedThreshold: 0.9 },
    };
    await act(async () => {
      await result.current.importBackup(buildBackup(empty));
    });
    await waitFor(() => expect(Object.keys(result.current.playlists)).toHaveLength(0));
    expect(result.current.progress).toEqual({});
    expect(result.current.activeId).toBeNull();
    expect(result.current.prefs.sessionLenMin).toBe(defaultPreferences().sessionLenMin);
  });
});

