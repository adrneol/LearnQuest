import {
  MongoClient, type ClientSession, type Db, type Collection, type Filter, type Document,
} from 'mongodb';
import { env } from '../config/env.js';
import type { CollectionAdapter, DbAdapter, Doc, FindOptions, UpdateResult } from './adapter.js';

class MongoCollection implements CollectionAdapter {
  constructor(
    private readonly c: Collection<Document>,
    private readonly session?: ClientSession,
  ) {}

  private options(): { session?: ClientSession } {
    return this.session ? { session: this.session } : {};
  }

  async findOne(query: Doc): Promise<Doc | null> {
    return (await this.c.findOne(query as Filter<Document>, this.options())) as Doc | null;
  }

  async find(query: Doc, opts?: FindOptions): Promise<Doc[]> {
    let cursor = this.c.find(query as Filter<Document>, this.options());
    if (opts?.sort) cursor = cursor.sort(opts.sort);
    if (opts?.skip) cursor = cursor.skip(opts.skip);
    if (opts?.limit !== undefined) cursor = cursor.limit(opts.limit);
    return (await cursor.toArray()) as Doc[];
  }

  async insertOne(doc: Doc): Promise<Doc> {
    const r = await this.c.insertOne(doc as Document, this.options());
    return { ...doc, _id: r.insertedId };
  }

  async updateOne(query: Doc, update: Doc, opts?: { upsert?: boolean }): Promise<UpdateResult> {
    const r = await this.c.updateOne(query as Filter<Document>, update as Document, {
      upsert: Boolean(opts?.upsert),
      ...this.options(),
    });
    return { matchedCount: r.matchedCount, modifiedCount: r.modifiedCount };
  }

  async findOneAndUpdate(query: Doc, update: Doc, opts?: { upsert?: boolean }): Promise<Doc | null> {
    return (await this.c.findOneAndUpdate(query as Filter<Document>, update as Document, {
      upsert: Boolean(opts?.upsert),
      returnDocument: 'after',
      ...this.options(),
    })) as Doc | null;
  }

  async deleteOne(query: Doc): Promise<number> {
    return (await this.c.deleteOne(query as Filter<Document>, this.options())).deletedCount ?? 0;
  }

  async deleteMany(query: Doc): Promise<number> {
    return (await this.c.deleteMany(query as Filter<Document>, this.options())).deletedCount ?? 0;
  }

  async count(query: Doc): Promise<number> {
    return this.c.countDocuments(query as Filter<Document>, this.options());
  }
}

export function createMongoAdapter(db: Db, session?: ClientSession): DbAdapter {
  return {
    collection(name: string): CollectionAdapter {
      return new MongoCollection(db.collection(name), session);
    },
    async dropCollection(name: string): Promise<void> {
      try {
        await db.dropCollection(name);
      } catch (e: unknown) {
        // Dropping an already-absent collection is idempotent.
        if ((e as { code?: number })?.code !== 26) throw e;
      }
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
  const alreadyPartial = partial?.usernameNormalized?.$type === 'string' && existing?.unique !== false;
  if (existing && !alreadyPartial) {
    // MongoDB will not allow two indexes with the same key pattern and
    // different options, so the old index must be replaced. Keep enough of its
    // definition to restore it if the new index cannot be created: no user
    // document is modified by either operation.
    const oldName = String(existing.name);
    const oldOptions: Document = { unique: existing.unique !== false };
    if (existing.sparse) oldOptions.sparse = true;
    if (existing.partialFilterExpression) oldOptions.partialFilterExpression = existing.partialFilterExpression;
    try {
      await accounts.dropIndex(oldName);
    } catch (e: unknown) {
      // A concurrent deploy may have replaced it already; the createIndex
      // below is idempotent when the options now match.
      if ((e as { code?: number })?.code !== 27) throw e;
    }
    try {
      await accounts.createIndex(
        { usernameNormalized: 1 },
        {
          name: 'username_normalized_partial_unique_v2',
          unique: true,
          partialFilterExpression: { usernameNormalized: { $type: 'string' } },
        },
      );
    } catch (error) {
      // Restore the previous constraint rather than leave the account
      // collection without username uniqueness after a failed rollout.
      try {
        await accounts.createIndex({ usernameNormalized: 1 }, { name: oldName, ...oldOptions });
      } catch {
        // Preserve the original replacement error; the next startup retries.
      }
      throw error;
    }
    return;
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
    // Used by the restartable account-deletion sweep; never a uniqueness rule.
    db.collection('lq_accounts').createIndex({ status: 1 }, { name: 'account_status' }),
    db.collection('lq_sessions').createIndex({ tokenHash: 1 }, { unique: true }),
    db.collection('lq_sessions').createIndex({ userId: 1, revokedAt: 1 }),
    db.collection('lq_sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    // MongoDB TTL indexes only expire real BSON dates. New documents carry a
    // Date `expireAt`; the legacy string `expiresAt` remains for application
    // comparisons and is purged by the maintenance sweep.
    db.collection('lq_sessions').createIndex({ expireAt: 1 }, { expireAfterSeconds: 0, name: 'session_expire_at_ttl' }),
    // Legacy lq_challenges / lq_reset_grants documents are intentionally left
    // untouched for a non-destructive rollout. New email action links use the
    // collection below and never write numeric codes or reset grants.
    db.collection('lq_action_tokens').createIndex({ tokenHash: 1 }, { unique: true }),
    db.collection('lq_action_tokens').createIndex({ userId: 1, purpose: 1, consumedAt: 1 }),
    db.collection('lq_action_tokens').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('lq_action_tokens').createIndex({ expireAt: 1 }, { expireAfterSeconds: 0, name: 'action_token_expire_at_ttl' }),
    db.collection('lq_oauth_states').createIndex({ stateHash: 1 }, { unique: true }),
    db.collection('lq_oauth_states').createIndex({ userId: 1 }, { sparse: true }),
    db.collection('lq_oauth_states').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('lq_oauth_states').createIndex({ expireAt: 1 }, { expireAfterSeconds: 0, name: 'oauth_state_expire_at_ttl' }),
    db.collection('lq_deletions').createIndex({ userId: 1, playlistId: 1 }, { unique: true }),
    // One resumable deletion saga per account. The document is removed after
    // successful verification, so it never becomes a permanent account index.
    db.collection('lq_account_deletions').createIndex({ userId: 1 }, { unique: true }),
    db.collection('lq_account_deletions').createIndex({ status: 1, updatedAt: 1 }),
    // Non-PII anti-resurrection fence. TTL expiry is the only cleanup path
    // after a verified deletion; the startup sweep also removes residue.
    db.collection('lq_account_fences').createIndex({ userId: 1 }, { unique: true }),
    db.collection('lq_account_fences').createIndex({ expireAt: 1 }, { expireAfterSeconds: 0, name: 'account_fence_expire_at_ttl' }),
    // Shared atomic security-endpoint counters. Keys are hashed; no raw IP or
    // account identifier is stored.
    db.collection('lq_rate_limits').createIndex({ expireAt: 1 }, { expireAfterSeconds: 0, name: 'rate_limit_expire_at_ttl' }),
    db.collection('lq_migrations').createIndex({ userId: 1, migrationId: 1 }, { unique: true }),
    db.collection('lq_state_versions').createIndex({ userId: 1 }, { unique: true }),
    // Consolidated learning-data target. Its repository cutover is selected
    // explicitly by LQ_USER_DATA_STORE; legacy remains the default until an
    // owner-approved migration has been verified.
    db.collection('lq_user_data').createIndex({ userId: 1, domain: 1, key: 1 }, { unique: true }),
    db.collection('lq_user_data').createIndex({ userId: 1, domain: 1, playlistId: 1 }),
    db.collection('lq_user_data').createIndex({ userId: 1, domain: 1, order: 1 }),
  ]);
  // A unified deployment must not re-create retired legacy collections just by
  // starting up. Only the selected backend receives its physical indexes.
  if (env.userDataStore !== 'legacy') return;
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

/**
 * Connect and return the database without creating indexes or collections.
 * Used by the read-only migration dry run. `getMongoDb` below adds the
 * idempotent index initialization used by the application and apply path.
 */
async function connectMongoDb(): Promise<Db> {
  if (!env.mongodbConfigured) {
    throw Object.assign(new Error('MongoDB is not configured. Set MONGODB_URI and MONGODB_DB_NAME.'), { status: 503, code: 'SETUP_REQUIRED' });
  }
  if (!dbPromise) {
    const clientAttempt = MongoClient.connect(env.mongodbUri, {
      appName: 'learnquest-api',
      // Keep every connection phase bounded. The supervisor adds controlled
      // backoff between attempts; these values bound one attempt only.
      serverSelectionTimeoutMS: 5_000,
      connectTimeoutMS: 5_000,
      socketTimeoutMS: 45_000,
      waitQueueTimeoutMS: 10_000,
      maxPoolSize: 10,
      retryWrites: true,
    });
    clientPromise = clientAttempt;
    const dbAttempt = clientAttempt.then((client) => client.db(env.mongodbDbName));
    dbPromise = dbAttempt;
    // Do not cache a rejected connection forever. A transient DNS, TLS, or
    // network failure must be retryable by the next request without a process
    // restart. Concurrent callers still share this one attempt.
    void dbAttempt.catch(async () => {
      if (dbPromise !== dbAttempt) return;
      dbPromise = null;
      if (clientPromise === clientAttempt) clientPromise = null;
      const client = await clientAttempt.catch(() => null);
      if (client) await client.close().catch(() => undefined);
    });
  }
  return dbPromise;
}

/**
 * Bounded read-only connectivity check used by startup diagnostics. This does
 * not create indexes or collections; `getMongoDb` performs the normal index
 * initialization separately so a connection failure cannot be confused with a
 * permission/index failure.
 */
export async function pingMongo(): Promise<void> {
  const db = await connectMongoDb();
  // The driver's server-selection and socket timeouts bound the connection;
  // timeoutMS additionally bounds the ping operation itself.
  await db.command({ ping: 1 }, { timeoutMS: 5_000 });
}

/** Lazily connect once, then ensure the application's indexes exist. */
export async function getMongoDb(): Promise<Db> {
  const db = await connectMongoDb();
  if (!indexesPromise) {
    const attempt = ensureIndexes(db);
    indexesPromise = attempt;
    // A failed index rollout may be transient (for example, a concurrent
    // deployment or a lost connection). Allow the next request to retry.
    void attempt.catch(() => {
      if (indexesPromise === attempt) indexesPromise = null;
    });
  }
  await indexesPromise;
  return db;
}

function createLazyMongoAdapter(getDb: () => Promise<Db>): DbAdapter {
  return {
    collection(name: string): CollectionAdapter {
      const lazy = {
        async findOne(query: Doc) { return (await getDb()).collection(name).findOne(query as Filter<Document>) as Promise<Doc | null>; },
        async find(query: Doc, opts?: FindOptions) {
          let c = (await getDb()).collection(name).find(query as Filter<Document>);
          if (opts?.sort) c = c.sort(opts.sort);
          if (opts?.skip) c = c.skip(opts.skip);
          if (opts?.limit !== undefined) c = c.limit(opts.limit);
          return (await c.toArray()) as Doc[];
        },
        async insertOne(doc: Doc) {
          const r = await (await getDb()).collection(name).insertOne(doc as Document);
          return { ...doc, _id: r.insertedId };
        },
        async updateOne(query: Doc, update: Doc, opts?: { upsert?: boolean }): Promise<UpdateResult> {
          const r = await (await getDb()).collection(name).updateOne(query as Filter<Document>, update as Document, { upsert: Boolean(opts?.upsert) });
          return { matchedCount: r.matchedCount, modifiedCount: r.modifiedCount };
        },
        async findOneAndUpdate(query: Doc, update: Doc, opts?: { upsert?: boolean }) {
          return (await (await getDb()).collection(name).findOneAndUpdate(query as Filter<Document>, update as Document, {
            upsert: Boolean(opts?.upsert), returnDocument: 'after',
          })) as Doc | null;
        },
        async deleteOne(query: Doc) {
          return (await (await getDb()).collection(name).deleteOne(query as Filter<Document>)).deletedCount ?? 0;
        },
        async deleteMany(query: Doc) {
          return (await (await getDb()).collection(name).deleteMany(query as Filter<Document>)).deletedCount ?? 0;
        },
        async count(query: Doc) {
          return (await getDb()).collection(name).countDocuments(query as Filter<Document>);
        },
      } satisfies CollectionAdapter;
      return lazy;
    },
    async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
      const db = await getDb();
      const session = db.client.startSession();
      try {
        let result!: T;
        await session.withTransaction(async () => {
          result = await fn(createMongoAdapter(db, session));
        });
        return result;
      } finally {
        await session.endSession().catch(() => undefined);
      }
    },
    async dropCollection(name: string) {
      try {
        await (await getDb()).dropCollection(name);
      } catch (e: unknown) {
        if ((e as { code?: number })?.code !== 26) throw e;
      }
    },
  };
}

let defaultAdapter: DbAdapter | null = null;
let readOnlyAdapter: DbAdapter | null = null;

/**
 * Production adapter. Connection is opened on first repository call.
 * `ensureIndexes: false` is reserved for explicit read-only tooling such as
 * the migration dry run; it never creates a collection or index.
 */
export function getMongoAdapter(options: { ensureIndexes?: boolean } = {}): DbAdapter {
  if (options.ensureIndexes === false) {
    if (!readOnlyAdapter) readOnlyAdapter = createLazyMongoAdapter(connectMongoDb);
    return readOnlyAdapter;
  }
  if (!defaultAdapter) defaultAdapter = createLazyMongoAdapter(getMongoDb);
  return defaultAdapter;
}

export async function closeMongo(): Promise<void> {
  // Detach state before awaiting so a caller that starts a fresh connection
  // during shutdown cannot have its promise cleared by this older close.
  const clientAttempt = clientPromise;
  clientPromise = null;
  dbPromise = null;
  indexesPromise = null;
  defaultAdapter = null;
  readOnlyAdapter = null;
  const client = clientAttempt ? await clientAttempt.catch(() => null) : null;
  await client?.close();
}
