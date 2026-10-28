import type { DataStore } from '../store.js';
import { ACCOUNT_RESIDUE_COLLECTIONS } from '../store.js';
import { httpError } from '../services/userData.js';

/**
 * Account write admission and deletion fencing.
 *
 * Account deletion must not race an authenticated request that already passed
 * `requireAuth`. The account document is the single admission authority:
 *
 *   - a writer atomically increments `writeLease` only while `status` is
 *     `active`;
 *   - deletion atomically changes `status` to `deleting`, so no new lease can
 *     be acquired;
 *   - deletion waits for every already-admitted lease to drain before removing
 *     data;
 *   - a short-lived fence record rejects/cleans any residual late write.
 *
 * The lease uses the account document rather than a separate distributed lock
 * so a single atomic MongoDB update is the cross-instance authority. A slotted
 * heartbeat keeps a legitimately long import from being mistaken for a crash;
 * a crashed process's lease becomes stale and is recovered by deletion or the
 * startup sweep.
 */
export const WRITE_LEASE_STALE_MS = 30_000;
const HEARTBEAT_MS = 5_000;
const DRAIN_TIMEOUT_MS = 35_000;
const FENCE_TTL_MS = 60 * 60_000;

export interface AccountWriteLease {
  release(): Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function leaseExpired(account: Record<string, unknown> | null): boolean {
  const at = Date.parse(String(account?.writeLeaseAt ?? ''));
  return !Number.isFinite(at) || Date.now() - at > WRITE_LEASE_STALE_MS;
}

export async function acquireAccountWriteLease(store: DataStore, userId: string): Promise<AccountWriteLease> {
  const now = new Date().toISOString();
  const admitted = await store.accounts.findOneAndUpdate(
    { userId, status: 'active' },
    { $inc: { writeLease: 1 }, $set: { writeLeaseAt: now } },
  );
  if (!admitted) {
    throw httpError(
      'This account is unavailable for changes. Sign in again or contact the account owner.',
      409,
      'ACCOUNT_UNAVAILABLE',
    );
  }

  let released = false;
  const heartbeat = setInterval(() => {
    void store.accounts.updateOne(
      { userId, writeLease: { $gt: 0 } },
      { $set: { writeLeaseAt: new Date().toISOString() } },
    ).catch(() => undefined);
  }, HEARTBEAT_MS);
  const unref = (heartbeat as { unref?: () => void }).unref;
  if (typeof unref === 'function') unref.call(heartbeat);

  return {
    async release(): Promise<void> {
      if (released) return;
      released = true;
      clearInterval(heartbeat);
      try {
        await store.accounts.updateOne(
          { userId, writeLease: { $gt: 0 } },
          { $inc: { writeLease: -1 }, $set: { writeLeaseAt: new Date().toISOString() } },
        );
      } catch {
        // The lease becomes stale and is recovered by the next deletion/sweep.
        // Never turn a completed request into a false failure because cleanup
        // of the admission counter was temporarily unreachable.
      }
    },
  };
}

/**
 * Wait until no admitted writer remains. Stale counters from a crashed process
 * are reset only after the heartbeat window has elapsed, so a live long-running
 * import is not cut off.
 */
export async function waitForAccountWriters(store: DataStore, userId: string): Promise<void> {
  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const account = await store.accounts.findOne({ userId });
    if (!account) return;
    const count = Number(account.writeLease ?? 0);
    if (count <= 0) return;
    if (leaseExpired(account)) {
      await store.accounts.updateOne(
        { userId, status: 'deleting', writeLease: { $gt: 0 } },
        { $set: { writeLease: 0, writeLeaseAt: null } },
      );
      return;
    }
    await sleep(50);
  }
  throw httpError(
    'An authenticated write is still in progress. The account remains unavailable and deletion will be retried safely.',
    503,
    'ACCOUNT_WRITE_IN_PROGRESS',
  );
}

/** Run one authenticated mutation under the account admission lease. */
export async function withAccountWriteLease<T>(
  store: DataStore,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lease = await acquireAccountWriteLease(store, userId);
  try {
    return await fn();
  } finally {
    await lease.release();
    // Defense in depth for an unlikely process pause longer than the lease
    // window: if deletion has begun, remove anything this request wrote.
    void purgeIfFenced(store, userId).catch(() => undefined);
  }
}

export async function setAccountDeletionFence(store: DataStore, userId: string): Promise<void> {
  const now = Date.now();
  await store.accountFences.updateOne(
    { userId },
    {
      $set: {
        userId,
        createdAt: new Date(now).toISOString(),
        expireAt: new Date(now + FENCE_TTL_MS),
      },
    },
    { upsert: true },
  );
}

export async function isAccountDeletionFenced(store: DataStore, userId: string): Promise<boolean> {
  return Boolean(await store.accountFences.findOne({ userId }));
}

export async function clearAccountDeletionFence(store: DataStore, userId: string): Promise<void> {
  await store.accountFences.deleteMany({ userId });
}

async function purgeResidue(store: DataStore, userId: string): Promise<void> {
  for (const name of ACCOUNT_RESIDUE_COLLECTIONS) {
    await store.adapter.collection(name).deleteMany({ userId });
  }
}

async function purgeIfFenced(store: DataStore, userId: string): Promise<void> {
  if (await isAccountDeletionFenced(store, userId)) {
    await purgeResidue(store, userId);
  }
}

/**
 * Startup/periodic recovery for late writes. A fence is only ever retained for
 * a deleted/deleting account; if an account was restored to active (failed
 * pre-deletion validation), the fence is removed rather than blocking it.
 */
export async function resumeDeletionFences(store: DataStore): Promise<{ scanned: number; cleaned: number; removed: number }> {
  const fences = await store.accountFences.find({});
  let cleaned = 0;
  let removed = 0;
  for (const fence of fences) {
    const userId = typeof fence.userId === 'string' ? fence.userId : '';
    if (!userId) {
      await store.accountFences.deleteMany({ _id: fence._id });
      continue;
    }
    const account = await store.accounts.findOne({ userId });
    if (account?.status === 'active') {
      await clearAccountDeletionFence(store, userId);
      removed += 1;
      continue;
    }
    await purgeResidue(store, userId);
    cleaned += 1;
  }
  return { scanned: fences.length, cleaned, removed };
}
