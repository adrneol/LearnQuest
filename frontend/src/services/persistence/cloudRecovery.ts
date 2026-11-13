import { deepEqual, mergeCollection, type MergeConflict } from './cloudMerge.js';
import { kvDel, kvGet, kvSet } from './db.js';

export const CLOUD_RECOVERY_VERSION = 1;
export const CLOUD_RECOVERY_MAX_BYTES = 2 * 1024 * 1024;
export const CLOUD_RECOVERY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
/**
 * Collections whose edits can be replayed through the normal three-way merge
 * without creating evidence, rewards, imports, or destructive bulk changes.
 * Event and Arena collections are deliberately excluded: recovering those
 * blindly could duplicate XP/evidence or replace another device's state.
 */
export const CLOUD_RECOVERY_COLLECTIONS = [
  'progress', 'ranges', 'checkpoints', 'modules', 'goals', 'flexGoals', 'settings', 'prefs',
] as const;

export interface CloudRecoveryDraft {
  version: typeof CLOUD_RECOVERY_VERSION;
  userId: string;
  baseVersion: number;
  createdAt: string;
  updatedAt: string;
  collections: Record<string, { base: unknown; local: unknown }>;
}

export class CloudRecoveryError extends Error {
  constructor(public readonly code: 'TOO_LARGE' | 'STORAGE' | 'CORRUPT', message: string) {
    super(message);
  }
}

function key(userId: string): string {
  return `cloud-recovery-v${CLOUD_RECOVERY_VERSION}:${userId}`;
}

function validValue(value: unknown): value is CloudRecoveryDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const draft = value as Record<string, unknown>;
  const createdAt = typeof draft.createdAt === 'string' ? Date.parse(draft.createdAt) : Number.NaN;
  const updatedAt = typeof draft.updatedAt === 'string' ? Date.parse(draft.updatedAt) : Number.NaN;
  if (draft.version !== CLOUD_RECOVERY_VERSION || typeof draft.userId !== 'string' || !draft.userId || draft.userId.length > 256
    || typeof draft.baseVersion !== 'number' || !Number.isSafeInteger(draft.baseVersion) || draft.baseVersion < 0
    || !Number.isFinite(createdAt) || !Number.isFinite(updatedAt) || updatedAt < createdAt
    || !draft.collections || typeof draft.collections !== 'object' || Array.isArray(draft.collections)) return false;
  const collections = draft.collections as Record<string, unknown>;
  if (Object.keys(collections).length === 0) return false;
  if (Object.keys(collections).some((name) => !CLOUD_RECOVERY_COLLECTIONS.includes(name as typeof CLOUD_RECOVERY_COLLECTIONS[number]))) return false;
  return Object.values(collections).every((entry) =>
    !!entry && typeof entry === 'object' && !Array.isArray(entry)
      && Object.hasOwn(entry, 'base') && Object.hasOwn(entry, 'local'));
}

export async function readCloudRecoveryDraft(userId: string): Promise<CloudRecoveryDraft | null> {
  const value = await kvGet<unknown>(key(userId));
  if (value === undefined) return null;
  if (!validValue(value) || value.userId !== userId || Date.now() - Date.parse(value.updatedAt) > CLOUD_RECOVERY_MAX_AGE_MS) {
    await kvDel(key(userId));
    return null;
  }
  return value;
}

export async function writeCloudRecoveryDraft(
  userId: string,
  baseVersion: number,
  baseline: Record<string, unknown>,
  local: Record<string, unknown>,
  collections: readonly string[],
): Promise<CloudRecoveryDraft | null> {
  const changed: CloudRecoveryDraft['collections'] = {};
  for (const name of collections) {
    if (!CLOUD_RECOVERY_COLLECTIONS.includes(name as typeof CLOUD_RECOVERY_COLLECTIONS[number])) continue;
    if (!deepEqual(baseline[name], local[name])) changed[name] = { base: baseline[name], local: local[name] };
  }
  if (Object.keys(changed).length === 0) return null;
  const prior = await readCloudRecoveryDraft(userId);
  const now = new Date().toISOString();
  const draft: CloudRecoveryDraft = {
    version: CLOUD_RECOVERY_VERSION,
    userId,
    baseVersion,
    createdAt: prior?.createdAt ?? now,
    updatedAt: now,
    collections: changed,
  };
  let bytes: number;
  try { bytes = new TextEncoder().encode(JSON.stringify(draft)).byteLength; } catch { throw new CloudRecoveryError('CORRUPT', 'Changes could not be prepared for local recovery.'); }
  if (bytes > CLOUD_RECOVERY_MAX_BYTES) {
    throw new CloudRecoveryError('TOO_LARGE', 'These pending changes are too large for a local recovery copy. Keep this tab open until saving completes.');
  }
  try {
    await kvSet(key(userId), draft);
  } catch {
    throw new CloudRecoveryError('STORAGE', 'The browser could not preserve a local recovery copy. Keep this tab open until saving completes.');
  }
  return draft;
}

export async function discardCloudRecoveryDraft(userId: string): Promise<void> {
  await kvDel(key(userId));
}

export function mergeCloudRecoveryDraft(
  draft: CloudRecoveryDraft,
  remote: Record<string, unknown>,
): { state: Record<string, unknown>; conflicts: MergeConflict[] } {
  const state = { ...remote };
  const conflicts: MergeConflict[] = [];
  for (const [name, change] of Object.entries(draft.collections)) {
    const result = mergeCollection(name, change.base, change.local, remote[name]);
    state[name] = result.value;
    conflicts.push(...result.conflicts);
  }
  return { state, conflicts };
}
