import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { createMemoryDb } from '../src/db/memoryAdapter.js';
import { createDataStore, USER_COLLECTIONS, type DataStore } from '../src/store.js';
import { completeOnboarding, createAccountFromGoogle } from '../src/auth/accounts.js';
import { findSessionByToken } from '../src/auth/sessions.js';
import { hashCode } from '../src/auth/crypto.js';
import { deleteAccountPermanently, resumePendingAccountDeletions } from '../src/services/accountDeletion.js';
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
  REAUTH_WINDOW_MIN: '10',
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
  async start() { return { url: 'https://accounts.google.test/auth', state: 'x' }; },
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

async function account(username: string): Promise<{ userId: string; username: string }> {
  const emailAddress = `${username}@example.test`;
  const pending = await createAccountFromGoogle(store, {
    sub: `google-${username}`,
    email: emailAddress,
    emailVerified: true,
    name: username,
  });
  const completed = await completeOnboarding(
    store,
    pending,
    { username, displayName: username, password: 'correct horse battery staple', timezone: 'UTC' },
    await hashCode('correct horse battery staple'),
  );
  return { userId: completed.userId, username };
}

async function login(username: string) {
  const res = await request(app).post('/api/auth/login').send({
    identifier: username,
    password: 'correct horse battery staple',
  });
  expect(res.status).toBe(200);
  return {
    cookie: String(res.headers['set-cookie'][0]).split(';')[0],
    csrf: res.body.csrfToken as string,
  };
}

function authed(req: request.Test, session: { cookie: string; csrf: string }) {
  return req.set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf);
}

const DOMAIN_VALUES: Record<string, any> = {
  playlists: { playlistId: 'PLdelete000000000001', title: 'Delete me', reportedCount: 0, entries: [], source: 'imported', fetchedAt: '2026-10-01T00:00:00.000Z', snapshotVersion: 1 },
  meta: { archived: false, addedAt: '2026-10-01T00:00:00.000Z' },
  progress: { playlistId: 'PLdelete000000000001', position: 1, videoId: 'v1', status: 'done', completedAt: '2026-10-02T00:00:00.000Z' },
  ranges: [],
  checkpoints: [],
  modules: [],
  sessions: [],
  goals: {},
  xp: [],
  achievements: {},
  segments: [],
  playSessions: [],
  queue: {},
  flexGoals: [],
  challenge: null,
  challengeEnabled: false,
  rankHistory: [],
  settings: { verifiedThreshold: 0.9 },
  prefs: { timezone: 'UTC', sessionLenMin: 25, breakMin: 5, reducedMotion: false, minViableMin: 10 },
  activeId: 'PLdelete000000000001',
};

async function seedOwnedRecords(userId: string): Promise<void> {
  for (const name of USER_COLLECTIONS) {
    await store.data(name).insertOne({
      userId,
      key: name === 'activeId' || ['challenge', 'settings', 'prefs'].includes(name) ? 'singleton' : `${name}-key`,
      value: DOMAIN_VALUES[name],
      updatedAt: '2026-10-02T00:00:00.000Z',
      order: 0,
    });
  }
  await store.userData.insertOne({
    userId, domain: 'progress', key: 'unified-key', value: { notes: 'unified' }, updatedAt: '2026-10-02T00:00:00.000Z', order: 0,
  });
  await store.adapter.collection('lq_challenges').insertOne({
    userId, challengeId: `challenge-${userId}`, purpose: 'password_reset', digest: 'not-a-secret',
    createdAt: '2026-10-02T00:00:00.000Z', expiresAt: '2026-10-03T00:00:00.000Z', consumedAt: null,
  });
  await store.adapter.collection('lq_reset_grants').insertOne({
    userId, grantId: `grant-${userId}`, tokenHash: 'not-a-token', createdAt: '2026-10-02T00:00:00.000Z',
    expiresAt: '2026-10-03T00:00:00.000Z', consumedAt: null,
  });
  await store.oauthStates.insertOne({
    userId, stateHash: `state-${userId}`, nonce: 'n', verifier: 'v', intent: 'login', createdAt: '2026-10-02T00:00:00.000Z',
    expiresAt: '2026-10-03T00:00:00.000Z', usedAt: null,
  });
  await store.migrations.insertOne({
    userId, migrationId: `migration-${userId}`, result: { collections: {} }, createdAt: '2026-10-02T00:00:00.000Z',
  });
  await store.stateVersions.insertOne({ userId, version: 3, updatedAt: '2026-10-02T00:00:00.000Z' });
  await store.deletions.insertOne({
    userId, playlistId: 'PLdelete000000000001', title: 'Delete me', status: 'completed',
    startedAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z', deletedCounts: {},
  });
  await store.actionTokens.insertOne({
    userId, tokenId: `token-${userId}`, tokenHash: `hash-${userId}`, purpose: 'password_reset',
    accountEmailNormalized: 'seed@example.test', emailNormalized: 'seed@example.test', targetEmail: 'seed@example.test',
    createdAt: '2026-10-02T00:00:00.000Z', expiresAt: '2026-10-03T00:00:00.000Z', consumedAt: null, lastSentAt: '2026-10-02T00:00:00.000Z',
  });
}

async function remainingOwned(userId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const name of USER_COLLECTIONS) out[`lq_data_${name}`] = await store.data(name).count({ userId });
  out.lq_user_data = await store.userData.count({ userId });
  out.lq_challenges = await store.adapter.collection('lq_challenges').count({ userId });
  out.lq_reset_grants = await store.adapter.collection('lq_reset_grants').count({ userId });
  out.lq_oauth_states = await store.oauthStates.count({ userId });
  out.lq_migrations = await store.migrations.count({ userId });
  out.lq_state_versions = await store.stateVersions.count({ userId });
  out.lq_deletions = await store.deletions.count({ userId });
  out.lq_action_tokens = await store.actionTokens.count({ userId });
  out.lq_sessions = await store.sessions.count({ userId });
  out.lq_accounts = await store.accounts.count({ userId });
  out.lq_account_deletions = await store.accountDeletions.count({ userId });
  return out;
}

describe('complete account deletion', () => {
  it('rejects every invalid confirmation without deleting anything', async () => {
    const a = await account('del_guard');
    await seedOwnedRecords(a.userId);
    const session = await login(a.username);
    const before = await remainingOwned(a.userId);

    const noCsrf = await request(app)
      .post('/api/account/delete')
      .set('Cookie', session.cookie)
      .send({ confirmPhrase: 'DELETE MY ACCOUNT', password: 'correct horse battery staple' });
    expect(noCsrf.status).toBe(403);

    const anonymous = await request(app)
      .post('/api/account/delete')
      .send({ confirmPhrase: 'DELETE MY ACCOUNT', password: 'correct horse battery staple' });
    expect(anonymous.status).toBe(401);

    const wrongPhrase = await authed(request(app).post('/api/account/delete'), session)
      .send({ confirmPhrase: 'DELETE ACCOUNT', password: 'correct horse battery staple' });
    expect(wrongPhrase.status).toBe(400);
    expect(wrongPhrase.body.code).toBe('CONFIRMATION_MISMATCH');

    const wrongPassword = await authed(request(app).post('/api/account/delete'), session)
      .send({ confirmPhrase: 'DELETE MY ACCOUNT', password: 'definitely wrong' });
    expect(wrongPassword.status).toBe(401);

    const clientSuppliedOwner = await authed(request(app).post('/api/account/delete'), session)
      .send({ confirmPhrase: 'DELETE MY ACCOUNT', password: 'correct horse battery staple', userId: 'attacker-chosen' });
    expect(clientSuppliedOwner.status).toBe(400);

    expect(await remainingOwned(a.userId)).toEqual(before);
    expect((await store.accounts.findOne({ userId: a.userId }))?.status).toBe('active');
    expect(await store.accountDeletions.count({ userId: a.userId })).toBe(0);
  });

  it('rejects an expired recent-authentication window before deleting', async () => {
    const a = await account('del_expired');
    await seedOwnedRecords(a.userId);
    const session = await login(a.username);
    // Snapshot after login: the login itself legitimately creates a session.
    const before = await remainingOwned(a.userId);
    const token = session.cookie.split('=')[1];
    const stored = await findSessionByToken(store, token);
    expect(stored).toBeTruthy();
    await store.sessions.updateOne(
      { sessionId: stored!.sessionId },
      { $set: { reauthenticatedAt: new Date(Date.now() - 60 * 60_000).toISOString() } },
    );

    const res = await authed(request(app).post('/api/account/delete'), session)
      .send({ confirmPhrase: 'DELETE MY ACCOUNT', password: 'correct horse battery staple' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('REAUTH_REQUIRED');
    expect(await remainingOwned(a.userId)).toEqual(before);
    expect((await store.accounts.findOne({ userId: a.userId }))?.status).toBe('active');
    expect(await store.data('progress').count({ userId: a.userId })).toBe(1);
  });

  it('deletes every discovered account-owned record, keeps another user intact, and removes the job', async () => {
    const a = await account('del_owner');
    const b = await account('del_other');
    await seedOwnedRecords(a.userId);
    await seedOwnedRecords(b.userId);
    const otherBefore = await remainingOwned(b.userId);
    const session = await login(a.username);
    const secondSession = await login(a.username);

    const res = await authed(request(app).post('/api/account/delete'), session)
      .send({ confirmPhrase: ' DELETE MY ACCOUNT ', password: 'correct horse battery staple' });
    expect(res.status).toBe(204);

    const after = await remainingOwned(a.userId);
    for (const [name, count] of Object.entries(after)) {
      expect(count, `${name} still contains account-owned records`).toBe(0);
    }
    expect(await remainingOwned(b.userId)).toEqual(otherBefore);
    expect(await store.accounts.findOne({ userId: a.userId })).toBeNull();
    expect(await store.accountDeletions.count({ userId: a.userId })).toBe(0);

    // Both previously valid cookies no longer authenticate.
    expect((await request(app).get('/api/account/data').set('Cookie', session.cookie)).status).toBe(401);
    expect((await request(app).get('/api/account/data').set('Cookie', secondSession.cookie)).status).toBe(401);
    const repeat = await authed(request(app).post('/api/account/delete'), session)
      .send({ confirmPhrase: 'DELETE MY ACCOUNT', password: 'correct horse battery staple' });
    expect(repeat.status).toBe(401);
  });

  it('reports incomplete cleanup, blocks access, and resumes the saga after a failure', async () => {
    const a = await account('del_resume');
    const b = await account('del_keep');
    await seedOwnedRecords(a.userId);
    await seedOwnedRecords(b.userId);
    const otherBefore = await remainingOwned(b.userId);
    const session = await login(a.username);

    const progress = store.data('progress');
    const originalDelete = progress.deleteMany.bind(progress);
    let failed = false;
    progress.deleteMany = async (query: any) => {
      if (!failed && query.userId === a.userId) {
        failed = true;
        throw new Error('simulated mid-deletion connection loss');
      }
      return originalDelete(query);
    };

    const failedRes = await authed(request(app).post('/api/account/delete'), session)
      .send({ confirmPhrase: 'DELETE MY ACCOUNT', password: 'correct horse battery staple' });
    progress.deleteMany = originalDelete;
    expect(failedRes.status).toBe(503);
    expect(failedRes.body.code).toBe('ACCOUNT_DELETION_INCOMPLETE');
    const job = await store.accountDeletions.findOne({ userId: a.userId });
    expect(job?.status).toBe('failed');
    expect((await store.accounts.findOne({ userId: a.userId }))?.status).toBe('deleting');
    expect((await request(app).get('/api/account/data').set('Cookie', session.cookie)).status).toBe(401);
    const blockedWrite = await request(app)
      .put('/api/account/data/progress')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf)
      .send({ version: 0, items: {} });
    expect(blockedWrite.status).toBe(401);

    // A process restart calls the sweep; it resumes only already-marked users.
    const resumed = await resumePendingAccountDeletions(store);
    expect(resumed.failed).toBe(0);
    expect(resumed.completed).toBeGreaterThanOrEqual(1);
    for (const [name, count] of Object.entries(await remainingOwned(a.userId))) {
      expect(count, `${name} still contains account-owned records after resume`).toBe(0);
    }
    expect(await remainingOwned(b.userId)).toEqual(otherBefore);
  });

  it('does not delete an active account when a stale job exists', async () => {
    const a = await account('del_active_job');
    await seedOwnedRecords(a.userId);
    await store.accountDeletions.insertOne({
      userId: a.userId, status: 'failed', startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(), attempts: 1, failedCollection: 'verification', deletedCounts: {},
    });
    const result = await resumePendingAccountDeletions(store);
    expect(result.completed).toBe(0);
    expect((await store.accounts.findOne({ userId: a.userId }))?.status).toBe('active');
    expect(await store.data('progress').count({ userId: a.userId })).toBe(1);
    expect(await store.accountDeletions.count({ userId: a.userId })).toBe(1);
  });

  it('is idempotent under duplicate concurrent deletion requests', async () => {
    const a = await account('del_concurrent');
    await seedOwnedRecords(a.userId);
    const session = await login(a.username);

    const [first, second] = await Promise.all([
      authed(request(app).post('/api/account/delete'), session)
        .send({ confirmPhrase: 'DELETE MY ACCOUNT', password: 'correct horse battery staple' }),
      authed(request(app).post('/api/account/delete'), session)
        .send({ confirmPhrase: 'DELETE MY ACCOUNT', password: 'correct horse battery staple' }),
    ]);

    // Either request may win the race; both outcomes must be truthful. A
    // success status is allowed only if no account-owned record remains.
    expect([204, 401, 404, 409, 503]).toContain(first.status);
    expect([204, 401, 404, 409, 503]).toContain(second.status);
    if (first.status === 204 || second.status === 204) {
      for (const [name, count] of Object.entries(await remainingOwned(a.userId))) {
        expect(count, `${name} still contains account-owned records after concurrent deletion`).toBe(0);
      }
    } else {
      // If neither reported success, cleanup must still be resumable and must
      // never leave a completed-looking job.
      const resumed = await resumePendingAccountDeletions(store);
      expect(resumed.failed).toBe(0);
      for (const [name, count] of Object.entries(await remainingOwned(a.userId))) {
        expect(count, `${name} still contains account-owned records after resume`).toBe(0);
      }
    }
  });

  it('supports direct idempotent resume after an already-completed deletion', async () => {
    const a = await account('del_twice');
    await seedOwnedRecords(a.userId);
    const first = await deleteAccountPermanently(store, a.userId);
    expect(first.deleted).toBe(true);
    await expect(deleteAccountPermanently(store, a.userId)).rejects.toMatchObject({ status: 404 });
    await expect(resumePendingAccountDeletions(store)).resolves.toEqual(expect.objectContaining({ failed: 0 }));
    expect(await store.accounts.count({ userId: a.userId })).toBe(0);
    expect(await store.accountDeletions.count({ userId: a.userId })).toBe(0);
  });
});
