import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { createMemoryDb } from '../src/db/memoryAdapter.js';
import { createDataStore, type DataStore } from '../src/store.js';
import { completeOnboarding, createAccountFromGoogle, type Account } from '../src/auth/accounts.js';
import { hashCode } from '../src/auth/crypto.js';
import { issueEmailActionToken } from '../src/auth/actionTokens.js';
import { createMemoryAuthEventBus, type AuthEventBus } from '../src/auth/eventBus.js';
import type { ActionEmailInput, EmailService, SecurityNoticeInput } from '../src/email/brevo.js';

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
for (const key of Object.keys(ENV)) savedEnv[key] = process.env[key];

class FakeEmail implements EmailService {
  configured = true;
  async sendActionEmail(_input: ActionEmailInput) {}
  async sendSecurityNotice(_input: SecurityNoticeInput) {}
}

interface LoginResult {
  cookie: string;
  csrf: string;
  userId: string;
}

interface SseFrame {
  event: string | null;
  data: string | null;
  comment: string | null;
  raw: string;
}

class SseClient {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = '';
  private done = false;
  private waiters: Array<() => void> = [];

  constructor(
    private readonly controller: AbortController,
    response: Response,
  ) {
    if (!response.body) throw new Error('SSE response has no body.');
    this.reader = response.body.getReader();
    void this.pump();
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const wake of waiters) wake();
  }

  private async pump(): Promise<void> {
    try {
      while (true) {
        const result = await this.reader.read();
        if (result.done) break;
        this.buffer += this.decoder.decode(result.value, { stream: true });
        this.wake();
      }
    } catch {
      // The test closes streams with AbortController.
    } finally {
      this.done = true;
      this.wake();
    }
  }

  private waitForChange(timeoutMs: number): Promise<void> {
    if (this.done || this.buffer.includes('\n\n')) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      const unref = (timer as { unref?: () => void }).unref;
      if (typeof unref === 'function') unref.call(timer);
      this.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private async readFrame(timeoutMs: number): Promise<SseFrame | null> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const lf = this.buffer.indexOf('\n\n');
      const crlf = this.buffer.indexOf('\r\n\r\n');
      const boundary = lf >= 0 && (crlf < 0 || lf < crlf) ? lf : crlf;
      if (boundary >= 0) {
        const length = boundary === crlf ? 4 : 2;
        const raw = this.buffer.slice(0, boundary);
        this.buffer = this.buffer.slice(boundary + length);
        const lines = raw.split(/\r?\n/);
        let event: string | null = null;
        let data: string | null = null;
        const comments: string[] = [];
        for (const line of lines) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data = line.slice(5).trim();
          else if (line.startsWith(':')) comments.push(line.slice(1).trim());
        }
        return { event, data, comment: comments.join('\n') || null, raw };
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      if (this.done) return null;
      await this.waitForChange(remaining);
    }
  }

  async waitForConnected(timeoutMs = 2_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let sawRetry = false;
    while (Date.now() < deadline) {
      const frame = await this.readFrame(deadline - Date.now());
      if (!frame) break;
      if (frame.raw === 'retry: 30000') {
        sawRetry = true;
        continue;
      }
      if (frame.event) throw new Error(`Stream failed before readiness: ${frame.raw}`);
      if (frame.comment === 'connected') {
        if (!sawRetry) throw new Error('SSE stream did not advertise the reconnect delay.');
        return;
      }
    }
    throw new Error('SSE stream did not become ready.');
  }

  async nextEvent(timeoutMs = 2_000): Promise<SseFrame | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const frame = await this.readFrame(deadline - Date.now());
      if (!frame) return null;
      if (frame.event) return frame;
    }
    return null;
  }

  close(): void {
    this.controller.abort();
    void this.reader.cancel().catch(() => undefined);
  }
}

let db: ReturnType<typeof createMemoryDb>;
let store: DataStore;
let email: FakeEmail;
let authEvents: AuthEventBus;
let app: Express;
let servers: Server[] = [];
let clients: SseClient[] = [];

beforeEach(() => {
  for (const [key, value] of Object.entries(ENV)) process.env[key] = value;
  db = createMemoryDb();
  store = createDataStore(db);
  email = new FakeEmail();
  authEvents = createMemoryAuthEventBus();
  app = createApp({ store, email, authEvents });
  servers = [];
  clients = [];
});

afterEach(async () => {
  for (const client of clients) client.close();
  clients = [];
  for (const server of servers) {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  servers = [];
  await authEvents.close();
  await db.close();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function listen(): Promise<string> {
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function seedAccount(username: string, address: string, sub: string): Promise<Account> {
  const account = await createAccountFromGoogle(store, {
    sub,
    email: address,
    emailVerified: true,
    name: username,
  });
  return completeOnboarding(store, account, {
    username,
    displayName: username,
    password: 'correct horse battery staple',
    timezone: 'UTC',
  }, await hashCode('correct horse battery staple'));
}

async function login(identifier: string): Promise<LoginResult> {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ identifier, password: 'correct horse battery staple' });
  expect(response.status).toBe(200);
  return {
    cookie: String(response.headers['set-cookie'][0]).split(';')[0],
    csrf: response.body.csrfToken as string,
    userId: response.body.user.userId as string,
  };
}

async function openStream(origin: string, session: LoginResult, query = ''): Promise<SseClient> {
  const controller = new AbortController();
  const response = await fetch(`${origin}/api/auth/events${query}`, {
    headers: { Cookie: session.cookie },
    signal: controller.signal,
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const client = new SseClient(controller, response);
  clients.push(client);
  await client.waitForConnected();
  return client;
}

function expectInvalidation(frame: SseFrame | null, reason: string): void {
  expect(frame).not.toBeNull();
  expect(frame!.event).toBe('auth-invalidated');
  expect(JSON.parse(frame!.data!)).toEqual({ type: 'auth-invalidated', reason });
}

describe('authenticated authentication-invalidation stream', () => {
  it('rejects unauthenticated and untrusted-origin subscriptions', async () => {
    const origin = await listen();
    const anonymous = await fetch(`${origin}/api/auth/events`);
    expect(anonymous.status).toBe(401);

    await seedAccount('stream_origin', 'stream-origin@example.test', 'stream-origin-sub');
    const session = await login('stream_origin');
    const untrusted = await fetch(`${origin}/api/auth/events`, {
      headers: { Cookie: session.cookie, Origin: 'https://evil.example' },
    });
    expect(untrusted.status).toBe(403);
    expect(await untrusted.text()).not.toContain(session.cookie);
  });

  it('targets normal logout to the revoked session only', async () => {
    const origin = await listen();
    await seedAccount('stream_normal', 'stream-normal@example.test', 'stream-normal-sub');
    await seedAccount('stream_other', 'stream-other@example.test', 'stream-other-sub');
    const first = await login('stream_normal');
    const second = await login('stream_normal');
    const other = await login('stream_other');
    const firstStream = await openStream(origin, first);
    const secondStream = await openStream(origin, second);
    const otherStream = await openStream(origin, other);

    const response = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', first.cookie);
    expect(response.status).toBe(204);

    expectInvalidation(await firstStream.nextEvent(), 'sessions-revoked');
    expect(await secondStream.nextEvent(600)).toBeNull();
    expect(await otherStream.nextEvent(600)).toBeNull();
  });

  it('notifies every account session on sign out all, not another account', async () => {
    const origin = await listen();
    await seedAccount('stream_all', 'stream-all@example.test', 'stream-all-sub');
    await seedAccount('stream_bystander', 'stream-bystander@example.test', 'stream-bystander-sub');
    const first = await login('stream_all');
    const second = await login('stream_all');
    const other = await login('stream_bystander');
    // A user-supplied account id in the URL must not select a subscription
    // target; the cookie remains the only authority.
    const firstStream = await openStream(origin, first, `?userId=${encodeURIComponent(other.userId)}`);
    const secondStream = await openStream(origin, second);
    const otherStream = await openStream(origin, other);

    const response = await request(app)
      .post('/api/auth/logout-all')
      .set('Cookie', first.cookie)
      .set('X-CSRF-Token', first.csrf);
    expect(response.status).toBe(204);

    const firstFrame = await firstStream.nextEvent();
    const secondFrame = await secondStream.nextEvent();
    expectInvalidation(firstFrame, 'sessions-revoked');
    expectInvalidation(secondFrame, 'sessions-revoked');
    expect(await otherStream.nextEvent(600)).toBeNull();

    const wire = `${firstFrame!.raw}\n${secondFrame!.raw}`;
    for (const secret of [
      first.userId,
      'stream-all@example.test',
      'stream_all',
      first.cookie,
      first.csrf,
    ]) {
      expect(wire).not.toContain(secret);
    }
  });

  it('notifies all sessions only after a successful password reset', async () => {
    const origin = await listen();
    const account = await seedAccount(
      'stream_reset',
      'stream-reset@example.test',
      'stream-reset-sub',
    );
    const first = await login('stream_reset');
    const second = await login('stream_reset');
    const firstStream = await openStream(origin, first);
    const secondStream = await openStream(origin, second);

    const failed = await request(app)
      .post('/api/auth/password/reset')
      .send({ token: 'invalid-reset-token-abcdefghijklmnopqrstuvwxyz', newPassword: 'new password is long enough' });
    expect(failed.status).toBe(400);
    expect(await firstStream.nextEvent(600)).toBeNull();
    expect(await secondStream.nextEvent(600)).toBeNull();

    const issued = await issueEmailActionToken(store, {
      userId: account.userId,
      purpose: 'password_reset',
      accountEmailNormalized: account.emailNormalized,
      emailNormalized: account.emailNormalized,
      targetEmail: account.email,
    });
    const reset = await request(app)
      .post('/api/auth/password/reset')
      .send({ token: issued.token, newPassword: 'new password is long enough' });
    expect(reset.status).toBe(204);

    expectInvalidation(await firstStream.nextEvent(), 'password-reset');
    expectInvalidation(await secondStream.nextEvent(), 'password-reset');
    expect(firstStream).toBeTruthy();

    const oldPassword = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'stream_reset', password: 'correct horse battery staple' });
    expect(oldPassword.status).toBe(401);
    const newPassword = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'stream_reset', password: 'new password is long enough' });
    expect(newPassword.status).toBe(200);
  });

  it('does not publish when logout revocation fails', async () => {
    const origin = await listen();
    await seedAccount('stream_failure', 'stream-failure@example.test', 'stream-failure-sub');
    const session = await login('stream_failure');
    const stream = await openStream(origin, session);
    const originalUpdate = store.sessions.updateOne.bind(store.sessions);
    store.sessions.updateOne = async () => {
      throw new Error('simulated revocation failure');
    };
    try {
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', session.cookie);
      expect(response.status).toBe(500);
      expect(await stream.nextEvent(600)).toBeNull();
    } finally {
      store.sessions.updateOne = originalUpdate;
    }
  });

  it('rejects a reconnection after the session has been revoked', async () => {
    const origin = await listen();
    await seedAccount('stream_reconnect', 'stream-reconnect@example.test', 'stream-reconnect-sub');
    const session = await login('stream_reconnect');
    const stream = await openStream(origin, session);

    const response = await request(app)
      .post('/api/auth/logout-all')
      .set('Cookie', session.cookie)
      .set('X-CSRF-Token', session.csrf);
    expect(response.status).toBe(204);
    expectInvalidation(await stream.nextEvent(), 'sessions-revoked');

    const reconnect = await fetch(`${origin}/api/auth/events`, {
      headers: { Cookie: session.cookie },
    });
    expect(reconnect.status).toBe(401);
    expect(await reconnect.text()).not.toContain(session.cookie);
  });
});
