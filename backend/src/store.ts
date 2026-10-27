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

export interface DataStore {
  adapter: DbAdapter;
  accounts: CollectionAdapter;
  sessions: CollectionAdapter;
  challenges: CollectionAdapter;
  oauthStates: CollectionAdapter;
  deletions: CollectionAdapter;
  migrations: CollectionAdapter;
  resetGrants: CollectionAdapter;
  stateVersions: CollectionAdapter;
  data(name: UserCollectionName): CollectionAdapter;
}

export function createDataStore(adapter: DbAdapter): DataStore {
  return {
    adapter,
    accounts: adapter.collection('lq_accounts'),
    sessions: adapter.collection('lq_sessions'),
    challenges: adapter.collection('lq_challenges'),
    oauthStates: adapter.collection('lq_oauth_states'),
    deletions: adapter.collection('lq_deletions'),
    migrations: adapter.collection('lq_migrations'),
    resetGrants: adapter.collection('lq_reset_grants'),
    stateVersions: adapter.collection('lq_state_versions'),
    data(name: UserCollectionName): CollectionAdapter {
      if (!USER_COLLECTIONS.includes(name)) throw new Error('Unknown user-data collection.');
      return adapter.collection(`lq_data_${name}`);
    },
  };
}
