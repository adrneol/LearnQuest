import { describe, it, expect, beforeEach } from 'vitest';
import { openDB } from 'idb';
import {
  BACKUP_SCHEMA_VERSION, buildBackup, validateBackup, type BackupState,
} from '../src/services/persistence/backup.js';
import { defaultPreferences } from '../src/domain/settings/preferences.js';
import { DEFAULT_CHALLENGE } from '../src/domain/competition/competition.js';
import { kvGet, kvReplaceAll, kvSet, kvClearAll } from '../src/services/persistence/db.js';
import type { PlaylistSnapshot, ProgressRecord } from '../src/types/index.js';

const P = 'PLbackup0000000000000';

function snapshot(): PlaylistSnapshot {
  return {
    playlistId: P,
    title: 'Backup Course',
    reportedCount: 2,
    entries: [
      { position: 1, entryId: 'e1', videoId: 'v1', title: 'One', durationSec: 60 },
      { position: 2, entryId: 'e2', videoId: 'v2', title: 'Two', durationSec: 120 },
    ],
    source: 'api',
    fetchedAt: '2026-10-01T00:00:00.000Z',
    snapshotVersion: 2,
  };
}

function state(): BackupState {
  const progress: Record<string, ProgressRecord> = {
    [`${P}::e1`]: {
      playlistId: P, position: 1, entryId: 'e1', videoId: 'v1',
      completedAt: '2026-10-01T10:00:00.000Z', status: 'done', source: 'verified',
      notes: 'note', confidence: 3,
    },
  };
  return {
    playlists: { [P]: snapshot() },
    meta: { [P]: { archived: false, addedAt: '2026-10-01T00:00:00.000Z' } },
    activeId: P,
    progress,
    ranges: [{ id: 'r1', playlistId: P, label: 'First', start: 1, end: 1, createdAt: '2026-10-01T00:00:00.000Z', snapshotVersion: 2, status: 'valid' }],
    checkpoints: [{ id: 'c1', playlistId: P, label: 'Half', start: 1, end: 1, createdAt: '2026-10-01T00:00:00.000Z', completedAt: null, snapshotVersion: 2, status: 'valid' }],
    modules: [{ id: 'm1', playlistId: P, name: 'Basics', positions: [1] }],
    sessions: [],
    goals: {},
    xp: [{ id: 'x1', reason: 'videoDone', points: 10, dedupKey: 'done:1', at: '2026-10-01T10:00:00.000Z' }],
    achievements: {},
    prefs: defaultPreferences(),
    segments: [{
      id: 's1', playlistId: P, position: 1, entryId: 'e1', videoId: 'v1', sessionId: 'sess1',
      wallStartMs: Date.parse('2026-10-01T09:59:00.000Z'), wallEndMs: Date.parse('2026-10-01T10:00:00.000Z'),
      timelineStartSec: 0, timelineEndSec: 60, playbackRate: 1, source: 'verified',
    }],
    playSessions: [{
      id: 'ps1', playlistId: P, position: 1, entryId: 'e1', videoId: 'v1',
      startedAt: '2026-10-01T09:59:00.000Z', finishedAt: '2026-10-01T10:00:00.000Z',
      activePlaybackSec: 60, contentSec: 60, uniqueGainSec: 60, pauseSec: 0, source: 'verified',
    }],
    queue: { [P]: [1] },
    flexGoals: [{
      id: 'g1', label: 'One video', metric: 'video-count', target: 1, playlistId: P,
      checkpointId: undefined, dateKey: null, createdAt: '2026-10-01T00:00:00.000Z',
      paused: false, achievedAt: null, achievedValue: null,
    }],
    challenge: DEFAULT_CHALLENGE,
    challengeEnabled: false,
    rankHistory: [],
    settings: { verifiedThreshold: 0.9 },
  };
}

function parsed(): any {
  return JSON.parse(buildBackup(state(), '2026-10-27T12:00:00.000Z'));
}

beforeEach(async () => {
  const db = await openDB('learnquest-db', 2, {
    upgrade(d) { if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); },
  });
  await db.clear('kv');
});

describe('versioned backup validation', () => {
  it('preserves valid review history and rejects malformed review entries', () => {
    const raw = parsed();
    raw.data.progress[`${P}::e1`].revisionDoneAt = '2026-10-20T10:00:00.000Z';
    raw.data.progress[`${P}::e1`].reviewHistory = [{
      id: 'rev-1', reviewedAt: '2026-10-20T10:00:00.000Z', dateKey: '2026-10-20', source: 'revision',
    }];
    const valid = validateBackup(JSON.stringify(raw));
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.backup.state.progress[`${P}::e1`].reviewHistory).toEqual(raw.data.progress[`${P}::e1`].reviewHistory);
    }

    const bad = parsed();
    bad.data.progress[`${P}::e1`].reviewHistory = [{
      id: 'rev-bad', reviewedAt: 'not-a-timestamp', dateKey: '2026-99-99',
    }];
    const rejected = validateBackup(JSON.stringify(bad));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.errors.join(' ')).toMatch(/reviewHistory/);
  });

  it('round-trips a complete version-3 backup with every collection', () => {
    const result = validateBackup(buildBackup(state(), '2026-10-27T12:00:00.000Z'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backup.version).toBe(BACKUP_SCHEMA_VERSION);
    expect(result.backup.state.playlists[P].entries).toHaveLength(2);
    expect(result.backup.state.progress[`${P}::e1`].notes).toBe('note');
    expect(result.backup.state.segments).toHaveLength(1);
    expect(result.backup.state.queue[P]).toEqual([1]);
    expect(result.backup.state.flexGoals).toHaveLength(1);
  });

  it('rejects unsupported versions and malformed top-level JSON', () => {
    const future = parsed();
    future.version = BACKUP_SCHEMA_VERSION + 1;
    const r1 = validateBackup(JSON.stringify(future));
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.errors[0]).toMatch(/Unsupported backup version/i);

    const bad = validateBackup('{not json');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]).toMatch(/valid JSON/i);
  });

  it('rejects malformed timestamps, NaN counts, duplicate positions, and bad durations', () => {
    const d = parsed();

    const badTime = structuredClone(d);
    badTime.data.progress[`${P}::e1`].completedAt = 'not-a-date';
    expect(validateBackup(JSON.stringify(badTime)).ok).toBe(false);

    const nanCount = structuredClone(d);
    nanCount.data.playlists[P].reportedCount = Number.NaN;
    expect(validateBackup(nanCount).ok).toBe(false);

    const duplicate = structuredClone(d);
    duplicate.data.playlists[P].entries[1].position = 1;
    expect(validateBackup(JSON.stringify(duplicate)).ok).toBe(false);

    const badDuration = structuredClone(d);
    badDuration.data.playlists[P].entries[0].durationSec = -5;
    expect(validateBackup(JSON.stringify(badDuration)).ok).toBe(false);
  });

  it('rejects cross-record references to missing playlists', () => {
    const d = parsed();
    d.data.checkpoints[0].playlistId = 'PLmissing00000000000';
    const r = validateBackup(JSON.stringify(d));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/checkpoint/i);
  });

  it('treats omitted collections as empty under full-restore semantics (never merges)', () => {
    const d = parsed();
    delete d.data.progress;
    delete d.data.segments;
    delete d.data.queue;
    const r = validateBackup(JSON.stringify(d));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.backup.state.progress).toEqual({});
    expect(r.backup.state.segments).toEqual([]);
    expect(r.backup.state.queue).toEqual({});
  });

  it('accepts legacy version-1 files through compatible defaults', () => {
    const legacy = {
      version: 1,
      playlists: { [P]: snapshot() },
      progress: { [`${P}::e1`]: { playlistId: P, position: 1, entryId: 'e1', videoId: 'v1', completedAt: '2026-10-01T10:00:00.000Z', status: 'done' } },
    };
    const r = validateBackup(legacy);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.backup.version).toBe(1);
    expect(r.backup.state.prefs.timezone).toBeTruthy();
  });

  it('rejects oversized and incomplete snapshots with actionable errors', () => {
    const d = parsed();
    d.data.playlists[P].entries[0].title = '';
    const r = validateBackup(JSON.stringify(d));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/title/i);
  });
});

describe('all-or-nothing IndexedDB replacement', () => {
  it('commits every key and removes keys omitted from the restore', async () => {
    await kvSet('playlists', { old: true });
    await kvSet('stale', { shouldVanish: true });
    await kvReplaceAll({ playlists: { fresh: true }, progress: { p: 1 } });
    expect(await kvGet('playlists')).toEqual({ fresh: true });
    expect(await kvGet('progress')).toEqual({ p: 1 });
    expect(await kvGet('stale')).toBeUndefined();
  });

  it('leaves the previous state intact when a restored value cannot be stored', async () => {
    await kvSet('playlists', { keep: true });
    await expect(kvReplaceAll({
      playlists: { replaced: true },
      // Functions are not structured-cloneable: the write must abort.
      broken: (() => undefined) as unknown,
    })).rejects.toBeTruthy();
    expect(await kvGet('playlists')).toEqual({ keep: true });
  });

  it('clear-all removes every key', async () => {
    await kvSet('a', 1);
    await kvSet('b', 2);
    await kvClearAll();
    expect(await kvGet('a')).toBeUndefined();
    expect(await kvGet('b')).toBeUndefined();
  });
});
