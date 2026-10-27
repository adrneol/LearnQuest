import type { DataStore } from '../store.js';
import { ACCOUNT_LEARNING_COLLECTIONS } from '../store.js';
import { http, type Account } from '../auth/accounts.js';

/**
 * Account deletion is a resumable saga, not a single document delete.
 *
 * Validation (authenticated session, recent reauthentication, current
 * Argon2id password where one exists, exact confirmation phrase, CSRF and
 * origin) happens in the route before this service is called. The service then:
 *   1. marks the account `deleting` (blocks new authentication and writes),
 *   2. persists a minimal operational job,
 *   3. removes every account-scoped record from every known collection,
 *   4. verifies zero ownership counts,
 *   5. deletes the account document,
 *   6. verifies that too, removes the job, and verifies the final state.
 *
 * Every step is idempotent. If a step fails, the job stays behind with a
 * failure marker and the account remains unavailable; a later startup sweep can
 * finish the same operation. Success is never returned before verification.
 */
export const ACCOUNT_DELETION_JOB_COLLECTION = 'lq_account_deletions';

/**
 * Collections that store an account-owned `userId`. Legacy collections are
 * included deliberately: a partially migrated deployment can contain data in
 * both the per-domain and consolidated layouts.
 */
export const ACCOUNT_SCOPED_COLLECTIONS = [
  ...ACCOUNT_LEARNING_COLLECTIONS,
  'lq_sessions',
  'lq_action_tokens',
  'lq_challenges',
  'lq_reset_grants',
  'lq_oauth_states',
  'lq_migrations',
  'lq_state_versions',
  'lq_deletions',
] as const;

export interface AccountDeletionJob {
  userId: string;
  status: 'running' | 'failed';
  startedAt: string;
  updatedAt: string;
  attempts: number;
  failedCollection: string | null;
  deletedCounts: Record<string, number>;
  verification?: Record<string, number>;
}

export interface AccountDeletionResult {
  deleted: true;
  verification: Record<string, number>;
  deletedCounts: Record<string, number>;
}

function incomplete(message: string): Error & { status: number; code?: string } {
  return http(503, message, 'ACCOUNT_DELETION_INCOMPLETE');
}

async function setJob(
  store: DataStore,
  userId: string,
  patch: Partial<AccountDeletionJob> & { status: AccountDeletionJob['status'] },
): Promise<void> {
  const now = new Date().toISOString();
  await store.accountDeletions.updateOne(
    { userId },
    {
      $set: {
        userId,
        startedAt: patch.startedAt ?? now,
        updatedAt: now,
        failedCollection: patch.failedCollection ?? null,
        deletedCounts: patch.deletedCounts ?? {},
        ...(patch.verification ? { verification: patch.verification } : {}),
        status: patch.status,
      },
      $inc: { attempts: 1 },
    },
    { upsert: true },
  );
}

/** Counts must all be zero; the object is the evidence returned to the caller. */
async function verifyAccountAbsent(store: DataStore, userId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const name of ACCOUNT_SCOPED_COLLECTIONS) {
    counts[name] = await store.adapter.collection(name).count({ userId });
  }
  counts[ACCOUNT_DELETION_JOB_COLLECTION] = await store.accountDeletions.count({ userId });
  counts.lq_accounts = await store.accounts.count({ userId });
  return counts;
}

function assertAbsent(counts: Record<string, number>): void {
  const remaining = Object.entries(counts).filter(([, count]) => count > 0);
  if (remaining.length > 0) {
    const names = remaining.map(([name]) => name).join(', ');
    throw incomplete(`Account deletion is incomplete; records remain in: ${names}. The account is still unavailable and cleanup will be retried.`);
  }
}

async function finalizeDeletion(store: DataStore, userId: string): Promise<AccountDeletionResult> {
  const existingJob = (await store.accountDeletions.findOne({ userId })) as AccountDeletionJob | null;
  const job = existingJob ?? {
    userId,
    status: 'running' as const,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    attempts: 0,
    failedCollection: null,
    deletedCounts: {},
  };
  await setJob(store, userId, {
    status: 'running',
    startedAt: job.startedAt,
    failedCollection: null,
    deletedCounts: job.deletedCounts ?? {},
  });

  // Revoke all sessions before touching learning records. The account status is
  // already `deleting`, so even an in-flight request cannot create a new one.
  const counts: Record<string, number> = { ...(job.deletedCounts ?? {}) };
  let currentCollection: string | null = null;

  try {
    for (const name of ACCOUNT_SCOPED_COLLECTIONS) {
      currentCollection = name;
      counts[name] = (counts[name] ?? 0) + await store.adapter.collection(name).deleteMany({ userId });
      await setJob(store, userId, {
        status: 'running',
        startedAt: job.startedAt,
        deletedCounts: counts,
      });
    }
    currentCollection = 'verification';

    // Data must be gone before the account identity is removed. If this check
    // fails, keep both the account marker and job so the owner can retry.
    const dataVerification = await verifyAccountAbsent(store, userId);
    // The account and job are expected to still exist at this point.
    const onlyExpected = Object.entries(dataVerification)
      .filter(([name]) => name !== 'lq_accounts' && name !== ACCOUNT_DELETION_JOB_COLLECTION)
      .every(([, count]) => count === 0);
    if (!onlyExpected) assertAbsent(Object.fromEntries(
      Object.entries(dataVerification).filter(([name]) => name !== 'lq_accounts' && name !== ACCOUNT_DELETION_JOB_COLLECTION),
    ));

    counts.lq_accounts = (counts.lq_accounts ?? 0) + await store.accounts.deleteMany({ userId });
    await setJob(store, userId, {
      status: 'running',
      startedAt: job.startedAt,
      deletedCounts: counts,
    });

    // The job is the last account-owned record. Remove it only after the
    // account and every data collection are verified empty.
    const beforeJobRemoval = await verifyAccountAbsent(store, userId);
    const jobOnly = Object.fromEntries(
      Object.entries(beforeJobRemoval).filter(([name]) => name !== ACCOUNT_DELETION_JOB_COLLECTION),
    );
    assertAbsent(jobOnly);

    await store.accountDeletions.deleteMany({ userId });

    const finalCounts = await verifyAccountAbsent(store, userId);
    assertAbsent(finalCounts);

    return {
      deleted: true,
      verification: finalCounts,
      deletedCounts: counts,
    };
  } catch (error) {
    const failedCollection = currentCollection;
    try {
      await setJob(store, userId, {
        status: 'failed',
        startedAt: job.startedAt,
        failedCollection,
        deletedCounts: counts,
      });
    } catch {
      // The original failure is the actionable error; a job write failure is
      // surfaced as the same incomplete deletion, never as success.
    }
    if ((error as { code?: string })?.code === 'ACCOUNT_DELETION_INCOMPLETE') throw error;
    throw incomplete('Account deletion did not finish. The account remains unavailable; cleanup is pending and can be retried safely.');
  }
}

/**
 * Begin or resume the deletion of one already-authenticated account.
 * Callers must have completed every destructive-action validation first.
 */
export async function deleteAccountPermanently(store: DataStore, userId: string): Promise<AccountDeletionResult> {
  const account = (await store.accounts.findOne({ userId })) as Account | null;
  if (!account && !(await store.accountDeletions.findOne({ userId }))) {
    throw http(404, 'This account no longer exists.', 'NOT_FOUND');
  }
  if (account && account.status === 'active') {
    const marked = await store.accounts.updateOne(
      { userId, status: 'active' },
      { $set: { status: 'deleting', updatedAt: new Date().toISOString() } },
    );
    if (marked.matchedCount === 0) {
      const current = (await store.accounts.findOne({ userId })) as Account | null;
      if (current?.status !== 'deleting') {
        throw http(409, 'This account changed state before deletion could begin. Nothing was deleted.', 'ACCOUNT_UNAVAILABLE');
      }
    }
  } else if (account && account.status !== 'deleting') {
    throw http(409, 'This account is unavailable for deletion.', 'ACCOUNT_UNAVAILABLE');
  }

  try {
    return await finalizeDeletion(store, userId);
  } catch (error) {
    // If the very first job write failed before anything was removed, restore
    // access only when the account document still exists and no job remains.
    if (account?.status === 'active') {
      try {
        const stillThere = await store.accounts.findOne({ userId });
        const job = await store.accountDeletions.findOne({ userId });
        if (stillThere && !job) {
          await store.accounts.updateOne({ userId, status: 'deleting' }, { $set: { status: 'active', updatedAt: new Date().toISOString() } });
        }
      } catch {
        // Keep the failure closed.
      }
    }
    throw error;
  }
}

/**
 * Startup/maintenance sweep for jobs left by a process crash or transient
 * database failure. Only accounts already marked `deleting` (or jobs whose
 * account document is already gone) are touched; an active account is never
 * deleted by this path.
 */
export async function resumePendingAccountDeletions(store: DataStore): Promise<{ attempted: number; completed: number; failed: number }> {
  const [accounts, jobs] = await Promise.all([
    store.accounts.find({ status: 'deleting' }),
    store.accountDeletions.find({}),
  ]);
  const ids = new Set<string>();
  for (const account of accounts) if (typeof account.userId === 'string') ids.add(account.userId);
  for (const job of jobs) if (typeof job.userId === 'string') ids.add(job.userId);

  let completed = 0;
  let failed = 0;
  for (const userId of ids) {
    try {
      const account = (await store.accounts.findOne({ userId })) as Account | null;
      if (account && account.status === 'active') continue;
      await finalizeDeletion(store, userId);
      completed += 1;
    } catch {
      failed += 1;
    }
  }
  return { attempted: completed + failed, completed, failed };
}
