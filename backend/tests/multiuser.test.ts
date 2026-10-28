import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { createMemoryDb } from '../src/db/memoryAdapter.js';
import { createDataStore, type DataStore } from '../src/store.js';
import { createAccountFromGoogle, completeOnboarding } from '../src/auth/accounts.js';
import { assertProductionConfig } from '../src/config/env.js';
import { hashCode, sessionTokenHash } from '../src/auth/crypto.js';
import { actionTokenDigest } from '../src/auth/actionTokens.js';
import { validateGoogleClaims, createGoogleOAuthService } from '../src/auth/google.js';
import type { ActionEmailInput, EmailService, SecurityNoticeInput } from '../src/email/brevo.js';
import type { GoogleIdentity, GoogleAuthIntent, GoogleOAuthService } from '../src/auth/google.js';
import {
  readUserState, replaceAllUserState, replaceUserCollection, emptyUserState,
} from '../src/services/userData.js';
import { mergeMigrationState } from '../src/routes/account.js';

const P = 'PLmultiuserP00000000';
const Q = 'PLmultiuserQ00000000';
const R = 'PLmultiuserR00000000';

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
  BREVO_SENDER_NAME: 'LearnQuest Test',
  RATE_LIMIT_PER_MIN: '10000',
  AUTH_RATE_LIMIT_PER_MIN: '10000',
  EMAIL_ACTION_RATE_LIMIT_PER_15MIN: '10000',
  TRUST_PROXY_HOPS: '0',
  SESSION_IDLE_HOURS: '168',
  SESSION_ABSOLUTE_DAYS: '30',
  EMAIL_ACTION_TTL_MIN: '30',
  EMAIL_ACTION_RESEND_SEC: '60',
};
const savedEnv: Record<string, string | undefined> = {};
for (const k of Object.keys(ENV)) savedEnv[k] = process.env[k];

class FakeEmail implements EmailService {
  configured = true;
  actions: ActionEmailInput[] = [];
  notices: SecurityNoticeInput[] = [];
  async sendActionEmail(input: ActionEmailInput) { this.actions.push({ ...input }); }
  async sendSecurityNotice(input: SecurityNoticeInput) { this.notices.push({ ...input }); }
}

let db: ReturnType<typeof createMemoryDb>;
let store: DataStore;
let email: FakeEmail;
let googleIdentity: GoogleIdentity;
let app: Express;
let google: GoogleOAuthService;

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v;
  db = createMemoryDb();
  store = createDataStore(db);
  email = new FakeEmail();
  googleIdentity = { sub: 'google-sub-1', email: 'one@example.test', emailVerified: true, name: 'One' };
  const started = new Map<string, { intent: GoogleAuthIntent; binding: string }>();
  google = {
    configured: true,
    async start(intent: GoogleAuthIntent, _userId: string | null, browserBinding: string) {
      // Include the binding in the state key only for this fake; the real
      // service stores a digest of the binding alongside the state.
      const state = `fake-state-${intent}-${browserBinding.slice(0, 8)}`;
      started.set(state, { intent, binding: browserBinding });
      return { url: `https://accounts.google.test/auth?state=${encodeURIComponent(state)}`, state };
    },
    async complete(code: string, state: string, browserBinding: string) {
      const record = started.get(state);
      if (code !== 'code-ok' || !record || record.binding !== browserBinding) {
        throw Object.assign(new Error('bad oauth'), { status: 400, code: 'INVALID_OAUTH_STATE' });
      }
      started.delete(state);
      return { identity: { ...googleIdentity }, intent: record.intent };
    },
  };
  app = createApp({ store, email, google });
});

afterEach(async () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await db.close();
});

async function startGoogle(intent: GoogleAuthIntent) {
  const res = await request(app).get('/api/auth/google/start').query({ intent });
  expect(res.status).toBe(200);
  const state = new URL(res.body.url).searchParams.get('state');
  expect(state).toBeTruthy();
  const cookies = (res.headers['set-cookie'] ?? []) as unknown as string[];
  const binding = cookies.find((cookie) => cookie.startsWith('lq_oauth='))?.split(';')[0];
  expect(binding, 'OAuth start must set a browser-binding cookie').toBeTruthy();
  return { state: state!, cookie: binding! };
}

async function callback(start: { state: string; cookie: string }, code = 'code-ok') {
  return request(app)
    .get('/api/auth/google/callback')
    .set('Cookie', start.cookie)
    .query({ code, state: start.state });
}

function sessionCookie(res: request.Response): string | undefined {
  const cookies = (res.headers['set-cookie'] ?? []) as unknown as string[];
  return cookies.find((cookie) => cookie.startsWith('lq_session='));
}

function actionToken(actionUrl: string): string {
  const url = new URL(actionUrl);
  const token = new URLSearchParams(url.hash.split('?')[1] ?? '').get('token');
  expect(token).toBeTruthy();
  return token!;
}

function snapshot(playlistId: string, title: string, count = 3) {
  return {
    playlistId,
    title,
    channelTitle: 'Channel',
    reportedCount: count,
    entries: Array.from({ length: count }, (_, i) => ({
      position: i + 1,
      entryId: `e${i + 1}`,
      videoId: `v${playlistId.slice(-1)}${i + 1}`,
      title: `${title} ${i + 1}`,
      durationSec: 600,
    })),
    source: 'imported' as const,
    fetchedAt: '2026-10-01T00:00:00.000Z',
    snapshotVersion: 1,
  };
}

function learningState(playlistIds: string[] = [P, Q]) {
  const state: any = emptyUserState();
  for (const id of playlistIds) {
    const snap = snapshot(id, id === P ? 'Course P' : id === Q ? 'Course Q' : 'Course R');
    state.playlists[id] = snap;
    state.meta[id] = { archived: false, addedAt: '2026-10-01T00:00:00.000Z' };
    state.progress[`${id}::e1`] = {
      playlistId: id, position: 1, entryId: 'e1', videoId: snap.entries[0].videoId,
      status: 'done', completedAt: '2026-10-02T00:00:00.000Z', source: 'manual',
      notes: `note-${id}`, confidence: 2, reviewHistory: [
        { id: `rv-${id}`, reviewedAt: '2026-10-03T00:00:00.000Z', dateKey: '2026-10-03' },
      ],
    };
    state.ranges.push({ id: `range-${id}`, playlistId: id, label: 'Range', start: 1, end: 2, createdAt: '2026-10-02T00:00:00.000Z', snapshotVersion: 1 });
    state.checkpoints.push({ id: `cp-${id}`, playlistId: id, label: 'CP', start: 1, end: 2, createdAt: '2026-10-02T00:00:00.000Z', completedAt: null, snapshotVersion: 1 });
    state.modules.push({ id: `mod-${id}`, playlistId: id, name: 'Module', positions: [1, 2] });
    state.sessions.push({
      id: `sess-${id}`, clientId: `client-${id}`, playlistId: id, startedAt: '2026-10-02T10:00:00.000Z',
      finishedAt: '2026-10-02T10:25:00.000Z', activeSec: 1500, elapsedSec: 1500, dateKey: '2026-10-02', note: 'focus',
    });
    state.segments.push({ id: `seg-${id}`, playlistId: id, videoId: 'v1', entryId: 'e1', wallStartMs: 1, wallEndMs: 2, timelineStartSec: 0, timelineEndSec: 60, source: 'verified' });
    state.playSessions.push({ id: `ps-${id}`, playlistId: id, position: 1, videoId: 'v1', startedAt: '2026-10-02T10:00:00.000Z', finishedAt: '2026-10-02T10:05:00.000Z', activePlaybackSec: 300, contentSec: 300, uniqueGainSec: 300, pauseSec: 0, source: 'verified' });
    state.queue[id] = [1, 2];
    state.flexGoals.push({ id: `goal-${id}`, playlistId: id, metric: 'video-count', target: 2, createdAt: '2026-10-01T00:00:00.000Z', achievedAt: null, achievedValue: null });
    state.xp.push({ id: `xp-${id}`, reason: 'videoDone', points: 10, dedupKey: `done:${id}:e1`, at: '2026-10-02T00:00:00.000Z' });
  }
  state.xp.push({ id: 'xp-day', reason: 'studyDay', points: 5, dedupKey: 'day:2026-10-02', at: '2026-10-02T00:00:00.000Z' });
  state.activeId = playlistIds[0] ?? null;
  state.prefs = { timezone: 'UTC', sessionLenMin: 25, breakMin: 5, reducedMotion: false, minViableMin: 10 };
  state.settings = { verifiedThreshold: 0.9 };
  return state;
}

async function seedUser(username: string, emailAddress: string, password: string, sub: string) {
  const account = await createAccountFromGoogle(store, { sub, email: emailAddress, emailVerified: true, name: username });
  const hash = await hashCode(password);
  return completeOnboarding(store, account, { username, displayName: username, password, timezone: 'UTC' }, hash);
}

async function login(identifier: string, password: string) {
  const res = await request(app).post('/api/auth/login').send({ identifier, password });
  expect(res.status).toBe(200);
  return {
    cookie: String(res.headers['set-cookie'][0]).split(';')[0],
    csrf: res.body.csrfToken as string,
    user: res.body.user,
  };
}

function authed(req: request.Test, session: { cookie: string; csrf: string }) {
  return req.set('Cookie', session.cookie).set('X-CSRF-Token', session.csrf);
}

async function putState(userId: string, state: unknown) {
  const current = await readUserState(store, userId);
  return replaceAllUserState(store, userId, state, current.version);
}

async function stateVersion(session: { cookie: string; csrf: string }) {
  const res = await authed(request(app).get('/api/account/data'), session);
  expect(res.status).toBe(200);
  return res.body.version as number;
}

describe('account registration and sessions', () => {
  it('creates a Google account through explicit registration and rotates the session', async () => {
    const state = await startGoogle('register');
    const callbackRes = await callback(state);
    expect(callbackRes.status).toBe(303);
    expect(callbackRes.headers.location).toContain('/#/onboarding');
    const cookie = String(callbackRes.headers['set-cookie'][0]).split(';')[0];
    const session1 = await request(app).get('/api/auth/session').set('Cookie', cookie);
    expect(session1.body.authenticated).toBe(true);
    expect(session1.body.onboardingRequired).toBe(true);
    expect(session1.body.configured.emailLinks).toBe(true);
    expect(session1.body.configured.otp).toBeUndefined();
    const onboard = await request(app)
      .post('/api/auth/onboarding')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', session1.body.csrfToken)
      .send({ username: 'one_user', displayName: 'One', password: 'correct horse battery staple', timezone: 'UTC' });
    expect(onboard.status).toBe(200);
    const newCookie = String(onboard.headers['set-cookie'][0]).split(';')[0];
    expect(newCookie).not.toBe(cookie);
    const oldSession = await request(app).get('/api/auth/session').set('Cookie', cookie);
    expect(oldSession.body.authenticated).toBe(false);
    const fresh = await request(app).get('/api/auth/session').set('Cookie', newCookie);
    expect(fresh.body.authenticated).toBe(true);
    expect(fresh.body.user.username).toBe('one_user');
    expect(fresh.body.user.hasPassword).toBe(true);
    const stored = await store.accounts.findOne({ usernameNormalized: 'one_user' });
    expect(stored?.passwordHash).not.toBe('correct horse battery staple');
    expect(String(stored?.passwordHash)).toMatch(/^\$argon2id\$/);
  });

  it('rejects a duplicate username and leaves the second registration pending', async () => {
    await seedUser('taken_name', 'taken@example.test', 'correct horse battery staple', 'google-sub-taken');
    googleIdentity = { sub: 'google-sub-duplicate', email: 'duplicate@example.test', emailVerified: true, name: 'Duplicate' };
    const callbackRes = await callback(await startGoogle('register'));
    expect(callbackRes.status).toBe(303);
    const cookie = String(callbackRes.headers['set-cookie'][0]).split(';')[0];
    const session = await request(app).get('/api/auth/session').set('Cookie', cookie);

    const duplicate = await request(app)
      .post('/api/auth/onboarding')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', session.body.csrfToken)
      .send({ username: 'taken_name', displayName: 'Duplicate', password: 'correct horse battery staple', timezone: 'UTC' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('USERNAME_TAKEN');

    const pending = await store.accounts.findOne({ userId: session.body.user.userId });
    expect(pending?.onboardingComplete).toBe(false);
    expect(pending?.username).toBeNull();
    expect((await store.accounts.findOne({ usernameNormalized: 'taken_name' }))?.onboardingComplete).toBe(true);
  });

  it('rejects an expired Google onboarding session without persisting setup', async () => {
    googleIdentity = { sub: 'google-sub-expired', email: 'expired@example.test', emailVerified: true, name: 'Expired' };
    const callbackRes = await callback(await startGoogle('register'));
    expect(callbackRes.status).toBe(303);
    const cookie = String(callbackRes.headers['set-cookie'][0]).split(';')[0];
    const session = await request(app).get('/api/auth/session').set('Cookie', cookie);
    const sessionDoc = await store.sessions.findOne({ userId: session.body.user.userId });
    await store.sessions.updateOne(
      { sessionId: sessionDoc!.sessionId },
      { $set: { onboardingExpiresAt: new Date(Date.now() - 60_000).toISOString() } },
    );

    const expired = await request(app)
      .post('/api/auth/onboarding')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', session.body.csrfToken)
      .send({ username: 'expired_user', displayName: 'Expired', password: 'correct horse battery staple', timezone: 'UTC' });
    expect(expired.status).toBe(403);
    expect(expired.body.code).toBe('ONBOARDING_SESSION_INVALID');

    const pending = await store.accounts.findOne({ userId: session.body.user.userId });
    expect(pending?.onboardingComplete).toBe(false);
    expect(pending?.username).toBeNull();
    expect(await store.accounts.count({ usernameNormalized: 'expired_user' })).toBe(0);
  });

  it('enforces the password length boundaries during onboarding', async () => {
    googleIdentity = { sub: 'google-sub-boundary', email: 'boundary@example.test', emailVerified: true, name: 'Boundary' };
    const callbackRes = await callback(await startGoogle('register'));
    expect(callbackRes.status).toBe(303);
    const cookie = String(callbackRes.headers['set-cookie'][0]).split(';')[0];
    const session = await request(app).get('/api/auth/session').set('Cookie', cookie);
    const submit = (password: string) => request(app)
      .post('/api/auth/onboarding')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', session.body.csrfToken)
      .send({ username: 'boundary_user', displayName: 'Boundary', password, timezone: 'UTC' });

    const tooShort = await submit('x'.repeat(11));
    expect(tooShort.status).toBe(400);
    expect(tooShort.body.code).toBe('WEAK_PASSWORD');

    const tooLong = await submit('x'.repeat(129));
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.code).toBe('INVALID_REQUEST');

    const exactMinimum = await submit('long enough!');
    expect(exactMinimum.status).toBe(200);
    const loginRes = await request(app).post('/api/auth/login').send({ identifier: 'boundary_user', password: 'long enough!' });
    expect(loginRes.status).toBe(200);
  });

  it('does not create an account when an unknown Google identity uses sign-in', async () => {
    const state = await startGoogle('login');
    const callbackRes = await callback(state);
    expect(callbackRes.status).toBe(303);
    expect(callbackRes.headers.location).toContain('error=google_account_not_found');
    expect(sessionCookie(callbackRes)).toBeUndefined();
    expect(await store.accounts.count({})).toBe(0);
  });

  it('signs in an existing Google identity only through the login intent', async () => {
    await seedUser('google_login', 'glogin@example.test', 'correct horse battery staple', 'google-sub-glogin');
    googleIdentity = { sub: 'google-sub-glogin', email: 'glogin@example.test', emailVerified: true, name: 'Google Login' };
    const loginState = await startGoogle('login');
    const loggedIn = await callback(loginState);
    expect(loggedIn.status).toBe(303);
    expect(loggedIn.headers.location).toContain('/#/dash');
    expect(loggedIn.headers['set-cookie']).toBeTruthy();

    const duplicate = await callback(await startGoogle('register'));
    expect(duplicate.headers.location).toContain('error=google_account_exists');
    expect(sessionCookie(duplicate)).toBeUndefined();
    expect(await store.accounts.count({ googleSub: 'google-sub-glogin' })).toBe(1);
  });

  it('rejects an unverified Google email without creating an account', async () => {
    googleIdentity = { sub: 'unverified-sub', email: 'unverified@example.test', emailVerified: false };
    const state = await startGoogle('register');
    const res = await callback(state);
    expect(res.headers.location).toContain('error=EMAIL_NOT_VERIFIED');
    expect(sessionCookie(res)).toBeUndefined();
    expect(await store.accounts.count({ googleSub: 'unverified-sub' })).toBe(0);
  });

  it('does not auto-link an existing email to a different Google identity', async () => {
    await seedUser('existing', 'linked@example.test', 'correct horse battery staple', 'google-sub-existing');
    googleIdentity = { sub: 'different-google-sub', email: 'linked@example.test', emailVerified: true };
    const cb = await callback(await startGoogle('register'));
    expect(cb.status).toBe(303);
    expect(cb.headers.location).toContain('error=LINK_REQUIRED');
    expect(await store.accounts.count({ emailNormalized: 'linked@example.test' })).toBe(1);
  });

  it('rotates session cookies, invalidates logout, and rejects CSRF-less mutations', async () => {
    await seedUser('alice', 'alice@example.test', 'correct horse battery staple', 'google-sub-a');
    const s = await login('alice', 'correct horse battery staple');
    const missingCsrf = await request(app).get('/api/account/data').set('Cookie', s.cookie);
    expect(missingCsrf.status).toBe(200); // reads do not require CSRF
    const blocked = await request(app)
      .put('/api/account/data/activeId')
      .set('Cookie', s.cookie)
      .send({ version: 0, items: P });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('CSRF_FAILED');
    const logout = await authed(request(app).post('/api/auth/logout'), s);
    expect(logout.status).toBe(204);
    expect((await request(app).get('/api/auth/session').set('Cookie', s.cookie)).body.authenticated).toBe(false);
  });

  it('revokes every device on logout-all without affecting another account', async () => {
    await seedUser('all_one', 'allone@example.test', 'correct horse battery staple', 'google-sub-all-one');
    await seedUser('all_two', 'alltwo@example.test', 'correct horse battery staple', 'google-sub-all-two');
    const first = await login('all_one', 'correct horse battery staple');
    const second = await login('all_one', 'correct horse battery staple');
    const other = await login('all_two', 'correct horse battery staple');

    const logoutAll = await authed(request(app).post('/api/auth/logout-all'), first);
    expect(logoutAll.status).toBe(204);
    const cleared = String(logoutAll.headers['set-cookie'][0]);
    expect(cleared).toContain('lq_session=');
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    expect(cleared).toContain('HttpOnly');
    expect(cleared).toContain('SameSite=Lax');
    expect(cleared).toContain('Path=/');
    expect(cleared).not.toMatch(/;\s*Domain=/i);

    for (const session of [first, second]) {
      expect((await request(app).get('/api/account/data').set('Cookie', session.cookie)).status).toBe(401);
      expect((await request(app).get('/api/auth/session').set('Cookie', session.cookie)).body.authenticated).toBe(false);
    }
    expect((await request(app).get('/api/account/data').set('Cookie', other.cookie)).status).toBe(200);
  });

  it('does not treat a stale-password-version session as authenticated', async () => {
    const account = await seedUser('versioned', 'versioned@example.test', 'correct horse battery staple', 'google-sub-versioned');
    const session = await login('versioned', 'correct horse battery staple');
    await store.accounts.updateOne(
      { userId: account.userId },
      { $set: { passwordVersion: Number(account.passwordVersion ?? 0) + 1 } },
    );

    const status = await request(app).get('/api/auth/session').set('Cookie', session.cookie);
    expect(status.status).toBe(200);
    expect(status.body.authenticated).toBe(false);
    expect(status.body.csrfToken).toBeUndefined();
    expect(String(status.headers['set-cookie'][0])).toContain('Max-Age=0');
    expect((await request(app).get('/api/account/data').set('Cookie', session.cookie)).status).toBe(401);
  });

  it('does not treat an expired pending-registration session as authenticated', async () => {
    const state = await startGoogle('register');
    const callbackRes = await callback(state);
    expect(callbackRes.status).toBe(303);
    const cookie = String(callbackRes.headers['set-cookie'][0]).split(';')[0];
    const session = await request(app).get('/api/auth/session').set('Cookie', cookie);
    expect(session.body.authenticated).toBe(true);
    expect(session.body.onboardingRequired).toBe(true);

    const sessionDoc = await store.sessions.findOne({ userId: session.body.user.userId });
    expect(sessionDoc).toBeTruthy();
    await store.sessions.updateOne(
      { sessionId: sessionDoc!.sessionId },
      { $set: { onboardingExpiresAt: new Date(Date.now() - 60_000).toISOString() } },
    );

    const expired = await request(app).get('/api/auth/session').set('Cookie', cookie);
    expect(expired.status).toBe(200);
    expect(expired.body.authenticated).toBe(false);
    expect(String(expired.headers['set-cookie'][0])).toContain('Max-Age=0');
    expect((await request(app).get('/api/account/data').set('Cookie', cookie)).status).toBe(401);
  });

  it('rejects idle-expired and absolute-expired sessions at the status endpoint', async () => {
    await seedUser('expiry_session', 'expiry-session@example.test', 'correct horse battery staple', 'google-sub-expiry-session');
    const idle = await login('expiry_session', 'correct horse battery staple');
    const absolute = await login('expiry_session', 'correct horse battery staple');
    const idleToken = idle.cookie.slice(idle.cookie.indexOf('=') + 1);
    const idleDoc = await store.sessions.findOne({ tokenHash: sessionTokenHash(idleToken) });
    expect(idleDoc).toBeTruthy();
    await store.sessions.updateOne(
      { sessionId: idleDoc!.sessionId },
      { $set: { idleExpiresAt: new Date(Date.now() - 60_000).toISOString() } },
    );
    const idleStatus = await request(app).get('/api/auth/session').set('Cookie', idle.cookie);
    expect(idleStatus.body.authenticated).toBe(false);
    expect(String(idleStatus.headers['set-cookie'][0])).toContain('Max-Age=0');

    await store.sessions.updateOne(
      { userId: absolute.user.userId, revokedAt: null },
      { $set: { expiresAt: new Date(Date.now() - 60_000).toISOString() } },
    );
    const absoluteStatus = await request(app).get('/api/auth/session').set('Cookie', absolute.cookie);
    expect(absoluteStatus.body.authenticated).toBe(false);
    expect(String(absoluteStatus.headers['set-cookie'][0])).toContain('Max-Age=0');
  });

  it('uses Secure __Host- cookies in production', async () => {
    process.env.NODE_ENV = 'production';
    await seedUser('prod', 'prod@example.test', 'correct horse battery staple', 'google-sub-prod');
    const res = await request(app).post('/api/auth/login').send({ identifier: 'prod', password: 'correct horse battery staple' });
    expect(res.status).toBe(200);
    const cookie = String(res.headers['set-cookie'][0]);
    expect(cookie).toContain('__Host-lq_session=');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).not.toMatch(/;\s*Domain=/i);
    expect(cookie).toContain('Expires=');
  });

  it('puts only the opaque session identifier in the cookie, never account or learning data', async () => {
    await seedUser('cookie_a', 'cookie@example.test', 'correct horse battery staple', 'google-sub-cookie');
    const res = await request(app).post('/api/auth/login').send({ identifier: 'cookie_a', password: 'correct horse battery staple' });
    expect(res.status).toBe(200);
    const setCookie = String(res.headers['set-cookie'][0]);
    const value = setCookie.split(';')[0].slice('lq_session='.length);
    expect(value).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(() => JSON.parse(value)).toThrow();
    expect(setCookie).not.toContain('cookie@example.test');
    expect(setCookie).not.toContain(res.body.user.userId);
    expect(setCookie).not.toContain('correct horse battery staple');
    expect(setCookie).not.toContain(P);
    expect(setCookie).not.toContain('note-');
  });

  it('returns the same generic response for unknown and wrong-password logins', async () => {
    await seedUser('bob', 'bob@example.test', 'correct horse battery staple', 'google-sub-b');
    const unknown = await request(app).post('/api/auth/login').send({ identifier: 'nobody', password: 'whatever-password' });
    const wrong = await request(app).post('/api/auth/login').send({ identifier: 'bob', password: 'definitely-wrong' });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error).toBe(wrong.body.error);
    expect(unknown.body.error).toMatch(/Invalid username\/email or password/);
  });

  it('rejects cross-origin browser mutations', async () => {
    const res = await request(app).post('/api/auth/login').set('Origin', 'https://evil.example').send({ identifier: 'x', password: 'y' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORIGIN_NOT_ALLOWED');
  });
});

describe('OAuth, email links, and password recovery security', () => {
  it('rejects forged Google claims (audience, issuer, nonce, expiry, unverified email)', () => {
    const base = { sub: 's', email: 'a@example.test', email_verified: true, aud: 'client', iss: 'https://accounts.google.com', nonce: 'n', exp: Math.floor(Date.now() / 1000) + 60 };
    expect(validateGoogleClaims(base, { nonce: 'n', clientId: 'client' }).sub).toBe('s');
    expect(() => validateGoogleClaims({ ...base, aud: 'other' }, { nonce: 'n', clientId: 'client' })).toThrow(/audience/);
    expect(() => validateGoogleClaims({ ...base, iss: 'https://evil.example' }, { nonce: 'n', clientId: 'client' })).toThrow(/issuer/);
    expect(() => validateGoogleClaims({ ...base, nonce: 'other' }, { nonce: 'n', clientId: 'client' })).toThrow(/nonce/);
    expect(() => validateGoogleClaims({ ...base, exp: 1 }, { nonce: 'n', clientId: 'client' })).toThrow(/expired/);
    expect(() => validateGoogleClaims({ ...base, email_verified: false }, { nonce: 'n', clientId: 'client' })).toThrow();
  });

  it('consumes OAuth state once, preserves the server-side intent, and rejects replay', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ id_token: 'fake-id-token' }) } as any);
    const svc = createGoogleOAuthService(store, {
      fetchImpl,
      verifyIdToken: async (_t, expected) => validateGoogleClaims({
        sub: 'google-state', email: 'state@example.test', email_verified: true,
        aud: expected.clientId, iss: 'https://accounts.google.com', nonce: expected.nonce,
        exp: Math.floor(Date.now() / 1000) + 60,
      }, expected),
    });
    const browserBinding = 'test-browser-binding-0123456789-abcdefghijklmnopqrstuvwxyz';
    const { url, state } = await svc.start('register', null, browserBinding);
    expect(url).toContain('code_challenge=');
    expect(url).toContain('nonce=');
    const result = await svc.complete('auth-code', state, browserBinding);
    expect(result.intent).toBe('register');
    expect(result.identity.sub).toBe('google-state');
    await expect(svc.complete('auth-code', state, browserBinding)).rejects.toMatchObject({ code: 'INVALID_OAUTH_STATE' });
  });

  it('binds OAuth state to the initiating browser and rejects missing, mismatched, and replayed bindings', async () => {
    await seedUser('oauth_bind', 'oauth-bind@example.test', 'correct horse battery staple', 'google-sub-oauth-bind');
    googleIdentity = { sub: 'google-sub-oauth-bind', email: 'oauth-bind@example.test', emailVerified: true };
    const start = await startGoogle('login');

    const missing = await request(app)
      .get('/api/auth/google/callback')
      .query({ code: 'code-ok', state: start.state });
    expect(missing.headers.location).toContain('error=invalid_oauth_state');
    expect(sessionCookie(missing)).toBeUndefined();

    const mismatched = await request(app)
      .get('/api/auth/google/callback')
      .set('Cookie', 'lq_oauth=not-the-initiating-browser-0123456789')
      .query({ code: 'code-ok', state: start.state });
    expect(mismatched.headers.location).toContain('error=INVALID_OAUTH_STATE');
    expect(sessionCookie(mismatched)).toBeUndefined();

    // The failed attempts did not consume the state; the initiating browser
    // can still complete the flow.
    const success = await callback(start);
    expect(success.headers.location).toContain('/#/dash');
    expect(sessionCookie(success)).toBeTruthy();

    // Replaying the same state from the same browser is rejected because the
    // atomic consumption already marked it used.
    const replay = await callback(start);
    expect(replay.headers.location).toContain('error=INVALID_OAUTH_STATE');
    expect(sessionCookie(replay)).toBeUndefined();
  });

  it('rejects an invalid OAuth intent without starting a flow', async () => {
    const res = await request(app).get('/api/auth/google/start').query({ intent: 'admin' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_OAUTH_INTENT');
  });

  it('rejects onboarding from a password session or a tampered Google onboarding binding', async () => {
    await seedUser('onboard_guard', 'guard@example.test', 'correct horse battery staple', 'google-sub-guard');
    const s = await login('onboard_guard', 'correct horse battery staple');
    const passwordSession = await authed(request(app).post('/api/auth/onboarding'), s)
      .send({ username: 'other_name', displayName: 'Other', password: 'another long password value' });
    expect(passwordSession.status).toBe(409); // already onboarded; never re-runs setup
    expect(passwordSession.body.code).toBe('ONBOARDING_COMPLETE');

    const pendingState = await startGoogle('register');
    const cb = await callback(pendingState);
    const cookie = String(cb.headers['set-cookie'][0]).split(';')[0];
    const session = await request(app).get('/api/auth/session').set('Cookie', cookie);
    const sessionDoc = await store.sessions.findOne({ userId: session.body.user.userId });
    await store.sessions.updateOne({ sessionId: sessionDoc!.sessionId }, { $set: { onboardingGoogleSub: 'someone-else' } });
    const tampered = await request(app)
      .post('/api/auth/onboarding')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', session.body.csrfToken)
      .send({ username: 'tampered_name', displayName: 'Tampered', password: 'long enough password' });
    expect(tampered.status).toBe(403);
    expect(tampered.body.code).toBe('ONBOARDING_SESSION_INVALID');
  });

  it('returns an identical generic response for known and unknown password-recovery identifiers', async () => {
    const knownAccount = await seedUser('recover_a', 'recover@example.test', 'correct horse battery staple', 'google-sub-recover');
    const known = await request(app).post('/api/auth/forgot').send({ identifier: 'recover_a' });
    const unknown = await request(app).post('/api/auth/forgot').send({ identifier: 'nobody@example.test' });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    expect(known.body.challengeId).toBeUndefined();
    expect(known.body.resetToken).toBeUndefined();
    expect(String(known.body.message)).toMatch(/if an eligible account matches/i);
    expect(String(known.body.message)).toMatch(/send a password-reset link/i);
    expect(email.actions).toHaveLength(1);
    const records = await store.actionTokens.find({ purpose: 'password_reset' });
    expect(records).toHaveLength(1);
    expect(records[0].userId).toBe(knownAccount.userId);
    expect(records[0].targetEmail).toBe('recover@example.test');
  });

  it('does not issue a link for an incomplete Google registration or a deleting account', async () => {
    const pending = await createAccountFromGoogle(store, {
      sub: 'google-sub-pending', email: 'pending@example.test', emailVerified: true, name: 'Pending',
    });
    const pendingRes = await request(app).post('/api/auth/forgot').send({ identifier: 'pending@example.test' });
    expect(pendingRes.status).toBe(202);
    expect(String(pendingRes.body.message)).toMatch(/if an eligible account matches/i);
    expect(email.actions).toHaveLength(0);
    expect(await store.actionTokens.count({ userId: pending.userId, purpose: 'password_reset' })).toBe(0);

    const deleting = await seedUser('deleting_a', 'deleting@example.test', 'correct horse battery staple', 'google-sub-deleting');
    await store.accounts.updateOne({ userId: deleting.userId }, { $set: { status: 'deleting' } });
    const deletingRes = await request(app).post('/api/auth/forgot').send({ identifier: 'deleting_a' });
    expect(deletingRes.status).toBe(202);
    expect(email.actions).toHaveLength(0);
    expect(await store.actionTokens.count({ userId: deleting.userId, purpose: 'password_reset' })).toBe(0);
  });

  it('keeps a generic response while invalidating the link when email delivery fails', async () => {
    const account = await seedUser('mailfail_a', 'mailfail@example.test', 'correct horse battery staple', 'google-sub-mailfail');
    const original = email.sendActionEmail.bind(email);
    email.sendActionEmail = async () => {
      throw Object.assign(new Error('simulated provider outage'), { status: 502, code: 'EMAIL_DELIVERY_FAILED' });
    };
    try {
      const res = await request(app).post('/api/auth/forgot').send({ identifier: 'mailfail_a' });
      expect(res.status).toBe(202);
      expect(String(res.body.message)).toMatch(/if an eligible account matches/i);
      expect(String(res.body.message)).not.toMatch(/delivered|sent to|inbox/i);
      expect(await store.actionTokens.count({ userId: account.userId, purpose: 'password_reset', consumedAt: null })).toBe(0);
    } finally {
      email.sendActionEmail = original;
    }
  });

  it('invalidates a pending reset link when the password is changed from a signed-in session', async () => {
    const oldPassword = 'correct horse battery staple';
    const newPassword = 'new correct horse battery staple';
    const account = await seedUser('pwchange_invalidate', 'pwchange-invalidate@example.test', oldPassword, 'google-sub-pwchange-invalidate');
    await request(app).post('/api/auth/forgot').send({ identifier: 'pwchange_invalidate' });
    expect(email.actions).toHaveLength(1);
    const token = actionToken(email.actions[0].actionUrl);

    const session = await login('pwchange_invalidate', oldPassword);
    const change = await authed(request(app).post('/api/auth/password/change'), session).send({
      currentPassword: oldPassword,
      newPassword,
    });
    expect(change.status).toBe(200);

    const replay = await request(app).post('/api/auth/password/reset').send({
      token,
      newPassword: 'yet another long password value',
    });
    expect(replay.status).toBe(400);
    expect(await store.actionTokens.count({ userId: account.userId, consumedAt: null })).toBe(0);
  });

  it('invalidates a pending email-change link when the password is reset', async () => {
    const oldPassword = 'correct horse battery staple';
    const newPassword = 'reset correct horse battery staple';
    const account = await seedUser('reset_email_link', 'reset-email-link@example.test', oldPassword, 'google-sub-reset-email-link');
    const session = await login('reset_email_link', oldPassword);
    const change = await authed(request(app).post('/api/account/email/change'), session).send({
      newEmail: 'reset-email-link-new@example.test',
      password: oldPassword,
    });
    expect(change.status).toBe(202);
    const emailChangeAction = email.actions.find((action) => action.purpose === 'email_change');
    expect(emailChangeAction).toBeTruthy();
    const emailChangeToken = actionToken(emailChangeAction!.actionUrl);

    await request(app).post('/api/auth/forgot').send({ identifier: 'reset_email_link' });
    const resetAction = email.actions.filter((action) => action.purpose === 'password_reset').at(-1);
    expect(resetAction).toBeTruthy();
    const reset = await request(app).post('/api/auth/password/reset').send({
      token: actionToken(resetAction!.actionUrl),
      newPassword,
    });
    expect(reset.status).toBe(204);

    const staleConfirmation = await request(app).post('/api/account/email/confirm').send({ token: emailChangeToken });
    expect(staleConfirmation.status).toBe(400);
    expect(await store.actionTokens.count({ userId: account.userId, consumedAt: null })).toBe(0);
  });

  it('cannot reset with an arbitrary email plus a guessed or wrong-account token', async () => {
    const a = await seedUser('guess_a', 'guessa@example.test', 'correct horse battery staple', 'google-sub-guessa');
    const b = await seedUser('guess_b', 'guessb@example.test', 'correct horse battery staple', 'google-sub-guessb');
    const guessed = await request(app).post('/api/auth/password/reset').send({
      token: 'A'.repeat(43), newPassword: 'another long password value',
    });
    expect(guessed.status).toBe(400);
    const unchanged = await request(app).post('/api/auth/login').send({ identifier: 'guess_a', password: 'correct horse battery staple' });
    expect(unchanged.status).toBe(200);

    await request(app).post('/api/auth/forgot').send({ identifier: 'guess_b' });
    const bToken = actionToken(email.actions.at(-1)!.actionUrl);
    const wrongAccount = await request(app).post('/api/auth/password/reset').send({
      token: bToken, newPassword: 'another long password value',
    });
    expect(wrongAccount.status).toBe(204); // the token is valid for B...
    const aLogin = await request(app).post('/api/auth/login').send({ identifier: 'guess_a', password: 'correct horse battery staple' });
    expect(aLogin.status).toBe(200); // ...and never changes A's password.
    const bLogin = await request(app).post('/api/auth/login').send({ identifier: 'guess_b', password: 'another long password value' });
    expect(bLogin.status).toBe(200);
    expect(a.userId).not.toBe(b.userId);
  });

  it('stores only an HMAC digest and delivers a fragment action link, never a numeric code', async () => {
    const account = await seedUser('linkhash', 'linkhash@example.test', 'correct horse battery staple', 'google-sub-linkhash');
    await request(app).post('/api/auth/forgot').send({ identifier: 'linkhash' });
    const action = email.actions.at(-1)!;
    const token = actionToken(action.actionUrl);
    expect(action.actionUrl).toContain('/#/reset-password?token=');
    expect(action.actionUrl.startsWith(`${process.env.APP_ORIGIN}/#/reset-password?token=`)).toBe(true);
    expect(new URL(action.actionUrl).search).toBe(''); // token is never in the server-visible query string
    expect(new URL(action.actionUrl).hash).toContain('token=');
    expect(action).not.toHaveProperty('code');
    const record = await store.actionTokens.findOne({ userId: account.userId, purpose: 'password_reset' });
    expect(record?.tokenHash).toBeTruthy();
    expect(record?.tokenHash).not.toBe(token);
    expect(JSON.stringify(record)).not.toContain(token);
    expect(JSON.stringify(record)).not.toMatch(/"code"/);
  });

  it('enforces the resend cooldown and invalidates older links when a new one is sent', async () => {
    const account = await seedUser('resend_a', 'resend@example.test', 'correct horse battery staple', 'google-sub-resend');
    await request(app).post('/api/auth/forgot').send({ identifier: 'resend_a' });
    const firstToken = actionToken(email.actions[0].actionUrl);
    await request(app).post('/api/auth/forgot').send({ identifier: 'resend_a' });
    expect(email.actions).toHaveLength(1); // cooldown suppressed a second message
    await store.actionTokens.updateOne(
      { userId: account.userId, purpose: 'password_reset' },
      { $set: { createdAt: new Date(Date.now() - 120_000).toISOString() } },
    );
    await request(app).post('/api/auth/forgot').send({ identifier: 'resend_a' });
    expect(email.actions).toHaveLength(2);
    const secondToken = actionToken(email.actions[1].actionUrl);
    expect(secondToken).not.toBe(firstToken);
    const old = await request(app).post('/api/auth/password/reset').send({ token: firstToken, newPassword: 'new long password value' });
    expect(old.status).toBe(400);
    const fresh = await request(app).post('/api/auth/password/reset').send({ token: secondToken, newPassword: 'new long password value' });
    expect(fresh.status).toBe(204);
  });

  it('expires links and rejects wrong-purpose, account-mismatched, malformed, and reused tokens', async () => {
    const a = await seedUser('tok_a', 'toka@example.test', 'correct horse battery staple', 'google-sub-toka');
    await request(app).post('/api/auth/forgot').send({ identifier: 'tok_a' });
    const resetToken = actionToken(email.actions.at(-1)!.actionUrl);
    const record = await store.actionTokens.findOne({ userId: a.userId, purpose: 'password_reset' });
    // The reported link was opened roughly 37 minutes after it was received.
    // Keep the record physically present to prove expiry is enforced by the
    // consume predicate, not by a TTL cleanup.
    await store.actionTokens.updateOne({ tokenId: record!.tokenId }, { $set: { expiresAt: new Date(Date.now() - 37 * 60_000).toISOString() } });
    const expired = await request(app).post('/api/auth/password/reset').send({ token: resetToken, newPassword: 'another long password' });
    expect(expired.status).toBe(400);
    expect(expired.body.code).toBe('INVALID_RESET_TOKEN');
    const stillPresent = await store.actionTokens.findOne({ tokenId: record!.tokenId });
    expect(stillPresent).toBeTruthy();
    expect(stillPresent?.consumedAt).toBeNull();

    const malformed = await request(app).post('/api/auth/password/reset').send({ token: 'short', newPassword: 'another long password' });
    expect(malformed.status).toBe(400);

    // A valid reset token cannot be used for email-change confirmation.
    await store.actionTokens.updateOne({ tokenId: record!.tokenId }, { $set: { expiresAt: new Date(Date.now() + 60_000).toISOString(), consumedAt: null } });
    const wrongPurpose = await request(app).post('/api/account/email/confirm').send({ token: resetToken });
    expect(wrongPurpose.status).toBe(400);

    // Account/email binding: a link issued for A is invalid after A's email changes.
    await request(app).post('/api/auth/forgot').send({ identifier: 'tok_a' });
    const boundToken = actionToken(email.actions.at(-1)!.actionUrl);
    await store.accounts.updateOne({ userId: a.userId }, { $set: { email: 'changed@example.test', emailNormalized: 'changed@example.test' } });
    const mismatch = await request(app).post('/api/auth/password/reset').send({ token: boundToken, newPassword: 'yet another long password' });
    expect(mismatch.status).toBe(400);
  });

  it('validates a reset link without consuming it and reports an expired link separately', async () => {
    const account = await seedUser('validate_a', 'validate@example.test', 'correct horse battery staple', 'google-sub-validate');
    await request(app).post('/api/auth/forgot').send({ identifier: 'validate_a' });
    const token = actionToken(email.actions.at(-1)!.actionUrl);
    const record = await store.actionTokens.findOne({ userId: account.userId, purpose: 'password_reset' });

    const valid = await request(app).post('/api/auth/password/reset/validate').send({ token });
    expect(valid.status).toBe(200);
    expect(valid.body).toEqual({ ok: true, valid: true });
    // Opening the page must not burn the link.
    expect((await store.actionTokens.findOne({ tokenId: record!.tokenId }))?.consumedAt).toBeNull();

    await store.actionTokens.updateOne(
      { tokenId: record!.tokenId },
      { $set: { expiresAt: new Date(Date.now() - 60_000).toISOString() } },
    );
    const expired = await request(app).post('/api/auth/password/reset/validate').send({ token });
    expect(expired.status).toBe(400);
    expect(expired.body.code).toBe('EXPIRED_RESET_TOKEN');
    expect((await store.actionTokens.findOne({ tokenId: record!.tokenId }))?.consumedAt).toBeNull();

    const garbage = await request(app).post('/api/auth/password/reset/validate').send({ token: 'A'.repeat(43) });
    expect(garbage.status).toBe(400);
    expect(garbage.body.code).toBe('INVALID_RESET_TOKEN');
  });

  it('does not report a password reset as successful when the database is unavailable', async () => {
    const account = await seedUser('dbfail_a', 'dbfail@example.test', 'correct horse battery staple', 'google-sub-dbfail');
    await request(app).post('/api/auth/forgot').send({ identifier: 'dbfail_a' });
    const token = actionToken(email.actions.at(-1)!.actionUrl);
    const before = await store.accounts.findOne({ userId: account.userId });
    const record = await store.actionTokens.findOne({ userId: account.userId, purpose: 'password_reset' });
    const spy = vi.spyOn(store.actionTokens, 'findOneAndUpdate').mockRejectedValueOnce(
      Object.assign(new Error('The database is unavailable. The request was not applied; retry when the service is ready.'), {
        status: 503,
        code: 'DATABASE_UNAVAILABLE',
      }),
    );
    try {
      const res = await request(app).post('/api/auth/password/reset').send({
        token,
        newPassword: 'unavailable new long password',
      });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('DATABASE_UNAVAILABLE');
      expect(res.body.error).toMatch(/database is unavailable/i);
      const after = await store.accounts.findOne({ userId: account.userId });
      expect(after?.passwordHash).toBe(before?.passwordHash);
      expect(after?.passwordVersion).toBe(before?.passwordVersion);
      // The failed write happened before consumption, so no token was burned.
      expect((await store.actionTokens.findOne({ tokenId: record!.tokenId }))?.consumedAt).toBeNull();
    } finally {
      spy.mockRestore();
    }
    const oldLogin = await request(app).post('/api/auth/login').send({
      identifier: 'dbfail_a', password: 'correct horse battery staple',
    });
    expect(oldLogin.status).toBe(200);
  });

  it('ignores request Host and X-Forwarded-Host headers when building reset links', async () => {
    await seedUser('header_a', 'header@example.test', 'correct horse battery staple', 'google-sub-header');
    const res = await request(app)
      .post('/api/auth/forgot')
      .set('Host', 'attacker.example')
      .set('X-Forwarded-Host', 'attacker.example')
      .send({ identifier: 'header_a' });
    expect(res.status).toBe(202);
    const action = email.actions.at(-1)!;
    expect(action.actionUrl.startsWith('http://localhost:5173/#/reset-password?token=')).toBe(true);
    expect(action.actionUrl).not.toContain('attacker.example');
  });

  it('atomically allows only one concurrent use of a reset link', async () => {
    await seedUser('concurrent_a', 'concurrent@example.test', 'correct horse battery staple', 'google-sub-concurrent');
    await request(app).post('/api/auth/forgot').send({ identifier: 'concurrent_a' });
    const token = actionToken(email.actions.at(-1)!.actionUrl);
    const [one, two] = await Promise.all([
      request(app).post('/api/auth/password/reset').send({ token, newPassword: 'first new long password' }),
      request(app).post('/api/auth/password/reset').send({ token, newPassword: 'second new long password' }),
    ]);
    expect([one.status, two.status].sort()).toEqual([204, 400]);
    const stored = await store.accounts.findOne({ emailNormalized: 'concurrent@example.test' });
    const firstWorks = await request(app).post('/api/auth/login').send({ identifier: 'concurrent_a', password: 'first new long password' });
    const secondWorks = await request(app).post('/api/auth/login').send({ identifier: 'concurrent_a', password: 'second new long password' });
    expect(stored).toBeTruthy();
    expect([firstWorks.status, secondWorks.status].filter((s) => s === 200)).toHaveLength(1);
  });

  it('resets the password only with a valid single-use link and revokes existing sessions', async () => {
    const account = await seedUser('resetuser', 'reset@example.test', 'correct horse battery staple', 'google-sub-reset');
    const before = await store.accounts.findOne({ userId: account.userId });
    const s = await login('resetuser', 'correct horse battery staple');
    const forgot = await request(app).post('/api/auth/forgot').send({ identifier: 'resetuser' });
    expect(forgot.status).toBe(202);
    expect(email.actions).toHaveLength(1);
    const token = actionToken(email.actions[0].actionUrl);
    const reset = await request(app).post('/api/auth/password/reset').send({ token, newPassword: 'new correct horse battery staple' });
    expect(reset.status).toBe(204);
    const after = await store.accounts.findOne({ userId: account.userId });
    expect(after?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(after?.passwordHash).not.toBe(before?.passwordHash);
    expect(after?.passwordVersion).toBe(Number(before?.passwordVersion) + 1);
    expect((await request(app).get('/api/account/data').set('Cookie', s.cookie)).status).toBe(401);
    const oldLogin = await request(app).post('/api/auth/login').send({ identifier: 'resetuser', password: 'correct horse battery staple' });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app).post('/api/auth/login').send({ identifier: 'resetuser', password: 'new correct horse battery staple' });
    expect(newLogin.status).toBe(200);
    const reuse = await request(app).post('/api/auth/password/reset').send({ token, newPassword: 'another correct horse battery staple' });
    expect(reuse.status).toBe(400);
  });

  it('revokes every session and invalidates every outstanding reset artifact after a reset', async () => {
    const a = await seedUser('reset_multi', 'resetmulti@example.test', 'correct horse battery staple', 'google-sub-reset-multi');
    const b = await seedUser('reset_other', 'resetother@example.test', 'correct horse battery staple', 'google-sub-reset-other');
    const aFirst = await login('reset_multi', 'correct horse battery staple');
    const aSecond = await login('reset_multi', 'correct horse battery staple');
    const bSession = await login('reset_other', 'correct horse battery staple');

    const forgot = await request(app).post('/api/auth/forgot').send({ identifier: 'reset_multi' });
    expect(forgot.status).toBe(202);
    const usedToken = actionToken(email.actions.at(-1)!.actionUrl);

    // A second outstanding reset record and legacy recovery artifacts must also
    // become unusable when the valid link completes.
    const extraToken = `extra-${'Z'.repeat(37)}`;
    const now = new Date().toISOString();
    await store.actionTokens.insertOne({
      tokenId: 'extra-reset-token',
      tokenHash: actionTokenDigest(extraToken),
      userId: a.userId,
      purpose: 'password_reset',
      accountEmailNormalized: a.emailNormalized,
      emailNormalized: a.emailNormalized,
      targetEmail: a.email,
      createdAt: now,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      consumedAt: null,
      lastSentAt: now,
    });
    await store.adapter.collection('lq_reset_grants').insertOne({
      userId: a.userId,
      grantId: 'legacy-grant-a',
      tokenHash: 'not-a-token',
      createdAt: now,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      consumedAt: null,
    });
    await store.adapter.collection('lq_challenges').insertOne({
      userId: a.userId,
      challengeId: 'legacy-challenge-a',
      purpose: 'password_reset',
      digest: 'not-a-secret',
      createdAt: now,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      consumedAt: null,
    });

    const reset = await request(app).post('/api/auth/password/reset').send({
      token: usedToken,
      newPassword: 'new correct horse battery staple',
    });
    expect(reset.status).toBe(204);

    for (const session of [aFirst, aSecond]) {
      expect((await request(app).get('/api/account/data').set('Cookie', session.cookie)).status).toBe(401);
    }
    // Another account's live session is unaffected.
    expect((await request(app).get('/api/account/data').set('Cookie', bSession.cookie)).status).toBe(200);

    const outstanding = await request(app).post('/api/auth/password/reset').send({
      token: extraToken,
      newPassword: 'another long password value',
    });
    expect(outstanding.status).toBe(400);
    const grant = await store.adapter.collection('lq_reset_grants').findOne({ userId: a.userId, grantId: 'legacy-grant-a' });
    const challenge = await store.adapter.collection('lq_challenges').findOne({ userId: a.userId, challengeId: 'legacy-challenge-a' });
    expect(grant?.consumedAt).toBeTruthy();
    expect(challenge?.consumedAt).toBeTruthy();

    expect((await request(app).post('/api/auth/login').send({
      identifier: 'reset_multi',
      password: 'correct horse battery staple',
    })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({
      identifier: 'reset_multi',
      password: 'new correct horse battery staple',
    })).status).toBe(200);
    expect(b.userId).not.toBe(a.userId);
  });

  it('verifies a new email through a link, revokes sessions, notifies the old address, and keeps Google linked', async () => {
    const account = await seedUser('mailuser', 'old@example.test', 'correct horse battery staple', 'google-sub-mail');
    const s = await login('mailuser', 'correct horse battery staple');
    const change = await authed(request(app).post('/api/account/email/change'), s)
      .send({ newEmail: 'new@example.test', password: 'correct horse battery staple' });
    expect(change.status).toBe(202);
    expect(change.body.email).toBe('new@example.test');
    expect(change.body.challengeId).toBeUndefined();
    expect(email.actions.at(-1)?.to).toBe('new@example.test');
    const token = actionToken(email.actions.at(-1)!.actionUrl);
    expect(email.actions.at(-1)!.actionUrl).toContain('/#/verify-email?token=');
    expect(email.actions.at(-1)!.actionUrl.startsWith(`${process.env.APP_ORIGIN}/#/verify-email?token=`)).toBe(true);
    const wrong = await request(app).post('/api/account/email/confirm').send({ token: 'x'.repeat(43) });
    expect(wrong.status).toBe(400);
    const verified = await request(app).post('/api/account/email/confirm').send({ token });
    expect(verified.status).toBe(200);
    expect(verified.body.email).toBe('new@example.test');
    const stored = await store.accounts.findOne({ userId: account.userId });
    expect(stored?.googleSub).toBe('google-sub-mail');
    expect(stored?.email).toBe('new@example.test');
    expect(email.notices.some((n) => n.to === 'old@example.test')).toBe(true);
    expect((await request(app).get('/api/account/data').set('Cookie', s.cookie)).status).toBe(401);
    const reuse = await request(app).post('/api/account/email/confirm').send({ token });
    expect(reuse.status).toBe(400);
  });

  it('rate-limits password-recovery requests before doing account work', async () => {
    process.env.EMAIL_ACTION_RATE_LIMIT_PER_15MIN = '1';
    const limitedApp = createApp({ store, email, google });
    const first = await request(limitedApp).post('/api/auth/forgot').send({ identifier: 'nobody@example.test' });
    const second = await request(limitedApp).post('/api/auth/forgot').send({ identifier: 'nobody@example.test' });
    expect(first.status).toBe(202);
    expect(second.status).toBe(429);
  });

  it('no longer exposes numeric OTP authentication routes', async () => {
    const otp = await request(app).post('/api/auth/otp/verify').send({ challengeId: 'x', code: '123456' });
    const legacyVerify = await request(app).post('/api/auth/verify-otp').send({});
    expect(otp.status).toBe(404);
    expect(legacyVerify.status).toBe(404);
    const config = await request(app).get('/api/auth/config');
    expect(config.body.configured.otp).toBeUndefined();
    expect(config.body.configured.emailLinks).toBe(true);
  });
});

describe('user isolation, data versions, migration, archive and delete', () => {
  it('isolates reads, mutations, archive and delete between two users', async () => {
    const a = await seedUser('iso_a', 'a@example.test', 'correct horse battery staple', 'google-sub-ia');
    const b = await seedUser('iso_b', 'b@example.test', 'correct horse battery staple', 'google-sub-ib');
    await putState(a.userId, learningState([P]));
    await putState(b.userId, learningState([Q]));
    const sa = await login('iso_a', 'correct horse battery staple');
    const sb = await login('iso_b', 'correct horse battery staple');
    const aState = await authed(request(app).get('/api/account/data'), sa);
    const bState = await authed(request(app).get('/api/account/data'), sb);
    expect(Object.keys(aState.body.state.playlists)).toEqual([P]);
    expect(Object.keys(bState.body.state.playlists)).toEqual([Q]);
    expect(aState.body.state.progress[`${Q}::e1`]).toBeUndefined();
    expect((await authed(request(app).post(`/api/playlists/${P}/archive`), sb).send({ version: bState.body.version })).status).toBe(404);
    expect((await authed(request(app).delete(`/api/playlists/${P}`), sb).send({ version: bState.body.version, confirmTitle: 'Course P' })).status).toBe(404);
    expect((await authed(request(app).get(`/api/playlists/${P}/summary`), sb)).status).toBe(404);
  });

  it('round-trips every learning collection through the authenticated cloud repository', async () => {
    const a = await seedUser('roundtrip_a', 'roundtrip@example.test', 'correct horse battery staple', 'google-sub-roundtrip');
    const state = learningState([P]);
    state.goals['2026-10-02'] = { dateKey: '2026-10-02', targetFocusSec: 3600, minViableSec: 600 };
    state.achievements.first = '2026-10-02T00:00:00.000Z';
    state.challenge = { mode: 'solo', targetRank: 3 };
    state.challengeEnabled = true;
    state.rankHistory.push({ at: '2026-10-02T00:00:00.000Z', rank: 2, of: 10 });
    await putState(a.userId, state);

    const s = await login('roundtrip_a', 'correct horse battery staple');
    const res = await authed(request(app).get('/api/account/data'), s);
    expect(res.status).toBe(200);
    const loaded = res.body.state;
    expect(loaded.playlists[P].title).toBe('Course P');
    expect(loaded.meta[P].archived).toBe(false);
    expect(loaded.progress[`${P}::e1`].notes).toBe(`note-${P}`);
    expect(loaded.ranges[0].id).toBe(`range-${P}`);
    expect(loaded.checkpoints[0].id).toBe(`cp-${P}`);
    expect(loaded.modules[0].id).toBe(`mod-${P}`);
    expect(loaded.sessions[0].id).toBe(`sess-${P}`);
    expect(loaded.goals['2026-10-02'].targetFocusSec).toBe(3600);
    expect(loaded.xp.some((x: any) => x.id === `xp-${P}`)).toBe(true);
    expect(loaded.achievements.first).toBe('2026-10-02T00:00:00.000Z');
    expect(loaded.segments[0].id).toBe(`seg-${P}`);
    expect(loaded.playSessions[0].id).toBe(`ps-${P}`);
    expect(loaded.queue[P]).toEqual([1, 2]);
    expect(loaded.flexGoals[0].id).toBe(`goal-${P}`);
    expect(loaded.challenge).toEqual({ mode: 'solo', targetRank: 3 });
    expect(loaded.challengeEnabled).toBe(true);
    expect(loaded.rankHistory).toEqual([{ at: '2026-10-02T00:00:00.000Z', rank: 2, of: 10 }]);
    expect(loaded.settings).toEqual({ verifiedThreshold: 0.9 });
    expect(loaded.prefs.timezone).toBe('UTC');
    expect(loaded.activeId).toBe(P);
  });

  it('shows data saved by one authenticated client to a second client for the same account', async () => {
    const a = await seedUser('cross_a', 'crossa@example.test', 'correct horse battery staple', 'google-sub-crossa');
    await putState(a.userId, learningState([P]));
    // Two independent logins model two devices; neither replaces the other.
    const desktop = await login('cross_a', 'correct horse battery staple');
    const laptop = await login('cross_a', 'correct horse battery staple');
    const before = await authed(request(app).get('/api/account/data'), desktop);
    expect(before.status).toBe(200);
    expect(before.body.state.progress[`${P}::e1`].notes).toBe(`note-${P}`);

    const changed = {
      ...before.body.state.progress,
      [`${P}::e1`]: {
        ...before.body.state.progress[`${P}::e1`],
        notes: 'written on the desktop',
        completedAt: '2026-10-05T00:00:00.000Z',
      },
    };
    const saved = await authed(request(app).put('/api/account/data/progress'), desktop)
      .send({ version: before.body.version, items: changed });
    expect(saved.status).toBe(200);

    const second = await authed(request(app).get('/api/account/data'), laptop);
    expect(second.status).toBe(200);
    expect(second.body.state.progress[`${P}::e1`].notes).toBe('written on the desktop');
    expect(second.body.state.progress[`${P}::e1`].completedAt).toBe('2026-10-05T00:00:00.000Z');
    expect(second.body.version).toBe(saved.body.version);
  });

  it('rejects stale versions and client-supplied ownership fields', async () => {
    const a = await seedUser('ver_a', 'vera@example.test', 'correct horse battery staple', 'google-sub-va');
    const sa = await login('ver_a', 'correct horse battery staple');
    const v = await stateVersion(sa);
    const first = await authed(request(app).put('/api/account/data/playlists'), sa).send({ version: v, items: { [P]: snapshot(P, 'P') } });
    expect(first.status).toBe(200);
    const stale = await authed(request(app).put('/api/account/data/playlists'), sa).send({ version: v, items: { [P]: snapshot(P, 'P2') } });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('VERSION_CONFLICT');
    const injected = await authed(request(app).put('/api/account/data/progress'), sa).send({
      version: first.body.version,
      items: { [`${P}::e1`]: { userId: 'someone-else', playlistId: P, position: 1, videoId: 'v1', status: 'done', completedAt: null } },
    });
    expect(injected.status).toBe(400);
    expect(injected.body.code).toBe('OWNERSHIP_FIELD');
    void a;
  });

  it('archives without deleting data, restores without duplicate XP, and hides from active fallback', async () => {
    const a = await seedUser('arch_a', 'arch@example.test', 'correct horse battery staple', 'google-sub-ar');
    await putState(a.userId, learningState([P, Q]));
    const s = await login('arch_a', 'correct horse battery staple');
    const before = await authed(request(app).get('/api/account/data'), s);
    const version = before.body.version;
    const archived = await authed(request(app).post(`/api/playlists/${P}/archive`), s).send({ version });
    expect(archived.status).toBe(200);
    expect(archived.body.activeId).toBe(Q);
    const after = await authed(request(app).get('/api/account/data'), s);
    expect(after.body.state.meta[P].archived).toBe(true);
    expect(after.body.state.progress[`${P}::e1`].notes).toBe(`note-${P}`);
    expect(after.body.state.xp).toHaveLength(3);
    const restored = await authed(request(app).post(`/api/playlists/${P}/restore`), s).send({ version: after.body.version });
    expect(restored.status).toBe(200);
    const final = await authed(request(app).get('/api/account/data'), s);
    expect(final.body.state.meta[P].archived).toBe(false);
    expect(final.body.state.xp).toHaveLength(3);
    expect(final.body.state.progress[`${P}::e1`].notes).toBe(`note-${P}`);
  });

  it('confirms permanent deletion with the displayed custom title, not only the source title', async () => {
    const a = await seedUser('rename_del', 'renamedel@example.test', 'correct horse battery staple', 'google-sub-rd');
    const state = learningState([P, Q]);
    state.meta[P].customTitle = 'Renamed Course P';
    await putState(a.userId, state);
    const s = await login('rename_del', 'correct horse battery staple');
    const before = await authed(request(app).get('/api/account/data'), s);
    const summary = await authed(request(app).get(`/api/playlists/${P}/summary`), s);
    expect(summary.status).toBe(200);
    expect(summary.body.title).toBe('Renamed Course P');

    const oldTitle = await authed(request(app).delete(`/api/playlists/${P}`), s)
      .send({ version: before.body.version, confirmTitle: 'Course P' });
    expect(oldTitle.status).toBe(409);
    expect(oldTitle.body.code).toBe('TITLE_MISMATCH');

    const deleted = await authed(request(app).delete(`/api/playlists/${P}`), s)
      .send({ version: before.body.version, confirmTitle: 'Renamed Course P' });
    expect(deleted.status).toBe(200);
    expect(deleted.body.deleted).toBe(true);
    const after = await authed(request(app).get('/api/account/data'), s);
    expect(after.body.state.playlists[P]).toBeUndefined();
    expect(after.body.state.playlists[Q]).toBeTruthy();
  });

  it('permanently deletes only reliably attributable records and preserves the other playlist', async () => {
    const a = await seedUser('del_a', 'del@example.test', 'correct horse battery staple', 'google-sub-del');
    await putState(a.userId, learningState([P, Q]));
    const s = await login('del_a', 'correct horse battery staple');
    const before = await authed(request(app).get('/api/account/data'), s);
    const deleted = await authed(request(app).delete(`/api/playlists/${P}`), s)
      .send({ version: before.body.version, confirmTitle: 'Course P' });
    expect(deleted.status).toBe(200);
    expect(deleted.body.deleted).toBe(true);
    expect(deleted.body.activeId).toBe(Q);
    const after = await authed(request(app).get('/api/account/data'), s);
    expect(after.body.state.playlists[P]).toBeUndefined();
    expect(after.body.state.meta[P]).toBeUndefined();
    expect(after.body.state.progress[`${P}::e1`]).toBeUndefined();
    expect(after.body.state.progress[`${Q}::e1`].notes).toBe(`note-${Q}`);
    expect(after.body.state.sessions.some((x: any) => x.playlistId === P)).toBe(false);
    expect(after.body.state.sessions.some((x: any) => x.playlistId === Q)).toBe(true);
    expect(after.body.state.checkpoints.some((x: any) => x.playlistId === P)).toBe(false);
    expect(after.body.state.ranges.some((x: any) => x.playlistId === P)).toBe(false);
    expect(after.body.state.modules.some((x: any) => x.playlistId === P)).toBe(false);
    expect(after.body.state.flexGoals.some((x: any) => x.playlistId === P)).toBe(false);
    expect(after.body.state.queue[P]).toBeUndefined();
    expect(after.body.state.xp.some((x: any) => x.dedupKey === `done:${P}:e1`)).toBe(false);
    expect(after.body.state.xp.some((x: any) => x.dedupKey === `done:${Q}:e1`)).toBe(true);
    expect(after.body.state.xp.some((x: any) => x.dedupKey === 'day:2026-10-02')).toBe(true);
    const retry = await authed(request(app).delete(`/api/playlists/${P}`), s)
      .send({ version: after.body.version, confirmTitle: 'Course P' });
    expect(retry.status).toBe(200);
    expect(retry.body.alreadyDeleted).toBe(true);
  });

  it('does not report success on a simulated database failure and resumes on retry', async () => {
    const a = await seedUser('fail_a', 'fail@example.test', 'correct horse battery staple', 'google-sub-fa');
    await putState(a.userId, learningState([P, Q]));
    const s = await login('fail_a', 'correct horse battery staple');
    const before = await authed(request(app).get('/api/account/data'), s);
    const sessions = store.data('sessions');
    const original = sessions.deleteMany.bind(sessions);
    let failed = false;
    sessions.deleteMany = async (query: any) => {
      if (!failed && query.userId === a.userId && query.playlistId === P) {
        failed = true;
        throw new Error('simulated database disconnect');
      }
      return original(query);
    };
    const res = await authed(request(app).delete(`/api/playlists/${P}`), s)
      .send({ version: before.body.version, confirmTitle: 'Course P' });
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('DELETE_INCOMPLETE');
    const job = await store.deletions.findOne({ userId: a.userId, playlistId: P });
    expect(job?.status).toBe('failed');
    // Playlist and its progress may be partially deleted, but the endpoint did
    // not claim success and the other playlist is untouched.
    const mid = await authed(request(app).get('/api/account/data'), s);
    expect(mid.body.state.playlists[Q]).toBeTruthy();
    sessions.deleteMany = original;
    const retry = await authed(request(app).delete(`/api/playlists/${P}`), s)
      .send({ version: mid.body.version, confirmTitle: 'Course P' });
    expect(retry.status).toBe(200);
    expect(retry.body.deleted).toBe(true);
    const final = await authed(request(app).get('/api/account/data'), s);
    expect(final.body.state.playlists[P]).toBeUndefined();
    expect(final.body.state.playlists[Q]).toBeTruthy();
  });

  it('deletes checkpoint-linked goals and every reliably attributable XP variant', async () => {
    const a = await seedUser('rich_del', 'richdel@example.test', 'correct horse battery staple', 'google-sub-rich');
    const state = learningState([P, Q]);
    state.flexGoals.push(
      { id: 'goal-cp-P', playlistId: null, checkpointId: `cp-${P}`, metric: 'video-count', target: 1, createdAt: '2026-10-01T00:00:00.000Z' },
      { id: 'goal-cp-Q', playlistId: null, checkpointId: `cp-${Q}`, metric: 'video-count', target: 1, createdAt: '2026-10-01T00:00:00.000Z' },
    );
    state.xp.push(
      { id: 'xp-code-P', reason: 'code', points: 5, dedupKey: `code:${P}:e1`, at: '2026-10-02T00:00:00.000Z' },
      { id: 'xp-ex-P', reason: 'ex', points: 5, dedupKey: `ex:${P}:e1`, at: '2026-10-02T00:00:00.000Z' },
      { id: 'xp-built-P', reason: 'built', points: 5, dedupKey: `built:${P}:e1`, at: '2026-10-02T00:00:00.000Z' },
      { id: 'xp-focus-P', reason: 'focus', points: 5, dedupKey: `focus:client-${P}`, at: '2026-10-02T00:00:00.000Z' },
      { id: 'xp-cp-P', reason: 'checkpoint', points: 5, dedupKey: `cp:cp-${P}:done`, at: '2026-10-02T00:00:00.000Z' },
      { id: 'xp-goal-cp-P', reason: 'goal', points: 5, dedupKey: 'goal:goal-cp-P:done', at: '2026-10-02T00:00:00.000Z' },
      { id: 'xp-code-Q', reason: 'code', points: 5, dedupKey: `code:${Q}:e1`, at: '2026-10-02T00:00:00.000Z' },
      { id: 'xp-focus-Q', reason: 'focus', points: 5, dedupKey: `focus:client-${Q}`, at: '2026-10-02T00:00:00.000Z' },
      { id: 'xp-goal-cp-Q', reason: 'goal', points: 5, dedupKey: 'goal:goal-cp-Q:done', at: '2026-10-02T00:00:00.000Z' },
    );
    await putState(a.userId, state);
    const s = await login('rich_del', 'correct horse battery staple');
    const before = await authed(request(app).get('/api/account/data'), s);
    const deleted = await authed(request(app).delete(`/api/playlists/${P}`), s)
      .send({ version: before.body.version, confirmTitle: 'Course P' });
    expect(deleted.status).toBe(200);
    expect(deleted.body.deletedCounts.flexGoals).toBe(2);
    expect(deleted.body.deletedCounts.xp).toBeGreaterThanOrEqual(7);

    const after = await authed(request(app).get('/api/account/data'), s);
    const keys = after.body.state.xp.map((x: any) => x.dedupKey);
    for (const key of [
      `code:${P}:e1`, `ex:${P}:e1`, `built:${P}:e1`, `focus:client-${P}`,
      `cp:cp-${P}:done`, 'goal:goal-cp-P:done',
    ]) {
      expect(keys).not.toContain(key);
    }
    for (const key of [`code:${Q}:e1`, `focus:client-${Q}`, 'goal:goal-cp-Q:done', 'day:2026-10-02']) {
      expect(keys).toContain(key);
    }
    const goalIds = after.body.state.flexGoals.map((g: any) => g.id);
    expect(goalIds).not.toContain('goal-cp-P');
    expect(goalIds).toContain('goal-cp-Q');
  });

  it('resumes after a failure that deleted the playlist document and keeps attribution ids', async () => {
    const a = await seedUser('resume_a', 'resume@example.test', 'correct horse battery staple', 'google-sub-resume');
    const state = learningState([P, Q]);
    state.flexGoals.push({
      id: 'goal-cp-P', playlistId: null, checkpointId: `cp-${P}`,
      metric: 'video-count', target: 1, createdAt: '2026-10-01T00:00:00.000Z',
    });
    state.xp.push(
      { id: 'xp-code-P', reason: 'code', points: 5, dedupKey: `code:${P}:e1`, at: '2026-10-02T00:00:00.000Z' },
      { id: 'xp-focus-P', reason: 'focus', points: 5, dedupKey: `focus:client-${P}`, at: '2026-10-02T00:00:00.000Z' },
      { id: 'xp-goal-cp-P', reason: 'goal', points: 5, dedupKey: 'goal:goal-cp-P:done', at: '2026-10-02T00:00:00.000Z' },
      { id: 'xp-code-Q', reason: 'code', points: 5, dedupKey: `code:${Q}:e1`, at: '2026-10-02T00:00:00.000Z' },
    );
    await putState(a.userId, state);
    const s = await login('resume_a', 'correct horse battery staple');
    const before = await authed(request(app).get('/api/account/data'), s);

    const failingXp = await store.data('xp').findOne({ userId: a.userId, key: 'xp-code-P' });
    const xpCol = store.data('xp');
    const originalDeleteOne = xpCol.deleteOne.bind(xpCol);
    let failed = false;
    xpCol.deleteOne = async (query: any) => {
      if (!failed && query.userId === a.userId && query._id === failingXp?._id) {
        failed = true;
        throw new Error('simulated XP collection disconnect');
      }
      return originalDeleteOne(query);
    };

    const first = await authed(request(app).delete(`/api/playlists/${P}`), s)
      .send({ version: before.body.version, confirmTitle: 'Course P' });
    expect(first.status).toBe(500);
    expect(first.body.code).toBe('DELETE_INCOMPLETE');
    const job = await store.deletions.findOne({ userId: a.userId, playlistId: P });
    expect(job?.status).toBe('failed');
    expect(job?.failedCollection).toBe('xp');
    expect(job?.title).toBe('Course P');
    expect(job?.checkpointIds).toContain(`cp-${P}`);
    expect(job?.goalIds).toContain('goal-cp-P');
    expect(job?.focusKeys).toContain(`focus:client-${P}`);
    // The playlist document was already removed before the XP step failed.
    expect(await store.data('playlists').findOne({ userId: a.userId, key: P })).toBeNull();

    xpCol.deleteOne = originalDeleteOne;
    // The original tab's version remains acceptable while the job is resumable.
    const retry = await authed(request(app).delete(`/api/playlists/${P}`), s)
      .send({ version: before.body.version, confirmTitle: 'Course P' });
    expect(retry.status).toBe(200);
    expect(retry.body.deleted).toBe(true);
    const final = await authed(request(app).get('/api/account/data'), s);
    const keys = final.body.state.xp.map((x: any) => x.dedupKey);
    expect(keys).not.toContain(`code:${P}:e1`);
    expect(keys).not.toContain(`focus:client-${P}`);
    expect(keys).not.toContain('goal:goal-cp-P:done');
    expect(keys).toContain(`code:${Q}:e1`);
    expect(final.body.state.flexGoals.map((g: any) => g.id)).not.toContain('goal-cp-P');
  });

  it('rolls back a failed full-state replace and leaves the version unchanged', async () => {
    const a = await seedUser('rollback_a', 'rollback@example.test', 'correct horse battery staple', 'google-sub-rb');
    await putState(a.userId, learningState([P, Q]));
    const before = await readUserState(store, a.userId);
    const next = learningState([P, Q, R]);
    const xpCol = store.data('xp');
    const originalInsertOne = xpCol.insertOne.bind(xpCol);
    let failed = false;
    xpCol.insertOne = async (doc: any) => {
      if (!failed && doc.userId === a.userId) {
        failed = true;
        throw new Error('simulated import disconnect');
      }
      return originalInsertOne(doc);
    };
    await expect(replaceAllUserState(store, a.userId, next, before.version))
      .rejects.toThrow('simulated import disconnect');
    xpCol.insertOne = originalInsertOne;
    const after = await readUserState(store, a.userId);
    expect(after.version).toBe(before.version);
    expect(after.state.playlists[R]).toBeUndefined();
    expect(after.state).toEqual(before.state);
  });

  it('rolls back a failed single-collection replace', async () => {
    const a = await seedUser('rollback_c', 'rollbackc@example.test', 'correct horse battery staple', 'google-sub-rc');
    await putState(a.userId, learningState([P]));
    const before = await readUserState(store, a.userId);
    const xpCol = store.data('xp');
    const originalInsertOne = xpCol.insertOne.bind(xpCol);
    let calls = 0;
    xpCol.insertOne = async (doc: any) => {
      calls += 1;
      if (calls === 2) throw new Error('simulated collection disconnect');
      return originalInsertOne(doc);
    };
    await expect(replaceUserCollection(store, a.userId, 'xp', before.state.xp, before.version))
      .rejects.toThrow('simulated collection disconnect');
    xpCol.insertOne = originalInsertOne;
    const after = await readUserState(store, a.userId);
    expect(after.version).toBe(before.version);
    expect(after.state.xp).toEqual(before.state.xp);
  });

  it('accepts an account-export envelope for restore and rejects invalid state without wiping data', async () => {
    const a = await seedUser('import_a', 'import@example.test', 'correct horse battery staple', 'google-sub-im');
    await putState(a.userId, learningState([P, Q]));
    const s = await login('import_a', 'correct horse battery staple');
    const exported = await authed(request(app).get('/api/account/export'), s);
    expect(exported.status).toBe(200);
    const replacement = {
      ...exported.body,
      state: {
        ...exported.body.state,
        progress: {
          ...exported.body.state.progress,
          [`${P}::e1`]: { ...exported.body.state.progress[`${P}::e1`], notes: 'restored note' },
        },
      },
    };
    const current = await authed(request(app).get('/api/account/data'), s);
    const imported = await authed(request(app).post('/api/account/import'), s)
      .send({ version: current.body.version, backup: replacement });
    expect(imported.status).toBe(200);
    const restored = await authed(request(app).get('/api/account/data'), s);
    expect(restored.body.state.progress[`${P}::e1`].notes).toBe('restored note');
    expect(restored.body.state.playlists[Q]).toBeTruthy();

    const invalid = await authed(request(app).post('/api/account/import'), s)
      .send({ version: restored.body.version, backup: { version: 3, state: 'not-an-object' } });
    expect(invalid.status).toBe(400);
    const metadataOnly = await authed(request(app).post('/api/account/import'), s)
      .send({ version: restored.body.version, backup: { version: 3, exportedAt: new Date().toISOString() } });
    expect(metadataOnly.status).toBe(400);
    expect(metadataOnly.body.code).toBe('INVALID_BACKUP');
    const unchanged = await authed(request(app).get('/api/account/data'), s);
    expect(unchanged.body.state.progress[`${P}::e1`].notes).toBe('restored note');
    expect(unchanged.body.state.playlists[Q]).toBeTruthy();
  });

  it('migrates local data deterministically and idempotently without duplicating XP', async () => {
    const a = await seedUser('mig_a', 'mig@example.test', 'correct horse battery staple', 'google-sub-mi');
    const s = await login('mig_a', 'correct horse battery staple');
    const existing = learningState([P]);
    await putState(a.userId, existing);
    const local = learningState([P, R]);
    local.playlists[P].title = 'Local P should not overwrite cloud';
    local.progress[`${P}::e1`].notes = 'local note should not overwrite';
    const v = await stateVersion(s);
    const first = await authed(request(app).post('/api/account/migrate'), s).send({ migrationId: 'migration-12345678', version: v, state: local });
    expect(first.status).toBe(200);
    expect(first.body.collections.playlists.added).toBe(1);
    expect(first.body.collections.playlists.skipped).toBe(1);
    const state1 = await authed(request(app).get('/api/account/data'), s);
    expect(state1.body.state.playlists[P].title).toBe('Course P');
    expect(state1.body.state.progress[`${P}::e1`].notes).toBe(`note-${P}`);
    expect(state1.body.state.playlists[R]).toBeTruthy();
    const xpCount = state1.body.state.xp.length;
    const repeat = await authed(request(app).post('/api/account/migrate'), s).send({ migrationId: 'migration-12345678', version: state1.body.version, state: local });
    expect(repeat.status).toBe(200);
    expect(repeat.body.alreadyApplied).toBe(true);
    const state2 = await authed(request(app).get('/api/account/data'), s);
    expect(state2.body.state.xp.length).toBe(xpCount);
  });

  it('merges migration conflicts with existing cloud records winning', () => {
    const existing = learningState([P]);
    const incoming = learningState([P, R]);
    incoming.playlists[P].title = 'Incoming';
    const merged = mergeMigrationState(existing, incoming);
    expect(merged.state.playlists[P].title).toBe('Course P');
    expect(merged.state.playlists[R]).toBeTruthy();
    expect(merged.state.xp.filter((x: any) => x.dedupKey === `done:${P}:e1`)).toHaveLength(1);
  });

  it('exports account data without password hashes and deletes the account with reauthentication', async () => {
    const a = await seedUser('exp_a', 'exp@example.test', 'correct horse battery staple', 'google-sub-ex');
    await putState(a.userId, learningState([P]));
    const s = await login('exp_a', 'correct horse battery staple');
    const exported = await authed(request(app).get('/api/account/export'), s);
    expect(exported.status).toBe(200);
    expect(exported.body.state.playlists[P]).toBeTruthy();
    expect(exported.body.account.email).toBe('exp@example.test');
    expect(JSON.stringify(exported.body)).not.toContain('passwordHash');
    const wrongPhrase = await authed(request(app).post('/api/account/delete'), s)
      .send({ confirmPhrase: 'wrong phrase', password: 'correct horse battery staple' });
    expect(wrongPhrase.status).toBe(400);
    const del = await authed(request(app).post('/api/account/delete'), s)
      .send({ confirmPhrase: 'DELETE MY ACCOUNT', password: 'correct horse battery staple' });
    expect(del.status).toBe(204);
    expect(await store.accounts.findOne({ userId: a.userId })).toBeNull();
    expect((await readUserState(store, a.userId)).state.playlists[P]).toBeUndefined();
    expect((await request(app).get('/api/account/data').set('Cookie', s.cookie)).status).toBe(401);
  });

  it('refuses production startup when required external configuration is missing', () => {
    process.env.NODE_ENV = 'production';
    for (const key of [
      'MONGODB_URI', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'BREVO_API_KEY',
      'BREVO_SENDER_EMAIL', 'SESSION_SECRET', 'EMAIL_ACTION_HMAC_SECRET', 'OTP_HMAC_SECRET',
    ]) delete process.env[key];
    expect(() => assertProductionConfig()).toThrow(/Refusing to start with insecure production configuration/);
    expect(() => assertProductionConfig()).toThrow(/MONGODB_URI is required/);
  });

  it('fails closed when external configuration is missing', async () => {
    delete process.env.MONGODB_URI;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.BREVO_API_KEY;
    const res = await request(app).get('/api/auth/session');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
    expect(res.body.setupRequired).toBe(true);
    expect(res.body.missing).toContain('MONGODB_URI');
    const loginRes = await request(app).post('/api/auth/login').send({ identifier: 'x', password: 'y' });
    expect(loginRes.status).toBe(503);
    expect(loginRes.body.code).toBe('SETUP_REQUIRED');
  });
});
