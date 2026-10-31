import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import {
  USER_COLLECTIONS,
  createUnifiedDomainCollection,
  type DataStore,
  type UserCollectionName,
} from '../store.js';
import { WRITE_LEASE_STALE_MS } from '../auth/writeLease.js';

/**
 * Durable, cross-process change control for a Legacy <-> Unified migration.
 *
 * The fence is a single MongoDB document. Every application process reads it
 * before admitting a learning-data mutation, so an in-memory flag is never the
 * authority. The journal is a per-account/per-domain progress record that
 * contains counts and checksums only, never learning payloads.
 */
export const MIGRATION_FENCE_ID = 'active';
export const MIGRATION_FORWARD_DIRECTION = 'forward' as const;
export const MIGRATION_REVERSE_DIRECTION = 'reverse' as const;
export type MigrationDirection = typeof MIGRATION_FORWARD_DIRECTION | typeof MIGRATION_REVERSE_DIRECTION;

export interface MigrationFenceRecord {
  _id?: unknown;
  fenceId: typeof MIGRATION_FENCE_ID;
  migrationId: string;
  direction: MigrationDirection;
  phase: 'frozen' | 'released';
  generation: string;
  sourceStore: 'legacy' | 'unified';
  targetStore: 'legacy' | 'unified';
  domains: UserCollectionName[];
  userIds: string[] | null;
  startedAt: string;
  updatedAt: string;
  releasedAt?: string;
  releaseReason?: 'cutover' | 'rollback' | 'aborted';
  smoke?: StorageSmokeResult;
}

export type MigrationJournalStatus = 'pending' | 'copying' | 'copied' | 'verified' | 'failed';

export interface MigrationJournalRecord {
  _id?: unknown;
  migrationId: string;
  direction: MigrationDirection;
  userId: string;
  domain: UserCollectionName;
  status: MigrationJournalStatus;
  sourceDocuments: number;
  sourceChecksum: string;
  matchedKeys: number;
  pendingKeys: number;
  destinationOnlyKeys: number;
  copied: number;
  attempts: number;
  startedAt: string;
  updatedAt: string;
  verifiedAt: string | null;
  error: string | null;
}

export interface StorageSmokeResult {
  passed: boolean;
  mode: 'legacy' | 'unified';
  operations: string[];
  elapsedMs: number;
  error?: string;
}

function migrationHttpError(
  message: string,
  status: number,
  code: string,
): Error & { status: number; code: string } {
  return Object.assign(new Error(message), { status, code });
}

export async function readMigrationFence(store: DataStore): Promise<MigrationFenceRecord | null> {
  return (await store.migrationControl.findOne({ _id: MIGRATION_FENCE_ID })) as MigrationFenceRecord | null;
}

export async function requireNoActiveMigrationFence(store: DataStore): Promise<void> {
  const fence = await readMigrationFence(store);
  if (!fence || fence.phase === 'released') return;
  throw migrationHttpError(
    'A learning-data storage migration is in progress. Changes are temporarily read-only; no data was changed.',
    503,
    'MIGRATION_READ_ONLY',
  );
}

/**
 * Called by every repository write path and by account deletion. Reads are
 * deliberately allowed so the application can show a truthful read-only state.
 */
export async function assertLearningDataWritable(store: DataStore): Promise<void> {
  await requireNoActiveMigrationFence(store);
}

export interface AcquireMigrationFenceInput {
  migrationId: string;
  direction: MigrationDirection;
  sourceStore: 'legacy' | 'unified';
  targetStore: 'legacy' | 'unified';
  domains: UserCollectionName[];
  userIds?: string[] | null;
  now?: string;
}

/**
 * Acquire the single active fence. A released fence can be reused for a new
 * generation. The document `_id` unique index makes two processes racing for
 * the first acquisition fail closed instead of both believing they own it.
 */
export async function acquireMigrationFence(
  store: DataStore,
  input: AcquireMigrationFenceInput,
): Promise<MigrationFenceRecord> {
  const now = input.now ?? new Date().toISOString();
  const existing = await readMigrationFence(store);
  if (existing && existing.phase !== 'released') {
    throw migrationHttpError(
      `A migration fence is already active (${existing.migrationId}, generation ${existing.generation}).`,
      409,
      'MIGRATION_FENCE_ACTIVE',
    );
  }
  const base: Omit<MigrationFenceRecord, '_id'> = {
    fenceId: MIGRATION_FENCE_ID,
    migrationId: input.migrationId,
    direction: input.direction,
    phase: 'frozen' as const,
    generation: randomUUID(),
    sourceStore: input.sourceStore,
    targetStore: input.targetStore,
    domains: [...input.domains],
    userIds: input.userIds ? [...input.userIds].sort() : null,
    startedAt: now,
    updatedAt: now,
    releasedAt: undefined,
    releaseReason: undefined,
    smoke: undefined,
  };
  if (existing) {
    const updated = await store.migrationControl.findOneAndUpdate(
      { _id: MIGRATION_FENCE_ID, phase: 'released' },
      { $set: base },
    ) as MigrationFenceRecord | null;
    if (!updated) {
      throw migrationHttpError(
        'Another process acquired the migration fence first. No data was changed.',
        409,
        'MIGRATION_FENCE_ACTIVE',
      );
    }
    return updated;
  }
  try {
    await store.migrationControl.insertOne({ _id: MIGRATION_FENCE_ID, ...base });
    return { _id: MIGRATION_FENCE_ID, ...base };
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 11000) {
      throw migrationHttpError(
        'Another process acquired the migration fence first. No data was changed.',
        409,
        'MIGRATION_FENCE_ACTIVE',
      );
    }
    throw error;
  }
}

export interface DrainResult {
  scanned: number;
  activeWriters: number;
  staleLeasesReset: number;
  waitedMs: number;
}

/** Wait for every admitted account writer to release its lease. */
export async function drainAccountWriters(
  store: DataStore,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<DrainResult> {
  const timeoutMs = options.timeoutMs ?? 35_000;
  const pollMs = options.pollMs ?? 100;
  const started = Date.now();
  const deadline = started + timeoutMs;
  let staleLeasesReset = 0;
  for (;;) {
    const accounts = await store.accounts.find({ writeLease: { $gt: 0 } });
    let activeWriters = 0;
    for (const account of accounts) {
      const leaseAt = Date.parse(String(account.writeLeaseAt ?? ''));
      const stale = !Number.isFinite(leaseAt) || Date.now() - leaseAt > WRITE_LEASE_STALE_MS;
      if (!stale) {
        activeWriters += 1;
        continue;
      }
      const reset = await store.accounts.updateOne(
        { userId: account.userId, writeLease: { $gt: 0 } },
        { $set: { writeLease: 0, writeLeaseAt: null } },
      );
      if (reset.modifiedCount > 0) staleLeasesReset += 1;
    }
    if (activeWriters === 0) {
      return {
        scanned: accounts.length,
        activeWriters: 0,
        staleLeasesReset,
        waitedMs: Date.now() - started,
      };
    }
    if (Date.now() >= deadline) {
      throw migrationHttpError(
        `${activeWriters} account write(s) are still in progress. The migration fence remains active; no snapshot was taken.`,
        503,
        'MIGRATION_DRAIN_TIMEOUT',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/**
 * Read/write smoke test against the selected repository shape. It uses an
 * isolated random owner id and removes its record in `finally`; no real account
 * or learning record is read or changed. This proves adapter reachability, not
 * an end-to-end browser request.
 */
export async function runStorageSmokeTest(
  store: DataStore,
  mode: 'legacy' | 'unified' = env.userDataStore,
): Promise<StorageSmokeResult> {
  const started = Date.now();
  const operations: string[] = [];
  const userId = `migration-smoke-${randomUUID()}`;
  const collection = mode === 'unified'
    ? createUnifiedDomainCollection(store.userData, 'settings')
    : store.data('settings');
  const value = { verifiedThreshold: 0.9 };
  let inserted = false;
  try {
    await collection.insertOne({
      userId,
      key: 'singleton',
      value,
      updatedAt: new Date().toISOString(),
      order: 0,
    });
    inserted = true;
    operations.push('insert');
    const read = await collection.findOne({ userId, key: 'singleton' });
    if (!read || (read.value as { verifiedThreshold?: unknown } | null)?.verifiedThreshold !== 0.9) {
      throw new Error('The smoke record could not be read back exactly.');
    }
    operations.push('read');
    return { passed: true, mode, operations, elapsedMs: Date.now() - started };
  } catch (error) {
    return {
      passed: false,
      mode,
      operations,
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? error.message : 'Storage smoke test failed.',
    };
  } finally {
    if (inserted) {
      try {
        await collection.deleteOne({ userId, key: 'singleton' });
        operations.push('delete');
      } catch {
        // A failed cleanup is still reported: `passed` is only true when the
        // insert/read path succeeded, but the caller sees the operation list.
      }
    }
  }
}

export interface ReleaseMigrationFenceInput {
  migrationId: string;
  reason: 'cutover' | 'rollback' | 'aborted';
  /** Smoke evidence for the mode that will now serve the application. */
  smoke?: StorageSmokeResult;
  now?: string;
}

function expectedReleaseDirection(reason: ReleaseMigrationFenceInput['reason']): MigrationDirection | null {
  if (reason === 'cutover') return MIGRATION_FORWARD_DIRECTION;
  if (reason === 'rollback') return MIGRATION_REVERSE_DIRECTION;
  return null;
}

function expectedReleaseStore(reason: ReleaseMigrationFenceInput['reason']): 'legacy' | 'unified' | null {
  if (reason === 'cutover') return 'unified';
  if (reason === 'rollback') return 'legacy';
  return null;
}

/**
 * A cutover/rollback release is evidence-gated, not a generic fence release.
 * Aborting an incomplete attempt remains possible, but it may never be used to
 * expose a store that was only partially migrated:
 *
 *   - the fence must have the direction and target the reason implies;
 *   - the run must cover every account and all 20 logical domains;
 *   - every journal entry for that direction must be verified;
 *   - the CLI additionally re-inspects live source/destination parity.
 */
async function assertReleaseEvidence(
  store: DataStore,
  fence: MigrationFenceRecord,
  reason: ReleaseMigrationFenceInput['reason'],
): Promise<void> {
  const direction = expectedReleaseDirection(reason);
  const target = expectedReleaseStore(reason);
  if (!direction || !target) return;

  if (fence.direction !== direction || fence.targetStore !== target) {
    throw migrationHttpError(
      `A ${reason} release requires a ${direction} fence targeting ${target}. `
      + `The active fence is ${fence.direction} -> ${fence.targetStore}; nothing was released.`,
      409,
      'MIGRATION_DIRECTION_MISMATCH',
    );
  }
  if (fence.userIds !== null) {
    throw migrationHttpError(
      `A ${reason} release requires a full-account migration. The active fence is scoped to `
      + `${fence.userIds.length} account(s); release it as aborted after resolving the scope.`,
      409,
      'MIGRATION_SCOPE_INCOMPLETE',
    );
  }
  const missingDomains = USER_COLLECTIONS.filter((domain) => !fence.domains.includes(domain));
  if (fence.domains.length !== USER_COLLECTIONS.length || missingDomains.length > 0) {
    throw migrationHttpError(
      `A ${reason} release requires all ${USER_COLLECTIONS.length} logical domains. `
      + `Missing: ${missingDomains.join(', ') || '(duplicate/unknown domain list)'}. Nothing was released.`,
      409,
      'MIGRATION_DOMAINS_INCOMPLETE',
    );
  }
  const journal = await readMigrationJournal(store, fence.migrationId, direction);
  const notVerified = journal.filter((entry) => entry.status !== 'verified');
  if (notVerified.length > 0) {
    const sample = notVerified
      .slice(0, 5)
      .map((entry) => `${entry.userId}/${entry.domain}=${entry.status}`)
      .join(', ');
    throw migrationHttpError(
      `The ${direction} migration journal contains ${notVerified.length} account/domain unit(s) that are not verified `
      + `(${sample}). The fence remains active; resume the migration or release it as aborted.`,
      409,
      'MIGRATION_JOURNAL_INCOMPLETE',
    );
  }
}

/**
 * Release the fence only after the selected repository can read and write.
 * Callers must switch the deployment mode first, then run this in the new
 * process/environment. A failed smoke test leaves the fence active.
 *
 * `cutover` and `rollback` additionally require a full-scope forward or reverse
 * journal whose every account/domain unit is verified. The operator CLI also
 * re-inspects live parity before calling this function.
 */
export async function releaseMigrationFence(
  store: DataStore,
  input: ReleaseMigrationFenceInput,
): Promise<MigrationFenceRecord> {
  const now = input.now ?? new Date().toISOString();
  const smoke = input.smoke ?? await runStorageSmokeTest(store);
  if (!smoke.passed) {
    throw migrationHttpError(
      `The ${smoke.mode} storage smoke test did not pass. The migration fence remains active and writes stay blocked.`,
      503,
      'MIGRATION_SMOKE_FAILED',
    );
  }
  const expectedStore = expectedReleaseStore(input.reason);
  if (expectedStore && smoke.mode !== expectedStore) {
    throw migrationHttpError(
      `A ${input.reason} release requires a passing ${expectedStore} smoke test, but the supplied evidence is for ${smoke.mode}. `
      + 'Nothing was released.',
      409,
      'MIGRATION_SMOKE_MODE_MISMATCH',
    );
  }
  const existing = await readMigrationFence(store);
  if (!existing) {
    throw migrationHttpError('No migration fence exists to release.', 409, 'MIGRATION_FENCE_MISSING');
  }
  if (existing.migrationId !== input.migrationId) {
    throw migrationHttpError(
      'The active migration fence belongs to a different migration. Nothing was released.',
      409,
      'MIGRATION_FENCE_MISMATCH',
    );
  }
  if (existing.phase === 'released') {
    return existing;
  }
  // Aborting is only safe while the application still serves the fence source.
  // Releasing an incomplete forward run after switching to Unified would bless
  // a partially copied destination; the operator must switch back first.
  if (input.reason === 'aborted' && smoke.mode !== existing.sourceStore) {
    throw migrationHttpError(
      `An aborted release must run on the fence source store (${existing.sourceStore}); `
      + `the supplied smoke evidence is for ${smoke.mode}. Nothing was released.`,
      409,
      'MIGRATION_SMOKE_MODE_MISMATCH',
    );
  }
  await assertReleaseEvidence(store, existing, input.reason);
  const updated = await store.migrationControl.findOneAndUpdate(
    { _id: MIGRATION_FENCE_ID, phase: 'frozen', migrationId: input.migrationId },
    {
      $set: {
        phase: 'released',
        releasedAt: now,
        updatedAt: now,
        releaseReason: input.reason,
        smoke,
      },
    },
  ) as MigrationFenceRecord | null;
  if (!updated) {
    throw migrationHttpError(
      'The migration fence changed before it could be released. Reload the status; writes may still be blocked.',
      409,
      'MIGRATION_FENCE_CHANGED',
    );
  }
  return updated;
}

export function journalKey(
  migrationId: string,
  direction: MigrationDirection,
  userId: string,
  domain: UserCollectionName,
): Record<string, unknown> {
  return { migrationId, direction, userId, domain };
}

export async function readMigrationJournal(
  store: DataStore,
  migrationId: string,
  direction: MigrationDirection,
): Promise<MigrationJournalRecord[]> {
  return (await store.migrationJournal.find(
    { migrationId, direction },
    { sort: { userId: 1, domain: 1 } },
  )) as MigrationJournalRecord[];
}

export interface JournalPatch {
  migrationId: string;
  direction: MigrationDirection;
  userId: string;
  domain: UserCollectionName;
  status: MigrationJournalStatus;
  sourceDocuments: number;
  sourceChecksum: string;
  matchedKeys: number;
  pendingKeys: number;
  destinationOnlyKeys: number;
  copied: number;
  verifiedAt?: string | null;
  error?: string | null;
}

/** Counts/checksums only; never stores record values, emails, or tokens. */
export async function writeMigrationJournal(
  store: DataStore,
  patch: JournalPatch,
): Promise<MigrationJournalRecord> {
  const key = journalKey(patch.migrationId, patch.direction, patch.userId, patch.domain);
  const existing = await store.migrationJournal.findOne(key) as MigrationJournalRecord | null;
  const now = new Date().toISOString();
  await store.migrationJournal.updateOne(
    key,
    {
      $set: {
        ...key,
        status: patch.status,
        sourceDocuments: patch.sourceDocuments,
        sourceChecksum: patch.sourceChecksum,
        matchedKeys: patch.matchedKeys,
        pendingKeys: patch.pendingKeys,
        destinationOnlyKeys: patch.destinationOnlyKeys,
        copied: patch.copied,
        updatedAt: now,
        verifiedAt: patch.verifiedAt ?? null,
        error: patch.error ?? null,
      },
      $setOnInsert: { startedAt: now },
      $inc: { attempts: existing ? 0 : 1 },
    },
    { upsert: true },
  );
  const saved = await store.migrationJournal.findOne(key) as MigrationJournalRecord | null;
  if (!saved) throw new Error('The migration journal entry could not be read after writing it.');
  return saved;
}

export interface MigrationStatus {
  fence: MigrationFenceRecord | null;
  journal: {
    total: number;
    verified: number;
    copied: number;
    pending: number;
    failed: number;
  };
}

export async function getMigrationStatus(
  store: DataStore,
  migrationId: string,
  direction: MigrationDirection,
): Promise<MigrationStatus> {
  const fence = await readMigrationFence(store);
  const journal = await readMigrationJournal(store, migrationId, direction);
  return {
    fence,
    journal: {
      total: journal.length,
      verified: journal.filter((entry) => entry.status === 'verified').length,
      copied: journal.filter((entry) => entry.status === 'copied').length,
      pending: journal.filter((entry) => entry.status === 'pending' || entry.status === 'copying').length,
      failed: journal.filter((entry) => entry.status === 'failed').length,
    },
  };
}
