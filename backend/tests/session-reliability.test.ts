import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { createMemoryDb } from '../src/db/memoryAdapter.js';
import { createDataStore, type DataStore } from '../src/store.js';
import { createAccountFromGoogle, completeOnboarding } from '../src/auth/accounts.js';
import { hashCode } from '../src/auth/crypto.js';
import { createSession, revokeSession, touchSession } from '../src/auth/sessions.js';
import type { GoogleIdentity, GoogleOAuthService } from '../src/auth/google.js';
import type { EmailService } from '../src/email/brevo.js';

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
  RATE_LIMIT_PER_MIN: '10000',
  AUTH_RATE_LIMIT_PER_MIN: '10000',
  EMAIL_ACTION_RATE_LIMIT_PER_15MIN: '10000',
  SESSION_IDLE_HOURS: '168',
  SESSION_ABSOLUTE_DAYS: '30',
};
const savedEnv: Record<string, string | undefined> = {};
for (const k of Object.keys(ENV)) savedEnv[k] = process.env[k];

class FakeEmail implements EmailService {
  configured = true;
  async sendActionEmail() { /* no-op */ }
  async sendSecurityNotice() { /* no-op */ }
}

class FakeGoogle implements Partial<GoogleOAuthService> {
  configured = true;
}

let db: ReturnType<typeof createMemoryDb>;
let store: DataStore;
let app: Express;

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v;
  db = createMemoryDb();
  store = createDataStore(db);
  app = createApp({ store, email: new FakeEmail(), google: new FakeGoogle() as unknown as GoogleOAuthService });
});

afterEach(async () => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await db.close();
});

async function seedUser(username: string, emailAddress: string, password: string, sub: string) {
  const account = await createAccountFromGoogle(store, { sub, email: emailAddress, emailVerified: true, name: username });
  const hash = await hashCode(password);
  return completeOnboarding(store, account, { username, displayName: username, password, timezone: 'UTC' }, hash);
}

describe('session reliability', () => {
  it('does not renew a session that was revoked after it was read', async () => {
    const account = await seedUser('touchrace', 'touchrace@example.test', 'correct horse battery staple', 'google-sub-touchrace');
    const created = await createSession(store, account.userId);
    // This models the precise boundary between requireAuth's token lookup and
    // session touch: a revocation must make the conditional touch fail.
    expect(await revokeSession(store, created.token)).toBe(true);
    await expect(touchSession(store, created.session)).resolves.toBeNull();
    const stored = await store.sessions.findOne({ sessionId: created.session.sessionId });
    expect(stored?.revokedAt).toBeTruthy();
  });

  it('renews the session cookie on authenticated GET requests (sliding idle window, capped by absolute expiry)', async () => {
    await seedUser('sliding', 'sliding@example.test', 'correct horse battery staple', 'google-sub-sliding');
    const login = await request(app).post('/api/auth/login').send({ identifier: 'sliding', password: 'correct horse battery staple' });
    expect(login.status).toBe(200);
    const cookie = String(login.headers['set-cookie'][0]).split(';')[0];

    const data = await request(app).get('/api/account/data').set('Cookie', cookie);
    expect(data.status).toBe(200);
    const setCookies = (data.headers['set-cookie'] ?? []) as unknown as string[];
    expect(setCookies.length).toBeGreaterThan(0);
    const renewal = setCookies.find((c) => c.startsWith('lq_session='));
    expect(renewal).toBeTruthy();
    // 168h idle window, never longer: not a static 30-day Max-Age.
    expect(renewal).toContain('Max-Age=604800');
    expect(renewal).toContain('Path=/');
    expect(renewal).toContain('HttpOnly');
    expect(renewal).toContain('SameSite=Lax');
  });

  it('does not attach a renewal cookie to unsafe mutation responses', async () => {
    await seedUser('nomutation', 'nomutation@example.test', 'correct horse battery staple', 'google-sub-nomutation');
    const login = await request(app).post('/api/auth/login').send({ identifier: 'nomutation', password: 'correct horse battery staple' });
    const cookie = String(login.headers['set-cookie'][0]).split(';')[0];
    const csrf = login.body.csrfToken as string;

    const logoutAll = await request(app).post('/api/auth/logout-all').set('Cookie', cookie).set('X-CSRF-Token', csrf);
    expect(logoutAll.status).toBe(204);
    const setCookies = ((logoutAll.headers['set-cookie'] ?? []) as unknown as string[]).filter((c) => c.startsWith('lq_session='));
    expect(setCookies).toHaveLength(1);
    expect(setCookies[0]).toContain('Max-Age=0');
  });

  it('logout-all revokes both the caller device and its siblings atomically', async () => {
    await seedUser('revokeall', 'revokeall@example.test', 'correct horse battery staple', 'google-sub-revokeall');
    const login1 = await request(app).post('/api/auth/login').send({ identifier: 'revokeall', password: 'correct horse battery staple' });
    await request(app).post('/api/auth/login').send({ identifier: 'revokeall', password: 'correct horse battery staple' });
    const cookie1 = String(login1.headers['set-cookie'][0]).split(';')[0];
    const csrf1 = login1.body.csrfToken as string;

    const logoutAll = await request(app).post('/api/auth/logout-all').set('Cookie', cookie1).set('X-CSRF-Token', csrf1);
    expect(logoutAll.status).toBe(204);
    const remaining = await store.sessions.find({ userId: login1.body.user.userId, revokedAt: null });
    expect(remaining).toHaveLength(0);
  });

  it('rejects an expired Google onboarding session on any authenticated surface', async () => {
    const account = await createAccountFromGoogle(store, {
      sub: 'google-sub-expired-onboard', email: 'expired@example.test', emailVerified: true, name: 'Expired',
    });
    const created = await createSession(store, account.userId, {
      authMethod: 'google_register',
      onboardingExpiresAt: new Date(Date.now() - 60_000).toISOString(),
      onboardingGoogleSub: 'google-sub-expired-onboard',
    });
    const cookie = `lq_session=${created.token}`;
    const data = await request(app).get('/api/account/data').set('Cookie', cookie);
    expect(data.status).toBe(403);
    expect(data.body.code).toBe('ONBOARDING_SESSION_INVALID');
    const stored = await store.sessions.findOne({ sessionId: created.session.sessionId });
    expect(stored?.revokedAt).toBeTruthy();
  });
});
