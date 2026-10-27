import { MongoClient, type Db, type Collection, type Filter, type Document } from 'mongodb';
import { env } from '../config/env.js';
import type { CollectionAdapter, DbAdapter, Doc, FindOptions, UpdateResult } from './adapter.js';

class MongoCollection implements CollectionAdapter {
  constructor(private readonly c: Collection<Document>) {}

  async findOne(query: Doc): Promise<Doc | null> {
    return (await this.c.findOne(query as Filter<Document>)) as Doc | null;
  }

  async find(query: Doc, opts?: FindOptions): Promise<Doc[]> {
    let cursor = this.c.find(query as Filter<Document>);
    if (opts?.sort) cursor = cursor.sort(opts.sort);
    if (opts?.skip) cursor = cursor.skip(opts.skip);
    if (opts?.limit !== undefined) cursor = cursor.limit(opts.limit);
    return (await cursor.toArray()) as Doc[];
  }

  async insertOne(doc: Doc): Promise<Doc> {
    const r = await this.c.insertOne(doc as Document);
    return { ...doc, _id: r.insertedId };
  }

  async updateOne(query: Doc, update: Doc, opts?: { upsert?: boolean }): Promise<UpdateResult> {
    const r = await this.c.updateOne(query as Filter<Document>, update as Document, { upsert: Boolean(opts?.upsert) });
    return { matchedCount: r.matchedCount, modifiedCount: r.modifiedCount };
  }

  async findOneAndUpdate(query: Doc, update: Doc, opts?: { upsert?: boolean }): Promise<Doc | null> {
    return (await this.c.findOneAndUpdate(query as Filter<Document>, update as Document, {
      upsert: Boolean(opts?.upsert),
      returnDocument: 'after',
    })) as Doc | null;
  }

  async deleteOne(query: Doc): Promise<number> {
    return (await this.c.deleteOne(query as Filter<Document>)).deletedCount ?? 0;
  }

  async deleteMany(query: Doc): Promise<number> {
    return (await this.c.deleteMany(query as Filter<Document>)).deletedCount ?? 0;
  }

  async count(query: Doc): Promise<number> {
    return this.c.countDocuments(query as Filter<Document>);
  }
}

export function createMongoAdapter(db: Db): DbAdapter {
  return {
    collection(name: string): CollectionAdapter {
      return new MongoCollection(db.collection(name));
    },
  };
}

let clientPromise: Promise<MongoClient> | null = null;
let dbPromise: Promise<Db> | null = null;
let indexesPromise: Promise<void> | null = null;

/** Safe description for logs: never includes credentials or query strings. */
export function mongoTargetDescription(): string {
  return env.mongodbConfigured ? `database "${env.mongodbDbName}"` : 'not configured';
}

/**
 * Pending Google registrations store `usernameNormalized: null` until
 * onboarding. A legacy `unique + sparse` index indexes null (sparse skips only
 * missing fields), so a second pending account would collide on null. A
 * partial index that indexes only strings permits many pending accounts while
 * keeping the username uniqueness guarantee. Existing deployments need the old
 * index replaced once; the data itself is not modified.
 */
async function ensureUsernameIndex(db: Db): Promise<void> {
  const accounts = db.collection('lq_accounts');
  let indexes: Document[] = [];
  try {
    indexes = await accounts.listIndexes().toArray();
  } catch (e: unknown) {
    // NamespaceNotFound means this is the first connection to a new database;
    // createIndex below will create the collection.
    if ((e as { code?: number })?.code !== 26) throw e;
  }
  const existing = indexes.find((index) => {
    const key = index.key as Record<string, unknown> | undefined;
    return key && Object.keys(key).length === 1 && key.usernameNormalized === 1;
  });
  const partial = existing?.partialFilterExpression as
    { usernameNormalized?: { $type?: unknown } } | undefined;
  const alreadyPartial = partial?.usernameNormalized?.$type === 'string';
  if (existing && !alreadyPartial) {
    try {
      await accounts.dropIndex(String(existing.name));
    } catch (e: unknown) {
      // A concurrent deploy may have replaced it already; the createIndex
      // below is idempotent when the options now match.
      if ((e as { code?: number })?.code !== 27) throw e;
    }
  }
  await accounts.createIndex(
    { usernameNormalized: 1 },
    { unique: true, partialFilterExpression: { usernameNormalized: { $type: 'string' } } },
  );
}

async function ensureIndexes(db: Db): Promise<void> {
  await ensureUsernameIndex(db);
  await Promise.all([
    db.collection('lq_accounts').createIndex({ googleSub: 1 }, { unique: true, sparse: true }),
    db.collection('lq_accounts').createIndex({ emailNormalized: 1 }, { unique: true }),
    db.collection('lq_sessions').createIndex({ tokenHash: 1 }, { unique: true }),
    db.collection('lq_sessions').createIndex({ userId: 1, revokedAt: 1 }),
    db.collection('lq_sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    // Legacy lq_challenges / lq_reset_grants documents are intentionally left
    // untouched for a non-destructive rollout. New email action links use the
    // collection below and never write numeric codes or reset grants.
    db.collection('lq_action_tokens').createIndex({ tokenHash: 1 }, { unique: true }),
    db.collection('lq_action_tokens').createIndex({ userId: 1, purpose: 1, consumedAt: 1 }),
    db.collection('lq_action_tokens').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('lq_oauth_states').createIndex({ stateHash: 1 }, { unique: true }),
    db.collection('lq_oauth_states').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('lq_deletions').createIndex({ userId: 1, playlistId: 1 }, { unique: true }),
    db.collection('lq_migrations').createIndex({ userId: 1, migrationId: 1 }, { unique: true }),
    db.collection('lq_state_versions').createIndex({ userId: 1 }, { unique: true }),
  ]);
  // One compound unique index for every per-user record collection.
  const names = [
    'playlists', 'meta', 'progress', 'ranges', 'checkpoints', 'modules', 'sessions',
    'goals', 'xp', 'achievements', 'segments', 'playSessions', 'queue', 'flexGoals',
    'challenge', 'challengeEnabled', 'rankHistory', 'settings', 'prefs', 'activeId',
  ];
  await Promise.all(names.map((n) =>
    db.collection(`lq_data_${n}`).createIndex({ userId: 1, key: 1 }, { unique: true }),
  ));
  // User-scoped lookup/cascade indexes.
  await Promise.all([
    db.collection('lq_data_progress').createIndex({ userId: 1, playlistId: 1 }),
    db.collection('lq_data_sessions').createIndex({ userId: 1, playlistId: 1 }),
    db.collection('lq_data_sessions').createIndex({ userId: 1, order: -1 }),
    db.collection('lq_data_segments').createIndex({ userId: 1, playlistId: 1 }),
    db.collection('lq_data_playSessions').createIndex({ userId: 1, playlistId: 1 }),
    db.collection('lq_data_checkpoints').createIndex({ userId: 1, playlistId: 1 }),
    db.collection('lq_data_ranges').createIndex({ userId: 1, playlistId: 1 }),
    db.collection('lq_data_modules').createIndex({ userId: 1, playlistId: 1 }),
    db.collection('lq_data_flexGoals').createIndex({ userId: 1, playlistId: 1 }),
    db.collection('lq_data_xp').createIndex({ userId: 1, order: -1 }),
  ]);
}

/** Lazily connect once and reuse the driver's pool. */
export async function getMongoDb(): Promise<Db> {
  if (!env.mongodbConfigured) {
    throw Object.assign(new Error('MongoDB is not configured. Set MONGODB_URI and MONGODB_DB_NAME.'), { status: 503, code: 'SETUP_REQUIRED' });
  }
  if (!dbPromise) {
    clientPromise = MongoClient.connect(env.mongodbUri, {
      serverSelectionTimeoutMS: 5_000,
      connectTimeoutMS: 5_000,
      maxPoolSize: 10,
      retryWrites: true,
    });
    dbPromise = clientPromise.then((client) => client.db(env.mongodbDbName));
  }
  const db = await dbPromise;
  if (!indexesPromise) indexesPromise = ensureIndexes(db);
  await indexesPromise;
  return db;
}

let defaultAdapter: DbAdapter | null = null;

/** Production adapter. Connection is opened on first repository call. */
export function getMongoAdapter(): DbAdapter {
  if (!defaultAdapter) {
    defaultAdapter = {
      collection(name: string): CollectionAdapter {
        const lazy = {
          async findOne(query: Doc) { return (await getMongoDb()).collection(name).findOne(query as Filter<Document>) as Promise<Doc | null>; },
          async find(query: Doc, opts?: FindOptions) {
            let c = (await getMongoDb()).collection(name).find(query as Filter<Document>);
            if (opts?.sort) c = c.sort(opts.sort);
            if (opts?.skip) c = c.skip(opts.skip);
            if (opts?.limit !== undefined) c = c.limit(opts.limit);
            return (await c.toArray()) as Doc[];
          },
          async insertOne(doc: Doc) {
            const r = await (await getMongoDb()).collection(name).insertOne(doc as Document);
            return { ...doc, _id: r.insertedId };
          },
          async updateOne(query: Doc, update: Doc, opts?: { upsert?: boolean }): Promise<UpdateResult> {
            const r = await (await getMongoDb()).collection(name).updateOne(query as Filter<Document>, update as Document, { upsert: Boolean(opts?.upsert) });
            return { matchedCount: r.matchedCount, modifiedCount: r.modifiedCount };
          },
          async findOneAndUpdate(query: Doc, update: Doc, opts?: { upsert?: boolean }) {
            return (await (await getMongoDb()).collection(name).findOneAndUpdate(query as Filter<Document>, update as Document, {
              upsert: Boolean(opts?.upsert), returnDocument: 'after',
            })) as Doc | null;
          },
          async deleteOne(query: Doc) {
            return (await (await getMongoDb()).collection(name).deleteOne(query as Filter<Document>)).deletedCount ?? 0;
          },
          async deleteMany(query: Doc) {
            return (await (await getMongoDb()).collection(name).deleteMany(query as Filter<Document>)).deletedCount ?? 0;
          },
          async count(query: Doc) {
            return (await getMongoDb()).collection(name).countDocuments(query as Filter<Document>);
          },
        } satisfies CollectionAdapter;
        return lazy;
      },
    };
  }
  return defaultAdapter;
}

export async function closeMongo(): Promise<void> {
  const client = clientPromise ? await clientPromise.catch(() => null) : null;
  await client?.close();
  clientPromise = null;
  dbPromise = null;
  indexesPromise = null;
  defaultAdapter = null;
}
