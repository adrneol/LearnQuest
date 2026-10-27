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
    const idx = this.docs.findIndex((d) => matchesQuery(d, query));
    if (idx < 0) {
      if (!opts?.upsert) return { matchedCount: 0, modifiedCount: 0 };
      const base = applyUpdate({ ...query }, update);
      const copy = structuredClone({ _id: randomUUID(), ...base });
      this.docs.push(copy);
      return { matchedCount: 0, modifiedCount: 0 };
    }
    this.docs[idx] = structuredClone(applyUpdate(this.docs[idx], update));
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async findOneAndUpdate(query: Doc, update: Doc, opts?: { upsert?: boolean }): Promise<Doc | null> {
    const idx = this.docs.findIndex((d) => matchesQuery(d, query));
    if (idx < 0) {
      if (!opts?.upsert) return null;
      const base = applyUpdate({ ...query }, update);
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
  return {
    collection(name: string): CollectionAdapter {
      let c = collections.get(name);
      if (!c) {
        c = new MemoryCollection();
        collections.set(name, c);
      }
      return c;
    },
    async close() {
      collections.clear();
    },
  };
}
