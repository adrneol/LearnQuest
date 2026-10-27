import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDb } from '../src/db/memoryAdapter.js';
import { createDataStore, USER_COLLECTIONS, type DataStore } from '../src/store.js';
import { applyUserDataMigration } from '../src/services/userDataMigration.js';
import {
  LEGACY_RETIREMENT_CONFIRMATION,
  inspectLegacyRetirement,
  retireLegacyCollections,
} from '../src/services/legacyRetirement.js';

const NOW = '2026-10-27T00:00:00.000Z';
const PLAYLIST = 'PLretire000000000001';

let db: ReturnType<typeof createMemoryDb>;
let store: DataStore;
const savedStore = process.env.LQ_USER_DATA_STORE;
const savedAck = process.env.LQ_USER_DATA_CUTOVER_ACK;

beforeEach(async () => {
  process.env.LQ_USER_DATA_STORE = 'unified';
  process.env.LQ_USER_DATA_CUTOVER_ACK = 'lq-data-to-user-data-v1';
  db = createMemoryDb();
  store = createDataStore(db);
  await store.data('playlists').insertOne({
    userId: 'retire-user',
    key: PLAYLIST,
    value: {
      playlistId: PLAYLIST,
      title: 'Retirement playlist',
      reportedCount: 1,
      entries: [{ position: 1, videoId: 'v1', title: 'One', durationSec: 60 }],
      source: 'imported',
      fetchedAt: NOW,
      snapshotVersion: 1,
    },
    updatedAt: NOW,
    order: 0,
  });
  await store.accounts.insertOne({
    userId: 'retire-user',
    username: 'retire_user',
    status: 'active',
    onboardingComplete: true,
    createdAt: NOW,
  });
  await store.sessions.insertOne({ sessionId: 'session-1', userId: 'retire-user', revokedAt: null });
});

afterEach(async () => {
  if (savedStore === undefined) delete process.env.LQ_USER_DATA_STORE;
  else process.env.LQ_USER_DATA_STORE = savedStore;
  if (savedAck === undefined) delete process.env.LQ_USER_DATA_CUTOVER_ACK;
  else process.env.LQ_USER_DATA_CUTOVER_ACK = savedAck;
  await db.close();
});

describe('explicit legacy retirement', () => {
  it('blocks when the application still reads legacy storage or has no reviewed artifact', async () => {
    process.env.LQ_USER_DATA_STORE = 'legacy';
    const report = await inspectLegacyRetirement(store, null);
    expect(report.status).toBe('blocked');
    expect(report.blockers.join(' ')).toMatch(/LQ_USER_DATA_STORE=unified/);
    await expect(retireLegacyCollections(store, LEGACY_RETIREMENT_CONFIRMATION, null, {
      backupConfirmed: true,
    })).rejects.toMatchObject({ code: 'RETIREMENT_BLOCKED' });
    expect(await store.data('playlists').count({ userId: 'retire-user' })).toBe(1);
  });

  it('requires the exact confirmation and an explicit backup acknowledgement', async () => {
    const applied = await applyUserDataMigration(store);
    expect(applied.status).toBe('applied');
    await expect(retireLegacyCollections(store, 'retire', applied, {
      backupConfirmed: true,
    })).rejects.toMatchObject({ code: 'CONFIRMATION_MISMATCH' });
    await expect(retireLegacyCollections(store, LEGACY_RETIREMENT_CONFIRMATION, applied, {
      backupConfirmed: false,
    })).rejects.toMatchObject({ code: 'BACKUP_NOT_CONFIRMED' });
    expect(await store.data('playlists').count({ userId: 'retire-user' })).toBe(1);
  });

  it('drops only the reviewed legacy learning collections after verification', async () => {
    const applied = await applyUserDataMigration(store);
    expect(applied.status).toBe('applied');
    const ready = await inspectLegacyRetirement(store, applied);
    expect(ready.status).toBe('ready');
    expect(ready.migration.pendingKeys).toBe(0);
    expect(ready.collections).toHaveLength(USER_COLLECTIONS.length);
    expect(ready.collections.find((c) => c.name === 'lq_data_playlists')?.documents).toBe(1);

    const result = await retireLegacyCollections(store, LEGACY_RETIREMENT_CONFIRMATION, applied, {
      backupConfirmed: true,
    });
    expect(result.status).toBe('retired');
    expect(result.dropped).toEqual(USER_COLLECTIONS.map((name) => `lq_data_${name}`));
    expect(result.dropped).not.toContain('lq_user_data');
    expect(result.dropped).not.toContain('lq_accounts');
    expect(result.dropped).not.toContain('lq_sessions');

    // The consolidated copy and operational records survive.
    expect(await store.userData.count({ userId: 'retire-user', domain: 'playlists' })).toBe(1);
    expect(await store.accounts.count({ userId: 'retire-user' })).toBe(1);
    expect(await store.sessions.count({ userId: 'retire-user' })).toBe(1);
    expect(await store.data('playlists').count({})).toBe(0);
  });
});
