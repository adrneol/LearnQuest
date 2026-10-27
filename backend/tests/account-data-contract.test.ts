import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { createMemoryDb } from '../src/db/memoryAdapter.js';
import { createDataStore, type DataStore } from '../src/store.js';
import { completeOnboarding, createAccountFromGoogle, type Account } from '../src/auth/accounts.js';
import { createSession } from '../src/auth/sessions.js';
import { hashCode } from '../src/auth/crypto.js';
import {
  DEFAULT_CHALLENGE, DEFAULT_PREFS, DEFAULT_SETTINGS, readUserState,
} from '../src/services/userData.js';
import type { EmailService } from '../src/email/brevo.js';
import type { GoogleOAuthService } from '../src/auth/google.js';

const ENV: Record<string, string> = {
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:5173',
  API_ORIGIN: 'http://localhost:3001',
  CORS_ORIGIN: 'http://localhost:5173',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/learnquest-test',
  MONGODB_DB_NAME: 'learnquest_test',
  SESSION_SECRET: 'test-session-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
  EMAIL_ACTION_HMAC_SECRET: 'test-email-action-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
  GOOGLE_CLIENT_ID: 'test-google-client.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:3001/api/auth/google/callback',
  BREVO_API_KEY: 'test-brevo-key',
  BREVO_SENDER_EMAIL: 'no-reply@example.test',
  TRUST_PROXY_HOPS: '0',
  AUTH_RATE_LIMIT_PER_MIN: '10000',
  EMAIL_ACTION_RATE_LIMIT_PER_15MIN: '10000',
};
const savedEnv: Record<string, string | undefined> = {};
for (const key of Object.keys(ENV)) savedEnv[key] = process.env[key];

const email: EmailService = {
  configured: false,
  async sendActionEmail() {},
  async sendSecurityNotice() {},
};
const google: GoogleOAuthService = {
  configured: true,
  async start() { return { url: 'https://accounts.google.test/auth', state: 'test-state' }; },
  async complete() { throw new Error('not used'); },
};

let db: ReturnType<typeof createMemoryDb>;
let store: DataStore;
let app: Express;

beforeEach(() => {
  for (const [key, value] of Object.entries(ENV)) process.env[key] = value;
  db = createMemoryDb();
  store = createDataStore(db);
  app = createApp({ store, email, google });
});

afterEach(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await db.close();
});

async function pendingAccount(sub: string, address: string): Promise<Account> {
  return createAccountFromGoogle(store, { sub, email: address, emailVerified: true, name: 'Pending' });
}

async function completedAccount(username: string, sub: string, address: string): Promise<Account> {
  const pending = await pendingAccount(sub, address);
  return completeOnboarding(
    store,
    pending,
    { username, displayName: username, password: 'correct horse battery staple', timezone: 'UTC' },
    await hashCode('correct horse battery staple'),
  );
}

async function sessionCookie(userId: string, authMethod: 'password' | 'google_register' = 'password'): Promise<string> {
  const created = await createSession(store, userId, {
    authMethod,
    ...(authMethod === 'google_register'
      ? { onboardingExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), onboardingGoogleSub: 'google-sub-pending' }
      : {}),
  });
  return `lq_session=${created.token}`;
}

function assertCanonicalEmptyState(state: any): void {
  expect(state.playlists).toEqual({});
  expect(state.meta).toEqual({});
  expect(state.progress).toEqual({});
  expect(state.ranges).toEqual([]);
  expect(state.checkpoints).toEqual([]);
  expect(state.modules).toEqual([]);
  expect(state.sessions).toEqual([]);
  expect(state.goals).toEqual({});
  expect(state.xp).toEqual([]);
  expect(state.achievements).toEqual({});
  expect(state.segments).toEqual([]);
  expect(state.playSessions).toEqual([]);
  expect(state.queue).toEqual({});
  expect(state.flexGoals).toEqual([]);
  expect(state.challenge).toEqual(DEFAULT_CHALLENGE);
  expect(state.challengeEnabled).toBe(false);
  expect(state.rankHistory).toEqual([]);
  expect(state.settings).toEqual(DEFAULT_SETTINGS);
  expect(state.prefs).toEqual({ ...DEFAULT_PREFS, timezone: 'UTC' });
  expect(state.activeId).toBeNull();
}

describe('canonical account-data contract', () => {
  it('does not expose account data for a pending onboarding account', async () => {
    const pending = await pendingAccount('google-sub-pending', 'pending@example.test');
    const cookie = await sessionCookie(pending.userId, 'google_register');

    const res = await request(app).get('/api/account/data').set('Cookie', cookie);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ONBOARDING_REQUIRED');
    expect(res.body.state).toBeUndefined();
    expect(res.body.playlists).toBeUndefined();
  });

  it('returns a complete canonical empty state for a fully onboarded account with no records', async () => {
    const account = await completedAccount('empty_user', 'google-sub-empty', 'empty@example.test');
    const cookie = await sessionCookie(account.userId);

    const res = await request(app).get('/api/account/data').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.version).toBe(0);
    expect(res.body.state).toBeTypeOf('object');
    expect(res.body.playlists).toBeUndefined();
    assertCanonicalEmptyState(res.body.state);

    // Reading defaults is not a write to any learning-data domain.
    const { state } = await readUserState(store, account.userId, {
      prefs: { timezone: account.timezone, sessionLenMin: account.sessionLenMin, breakMin: account.breakMin, minViableMin: account.minViableMin },
    });
    assertCanonicalEmptyState(state);
    for (const name of ['playlists', 'meta', 'progress', 'ranges', 'checkpoints', 'modules', 'sessions', 'goals', 'xp', 'achievements', 'segments', 'playSessions', 'queue', 'flexGoals', 'challenge', 'challengeEnabled', 'rankHistory', 'settings', 'prefs', 'activeId'] as const) {
      expect(await store.data(name).count({ userId: account.userId })).toBe(0);
    }
  });

  it('accepts the first playlist write on the empty account and keeps unrelated defaults', async () => {
    const account = await completedAccount('first_user', 'google-sub-first', 'first@example.test');
    const cookie = await sessionCookie(account.userId);
    const snap = {
      playlistId: 'PLcontract000000000001',
      title: 'First Course',
      reportedCount: 1,
      entries: [{ position: 1, videoId: 'v1', title: 'One', durationSec: 60 }],
      source: 'imported',
      fetchedAt: '2026-10-01T00:00:00.000Z',
      snapshotVersion: 1,
    };
    const saved = await request(app)
      .put('/api/account/data/playlists')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', '')
      .send({ version: 0, items: { [snap.playlistId]: snap } });
    // CSRF is required. Fetch the real token from the session endpoint.
    expect(saved.status).toBe(403);

    const session = await request(app).get('/api/auth/session').set('Cookie', cookie);
    const put = await request(app)
      .put('/api/account/data/playlists')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', session.body.csrfToken)
      .send({ version: 0, items: { [snap.playlistId]: snap } });
    expect(put.status).toBe(200);
    expect(put.body.version).toBe(1);

    const loaded = await request(app).get('/api/account/data').set('Cookie', cookie);
    expect(loaded.status).toBe(200);
    expect(loaded.body.state.playlists[snap.playlistId].title).toBe('First Course');
    expect(loaded.body.state.activeId).toBeNull();
    expect(loaded.body.state.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('stores multiple rank-history snapshots with distinct per-user keys', async () => {
    const account = await completedAccount('rank_user', 'google-sub-rank', 'rank@example.test');
    const cookie = await sessionCookie(account.userId);
    const session = await request(app).get('/api/auth/session').set('Cookie', cookie);
    const entries = [
      { at: '2026-10-01T00:00:00.000Z', rank: 1, of: 10, metric: 'efficiency' },
      { at: '2026-10-02T00:00:00.000Z', rank: 2, of: 10, metric: 'efficiency' },
    ];
    const put = await request(app)
      .put('/api/account/data/rankHistory')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', session.body.csrfToken)
      .send({ version: 0, items: entries });
    expect(put.status).toBe(200);

    const docs = await store.data('rankHistory').find({ userId: account.userId }, { sort: { order: 1 } });
    expect(docs).toHaveLength(2);
    expect(new Set(docs.map((doc) => doc.key)).size).toBe(2);

    const loaded = await request(app).get('/api/account/data').set('Cookie', cookie);
    expect(loaded.status).toBe(200);
    expect(loaded.body.state.rankHistory).toEqual(entries);
  });

  it('returns an explicit error and preserves data when a required read fails', async () => {
    const account = await completedAccount('read_fail', 'google-sub-readfail', 'readfail@example.test');
    const cookie = await sessionCookie(account.userId);
    await store.data('progress').insertOne({
      userId: account.userId,
      key: 'PLcontract000000000002::e1',
      value: {
        playlistId: 'PLcontract000000000002', position: 1, entryId: 'e1', videoId: 'v1',
        status: 'done', completedAt: '2026-10-02T00:00:00.000Z', notes: 'must survive',
      },
      updatedAt: '2026-10-02T00:00:00.000Z',
      order: 0,
    });
    const progress = store.data('progress');
    const originalFind = progress.find.bind(progress);
    let fail = true;
    progress.find = async (query: any, opts?: any) => {
      if (fail && query.userId === account.userId) throw new Error('simulated database outage');
      return originalFind(query, opts);
    };

    const failed = await request(app).get('/api/account/data').set('Cookie', cookie);
    expect(failed.status).toBe(503);
    expect(failed.body.code).toBe('DATA_READ_FAILED');
    expect(failed.body.state).toBeUndefined();
    expect(await store.data('progress').count({ userId: account.userId })).toBe(1);

    fail = false;
    progress.find = originalFind;
    const retried = await request(app).get('/api/account/data').set('Cookie', cookie);
    expect(retried.status).toBe(200);
    expect(retried.body.state.progress['PLcontract000000000002::e1'].notes).toBe('must survive');
  });

  it('rejects malformed stored records instead of normalizing them to an empty account', async () => {
    const account = await completedAccount('bad_record', 'google-sub-bad', 'bad@example.test');
    const cookie = await sessionCookie(account.userId);
    await store.data('progress').insertOne({
      userId: account.userId,
      key: 'malformed',
      value: undefined,
      updatedAt: '2026-10-02T00:00:00.000Z',
      order: 0,
    });

    const res = await request(app).get('/api/account/data').set('Cookie', cookie);
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('DATA_INTEGRITY_ERROR');
    expect(res.body.state).toBeUndefined();
    expect(await store.data('progress').count({ userId: account.userId })).toBe(1);
  });

  it('rejects a non-null malformed domain payload and preserves it', async () => {
    const account = await completedAccount('bad_payload', 'google-sub-bad-payload', 'bad-payload@example.test');
    const cookie = await sessionCookie(account.userId);
    await store.data('progress').insertOne({
      userId: account.userId,
      key: 'malformed-status',
      value: {
        playlistId: 'PLcontract000000000003',
        position: 1,
        videoId: 'v1',
        status: 'not-a-real-status',
        completedAt: null,
        notes: 'preserve this record',
      },
      updatedAt: '2026-10-02T00:00:00.000Z',
      order: 0,
    });

    const res = await request(app).get('/api/account/data').set('Cookie', cookie);
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('DATA_INTEGRITY_ERROR');
    expect(res.body.state).toBeUndefined();
    expect(await store.data('progress').count({ userId: account.userId })).toBe(1);
  });
});
