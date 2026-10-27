import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDb } from '../src/db/memoryAdapter.js';
import {
  USER_COLLECTIONS,
  createDataStore,
  type DataStore,
  type UserCollectionName,
} from '../src/store.js';
import {
  USER_DATA_MIGRATION_ID,
  USER_DATA_MIGRATION_VERSION,
  applyUserDataMigration,
  inspectUserDataMigration,
} from '../src/services/userDataMigration.js';

const NOW = '2026-10-02T00:00:00.000Z';
const PLAYLIST_ID = 'PLmigration000000000001';
const SECRET_NOTE = 'TOP-SECRET-MIGRATION-PAYLOAD';

const SAMPLE: Record<UserCollectionName, unknown> = {
  playlists: {
    playlistId: PLAYLIST_ID,
    title: 'Migration playlist',
    reportedCount: 1,
    entries: [{ position: 1, videoId: 'v1', title: 'Video one', durationSec: 120 }],
    source: 'imported',
    fetchedAt: NOW,
    snapshotVersion: 1,
  },
  meta: { archived: false, addedAt: NOW },
  progress: {
    playlistId: PLAYLIST_ID,
    position: 1,
    videoId: 'v1',
    status: 'done',
    completedAt: NOW,
    notes: SECRET_NOTE,
  },
  ranges: { playlistId: PLAYLIST_ID, id: 'range-1', label: 'Range one', start: 1, end: 5, createdAt: NOW, completedAt: null },
  checkpoints: { playlistId: PLAYLIST_ID, id: 'checkpoint-1', label: 'Checkpoint one', start: 1, end: 5, createdAt: NOW },
  modules: { playlistId: PLAYLIST_ID, id: 'module-1', name: 'Module one', positions: [1, 2] },
  sessions: {
    id: 'session-1', playlistId: PLAYLIST_ID, startedAt: NOW, finishedAt: null,
    activeSec: 120, elapsedSec: 150, intervals: [], note: '',
  },
  goals: { dateKey: '2026-10-02', targetFocusSec: 3600, minViableSec: 600 },
  xp: { id: 'xp-1', dedupKey: `done:${PLAYLIST_ID}:1`, reason: 'completed-video', points: 10, at: NOW },
  achievements: NOW,
  segments: { playlistId: PLAYLIST_ID, id: 'segment-1' },
  playSessions: { playlistId: PLAYLIST_ID, id: 'play-session-1' },
  queue: [1, 2],
  flexGoals: { id: 'flex-goal-1', metric: 'focusMin', target: 30, createdAt: NOW, playlistId: PLAYLIST_ID },
  challenge: { seed: 20261013, cohortSize: 100 },
  challengeEnabled: false,
  rankHistory: { id: 'rank-1', at: NOW, rank: 1, of: 10 },
  settings: { verifiedThreshold: 0.9 },
  prefs: { timezone: 'UTC', sessionLenMin: 25, breakMin: 5, reducedMotion: false, minViableMin: 10 },
  activeId: PLAYLIST_ID,
};

const KEY: Record<UserCollectionName, string> = {
  playlists: PLAYLIST_ID,
  meta: PLAYLIST_ID,
  progress: 'v1',
  ranges: 'range-1',
  checkpoints: 'checkpoint-1',
  modules: 'module-1',
  sessions: 'session-1',
  goals: '2026-10-02',
  xp: 'xp-1',
  achievements: 'achievement-1',
  segments: 'segment-1',
  playSessions: 'play-session-1',
  queue: PLAYLIST_ID,
  flexGoals: 'flex-goal-1',
  challenge: 'singleton',
  challengeEnabled: 'singleton',
  rankHistory: 'rank-1',
  settings: 'singleton',
  prefs: 'singleton',
  activeId: 'singleton',
};

let db: ReturnType<typeof createMemoryDb>;
let store: DataStore;

beforeEach(() => {
  db = createMemoryDb();
  store = createDataStore(db);
});

afterEach(async () => {
  await db.close();
});

async function ensureAccount(userId: string): Promise<void> {
  if (await store.accounts.findOne({ userId })) return;
  await store.accounts.insertOne({
    userId,
    username: userId,
    status: 'active',
    onboardingComplete: true,
    createdAt: NOW,
  });
}

async function insertRecord(
  userId: string,
  domain: UserCollectionName,
  key: string,
  value: unknown,
  order = 0,
): Promise<void> {
  await ensureAccount(userId);
  const doc: Record<string, unknown> = { userId, key, value, updatedAt: NOW, order };
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const playlistId = (value as Record<string, unknown>).playlistId;
    if (typeof playlistId === 'string') doc.playlistId = playlistId;
  }
  await store.data(domain).insertOne(doc);
}

async function seedUser(userId: string, domains: UserCollectionName[] = [...USER_COLLECTIONS]): Promise<void> {
  for (const [index, domain] of USER_COLLECTIONS.entries()) {
    if (!domains.includes(domain)) continue;
    await insertRecord(userId, domain, KEY[domain], SAMPLE[domain], index);
  }
}

async function snapshotLegacy(userId: string): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const domain of USER_COLLECTIONS) {
    out[domain] = await store.data(domain).find({ userId }, { sort: { key: 1 } });
  }
  return out;
}

describe('lq_user_data migration', () => {
  it('is a deterministic dry run that never writes or exposes payloads', async () => {
    await seedUser('user-a');
    await seedUser('user-b');

    const first = await inspectUserDataMigration(store, { batchSize: 2 });
    const second = await inspectUserDataMigration(store, { batchSize: 2 });

    expect(second).toEqual(first);
    expect(first.migration).toMatchObject({
      id: USER_DATA_MIGRATION_ID,
      version: USER_DATA_MIGRATION_VERSION,
      mode: 'dry-run',
      targetCollection: 'lq_user_data',
      batchSize: 2,
    });
    expect(first.users.map((user) => user.userId)).toEqual(['user-a', 'user-b']);
    expect(first.status).toBe('ready');
    expect(first.totals.users).toBe(2);
    expect(first.totals.sourceDocuments).toBe(USER_COLLECTIONS.length * 2);
    expect(first.totals.validSourceKeys).toBe(USER_COLLECTIONS.length * 2);
    expect(first.totals.pendingKeys).toBe(USER_COLLECTIONS.length * 2);
    expect(first.totals.matchedKeys).toBe(0);
    expect(first.checksums.source).toMatch(/^[a-f0-9]{64}$/);
    expect(await store.userData.count({})).toBe(0);
    expect(JSON.stringify(first)).not.toContain(SECRET_NOTE);
  });

  it('copies every domain, preserves fields, leaves legacy data intact, and is idempotent', async () => {
    await seedUser('user-a');
    await seedUser('user-b');
    const legacyBeforeA = await snapshotLegacy('user-a');
    const legacyBeforeB = await snapshotLegacy('user-b');

    const applied = await applyUserDataMigration(store, {
      userIds: ['user-a'],
      batchSize: 1,
    });

    expect(applied.status).toBe('applied');
    expect(applied.ok).toBe(true);
    expect(applied.error).toBeUndefined();
    expect(applied.applied.copied).toBe(USER_COLLECTIONS.length);
    expect(applied.applied.alreadyPresent).toBe(0);
    expect(applied.after?.totals.pendingKeys).toBe(0);
    expect(applied.after?.totals.matchedKeys).toBe(USER_COLLECTIONS.length);
    expect(applied.after?.checksums.source).toBe(applied.after?.checksums.matchedDestination);
    expect(await store.userData.count({ userId: 'user-a' })).toBe(USER_COLLECTIONS.length);
    expect(await store.userData.count({ userId: 'user-b' })).toBe(0);

    const targetProgress = await store.userData.findOne({ userId: 'user-a', domain: 'progress', key: 'v1' });
    expect(targetProgress).toMatchObject({
      userId: 'user-a',
      domain: 'progress',
      key: 'v1',
      value: SAMPLE.progress,
      playlistId: PLAYLIST_ID,
      updatedAt: NOW,
      order: USER_COLLECTIONS.indexOf('progress'),
    });
    const targetSettings = await store.userData.findOne({ userId: 'user-a', domain: 'settings', key: 'singleton' });
    expect(targetSettings).toMatchObject({ value: SAMPLE.settings, updatedAt: NOW });

    expect(await snapshotLegacy('user-a')).toEqual(legacyBeforeA);
    expect(await snapshotLegacy('user-b')).toEqual(legacyBeforeB);

    const repeated = await applyUserDataMigration(store, {
      userIds: ['user-a'],
      batchSize: 2,
    });
    expect(repeated.status).toBe('applied');
    expect(repeated.ok).toBe(true);
    expect(repeated.applied.copied).toBe(0);
    expect(repeated.applied.alreadyPresent).toBe(USER_COLLECTIONS.length);
    expect(await store.userData.count({ userId: 'user-a' })).toBe(USER_COLLECTIONS.length);
    expect(await snapshotLegacy('user-a')).toEqual(legacyBeforeA);
  });

  it('blocks duplicate source keys and writes nothing', async () => {
    await insertRecord('user-a', 'playlists', PLAYLIST_ID, SAMPLE.playlists);
    await insertRecord('user-a', 'progress', 'v1', SAMPLE.progress);
    await insertRecord('user-a', 'progress', 'v1', { ...(SAMPLE.progress as Record<string, unknown>), status: 'todo' });

    const report = await inspectUserDataMigration(store, { userIds: ['user-a'] });
    expect(report.status).toBe('blocked');
    expect(report.totals.duplicateSourceKeys).toBe(1);
    expect(report.totals.validSourceKeys).toBe(2);
    const progress = report.users[0].domains.find((domain) => domain.domain === 'progress');
    expect(progress?.issues.duplicateSourceKeys).toEqual(['v1']);
    expect(progress?.duplicateSourceKeys).toBe(1);

    const applied = await applyUserDataMigration(store, { userIds: ['user-a'] });
    expect(applied.status).toBe('blocked');
    expect(applied.ok).toBe(false);
    expect(applied.applied.copied).toBe(0);
    expect(await store.userData.count({})).toBe(0);
    expect(await store.data('playlists').count({ userId: 'user-a' })).toBe(1);
  });

  it('blocks malformed source records without leaking their payloads', async () => {
    await insertRecord('user-a', 'playlists', PLAYLIST_ID, SAMPLE.playlists);
    await insertRecord('user-a', 'progress', 'v1', {
      playlistId: PLAYLIST_ID,
      position: 1,
      videoId: 'v1',
      status: 'BROKEN-SECRET-STATUS',
      completedAt: NOW,
      notes: SECRET_NOTE,
    });

    const report = await inspectUserDataMigration(store, { userIds: ['user-a'] });
    expect(report.status).toBe('blocked');
    expect(report.totals.invalidSourceDocuments).toBe(1);
    expect(report.users[0].domains.find((domain) => domain.domain === 'progress')?.issues.invalidSource[0]?.key).toBe('v1');
    expect(JSON.stringify(report)).not.toContain(SECRET_NOTE);
    expect(JSON.stringify(report)).not.toContain('BROKEN-SECRET-STATUS');

    const applied = await applyUserDataMigration(store, { userIds: ['user-a'] });
    expect(applied.status).toBe('blocked');
    expect(applied.applied.copied).toBe(0);
    expect(await store.userData.count({})).toBe(0);
  });

  it('detects destination conflicts and never overwrites them', async () => {
    await insertRecord('user-a', 'playlists', PLAYLIST_ID, SAMPLE.playlists);
    await insertRecord('user-a', 'progress', 'v1', SAMPLE.progress);
    // The memory adapter permits a conflicting destination so the tool itself
    // is tested independently of a unique index.
    await store.userData.insertOne({
      userId: 'user-a',
      domain: 'progress',
      key: 'v1',
      value: { ...(SAMPLE.progress as Record<string, unknown>), status: 'todo' },
      updatedAt: NOW,
      order: 99,
    });

    const report = await inspectUserDataMigration(store, { userIds: ['user-a'] });
    expect(report.status).toBe('blocked');
    expect(report.totals.conflicts).toBeGreaterThan(0);
    const progress = report.users[0].domains.find((domain) => domain.domain === 'progress');
    expect(progress?.issues.conflicts[0]?.key).toBe('v1');
    expect(JSON.stringify(report)).not.toContain(SECRET_NOTE);

    const applied = await applyUserDataMigration(store, { userIds: ['user-a'] });
    expect(applied.status).toBe('blocked');
    expect(applied.applied.copied).toBe(0);
    expect(await store.userData.count({ userId: 'user-a' })).toBe(1);
    expect(await store.userData.count({ userId: 'user-a', domain: 'playlists' })).toBe(0);
    const saved = await store.userData.findOne({ userId: 'user-a', domain: 'progress', key: 'v1' });
    expect((saved?.value as Record<string, unknown>).status).toBe('todo');
  });

  it('blocks duplicate destination rows', async () => {
    await insertRecord('user-a', 'progress', 'v1', SAMPLE.progress);
    for (let i = 0; i < 2; i += 1) {
      await store.userData.insertOne({
        userId: 'user-a', domain: 'progress', key: 'v1', value: SAMPLE.progress, updatedAt: NOW, order: i,
      });
    }

    const report = await inspectUserDataMigration(store, { userIds: ['user-a'] });
    expect(report.status).toBe('blocked');
    expect(report.totals.duplicateDestinationKeys).toBe(1);
    expect(report.users[0].domains.find((domain) => domain.domain === 'progress')?.issues.duplicateDestinationKeys).toEqual(['v1']);

    const applied = await applyUserDataMigration(store, { userIds: ['user-a'] });
    expect(applied.status).toBe('blocked');
    expect(applied.applied.copied).toBe(0);
    expect(await store.userData.count({ userId: 'user-a' })).toBe(2);
  });

  it('reports incomplete rather than success when verification finds a missing record', async () => {
    await insertRecord('user-a', 'progress', 'v1', SAMPLE.progress);

    const originalInsert = store.userData.insertOne.bind(store.userData);
    store.userData.insertOne = async (doc) => doc;
    const fakeSuccess = await applyUserDataMigration(store, { userIds: ['user-a'] });
    store.userData.insertOne = originalInsert;

    expect(fakeSuccess.status).toBe('incomplete');
    expect(fakeSuccess.ok).toBe(false);
    expect(fakeSuccess.applied.copied).toBe(1);
    expect(fakeSuccess.after?.totals.pendingKeys).toBe(1);
    expect(fakeSuccess.error).toBeTruthy();

    const retried = await applyUserDataMigration(store, { userIds: ['user-a'] });
    expect(retried.status).toBe('applied');
    expect(retried.ok).toBe(true);
    expect(retried.applied.copied).toBe(1);
    expect(await store.userData.count({ userId: 'user-a' })).toBe(1);
  });

  it('reports incomplete when the legacy source changes during the copy', async () => {
    await insertRecord('user-a', 'progress', 'v1', SAMPLE.progress);

    const originalInsert = store.userData.insertOne.bind(store.userData);
    let changed = false;
    store.userData.insertOne = async (doc) => {
      const saved = await originalInsert(doc);
      if (!changed) {
        changed = true;
        await store.data('progress').deleteMany({ userId: 'user-a' });
      }
      return saved;
    };
    const result = await applyUserDataMigration(store, { userIds: ['user-a'] });
    store.userData.insertOne = originalInsert;

    expect(result.status).toBe('incomplete');
    expect(result.ok).toBe(false);
    expect(result.warnings.join(' ')).toMatch(/source changed during the copy/i);
    expect(await store.userData.count({ userId: 'user-a' })).toBe(1);
  });

  it('scopes copying by account and domain without touching another account', async () => {
    await seedUser('user-a');
    await seedUser('user-b');
    const legacyBeforeB = await snapshotLegacy('user-b');

    const result = await applyUserDataMigration(store, {
      userIds: ['user-a'],
      domains: ['playlists', 'progress'],
      batchSize: 1,
    });

    expect(result.before.migration.userIds).toEqual(['user-a']);
    expect(result.before.migration.domains).toEqual(['playlists', 'progress']);
    expect(result.status).toBe('applied');
    expect(result.applied.copied).toBe(2);
    expect(await store.userData.count({ userId: 'user-a' })).toBe(2);
    expect(await store.userData.count({ userId: 'user-b' })).toBe(0);
    expect(await snapshotLegacy('user-b')).toEqual(legacyBeforeB);
  });

  it('reports destination-only records as a warning without overwriting them', async () => {
    await ensureAccount('user-a');
    await store.userData.insertOne({
      userId: 'user-a', domain: 'playlists', key: 'orphan-playlist', value: SAMPLE.playlists, updatedAt: NOW, order: 0,
    });

    const report = await inspectUserDataMigration(store, { userIds: ['user-a'] });
    expect(report.status).toBe('ready');
    expect(report.totals.destinationOnlyKeys).toBe(1);
    expect(report.warnings.join(' ')).toContain('no matching legacy source');

    const result = await applyUserDataMigration(store, { userIds: ['user-a'] });
    expect(result.status).toBe('applied');
    expect(result.ok).toBe(true);
    expect(result.applied.copied).toBe(0);
    expect(await store.userData.count({ userId: 'user-a' })).toBe(1);
    const saved = await store.userData.findOne({ userId: 'user-a', domain: 'playlists', key: 'orphan-playlist' });
    expect(saved?.value).toEqual(SAMPLE.playlists);
  });

  it('blocks migration for a deleted account and never resurrects its records', async () => {
    await insertRecord('deleted-user', 'progress', 'v1', SAMPLE.progress);
    await store.accounts.deleteMany({ userId: 'deleted-user' });

    const report = await inspectUserDataMigration(store, { userIds: ['deleted-user'] });
    expect(report.status).toBe('blocked');
    expect(JSON.stringify(report.globalIssues)).toMatch(/no owning account/i);

    const applied = await applyUserDataMigration(store, { userIds: ['deleted-user'] });
    expect(applied.status).toBe('blocked');
    expect(applied.ok).toBe(false);
    expect(await store.userData.count({ userId: 'deleted-user' })).toBe(0);
  });

  it('blocks migration while an account-deletion job exists', async () => {
    await insertRecord('deleting-user', 'progress', 'v1', SAMPLE.progress);
    await store.accountDeletions.insertOne({
      userId: 'deleting-user',
      status: 'running',
      startedAt: NOW,
      updatedAt: NOW,
      attempts: 1,
      failedCollection: null,
      deletedCounts: {},
    });

    const report = await inspectUserDataMigration(store, { userIds: ['deleting-user'] });
    expect(report.status).toBe('blocked');
    expect(JSON.stringify(report.globalIssues)).toMatch(/deletion job/i);
    expect(await store.userData.count({ userId: 'deleting-user' })).toBe(0);
  });

  it('removes a record copied when the account is deleted mid-copy', async () => {
    await insertRecord('race-user', 'progress', 'v1', SAMPLE.progress);
    const originalInsert = store.userData.insertOne.bind(store.userData);
    store.userData.insertOne = async (doc) => {
      const saved = await originalInsert(doc);
      await store.accounts.deleteMany({ userId: 'race-user' });
      return saved;
    };

    const result = await applyUserDataMigration(store, { userIds: ['race-user'] });
    store.userData.insertOne = originalInsert;

    expect(result.status).toBe('incomplete');
    expect(result.ok).toBe(false);
    expect(await store.userData.count({ userId: 'race-user' })).toBe(0);
  });

  it('blocks the whole run when a legacy record has no valid owner', async () => {
    await insertRecord('user-a', 'progress', 'v1', SAMPLE.progress);
    await store.data('progress').insertOne({
      key: 'ownerless',
      value: SAMPLE.progress,
      updatedAt: NOW,
      order: 99,
    });

    const report = await inspectUserDataMigration(store);
    expect(report.status).toBe('blocked');
    expect(report.globalIssues).toHaveLength(1);
    expect(report.globalIssues[0]).toMatchObject({ collection: 'lq_data_progress', key: 'ownerless' });
    expect(JSON.stringify(report)).not.toContain(SECRET_NOTE);

    const applied = await applyUserDataMigration(store);
    expect(applied.status).toBe('blocked');
    expect(applied.applied.copied).toBe(0);
    expect(await store.userData.count({})).toBe(0);
  });

  it('rejects invalid scope and batch options', async () => {
    await expect(inspectUserDataMigration(store, { batchSize: 0 })).rejects.toThrow(/batchSize/);
    await expect(inspectUserDataMigration(store, { batchSize: 5_001 })).rejects.toThrow(/batchSize/);
    await expect(inspectUserDataMigration(store, { userIds: [] })).rejects.toThrow(/at least one/);
    await expect(inspectUserDataMigration(store, { userIds: [''] })).rejects.toThrow(/non-empty/);
    await expect(inspectUserDataMigration(store, { domains: [] })).rejects.toThrow(/At least one/);
    await expect(inspectUserDataMigration(store, {
      domains: ['not-a-domain' as UserCollectionName],
    })).rejects.toThrow(/Unknown migration domain/);
  });
});
