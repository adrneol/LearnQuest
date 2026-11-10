import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDb } from '../src/db/memoryAdapter.js';
import { createDataStore, type DataStore } from '../src/store.js';
import {
  emptyUserState, readUserState, replaceAllUserState,
} from '../src/services/userData.js';

const ENV = {
  LQ_USER_DATA_STORE: 'legacy',
  SESSION_SECRET: 'test-session-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
  EMAIL_ACTION_HMAC_SECRET: 'test-email-action-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/learnquest-test',
};
const savedEnv: Record<string, string | undefined> = {};
for (const k of Object.keys(ENV)) savedEnv[k] = process.env[k];

let db: ReturnType<typeof createMemoryDb>;
let store: DataStore;

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v;
  db = createMemoryDb();
  store = createDataStore(db);
});

afterEach(async () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await db.close();
});

describe('unified-selected-but-empty guard', () => {
  it('refuses to read an account whose unified store is empty while legacy data exists', async () => {
    const state = emptyUserState();
    state.playlists = {
      pl_test_guard: {
        playlistId: 'pl_test_guard',
        title: 'Guard Test',
        entries: [
          { position: 1, videoId: 'guardvideo1', title: 'Guard Video', durationSec: 300 },
        ],
        fetchedAt: new Date().toISOString(),
        snapshotVersion: 1,
        source: 'imported',
      },
    } as any;

    // 1. Seed legacy storage while the legacy layout is selected.
    expect(process.env.LQ_USER_DATA_STORE).toBe('legacy');
    await replaceAllUserState(store, 'user_guard', state, 0);

    // 2. Flip to unified without a migration: the guard must fire.
    process.env.LQ_USER_DATA_STORE = 'unified';
    await expect(readUserState(store, 'user_guard')).rejects.toMatchObject({
      status: 503,
      code: 'MIGRATION_NOT_APPLIED',
    });
  });

  it('does not block a genuinely empty account on unified (fresh signup before any data)', async () => {
    process.env.LQ_USER_DATA_STORE = 'unified';
    const result = await readUserState(store, 'user_fresh_unified');
    expect(result.state.playlists).toEqual({});
    expect(result.version).toBe(0);
  });
});
