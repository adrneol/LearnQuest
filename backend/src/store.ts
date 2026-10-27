import type { CollectionAdapter, DbAdapter, Doc, FindOptions, UpdateResult } from './db/adapter.js';
import { env } from './config/env.js';

/**
 * User-owned learning collections. Each maps to its own MongoDB collection so
 * unbounded history is never stored in one giant user document. Every document
 * is keyed by `userId` at the repository boundary.
 */
export const USER_COLLECTIONS = [
  'playlists',
  'meta',
  'progress',
  'ranges',
  'checkpoints',
  'modules',
  'sessions',
  'goals',
  'xp',
  'achievements',
  'segments',
  'playSessions',
  'queue',
  'flexGoals',
  'challenge',
  'challengeEnabled',
  'rankHistory',
  'settings',
  'prefs',
  'activeId',
] as const;

export type UserCollectionName = (typeof USER_COLLECTIONS)[number];

export const UNIFIED_USER_DATA_COLLECTION = 'lq_user_data';

/**
 * Every legacy learning-data collection plus the consolidated target
 * collection. Deletion and migration use this list so a domain cannot be
 * forgotten when a new one is added to USER_COLLECTIONS.
 */
export const ACCOUNT_LEARNING_COLLECTIONS = [
  ...USER_COLLECTIONS.map((name) => `lq_data_${name}`),
  UNIFIED_USER_DATA_COLLECTION,
] as const;

export interface DataStore {
  adapter: DbAdapter;
  accounts: CollectionAdapter;
  sessions: CollectionAdapter;
  actionTokens: CollectionAdapter;
  oauthStates: CollectionAdapter;
  deletions: CollectionAdapter;
  accountDeletions: CollectionAdapter;
  migrations: CollectionAdapter;
  stateVersions: CollectionAdapter;
  userData: CollectionAdapter;
  /** Legacy per-domain collection. Migration/retirement must use this explicitly. */
  data(name: UserCollectionName): CollectionAdapter;
  /** Active application learning-data backend selected by LQ_USER_DATA_STORE. */
  domainData(name: UserCollectionName): CollectionAdapter;
}

function assertKnownDomain(name: string): UserCollectionName {
  if (!USER_COLLECTIONS.includes(name as UserCollectionName)) {
    throw new Error('Unknown user-data collection.');
  }
  return name as UserCollectionName;
}

/**
 * Present the consolidated `lq_user_data` records as the legacy per-domain
 * shape. This keeps repository validation, playlist attribution, optimistic
 * versioning, and all ownership filters in one place while allowing the
 * physical layout to be selected deliberately by configuration.
 *
 * Every query is additionally scoped by `domain`; a caller can never reach a
 * record in another domain through this adapter. Callers still supply and are
 * checked against the authenticated `userId` exactly as on the legacy backend.
 */
export function createUnifiedDomainCollection(
  userData: CollectionAdapter,
  domain: UserCollectionName,
): CollectionAdapter {
  const scoped = (query: Doc): Doc => ({ ...query, domain });
  const scopedUpdate = (update: Doc): Doc => {
    const usesOperators = Object.keys(update ?? {}).some((key) => key.startsWith('$'));
    if (usesOperators) {
      const set = update.$set && typeof update.$set === 'object' && !Array.isArray(update.$set)
        ? update.$set
        : {};
      return { ...update, $set: { ...set, domain } };
    }
    // Replacement-style update: preserve its fields and attach the domain.
    return { ...update, domain };
  };
  const asLegacy = (doc: Doc | null): Doc | null => {
    if (!doc) return null;
    const { domain: _domain, ...legacy } = doc;
    return legacy;
  };
  return {
    async findOne(query: Doc): Promise<Doc | null> {
      return asLegacy(await userData.findOne(scoped(query)));
    },
    async find(query: Doc, opts?: FindOptions): Promise<Doc[]> {
      return (await userData.find(scoped(query), opts)).map((doc) => asLegacy(doc)!);
    },
    async insertOne(doc: Doc): Promise<Doc> {
      if (doc.userId === undefined || doc.key === undefined) {
        throw new Error('Unified user-data records require userId and key.');
      }
      const inserted = await userData.insertOne({ ...doc, domain });
      return asLegacy(inserted)!;
    },
    async updateOne(query: Doc, update: Doc, opts?: { upsert?: boolean }): Promise<UpdateResult> {
      return userData.updateOne(scoped(query), scopedUpdate(update), opts);
    },
    async findOneAndUpdate(query: Doc, update: Doc, opts?: { upsert?: boolean }): Promise<Doc | null> {
      return asLegacy(await userData.findOneAndUpdate(scoped(query), scopedUpdate(update), opts));
    },
    async deleteOne(query: Doc): Promise<number> {
      return userData.deleteOne(scoped(query));
    },
    async deleteMany(query: Doc): Promise<number> {
      return userData.deleteMany(scoped(query));
    },
    async count(query: Doc): Promise<number> {
      return userData.count(scoped(query));
    },
  };
}

export function createDataStore(adapter: DbAdapter): DataStore {
  const userData = adapter.collection(UNIFIED_USER_DATA_COLLECTION);
  return {
    adapter,
    accounts: adapter.collection('lq_accounts'),
    sessions: adapter.collection('lq_sessions'),
    actionTokens: adapter.collection('lq_action_tokens'),
    oauthStates: adapter.collection('lq_oauth_states'),
    deletions: adapter.collection('lq_deletions'),
    // Temporary account-deletion saga job. Removed after verified success.
    accountDeletions: adapter.collection('lq_account_deletions'),
    migrations: adapter.collection('lq_migrations'),
    stateVersions: adapter.collection('lq_state_versions'),
    userData,
    data(name: UserCollectionName): CollectionAdapter {
      if (!USER_COLLECTIONS.includes(name)) throw new Error('Unknown user-data collection.');
      return adapter.collection(`lq_data_${name}`);
    },
    domainData(name: UserCollectionName): CollectionAdapter {
      const domain = assertKnownDomain(name);
      return env.userDataStore === 'unified'
        ? createUnifiedDomainCollection(userData, domain)
        : adapter.collection(`lq_data_${domain}`);
    },
  };
}
