/**
 * Tiny database adapter used by the account/learning-data repositories.
 *
 * Production uses MongoDB. Automated tests use the in-memory adapter from
 * `memoryAdapter.ts`; both share the exact same repository logic and query
 * operators so ownership and cascade behaviour are testable without a live
 * cluster. The adapter deliberately supports only the small query surface the
 * repositories use (equality, $in, $ne, range, $exists).
 */

export type Doc = Record<string, any>;

export interface FindOptions {
  sort?: Record<string, 1 | -1>;
  limit?: number;
  skip?: number;
}

export interface UpdateResult {
  matchedCount: number;
  modifiedCount: number;
}

export interface CollectionAdapter {
  findOne(query: Doc): Promise<Doc | null>;
  find(query: Doc, opts?: FindOptions): Promise<Doc[]>;
  insertOne(doc: Doc): Promise<Doc>;
  updateOne(query: Doc, update: Doc, opts?: { upsert?: boolean }): Promise<UpdateResult>;
  findOneAndUpdate(query: Doc, update: Doc, opts?: { upsert?: boolean }): Promise<Doc | null>;
  deleteOne(query: Doc): Promise<number>;
  deleteMany(query: Doc): Promise<number>;
  count(query: Doc): Promise<number>;
}

export interface DbAdapter {
  collection(name: string): CollectionAdapter;
  /**
   * Run a set of operations atomically when the backend supports it. MongoDB
   * uses a multi-document transaction; the in-memory test adapter snapshots and
   * restores its collections. Callers must not treat this as optional for
   * destructive multi-collection imports unless they can prove an equivalent
   * staged recovery protocol.
   */
  transaction?<T>(fn: (adapter: DbAdapter) => Promise<T>): Promise<T>;
  /** Optional destructive maintenance capability used only by the explicit retirement CLI. */
  dropCollection?(name: string): Promise<void>;
  close?(): Promise<void>;
}

export function isOperatorObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function matchesQuery(doc: Doc, query: Doc): boolean {
  for (const [field, expected] of Object.entries(query)) {
    const actual = doc[field];
    if (isOperatorObject(expected)) {
      for (const [op, operand] of Object.entries(expected)) {
        if (op === '$in' && Array.isArray(operand)) {
          if (!operand.some((v) => v === actual)) return false;
        } else if (op === '$ne') {
          if (actual === operand) return false;
        } else if (op === '$exists') {
          if ((actual !== undefined) !== Boolean(operand)) return false;
        } else if (op === '$lt') {
          if (!((actual as any) < (operand as any))) return false;
        } else if (op === '$lte') {
          if (!((actual as any) <= (operand as any))) return false;
        } else if (op === '$gt') {
          if (!((actual as any) > (operand as any))) return false;
        } else if (op === '$gte') {
          if (!((actual as any) >= (operand as any))) return false;
        } else {
          return false;
        }
      }
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

export function applyUpdate(doc: Doc, update: Doc, inserting = false): Doc {
  const set = isOperatorObject(update.$set) ? update.$set : update;
  const inc = isOperatorObject(update.$inc) ? update.$inc : null;
  const setOnInsert = inserting && isOperatorObject(update.$setOnInsert) ? update.$setOnInsert : null;
  const next: Doc = { ...doc, ...set, ...(setOnInsert ?? {}) };
  if (inc) {
    for (const [key, amount] of Object.entries(inc)) {
      next[key] = (typeof next[key] === 'number' ? next[key] : 0) + Number(amount);
    }
  }
  return next;
}

export function sortDocs(docs: Doc[], sort?: Record<string, 1 | -1>): Doc[] {
  if (!sort) return docs;
  const entries = Object.entries(sort);
  return [...docs].sort((a, b) => {
    for (const [field, dir] of entries) {
      const av = a[field];
      const bv = b[field];
      if (av === bv) continue;
      if (av === undefined || av === null) return dir === 1 ? -1 : 1;
      if (bv === undefined || bv === null) return dir === 1 ? 1 : -1;
      return (av < bv ? -1 : 1) * dir;
    }
    return 0;
  });
}
