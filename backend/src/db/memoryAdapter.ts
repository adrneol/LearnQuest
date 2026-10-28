import { randomUUID } from 'node:crypto';
import {
  applyUpdate,
  matchesQuery,
  sortDocs,
  type CollectionAdapter,
  type DbAdapter,
  type Doc,
  type FindOptions,
  type UpdateResult,
} from './adapter.js';

/**
 * Match MongoDB's immutable `_id` behavior. The previous fake silently accepted
 * a `$set` containing `_id`, which hid a production-only onboarding failure
 * ("would modify the immutable field '_id'").
 */
function assertMutableUpdate(update: Doc): void {
  const set = update.$set && typeof update.$set === 'object' && !Array.isArray(update.$set)
    ? update.$set
    : update;
  if (Object.prototype.hasOwnProperty.call(set, '_id')) {
    throw Object.assign(
      new Error("Performing an update on the path '_id' would modify the immutable field '_id'"),
      { code: 66, codeName: 'ImmutableField' },
    );
  }
}

/**
 * Test-only in-memory adapter. A copy is created per `createMemoryDb()` call;
 * no module-level state is shared between test files or app instances.
 */
class MemoryCollection implements CollectionAdapter {
  private docs: Doc[] = [];

  async findOne(query: Doc): Promise<Doc | null> {
    const hit = this.docs.find((d) => matchesQuery(d, query));
    return hit ? structuredClone(hit) : null;
  }

  async find(query: Doc, opts?: FindOptions): Promise<Doc[]> {
    let out = this.docs.filter((d) => matchesQuery(d, query));
    out = sortDocs(out, opts?.sort);
    if (opts?.skip) out = out.slice(opts.skip);
    if (opts?.limit !== undefined) out = out.slice(0, opts.limit);
    return out.map((d) => structuredClone(d));
  }

  async insertOne(doc: Doc): Promise<Doc> {
    const copy = structuredClone({ _id: doc._id ?? randomUUID(), ...doc });
    this.docs.push(copy);
    return structuredClone(copy);
  }

  async updateOne(query: Doc, update: Doc, opts?: { upsert?: boolean }): Promise<UpdateResult> {
    assertMutableUpdate(update);
    const idx = this.docs.findIndex((d) => matchesQuery(d, query));
    if (idx < 0) {
      if (!opts?.upsert) return { matchedCount: 0, modifiedCount: 0 };
      const base = applyUpdate({ ...query }, update, true);
      const copy = structuredClone({ _id: randomUUID(), ...base });
      this.docs.push(copy);
      return { matchedCount: 0, modifiedCount: 0 };
    }
    this.docs[idx] = structuredClone(applyUpdate(this.docs[idx], update));
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async findOneAndUpdate(query: Doc, update: Doc, opts?: { upsert?: boolean }): Promise<Doc | null> {
    assertMutableUpdate(update);
    const idx = this.docs.findIndex((d) => matchesQuery(d, query));
    if (idx < 0) {
      if (!opts?.upsert) return null;
      const base = applyUpdate({ ...query }, update, true);
      const copy = structuredClone({ _id: randomUUID(), ...base });
      this.docs.push(copy);
      return structuredClone(copy);
    }
    this.docs[idx] = structuredClone(applyUpdate(this.docs[idx], update));
    return structuredClone(this.docs[idx]);
  }

  async deleteOne(query: Doc): Promise<number> {
    const idx = this.docs.findIndex((d) => matchesQuery(d, query));
    if (idx < 0) return 0;
    this.docs.splice(idx, 1);
    return 1;
  }

  async deleteMany(query: Doc): Promise<number> {
    const before = this.docs.length;
    this.docs = this.docs.filter((d) => !matchesQuery(d, query));
    return before - this.docs.length;
  }

  async count(query: Doc): Promise<number> {
    return this.docs.filter((d) => matchesQuery(d, query)).length;
  }
}

export function createMemoryDb(): DbAdapter {
  const collections = new Map<string, CollectionAdapter>();
  const adapter: DbAdapter = {
    collection(name: string): CollectionAdapter {
      let c = collections.get(name);
      if (!c) {
        c = new MemoryCollection();
        collections.set(name, c);
      }
      return c;
    },
    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
      // Test equivalent of a MongoDB transaction: snapshot every collection,
      // run the callback against the same adapter, and restore the snapshot if
      // anything throws. This makes failure-path tests meaningful instead of
      // relying on a best-effort application-level rollback.
      const namesBefore = new Set(collections.keys());
      const snapshot = new Map<string, Doc[]>();
      for (const [name, collection] of collections) {
        snapshot.set(name, await collection.find({}));
      }
      const transactionAdapter: DbAdapter = {
        collection: (name: string) => adapter.collection(name),
        dropCollection: (name: string) => adapter.dropCollection!(name),
        close: () => adapter.close!(),
      };
      try {
        return await fn(transactionAdapter);
      } catch (error) {
        for (const name of [...collections.keys()]) {
          if (!namesBefore.has(name)) {
            collections.delete(name);
            continue;
          }
          const collection = collections.get(name);
          const docs = snapshot.get(name) ?? [];
          if (!collection) continue;
          await collection.deleteMany({});
          for (const doc of docs) await collection.insertOne(doc);
        }
        throw error;
      }
    },
    async dropCollection(name: string) {
      collections.delete(name);
    },
    async close() {
      collections.clear();
    },
  };
  return adapter;
}
