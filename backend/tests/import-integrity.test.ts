import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMemoryDb } from '../src/db/memoryAdapter.js';
import { createDataStore, type DataStore } from '../src/store.js';
import {
  emptyUserState, readUserState, replaceAllUserState, type UserState,
} from '../src/services/userData.js';

const ENV: Record<string, string> = {
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:5173',
  API_ORIGIN: 'http://localhost:3001',
  CORS_ORIGIN: 'http://localhost:5173',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/learnquest-test',
  MONGODB_DB_NAME: 'learnquest_test',
  SESSION_SECRET: 'test-session-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
  EMAIL_ACTION_HMAC_SECRET: 'test-email-action-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
  EMAIL_ACTION_TTL_MIN: '30',
  EMAIL_ACTION_RESEND_SEC: '60',
  LQ_USER_DATA_STORE: 'legacy',
};
const saved: Record<string, string | undefined> = {};
const USER = 'import-integrity-user';

let db: ReturnType<typeof createMemoryDb>;
let store: DataStore;

function stateWithProgress(notes: string): UserState {
  const state = emptyUserState();
  state.progress = {
    p1: {
      playlistId: 'PLimport0000000000001',
      position: 1,
      videoId: 'v1',
      status: 'in-progress',
      completedAt: null,
      notes,
    },
  };
  state.playlists = {
    PLimport0000000000001: {
      playlistId: 'PLimport0000000000001',
      title: 'Import target',
      reportedCount: 1,
      entries: [{ position: 1, videoId: 'v1', title: 'One', durationSec: 60 }],
      source: 'imported',
      fetchedAt: '2026-10-01T00:00:00.000Z',
      snapshotVersion: 1,
    },
  };
  state.activeId = 'PLimport0000000000001';
  return state;
}

beforeEach(async () => {
  for (const [key, value] of Object.entries(ENV)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  db = createMemoryDb();
  store = createDataStore(db);
  await replaceAllUserState(store, USER, stateWithProgress('original'), 0);
});

afterEach(async () => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await db.close();
});

describe('atomic account import', () => {
  it('rolls back every collection when one write fails mid-import', async () => {
    const before = await readUserState(store, USER);
    expect(before.state.progress.p1.notes).toBe('original');

    const originalTransaction = store.transaction;
    expect(originalTransaction).toBeTruthy();
    store.transaction = async (fn) => originalTransaction!((tx) => {
      const progress = tx.domainData('progress');
      const failing = new Proxy(progress, {
        get(target, property) {
          if (property === 'insertOne') {
            return async () => { throw new Error('simulated mid-import write failure'); };
          }
          const value = Reflect.get(target, property);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const wrapped = Object.create(tx) as DataStore;
      wrapped.domainData = (name) => (name === 'progress' ? failing : tx.domainData(name));
      return fn(wrapped);
    });

    await expect(replaceAllUserState(store, USER, stateWithProgress('should-not-persist'), before.version))
      .rejects.toThrow(/simulated mid-import write failure/);

    const after = await readUserState(store, USER);
    expect(after.version).toBe(before.version);
    expect(after.state).toEqual(before.state);
    expect(after.state.progress.p1.notes).toBe('original');
  });

  it('commits the idempotency record with the data or not at all', async () => {
    const before = await readUserState(store, USER);
    await expect(replaceAllUserState(store, USER, stateWithProgress('not-committed'), before.version, {
      afterWrite: async (tx) => {
        await tx.migrations.insertOne({
          userId: USER,
          migrationId: 'rollback-marker',
          result: { ok: false },
          createdAt: new Date().toISOString(),
        });
        throw new Error('simulated migration marker failure');
      },
    })).rejects.toThrow(/simulated migration marker failure/);

    expect(await store.migrations.count({ userId: USER, migrationId: 'rollback-marker' })).toBe(0);
    const after = await readUserState(store, USER);
    expect(after.version).toBe(before.version);
    expect(after.state).toEqual(before.state);

    const committed = await replaceAllUserState(store, USER, stateWithProgress('committed'), before.version, {
      afterWrite: async (tx) => {
        await tx.migrations.insertOne({
          userId: USER,
          migrationId: 'commit-marker',
          result: { ok: true },
          createdAt: new Date().toISOString(),
        });
      },
    });
    expect(committed.version).toBe(before.version + 1);
    expect(await store.migrations.count({ userId: USER, migrationId: 'commit-marker' })).toBe(1);
    expect((await readUserState(store, USER)).state.progress.p1.notes).toBe('committed');
  });

  it('rejects an import when the deployment cannot guarantee atomicity', async () => {
    const before = await readUserState(store, USER);
    const nonAtomic = Object.create(store) as DataStore;
    nonAtomic.adapter = { ...store.adapter, transaction: undefined };
    nonAtomic.transaction = undefined;
    await expect(replaceAllUserState(nonAtomic, USER, stateWithProgress('no-atomicity'), before.version))
      .rejects.toMatchObject({ code: 'ATOMICITY_UNAVAILABLE', status: 503 });
    expect((await readUserState(store, USER)).state.progress.p1.notes).toBe('original');
  });
});
