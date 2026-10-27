import type { CollectionAdapter, DbAdapter } from './db/adapter.js';

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
  data(name: UserCollectionName): CollectionAdapter;
}

export function createDataStore(adapter: DbAdapter): DataStore {
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
    userData: adapter.collection(UNIFIED_USER_DATA_COLLECTION),
    data(name: UserCollectionName): CollectionAdapter {
      if (!USER_COLLECTIONS.includes(name)) throw new Error('Unknown user-data collection.');
      return adapter.collection(`lq_data_${name}`);
    },
  };
}
