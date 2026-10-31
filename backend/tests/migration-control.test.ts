import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDb } from '../src/db/memoryAdapter.js';
import { createDataStore, USER_COLLECTIONS, type DataStore, type UserCollectionName } from '../src/store.js';
import {
  MIGRATION_FENCE_ID,
  MIGRATION_FORWARD_DIRECTION,
  MIGRATION_REVERSE_DIRECTION,
  acquireMigrationFence,
  assertLearningDataWritable,
  drainAccountWriters,
  getMigrationStatus,
  readMigrationFence,
  releaseMigrationFence,
  runStorageSmokeTest,
  writeMigrationJournal,
} from '../src/services/migrationControl.js';
import { replaceUserCollection } from '../src/services/userData.js';
import {
  applyReverseUserDataMigration,
  inspectReverseUserDataMigration,
} from '../src/services/userDataReverseMigration.js';
import { USER_DATA_MIGRATION_ID } from '../src/services/userDataMigration.js';

const NOW = '2026-10-31T00:00:00.000Z';
const PROGRESS = {
  playlistId: 'PLphase24migration0001',
  position: 1,
  videoId: 'v1',
  status: 'done',
  completedAt: NOW,
  notes: 'Phase 24 migration evidence',
};

let store: DataStore;

beforeEach(() => {
  store = createDataStore(createMemoryDb());
});

async function seedAccount(userId: string): Promise<void> {
  if (await store.accounts.findOne({ userId })) return;
  await store.accounts.insertOne({ userId, status: 'active' });
}

async function seedUnifiedProgress(userId: string, notes = PROGRESS.notes): Promise<void> {
  await seedAccount(userId);
  await store.userData.insertOne({
    userId,
    domain: 'progress',
    key: 'v1',
    value: { ...PROGRESS, notes },
    updatedAt: NOW,
    order: 0,
  });
}

async function seedLegacyProgress(userId: string, notes = PROGRESS.notes): Promise<void> {
  await seedAccount(userId);
  await store.data('progress').insertOne({
    userId,
    key: 'v1',
    value: { ...PROGRESS, notes },
    updatedAt: NOW,
    order: 0,
  });
}

describe('durable migration fence', () => {
  it('is visible through the repository and blocks every learning write', async () => {
    const fence = await acquireMigrationFence(store, {
      migrationId: USER_DATA_MIGRATION_ID,
      direction: MIGRATION_FORWARD_DIRECTION,
      sourceStore: 'legacy',
      targetStore: 'unified',
      domains: ['progress'],
    });
    expect(fence.phase).toBe('frozen');
    expect((await readMigrationFence(store))?.generation).toBe(fence.generation);
    await expect(assertLearningDataWritable(store)).rejects.toMatchObject({
      status: 503,
      code: 'MIGRATION_READ_ONLY',
    });
    await expect(replaceUserCollection(store, 'user-a', 'progress', { v1: PROGRESS }, 0))
      .rejects.toMatchObject({ code: 'MIGRATION_READ_ONLY' });
    expect(await store.data('progress').count({})).toBe(0);
    expect(await store.userData.count({})).toBe(0);
  });

  it('refuses a second process while a fence is frozen and reuses it after release', async () => {
    const first = await acquireMigrationFence(store, {
      migrationId: USER_DATA_MIGRATION_ID,
      direction: MIGRATION_FORWARD_DIRECTION,
      sourceStore: 'legacy',
      targetStore: 'unified',
      domains: ['progress'],
    });
    await expect(acquireMigrationFence(store, {
      migrationId: USER_DATA_MIGRATION_ID,
      direction: MIGRATION_FORWARD_DIRECTION,
      sourceStore: 'legacy',
      targetStore: 'unified',
      domains: ['progress'],
    })).rejects.toMatchObject({ code: 'MIGRATION_FENCE_ACTIVE' });
    const smoke = await runStorageSmokeTest(store, 'legacy');
    expect(smoke.passed).toBe(true);
    const released = await releaseMigrationFence(store, {
      migrationId: USER_DATA_MIGRATION_ID,
      reason: 'aborted',
      smoke,
    });
    expect(released.phase).toBe('released');
    expect(released.releaseReason).toBe('aborted');
    await expect(assertLearningDataWritable(store)).resolves.toBeUndefined();
    const second = await acquireMigrationFence(store, {
      migrationId: USER_DATA_MIGRATION_ID,
      direction: MIGRATION_REVERSE_DIRECTION,
      sourceStore: 'unified',
      targetStore: 'legacy',
      domains: ['progress'],
    });
    expect(second.phase).toBe('frozen');
    expect(second.generation).not.toBe(first.generation);
    const status = await getMigrationStatus(store, USER_DATA_MIGRATION_ID, MIGRATION_REVERSE_DIRECTION);
    expect(status.fence?.direction).toBe(MIGRATION_REVERSE_DIRECTION);
  });

  it('drains a live write lease and recovers a stale crashed lease', async () => {
    await store.accounts.insertOne({ userId: 'live', status: 'active', writeLease: 1, writeLeaseAt: new Date().toISOString() });
    await store.accounts.insertOne({
      userId: 'stale',
      status: 'active',
      writeLease: 1,
      writeLeaseAt: new Date(Date.now() - 120_000).toISOString(),
    });
    let released = false;
    const drain = drainAccountWriters(store, { timeoutMs: 2_000, pollMs: 20 });
    setTimeout(async () => {
      await store.accounts.updateOne({ userId: 'live' }, { $set: { writeLease: 0, writeLeaseAt: null } });
      released = true;
    }, 60);
    const result = await drain;
    expect(released).toBe(true);
    expect(result.activeWriters).toBe(0);
    expect(result.staleLeasesReset).toBe(1);
    expect((await store.accounts.findOne({ userId: 'stale' }))?.writeLease).toBe(0);
  });
});

describe('controlled reverse migration', () => {
  it('copies a Unified-only write into Legacy and verifies parity', async () => {
    await seedUnifiedProgress('user-a');
    const before = await inspectReverseUserDataMigration(store, { userIds: ['user-a'] });
    expect(before.status).toBe('ready');
    expect(before.totals.pendingKeys).toBe(1);
    expect(before.totals.destinationDocuments).toBe(0);

    const applied = await applyReverseUserDataMigration(store, { userIds: ['user-a'] });
    expect(applied.status).toBe('applied');
    expect(applied.ok).toBe(true);
    expect(applied.applied.copied).toBe(1);
    expect(applied.after?.totals.pendingKeys).toBe(0);
    expect(applied.after?.totals.destinationOnlyKeys).toBe(0);
    expect(applied.after?.checksums.source).toBe(applied.after?.checksums.matchedDestination);
    expect(await store.data('progress').count({ userId: 'user-a' })).toBe(1);

    const resumed = await applyReverseUserDataMigration(store, { userIds: ['user-a'] });
    expect(resumed.status).toBe('applied');
    expect(resumed.applied.copied + resumed.applied.updated).toBe(0);
    expect(resumed.applied.resumedDomains).toBeGreaterThan(0);
  });

  it('replaces a changed Legacy record with the authoritative Unified value', async () => {
    await seedUnifiedProgress('user-a', 'unified value');
    await seedLegacyProgress('user-a', 'legacy stale value');
    const dryRun = await inspectReverseUserDataMigration(store, { userIds: ['user-a'] });
    expect(dryRun.status).toBe('ready');
    expect(dryRun.totals.conflicts).toBe(1);

    const applied = await applyReverseUserDataMigration(store, { userIds: ['user-a'] });
    expect(applied.status).toBe('applied');
    expect(applied.applied.updated).toBe(1);
    expect((await store.data('progress').findOne({ userId: 'user-a', key: 'v1' }))?.value?.notes)
      .toBe('unified value');
  });

  it('blocks on a stale Legacy-only record unless explicit removal is authorized', async () => {
    await seedUnifiedProgress('user-a');
    await store.data('progress').insertOne({
      userId: 'user-a', key: 'legacy-only', value: { ...PROGRESS, videoId: 'v2', position: 2 }, updatedAt: NOW, order: 2,
    });
    const blocked = await inspectReverseUserDataMigration(store, { userIds: ['user-a'] });
    expect(blocked.status).toBe('blocked');
    expect(blocked.totals.destinationOnlyKeys).toBe(1);
    const noWrite = await applyReverseUserDataMigration(store, { userIds: ['user-a'] });
    expect(noWrite.status).toBe('blocked');
    expect(await store.data('progress').count({ userId: 'user-a', key: 'legacy-only' })).toBe(1);

    const allowed = await inspectReverseUserDataMigration(store, {
      userIds: ['user-a'],
      allowStaleDestinationRemoval: true,
    });
    expect(allowed.status).toBe('ready');
    const applied = await applyReverseUserDataMigration(store, {
      userIds: ['user-a'],
      allowStaleDestinationRemoval: true,
    });
    expect(applied.status).toBe('applied');
    expect(applied.applied.staleRemoved).toBe(1);
    expect(await store.data('progress').count({ userId: 'user-a', key: 'legacy-only' })).toBe(0);
  });

  it('leaves the fence active when the selected storage smoke test fails', async () => {
    await acquireMigrationFence(store, {
      migrationId: USER_DATA_MIGRATION_ID,
      direction: MIGRATION_REVERSE_DIRECTION,
      sourceStore: 'unified',
      targetStore: 'legacy',
      domains: ['progress'],
    });
    const failed = { passed: false, mode: 'legacy' as const, operations: ['insert'], elapsedMs: 1, error: 'read failed' };
    await expect(releaseMigrationFence(store, {
      migrationId: USER_DATA_MIGRATION_ID,
      reason: 'rollback',
      smoke: failed,
    })).rejects.toMatchObject({ code: 'MIGRATION_SMOKE_FAILED' });
    expect((await readMigrationFence(store))?.phase).toBe('frozen');
  });

  it('refuses a cutover release without a verified full forward journal', async () => {
    await acquireMigrationFence(store, {
      migrationId: USER_DATA_MIGRATION_ID,
      direction: MIGRATION_FORWARD_DIRECTION,
      sourceStore: 'legacy',
      targetStore: 'unified',
      domains: [...USER_COLLECTIONS],
    });
    await writeMigrationJournal(store, {
      migrationId: USER_DATA_MIGRATION_ID,
      direction: MIGRATION_FORWARD_DIRECTION,
      userId: 'user-a',
      domain: 'progress',
      status: 'failed',
      sourceDocuments: 1,
      sourceChecksum: 'checksum-progress',
      matchedKeys: 0,
      pendingKeys: 1,
      destinationOnlyKeys: 0,
      copied: 0,
      verifiedAt: null,
      error: 'verification failed',
    });
    const smoke = { passed: true, mode: 'unified' as const, operations: ['insert', 'read', 'delete'], elapsedMs: 1 };
    await expect(releaseMigrationFence(store, {
      migrationId: USER_DATA_MIGRATION_ID,
      reason: 'cutover',
      smoke,
    })).rejects.toMatchObject({ code: 'MIGRATION_JOURNAL_INCOMPLETE' });
    expect((await readMigrationFence(store))?.phase).toBe('frozen');
  });

  it('refuses a cutover release for a scoped account or domain run', async () => {
    await acquireMigrationFence(store, {
      migrationId: USER_DATA_MIGRATION_ID,
      direction: MIGRATION_FORWARD_DIRECTION,
      sourceStore: 'legacy',
      targetStore: 'unified',
      domains: [...USER_COLLECTIONS],
      userIds: ['user-a'],
    });
    const smoke = { passed: true, mode: 'unified' as const, operations: ['insert', 'read', 'delete'], elapsedMs: 1 };
    await expect(releaseMigrationFence(store, {
      migrationId: USER_DATA_MIGRATION_ID,
      reason: 'cutover',
      smoke,
    })).rejects.toMatchObject({ code: 'MIGRATION_SCOPE_INCOMPLETE' });
    expect((await readMigrationFence(store))?.phase).toBe('frozen');

    const released = await releaseMigrationFence(store, {
      migrationId: USER_DATA_MIGRATION_ID,
      reason: 'aborted',
      smoke: { ...smoke, mode: 'legacy' },
    });
    expect(released.phase).toBe('released');
  });

  it('refuses an aborted release while the application is on the migration target', async () => {
    await acquireMigrationFence(store, {
      migrationId: USER_DATA_MIGRATION_ID,
      direction: MIGRATION_FORWARD_DIRECTION,
      sourceStore: 'legacy',
      targetStore: 'unified',
      domains: [...USER_COLLECTIONS],
      userIds: ['user-a'],
    });
    const targetSmoke = { passed: true, mode: 'unified' as const, operations: ['insert', 'read', 'delete'], elapsedMs: 1 };
    await expect(releaseMigrationFence(store, {
      migrationId: USER_DATA_MIGRATION_ID,
      reason: 'aborted',
      smoke: targetSmoke,
    })).rejects.toMatchObject({ code: 'MIGRATION_SMOKE_MODE_MISMATCH' });
    expect((await readMigrationFence(store))?.phase).toBe('frozen');

    const sourceSmoke = { ...targetSmoke, mode: 'legacy' as const };
    const released = await releaseMigrationFence(store, {
      migrationId: USER_DATA_MIGRATION_ID,
      reason: 'aborted',
      smoke: sourceSmoke,
    });
    expect(released.phase).toBe('released');
  });

  it('refuses a cutover release when the fence direction is reverse', async () => {
    await acquireMigrationFence(store, {
      migrationId: USER_DATA_MIGRATION_ID,
      direction: MIGRATION_REVERSE_DIRECTION,
      sourceStore: 'unified',
      targetStore: 'legacy',
      domains: [...USER_COLLECTIONS],
    });
    const smoke = { passed: true, mode: 'unified' as const, operations: ['insert', 'read', 'delete'], elapsedMs: 1 };
    await expect(releaseMigrationFence(store, {
      migrationId: USER_DATA_MIGRATION_ID,
      reason: 'cutover',
      smoke,
    })).rejects.toMatchObject({ code: 'MIGRATION_DIRECTION_MISMATCH' });
    expect((await readMigrationFence(store))?.phase).toBe('frozen');
  });

  it('releases a cutover only after every account/domain unit is verified', async () => {
    await acquireMigrationFence(store, {
      migrationId: USER_DATA_MIGRATION_ID,
      direction: MIGRATION_FORWARD_DIRECTION,
      sourceStore: 'legacy',
      targetStore: 'unified',
      domains: [...USER_COLLECTIONS],
    });
    for (const [index, domain] of USER_COLLECTIONS.entries()) {
      await writeMigrationJournal(store, {
        migrationId: USER_DATA_MIGRATION_ID,
        direction: MIGRATION_FORWARD_DIRECTION,
        userId: 'user-a',
        domain,
        status: index === 0 ? 'pending' : 'verified',
        sourceDocuments: 1,
        sourceChecksum: `checksum-${domain}`,
        matchedKeys: 1,
        pendingKeys: index === 0 ? 1 : 0,
        destinationOnlyKeys: 0,
        copied: index === 0 ? 0 : 1,
        verifiedAt: index === 0 ? null : NOW,
      });
    }
    const smoke = { passed: true, mode: 'unified' as const, operations: ['insert', 'read', 'delete'], elapsedMs: 1 };
    await expect(releaseMigrationFence(store, {
      migrationId: USER_DATA_MIGRATION_ID,
      reason: 'cutover',
      smoke,
    })).rejects.toMatchObject({ code: 'MIGRATION_JOURNAL_INCOMPLETE' });
    expect((await readMigrationFence(store))?.phase).toBe('frozen');

    await writeMigrationJournal(store, {
      migrationId: USER_DATA_MIGRATION_ID,
      direction: MIGRATION_FORWARD_DIRECTION,
      userId: 'user-a',
      domain: USER_COLLECTIONS[0],
      status: 'verified',
      sourceDocuments: 1,
      sourceChecksum: `checksum-${USER_COLLECTIONS[0]}`,
      matchedKeys: 1,
      pendingKeys: 0,
      destinationOnlyKeys: 0,
      copied: 1,
      verifiedAt: NOW,
    });
    const released = await releaseMigrationFence(store, {
      migrationId: USER_DATA_MIGRATION_ID,
      reason: 'cutover',
      smoke,
    });
    expect(released.phase).toBe('released');
    expect(released.releaseReason).toBe('cutover');
    await expect(assertLearningDataWritable(store)).resolves.toBeUndefined();
  });

  it('keeps journal entries payload-free and resumable per account/domain', async () => {
    await seedUnifiedProgress('user-a');
    await applyReverseUserDataMigration(store, { userIds: ['user-a'] });
    const entries = await store.migrationJournal.find({
      migrationId: USER_DATA_MIGRATION_ID,
      direction: MIGRATION_REVERSE_DIRECTION,
    });
    const progress = entries.find((entry) => entry.userId === 'user-a' && entry.domain === 'progress');
    expect(progress?.status).toBe('verified');
    expect(progress?.sourceChecksum).toBeTruthy();
    expect(JSON.stringify(progress)).not.toContain('Phase 24 migration evidence');
    expect(JSON.stringify(progress)).not.toContain('notes');
  });

  it('detects a Unified source mutation during reverse copy and reports incomplete', async () => {
    await seedUnifiedProgress('user-a');
    const originalInsert = store.data('progress').insertOne.bind(store.data('progress'));
    let changed = false;
    store.data('progress').insertOne = async (doc) => {
      const saved = await originalInsert(doc);
      if (!changed) {
        changed = true;
        await store.userData.deleteMany({ userId: 'user-a' });
      }
      return saved;
    };
    const applied = await applyReverseUserDataMigration(store, { userIds: ['user-a'] });
    store.data('progress').insertOne = originalInsert;
    expect(applied.status).toBe('incomplete');
    expect(applied.ok).toBe(false);
    expect(applied.error).toMatch(/changed during/i);
  });
});

describe('20-domain inventory contract', () => {
  it('the fence can name every logical domain and no extra domain is needed', async () => {
    const domains: UserCollectionName[] = [
      'playlists', 'meta', 'progress', 'ranges', 'checkpoints', 'modules', 'sessions',
      'goals', 'xp', 'achievements', 'segments', 'playSessions', 'queue', 'flexGoals',
      'challenge', 'challengeEnabled', 'rankHistory', 'settings', 'prefs', 'activeId',
    ];
    expect(domains).toHaveLength(20);
    const fence = await acquireMigrationFence(store, {
      migrationId: USER_DATA_MIGRATION_ID,
      direction: MIGRATION_FORWARD_DIRECTION,
      sourceStore: 'legacy',
      targetStore: 'unified',
      domains,
    });
    expect(fence._id).toBe(MIGRATION_FENCE_ID);
    expect(fence.domains).toEqual(domains);
  });
});
