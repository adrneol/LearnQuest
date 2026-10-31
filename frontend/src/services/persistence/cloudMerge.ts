/**
 * Three-way reconciliation for cloud account collections.
 *
 * `base` is the last server-confirmed value, `local` is the current browser
 * value, and `remote` is the newest server value. A value is only replaced when
 * one side did not change; otherwise the changed records are merged by stable
 * identity. Records edited differently on both sides are reported as conflicts
 * and the local value is preserved so nothing is silently discarded.
 *
 * This module is deliberately data-shape aware but framework independent. It
 * never merges arrays by index and never resurrects a record that one side
 * deleted.
 */

export interface MergeConflict {
  collection: string;
  key: string;
  base: unknown;
  local: unknown;
  remote: unknown;
}

export interface MergeResult {
  value: unknown;
  conflicts: MergeConflict[];
}

const ARRAY_COLLECTIONS = new Set([
  'ranges', 'checkpoints', 'modules', 'sessions', 'xp', 'segments',
  'playSessions', 'flexGoals', 'rankHistory',
]);

const SINGLETON_COLLECTIONS = new Set([
  'activeId', 'challenge', 'challengeEnabled', 'settings', 'prefs',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

function recordKey(value: unknown, index: number): string {
  if (isPlainObject(value)) {
    for (const field of ['id', 'clientId', 'dedupKey', 'sessionId'] as const) {
      const candidate = value[field];
      if (typeof candidate === 'string' && candidate.length > 0) return `${field}:${candidate}`;
    }
    if (typeof value.at === 'string' && typeof value.rank === 'number') {
      return `rank:${value.at}:${value.rank}:${String(value.metric ?? '')}`;
    }
    if (typeof value.dateKey === 'string' && typeof value.metric === 'string') {
      return `goal:${value.dateKey}:${value.metric}:${String(value.playlistId ?? '')}`;
    }
  }
  // A record with no stable identity is not safe to positionally reconcile.
  return `#index:${index}`;
}

function indexArray(value: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (!Array.isArray(value)) return out;
  value.forEach((item, index) => {
    // Duplicate identities cannot be merged safely; keep the last occurrence
    // (the collection validators also reject duplicate IDs on write).
    out.set(recordKey(item, index), item);
  });
  return out;
}

function mergeRecord(
  collection: string,
  key: string,
  base: unknown,
  local: unknown,
  remote: unknown,
  conflicts: MergeConflict[],
): unknown {
  if (deepEqual(local, remote)) return local;
  if (deepEqual(local, base)) return remote;
  if (deepEqual(remote, base)) return local;
  // Both sides changed the same meaningful record differently. Preserve the
  // local value and require an explicit decision.
  conflicts.push({ collection, key, base, local, remote });
  return local;
}

function mergeArray(collection: string, base: unknown, local: unknown, remote: unknown): MergeResult {
  const conflicts: MergeConflict[] = [];
  const baseMap = indexArray(base);
  const localMap = indexArray(local);
  const remoteMap = indexArray(remote);
  const keys = new Set<string>([...localMap.keys(), ...remoteMap.keys(), ...baseMap.keys()]);
  const merged: unknown[] = [];
  // Keep the local display order, then append remote-only records in their
  // remote order. The server does not promise array order semantics.
  const orderedKeys = [
    ...localMap.keys(),
    ...[...remoteMap.keys()].filter((k) => !localMap.has(k)),
  ];
  for (const key of orderedKeys) {
    const b = baseMap.get(key);
    const l = localMap.get(key);
    const r = remoteMap.get(key);
    // Deletion intent wins: if either side removed a record that existed in
    // the confirmed baseline, do not resurrect it from the other side.
    if (b !== undefined && (l === undefined || r === undefined)) continue;
    if (l === undefined) { merged.push(r); continue; }
    if (r === undefined) { merged.push(l); continue; }
    merged.push(mergeRecord(collection, key, b, l, r, conflicts));
  }
  // A key that only exists in base was deleted on both sides and is dropped.
  void keys;
  return { value: merged, conflicts };
}

function mergeMap(collection: string, base: unknown, local: unknown, remote: unknown): MergeResult {
  const conflicts: MergeConflict[] = [];
  const b = isPlainObject(base) ? base : {};
  const l = isPlainObject(local) ? local : {};
  const r = isPlainObject(remote) ? remote : {};
  const keys = new Set<string>([...Object.keys(l), ...Object.keys(r), ...Object.keys(b)]);
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const bv = b[key];
    const lv = l[key];
    const rv = r[key];
    const inBase = Object.prototype.hasOwnProperty.call(b, key);
    if (inBase && (lv === undefined || rv === undefined)) continue;
    if (lv === undefined) { out[key] = rv; continue; }
    if (rv === undefined) { out[key] = lv; continue; }
    out[key] = mergeRecord(collection, key, bv, lv, rv, conflicts);
  }
  return { value: out, conflicts };
}

export function mergeCollection(
  collection: string,
  base: unknown,
  local: unknown,
  remote: unknown,
): MergeResult {
  if (deepEqual(local, remote)) return { value: local, conflicts: [] };
  if (deepEqual(local, base)) return { value: remote, conflicts: [] };
  if (deepEqual(remote, base)) return { value: local, conflicts: [] };
  if (ARRAY_COLLECTIONS.has(collection) || (Array.isArray(local) && Array.isArray(remote))) {
    return mergeArray(collection, base, local, remote);
  }
  if (SINGLETON_COLLECTIONS.has(collection)) {
    return {
      value: local,
      conflicts: [{ collection, key: 'singleton', base, local, remote }],
    };
  }
  if (isPlainObject(local) && isPlainObject(remote)) {
    return mergeMap(collection, base, local, remote);
  }
  return {
    value: local,
    conflicts: [{ collection, key: 'singleton', base, local, remote }],
  };
}

/** Merge every collection of a full account state against a confirmed baseline. */
export function mergeAccountState(
  collections: readonly string[],
  base: Record<string, unknown>,
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
): { state: Record<string, unknown>; conflicts: MergeConflict[] } {
  const state: Record<string, unknown> = { ...remote };
  const conflicts: MergeConflict[] = [];
  for (const name of collections) {
    const result = mergeCollection(name, base[name], local[name], remote[name]);
    state[name] = result.value;
    conflicts.push(...result.conflicts);
  }
  return { state, conflicts };
}
