import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDb } from '../src/db/memoryAdapter.js';
import {
  createDataStore,
  createUnifiedDomainCollection,
  type DataStore,
  type UserCollectionName,
} from '../src/store.js';
import { applyUserDataMigration } from '../src/services/userDataMigration.js';
import {
  readUserState,
  replaceUserCollection,
} from '../src/services/userData.js';

const NOW = '2026-10-27T00:00:00.000Z';
const USER_A = 'unified-user-a';
const USER_B = 'unified-user-b';
const PLAYLIST = 'PLunified00000000001';

const SAMPLE: Partial<Record<UserCollectionName, unknown>> = {
  playlists: {
    playlistId: PLAYLIST,
    title: 'Unified playlist',
    reportedCount: 1,
    entries: [{ position: 1, videoId: 'v1', title: 'One', durationSec: 60 }],
    source: 'imported',
    fetchedAt: NOW,
    snapshotVersion: 1,
  },
  meta: { archived: false, customTitle: 'Unified title', addedAt: NOW },
  progress: {
    playlistId: PLAYLIST,
    position: 1,
    videoId: 'v1',
    status: 'done',
    completedAt: NOW,
    notes: 'unified-note',
  },
  activeId: PLAYLIST,
  prefs: { timezone: 'UTC', sessionLenMin: 25, breakMin: 5, reducedMotion: false, minViableMin: 10 },
  settings: { verifiedThreshold: 0.9 },
  challenge: { seed: 20261013, cohortSize: 100, tierDist: { Ultra: 2 }, windowDays: 14, dailyCapHours: 6 },
  challengeEnabled: true,
};

const KEYS: Partial<Record<UserCollectionName, string>> = {
  playlists: PLAYLIST,
  meta: PLAYLIST,
  progress: 'v1',
  activeId: 'singleton',
  prefs: 'singleton',
  settings: 'singleton',
  challenge: 'singleton',
  challengeEnabled: 'singleton',
};

let db: ReturnType<typeof createMemoryDb>;
let store: DataStore;
const savedStore = process.env.LQ_USER_DATA_STORE;
const savedAck = process.env.LQ_USER_DATA_CUTOVER_ACK;

beforeEach(() => {
  db = createMemoryDb();
  store = createDataStore(db);
});

afterEach(async () => {
  if (savedStore === undefined) delete process.env.LQ_USER_DATA_STORE;
  else process.env.LQ_USER_DATA_STORE = savedStore;
  if (savedAck === undefined) delete process.env.LQ_USER_DATA_CUTOVER_ACK;
  else process.env.LQ_USER_DATA_CUTOVER_ACK = savedAck;
  await db.close();
});

async function seedLegacy(userId: string): Promise<void> {
  await store.accounts.insertOne({
    userId,
    username: userId,
    status: 'active',
    onboardingComplete: true,
    createdAt: NOW,
  });
  for (const [domain, value] of Object.entries(SAMPLE) as [UserCollectionName, unknown][]) {
    await store.data(domain).insertOne({
      userId,
      key: KEYS[domain]!,
      value,
      updatedAt: NOW,
      order: 0,
    });
  }
}

describe('consolidated domain adapter', () => {
  it('hides the domain from callers while scoping every operation', async () => {
    const col = createUnifiedDomainCollection(store.userData, 'progress');
    const inserted = await col.insertOne({
      userId: USER_A,
      key: 'v1',
      value: { playlistId: PLAYLIST, position: 1, videoId: 'v1', status: 'done', completedAt: NOW },
      updatedAt: NOW,
      order: 0,
    });
    expect(inserted).not.toHaveProperty('domain');
    const raw = await store.userData.findOne({ userId: USER_A, domain: 'progress', key: 'v1' });
    expect(raw).toMatchObject({ userId: USER_A, domain: 'progress', key: 'v1' });

    await col.updateOne(
      { userId: USER_A, key: 'v1' },
      { $set: { value: { ...(raw?.value as object), notes: 'updated' } } },
    );
    // An operator update with no $set still retains the domain partition.
    await col.updateOne({ userId: USER_A, key: 'v1' }, { $inc: { order: 1 } });
    const updated = await col.findOne({ userId: USER_A, key: 'v1' });
    expect((updated?.value as Record<string, unknown>).notes).toBe('updated');
    expect(updated?.order).toBe(1);
    expect(updated).not.toHaveProperty('domain');

    // A same-key record in another domain or account is never visible.
    await store.userData.insertOne({
      userId: USER_A,
      domain: 'meta',
      key: 'v1',
      value: { archived: false },
      updatedAt: NOW,
      order: 0,
    });
    await store.userData.insertOne({
      userId: USER_B,
      domain: 'progress',
      key: 'v1',
      value: { notes: 'other account' },
      updatedAt: NOW,
      order: 0,
    });
    expect(await col.findOne({ userId: USER_B, key: 'v1' })).toMatchObject({ userId: USER_B });
    expect((await col.find({ userId: USER_A })).map((doc) => doc.key)).toEqual(['v1']);
    expect(await col.count({ userId: USER_A })).toBe(1);
  });
});

describe('repository cutover to lq_user_data', () => {
  it('reads migrated records and writes only the selected backend without falling back', async () => {
    await seedLegacy(USER_A);
    await seedLegacy(USER_B);

    const migrated = await applyUserDataMigration(store, { userIds: [USER_A] });
    expect(migrated.status).toBe('applied');
    expect(migrated.ok).toBe(true);

    process.env.LQ_USER_DATA_STORE = 'unified';
    process.env.LQ_USER_DATA_CUTOVER_ACK = 'lq-data-to-user-data-v1';

    const read = await readUserState(store, USER_A);
    expect(read.state.activeId).toBe(PLAYLIST);
    expect(read.state.playlists[PLAYLIST]).toMatchObject({ title: 'Unified playlist' });
    expect(read.state.meta[PLAYLIST]).toMatchObject({ customTitle: 'Unified title' });
    expect(read.state.progress.v1?.notes).toBe('unified-note');
    expect(read.version).toBe(0);

    const saved = await replaceUserCollection(store, USER_A, 'activeId', 'PLunified00000000002', read.version);
    expect(saved.version).toBe(1);

    const unified = await store.userData.findOne({
      userId: USER_A,
      domain: 'activeId',
      key: 'singleton',
    });
    expect(unified?.value).toBe('PLunified00000000002');
    expect(unified?.domain).toBe('activeId');

    // The legacy source remains untouched for rollback, and another account's
    // rows were not copied or changed by this scoped write.
    const legacy = await store.data('activeId').findOne({ userId: USER_A, key: 'singleton' });
    expect(legacy?.value).toBe(PLAYLIST);
    expect(await store.userData.count({ userId: USER_B })).toBe(0);

    const reread = await readUserState(store, USER_A);
    expect(reread.state.activeId).toBe('PLunified00000000002');
    expect(reread.version).toBe(1);
  });

  it('fails rather than silently using legacy when unified is selected without data', async () => {
    await seedLegacy(USER_A);
    process.env.LQ_USER_DATA_STORE = 'unified';
    // The config gate is enforced separately; this proves the repository does
    // not fall back to the populated legacy collection.
    const read = await readUserState(store, USER_A);
    expect(read.state.playlists).toEqual({});
    expect(read.state.activeId).toBeNull();
  });

  it('rejects an invalid store selection', async () => {
    process.env.LQ_USER_DATA_STORE = 'both';
    expect(() => store.domainData('progress')).toThrow(/LQ_USER_DATA_STORE/);
  });
});
