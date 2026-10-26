import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'learnquest-db';
// v2: additive — same kv store plus new keys (segments, playSessions, queue,
// flexGoals, challenge*, rankHistory, settings). Existing v1 keys are preserved
// untouched by the upgrade; export a JSON backup (Reports) before major updates.
const DB_VERSION = 2;
const STORE = 'kv';

let dbp: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbp) {
    dbp = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      },
    });
  }
  return dbp;
}

/**
 * Read one key. A storage read failure is NOT an empty database: it rejects so
 * callers can stop before defaults overwrite existing data.
 */
export async function kvGet<T>(key: string): Promise<T | undefined> {
  const d = await db();
  return (await d.get(STORE, key)) as T | undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const d = await db();
  await d.put(STORE, value, key);
}

export async function kvDel(key: string): Promise<void> {
  const d = await db();
  await d.delete(STORE, key);
}

export async function kvClearAll(): Promise<void> {
  const d = await db();
  await d.clear(STORE);
}

export async function kvDump(): Promise<Record<string, unknown>> {
  const d = await db();
  const keys = await d.getAllKeys(STORE);
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    out[String(k)] = await d.get(STORE, k);
  }
  return out;
}

/**
 * All-or-nothing replacement of the whole key/value store. A restore either
 * commits every validated key in one IndexedDB transaction or leaves the
 * previous state untouched.
 */
export async function kvReplaceAll(data: Record<string, unknown>): Promise<void> {
  const d = await db();
  const tx = d.transaction(STORE, 'readwrite');
  try {
    const store = tx.objectStore(STORE);
    await store.clear();
    for (const [key, value] of Object.entries(data)) {
      await store.put(value, key);
    }
  } catch (err) {
    // A failed put (for example, a non-cloneable value) must roll back the
    // clear and every write before it, not just reject after committing them.
    try { tx.abort(); } catch { /* already aborted/finished */ }
    try { await tx.done; } catch { /* expected AbortError */ }
    throw err;
  }
  await tx.done;
}
