import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoClient, type Db, type Document } from 'mongodb';
import { createDirectMongoAdapter } from '../src/db/mongo.js';
import { createDataStore, USER_COLLECTIONS, type DataStore } from '../src/store.js';
import { inspectUserDataMigration } from '../src/services/userDataMigration.js';
import { compareMigrationReports } from '../src/services/migrationReportComparison.js';
import {
  MIGRATION_FIXTURE_DOMAINS,
  MIGRATION_FIXTURE_KEYS,
  MIGRATION_FIXTURE_NOW,
  MIGRATION_FIXTURE_SAMPLE,
} from './fixtures/migrationSample.js';

/**
 * Isolated logical backup/restore rehearsal.
 *
 * This is NOT a mongodump/mongorestore proof. It clones the synthetic source
 * collections into a separate empty database with the MongoDB driver, then
 * proves the restore-comparison tool reproduces every account/domain count and
 * canonical checksum. The production runbook still requires a real database
 * backup/restore artifact before cutover.
 *
 * Runs only with an explicit non-production test URI:
 *   LQ_TEST_MONGO_URI=mongodb://127.0.0.1:27018/?replicaSet=lqp24
 */
const MONGO_URI = process.env.LQ_TEST_MONGO_URI;
const ARTIFACT_DIR = process.env.LQ_TEST_ARTIFACT_DIR;
const SOURCE_DB = 'learnquest_phase24_restore_source';
const TARGET_DB = 'learnquest_phase24_restore_target';
const describeMongo = MONGO_URI ? describe : describe.skip;

let client: MongoClient | null = null;
let sourceDb: Db | null = null;
let targetDb: Db | null = null;

async function seedLegacy(store: DataStore, userId: string, domains: readonly string[]): Promise<void> {
  await store.accounts.insertOne({
    userId,
    status: 'active',
    createdAt: MIGRATION_FIXTURE_NOW,
    onboardingComplete: true,
  });
  for (const domain of domains) {
    await store.data(domain as typeof MIGRATION_FIXTURE_DOMAINS[number]).insertOne({
      userId,
      key: MIGRATION_FIXTURE_KEYS[domain as keyof typeof MIGRATION_FIXTURE_KEYS],
      value: MIGRATION_FIXTURE_SAMPLE[domain as keyof typeof MIGRATION_FIXTURE_SAMPLE],
      updatedAt: MIGRATION_FIXTURE_NOW,
      order: 0,
    });
  }
}

/** Logical copy of the learning/account collections into a separate database. */
async function cloneCollections(from: Db, to: Db): Promise<number> {
  const names = new Set<string>(['lq_accounts']);
  for (const domain of USER_COLLECTIONS) names.add(`lq_data_${domain}`);
  let copied = 0;
  for (const name of names) {
    const docs = await from.collection<Document>(name).find({}).toArray();
    if (docs.length > 0) await to.collection<Document>(name).insertMany(docs);
    copied += docs.length;
  }
  return copied;
}

describeMongo('isolated logical backup/restore rehearsal', () => {
  beforeAll(async () => {
    client = new MongoClient(MONGO_URI!, { serverSelectionTimeoutMS: 5_000 });
    await client.connect();
    sourceDb = client.db(SOURCE_DB);
    targetDb = client.db(TARGET_DB);
    await sourceDb.dropDatabase();
    await targetDb.dropDatabase();
    if (ARTIFACT_DIR) await mkdir(ARTIFACT_DIR, { recursive: true });
  }, 30_000);

  afterAll(async () => {
    if (sourceDb) await sourceDb.dropDatabase().catch(() => undefined);
    if (targetDb) await targetDb.dropDatabase().catch(() => undefined);
    await client?.close().catch(() => undefined);
  });

  it('restores every account/domain count and checksum into an empty database and detects a missing record', async () => {
    expect(sourceDb).not.toBeNull();
    expect(targetDb).not.toBeNull();
    const sourceStore = createDataStore(createDirectMongoAdapter(sourceDb!));
    const restoredStore = createDataStore(createDirectMongoAdapter(targetDb!));

    await seedLegacy(sourceStore, 'restore-user-full', MIGRATION_FIXTURE_DOMAINS);
    // A second account with a deliberately sparse shape proves empty domain
    // units are restored and compared, not synthesized or dropped.
    await seedLegacy(sourceStore, 'restore-user-sparse', MIGRATION_FIXTURE_DOMAINS.slice(0, 3));

    const baseline = await inspectUserDataMigration(sourceStore);
    expect(baseline.status).toBe('ready');
    expect(baseline.totals.sourceDocuments).toBe(23);
    expect(baseline.totals.validSourceKeys).toBe(23);

    const copied = await cloneCollections(sourceDb!, targetDb!);
    expect(copied).toBe(25); // 2 accounts + 23 learning records.

    const restored = await inspectUserDataMigration(restoredStore);
    expect(restored.status).toBe('ready');
    const compared = compareMigrationReports(baseline, restored);
    expect(compared.ok).toBe(true);
    expect(compared.failures).toEqual([]);
    expect(compared.direction).toBe('forward');
    expect(compared.sourceDocuments).toBe(23);
    expect(compared.validSourceKeys).toBe(23);
    expect(compared.comparedUnits).toBe(40);

    if (ARTIFACT_DIR) {
      await writeFile(join(ARTIFACT_DIR, 'restore-baseline.json'), `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
      await writeFile(join(ARTIFACT_DIR, 'restore-restored.json'), `${JSON.stringify(restored, null, 2)}\n`, 'utf8');
      await writeFile(join(ARTIFACT_DIR, 'restore-comparison.json'), `${JSON.stringify(compared, null, 2)}\n`, 'utf8');
    }

    // A restore that loses even one record must fail comparison.
    await targetDb!.collection('lq_data_progress').deleteOne({ userId: 'restore-user-full' });
    const damaged = await inspectUserDataMigration(restoredStore);
    const damagedComparison = compareMigrationReports(baseline, damaged);
    expect(damagedComparison.ok).toBe(false);
    expect(damagedComparison.failures.some((failure) => failure.includes('document count mismatch'))).toBe(true);
    if (ARTIFACT_DIR) {
      await writeFile(join(ARTIFACT_DIR, 'restore-damaged-comparison.json'), `${JSON.stringify(damagedComparison, null, 2)}\n`, 'utf8');
    }
  }, 60_000);
});
