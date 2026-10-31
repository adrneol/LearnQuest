import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { createMemoryDb } from '../src/db/memoryAdapter.js';
import { createDataStore, type DataStore } from '../src/store.js';
import { completeOnboarding, createAccountFromGoogle, type Account } from '../src/auth/accounts.js';
import { createSession } from '../src/auth/sessions.js';
import { hashCode } from '../src/auth/crypto.js';
import { readUserState } from '../src/services/userData.js';
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

async function completedAccount(username: string, sub: string, address: string): Promise<Account> {
  const pending = await createAccountFromGoogle(store, { sub, email: address, emailVerified: true, name: username });
  return completeOnboarding(
    store,
    pending,
    { username, displayName: username, password: 'correct horse battery staple', timezone: 'UTC' },
    await hashCode('correct horse battery staple'),
  );
}

async function sessionCookie(userId: string): Promise<string> {
  const created = await createSession(store, userId, { authMethod: 'password' });
  return `lq_session=${created.token}`;
}

async function csrf(cookie: string): Promise<string> {
  const session = await request(app).get('/api/auth/session').set('Cookie', cookie);
  return session.body.csrfToken;
}

function focusSession(id: string, overrides: Record<string, unknown> = {}) {
  const base = {
    id,
    clientId: id,
    playlistId: 'PLappend000000000001',
    startedAt: '2026-10-27T10:00:00.000Z',
    finishedAt: '2026-10-27T10:10:00.000Z',
    activeSec: 600,
    elapsedSec: 600,
    pausedSec: 0,
    intervals: [{
      startMs: Date.parse('2026-10-27T10:00:00.000Z'),
      endMs: Date.parse('2026-10-27T10:10:00.000Z'),
      kind: 'active',
    }],
    estimated: false,
    timerVersion: 2,
    ...overrides,
  };
  if (!('intervals' in overrides)) {
    base.intervals = [{
      startMs: Date.parse(base.startedAt),
      endMs: Date.parse(base.finishedAt as string),
      kind: 'active',
    }];
  }
  return base;
}

function xp(id: string, dedupKey: string) {
  return {
    id,
    dedupKey,
    reason: 'focus',
    points: 5,
    at: '2026-10-27T10:10:00.000Z',
  };
}

describe('bounded append API', () => {
  it('requires authentication, CSRF, and an appendable collection', async () => {
    const account = await completedAccount('append_auth', 'google-sub-append-auth', 'append-auth@example.test');
    const cookie = await sessionCookie(account.userId);
    const token = await csrf(cookie);
    const item = focusSession('session-1');

    const anonymous = await request(app)
      .post('/api/account/data/sessions/append')
      .send({ version: 0, items: [item] });
    expect(anonymous.status).toBe(401);

    const noCsrf = await request(app)
      .post('/api/account/data/sessions/append')
      .set('Cookie', cookie)
      .send({ version: 0, items: [item] });
    expect(noCsrf.status).toBe(403);

    const unsupported = await request(app)
      .post('/api/account/data/goals/append')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', token)
      .send({ version: 0, items: [{ dateKey: '2026-10-27' }] });
    expect(unsupported.status).toBe(400);
    expect(unsupported.body.code).toBe('APPEND_UNSUPPORTED');
  });

  it('appends stable records, survives an idempotent retry, and preserves order', async () => {
    const account = await completedAccount('append_ok', 'google-sub-append-ok', 'append-ok@example.test');
    const cookie = await sessionCookie(account.userId);
    const token = await csrf(cookie);
    const first = focusSession('session-a');
    const second = focusSession('session-b', { startedAt: '2026-10-27T11:00:00.000Z', finishedAt: '2026-10-27T11:10:00.000Z' });

    const appended = await request(app)
      .post('/api/account/data/sessions/append')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', token)
      .send({ version: 0, items: [first, second] });
    expect(appended.status).toBe(200);
    expect(appended.body).toMatchObject({ appended: 2, skipped: 0, version: 1 });

    const retried = await request(app)
      .post('/api/account/data/sessions/append')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', token)
      .send({ version: 0, items: [first, second] });
    expect(retried.status).toBe(200);
    expect(retried.body).toMatchObject({ appended: 0, skipped: 2, version: 1 });

    const { state } = await readUserState(store, account.userId);
    expect(state.sessions.map((session: any) => session.id)).toEqual(['session-a', 'session-b']);
  });

  it('rejects a conflicting edit and a duplicate XP logical award', async () => {
    const account = await completedAccount('append_conflict', 'google-sub-append-conflict', 'append-conflict@example.test');
    const cookie = await sessionCookie(account.userId);
    const token = await csrf(cookie);
    const first = focusSession('session-edit');
    await request(app)
      .post('/api/account/data/sessions/append')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', token)
      .send({ version: 0, items: [first] });

    const changed = await request(app)
      .post('/api/account/data/sessions/append')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', token)
      .send({
        version: 1,
        items: [focusSession('session-edit', {
          finishedAt: '2026-10-27T10:05:00.000Z',
          activeSec: 300,
          elapsedSec: 300,
        })],
      });
    expect(changed.status).toBe(409);
    expect(changed.body.code).toBe('APPEND_CONFLICT');

    const xpAppend = await request(app)
      .post('/api/account/data/xp/append')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', token)
      .send({ version: 1, items: [xp('xp-1', 'focus:one')] });
    expect(xpAppend.status).toBe(200);

    const duplicateAward = await request(app)
      .post('/api/account/data/xp/append')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', token)
      .send({ version: 2, items: [xp('xp-2', 'focus:one')] });
    expect(duplicateAward.status).toBe(409);
    expect(duplicateAward.body.code).toBe('XP_DUPLICATE_DEDUP_KEY');
  });

  it('returns a version conflict for a stale new record and isolates accounts', async () => {
    const owner = await completedAccount('append_owner', 'google-sub-append-owner', 'append-owner@example.test');
    const other = await completedAccount('append_other', 'google-sub-append-other', 'append-other@example.test');
    const ownerCookie = await sessionCookie(owner.userId);
    const ownerToken = await csrf(ownerCookie);
    const otherCookie = await sessionCookie(other.userId);
    const otherToken = await csrf(otherCookie);

    await request(app)
      .post('/api/account/data/sessions/append')
      .set('Cookie', ownerCookie)
      .set('X-CSRF-Token', ownerToken)
      .send({ version: 0, items: [focusSession('owner-session-1')] });

    const stale = await request(app)
      .post('/api/account/data/sessions/append')
      .set('Cookie', ownerCookie)
      .set('X-CSRF-Token', ownerToken)
      .send({ version: 0, items: [focusSession('owner-session-2')] });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('VERSION_CONFLICT');

    await request(app)
      .post('/api/account/data/sessions/append')
      .set('Cookie', otherCookie)
      .set('X-CSRF-Token', otherToken)
      .send({ version: 0, items: [focusSession('other-session-1')] });

    const ownerState = await readUserState(store, owner.userId);
    const otherState = await readUserState(store, other.userId);
    expect(ownerState.state.sessions.map((session: any) => session.id)).toEqual(['owner-session-1']);
    expect(otherState.state.sessions.map((session: any) => session.id)).toEqual(['other-session-1']);
  });

  it('rejects an oversized append request before touching storage', async () => {
    const account = await completedAccount('append_large', 'google-sub-append-large', 'append-large@example.test');
    const cookie = await sessionCookie(account.userId);
    const token = await csrf(cookie);
    const items = Array.from({ length: 5_001 }, (_, i) => xp(`xp-${i}`, `focus:${i}`));

    const res = await request(app)
      .post('/api/account/data/xp/append')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', token)
      .send({ version: 0, items });
    expect(res.status).toBe(400);
    expect(await store.stateVersions.findOne({ userId: account.userId })).toBeNull();

    const { state } = await readUserState(store, account.userId);
    expect(state.xp).toEqual([]);
  });
});
