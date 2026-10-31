import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoClient, type Db } from 'mongodb';
import { createDirectMongoAdapter } from '../src/db/mongo.js';
import { createDataStore, type DataStore, type UserCollectionName } from '../src/store.js';
import {
  MIGRATION_FORWARD_DIRECTION,
  MIGRATION_REVERSE_DIRECTION,
  acquireMigrationFence,
  assertLearningDataWritable,
  getMigrationStatus,
  releaseMigrationFence,
  runStorageSmokeTest,
} from '../src/services/migrationControl.js';
import {
  USER_DATA_MIGRATION_ID,
  applyUserDataMigration,
  inspectUserDataMigration,
} from '../src/services/userDataMigration.js';
import {
  applyReverseUserDataMigration,
  inspectReverseUserDataMigration,
} from '../src/services/userDataReverseMigration.js';
import { replaceUserCollection } from '../src/services/userData.js';
import {
  MIGRATION_FIXTURE_DOMAINS as DOMAINS,
  MIGRATION_FIXTURE_KEYS as KEY,
  MIGRATION_FIXTURE_NOW as NOW,
  MIGRATION_FIXTURE_SAMPLE as SAMPLE,
} from './fixtures/migrationSample.js';

/**
 * Isolated MongoDB replica-set rehearsal. This runs only when an explicitly
 * supplied, non-production test URI is present:
 *
 *   LQ_TEST_MONGO_URI=mongodb://127.0.0.1:27018/?replicaSet=lqp24
 *
 * The database name is fixed to a clearly non-production rehearsal name and is
 * dropped before and after the suite. No application environment URI or
 * production database is read.
 */
const MONGO_URI = process.env.LQ_TEST_MONGO_URI;
const DB_NAME = 'learnquest_phase24_rehearsal';
const shouldRun = Boolean(MONGO_URI);
const describeMongo = shouldRun ? describe : describe.skip;

let client: MongoClient | null = null;
let db: Db | null = null;
let store: DataStore;

async function seedAccount(userId: string): Promise<void> {
  if (await store.accounts.findOne({ userId })) return;
  await store.accounts.insertOne({ userId, status: 'active', createdAt: NOW, onboardingComplete: true });
}

async function seedLegacy(userId: string): Promise<void> {
  await seedAccount(userId);
  for (const domain of DOMAINS) {
    await store.data(domain).insertOne({
      userId,
      key: KEY[domain],
      value: SAMPLE[domain],
      updatedAt: NOW,
      order: 0,
    });
  }
}

describeMongo('isolated MongoDB replica-set migration rehearsal', () => {
  beforeAll(async () => {
    client = new MongoClient(MONGO_URI!, { serverSelectionTimeoutMS: 5_000 });
    await client.connect();
    db = client.db(DB_NAME);
    await db.dropDatabase();
    store = createDataStore(createDirectMongoAdapter(db));
    await store.stateVersions.insertOne({ userId: 'unique-index-seed', version: 0, updatedAt: NOW });
    await db.collection('lq_state_versions').createIndex({ userId: 1 }, { unique: true });
  }, 30_000);

  afterAll(async () => {
    if (db) await db.dropDatabase().catch(() => undefined);
    await client?.close().catch(() => undefined);
  });

  it('proves forward parity, real transactions, reverse parity, resume and freeze behavior', async () => {
    expect(db).not.toBeNull();
    await seedLegacy('rehearsal-user-a');

    // Dry run is zero-write.
    const dry = await inspectUserDataMigration(store, { userIds: ['rehearsal-user-a'] });
    expect(dry.status).toBe('ready');
    expect(dry.totals.sourceDocuments).toBe(20);
    expect(await store.userData.count({ userId: 'rehearsal-user-a' })).toBe(0);
    expect(await store.data('progress').count({ userId: 'rehearsal-user-a' })).toBe(1);

    const fence = await acquireMigrationFence(store, {
      migrationId: USER_DATA_MIGRATION_ID,
      direction: MIGRATION_FORWARD_DIRECTION,
      sourceStore: 'legacy',
      targetStore: 'unified',
      domains: DOMAINS as UserCollectionName[],
    });
    expect(fence.phase).toBe('frozen');
    await expect(assertLearningDataWritable(store)).rejects.toMatchObject({ code: 'MIGRATION_READ_ONLY' });
    await expect(replaceUserCollection(store, 'rehearsal-user-a', 'progress', { v1: SAMPLE.progress }, 0))
      .rejects.toMatchObject({ code: 'MIGRATION_READ_ONLY' });

    const applied = await applyUserDataMigration(store, { userIds: ['rehearsal-user-a'] });
    expect(applied.status).toBe('applied');
    expect(applied.ok).toBe(true);
    expect(applied.after?.totals.matchedKeys).toBe(20);
    expect(applied.after?.totals.pendingKeys).toBe(0);
    expect(applied.after?.checksums.source).toBe(applied.after?.checksums.matchedDestination);
    expect(await store.userData.count({ userId: 'rehearsal-user-a' })).toBe(20);
    // Legacy is unchanged.
    expect(await store.data('progress').count({ userId: 'rehearsal-user-a' })).toBe(1);
    expect((await store.data('progress').findOne({ userId: 'rehearsal-user-a' }))?.value?.notes).toBe('rehearsal note');

    const forwardStatus = await getMigrationStatus(store, USER_DATA_MIGRATION_ID, MIGRATION_FORWARD_DIRECTION);
    expect(forwardStatus.journal.verified).toBe(20);

    // Simulate a lost destination record, then re-run: the journal cannot skip
    // a domain whose live destination parity is incomplete.
    await store.userData.deleteOne({ userId: 'rehearsal-user-a', domain: 'progress', key: 'v1' });
    const resumed = await applyUserDataMigration(store, { userIds: ['rehearsal-user-a'] });
    expect(resumed.status).toBe('applied');
    expect(resumed.applied.copied).toBe(1);
    expect(resumed.applied.resumedDomains).toBe(19);

    // Cutover release requires verified full-scope evidence, then rollback
    // acquires a new reverse generation just as the operator runbook does.
    const cutoverSmoke = await runStorageSmokeTest(store, 'unified');
    expect(cutoverSmoke.passed).toBe(true);
    const cutover = await releaseMigrationFence(store, {
      migrationId: USER_DATA_MIGRATION_ID,
      reason: 'cutover',
      smoke: cutoverSmoke,
    });
    expect(cutover.phase).toBe('released');
    expect(cutover.releaseReason).toBe('cutover');
    await assertLearningDataWritable(store);

    await acquireMigrationFence(store, {
      migrationId: USER_DATA_MIGRATION_ID,
      direction: MIGRATION_REVERSE_DIRECTION,
      sourceStore: 'unified',
      targetStore: 'legacy',
      domains: DOMAINS as UserCollectionName[],
    });

    // A Unified-era write must survive a reverse copy into Legacy.
    const unifiedProgress = await store.userData.findOne({
      userId: 'rehearsal-user-a', domain: 'progress', key: 'v1',
    });
    expect(unifiedProgress).not.toBeNull();
    await store.userData.updateOne(
      { userId: 'rehearsal-user-a', domain: 'progress', key: 'v1' },
      { $set: { value: { ...SAMPLE.progress, notes: 'post-cutover unified change' }, updatedAt: '2026-11-01T00:00:00.000Z' } },
    );
    const reverseDry = await inspectReverseUserDataMigration(store, { userIds: ['rehearsal-user-a'] });
    expect(reverseDry.status).toBe('ready');
    expect(reverseDry.totals.conflicts).toBe(1);
    const reversed = await applyReverseUserDataMigration(store, { userIds: ['rehearsal-user-a'] });
    expect(reversed.status).toBe('applied');
    expect(reversed.applied.updated).toBe(1);
    expect((await store.data('progress').findOne({ userId: 'rehearsal-user-a', key: 'v1' }))?.value?.notes)
      .toBe('post-cutover unified change');
    expect(await store.userData.count({ userId: 'rehearsal-user-a' })).toBe(20);
    expect(await store.data('progress').count({ userId: 'rehearsal-user-a' })).toBe(1);

    const reverseStatus = await getMigrationStatus(store, USER_DATA_MIGRATION_ID, MIGRATION_REVERSE_DIRECTION);
    expect(reverseStatus.journal.verified).toBe(20);

    // A real MongoDB transaction works on this replica set after the fence is
    // released, and the fence prevented it beforehand.
    // A rollback release requires Legacy smoke evidence for the mode that will
    // serve the application. The separate Unified read/write path is exercised
    // after the fence is released below.
    const smoke = await runStorageSmokeTest(store, 'legacy');
    expect(smoke.passed).toBe(true);
    const released = await releaseMigrationFence(store, {
      migrationId: USER_DATA_MIGRATION_ID,
      reason: 'rollback',
      smoke,
    });
    expect(released.phase).toBe('released');
    const previousMode = process.env.LQ_USER_DATA_STORE;
    process.env.LQ_USER_DATA_STORE = 'unified';
    try {
      const write = await replaceUserCollection(store, 'rehearsal-user-a', 'progress', {
        v1: { ...SAMPLE.progress, notes: 'transaction verified' },
      }, 0);
      expect(write.version).toBe(1);
      expect((await store.userData.findOne({ userId: 'rehearsal-user-a', domain: 'progress', key: 'v1' }))?.value?.notes)
        .toBe('transaction verified');
    } finally {
      if (previousMode === undefined) delete process.env.LQ_USER_DATA_STORE;
      else process.env.LQ_USER_DATA_STORE = previousMode;
    }
  }, 60_000);
});
