import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { MongoClient, type Db } from 'mongodb';
import { createApp } from '../src/app.js';
import { createDirectMongoAdapter } from '../src/db/mongo.js';
import { createDataStore, type DataStore } from '../src/store.js';
import { completeOnboarding, createAccountFromGoogle, type Account } from '../src/auth/accounts.js';
import { hashCode } from '../src/auth/crypto.js';
import { createMongoAuthEventBus, type AuthEventBus } from '../src/auth/eventBus.js';
import type { ActionEmailInput, EmailService, SecurityNoticeInput } from '../src/email/brevo.js';
import { expectInvalidation, openSseStream, type SseClient } from './helpers/sse.js';

/**
 * Real MongoDB multi-instance rehearsal.
 *
 * Two independent Express app instances share the same MongoDB database but
 * have separate tailable-cursor event buses, exactly as two Render instances
 * would. A client connected to instance B must receive an account-wide
 * revocation published by instance A.
 *
 * Runs only with an explicit non-production MongoDB URI:
 *   LQ_TEST_MONGO_URI=mongodb://127.0.0.1:27017
 */
const MONGO_URI = process.env.LQ_TEST_MONGO_URI;
const describeMongo = MONGO_URI ? describe : describe.skip;

const ENV: Record<string, string> = {
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:5173',
  API_ORIGIN: 'http://localhost:3001',
  CORS_ORIGIN: 'http://localhost:5173',
  MONGODB_URI: MONGO_URI ?? 'mongodb://127.0.0.1:27017/learnquest-test',
  MONGODB_DB_NAME: 'learnquest_auth_events_test',
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

describeMongo('real MongoDB cross-instance authentication invalidation fanout', () => {
  let client: MongoClient;
  let db: Db;
  let storeA: DataStore;
  let storeB: DataStore;
  let busA: AuthEventBus;
  let busB: AuthEventBus;
  let appA: Express;
  let appB: Express;
  let serverA: Server;
  let serverB: Server;
  let originA: string;
  let originB: string;
  let account: Account;
  let other: Account;
  const streams: SseClient[] = [];

  beforeAll(async () => {
    for (const [key, value] of Object.entries(ENV)) process.env[key] = value;
    client = new MongoClient(MONGO_URI!, { serverSelectionTimeoutMS: 5_000 });
    await client.connect();
    db = client.db(`lq_auth_events_${randomBytes(4).toString('hex')}`);
    storeA = createDataStore(createDirectMongoAdapter(db));
    storeB = createDataStore(createDirectMongoAdapter(db));
    busA = createMongoAuthEventBus({ getDb: async () => db });
    busB = createMongoAuthEventBus({ getDb: async () => db });
    const email = new FakeEmail();
    appA = createApp({ store: storeA, email, authEvents: busA });
    appB = createApp({ store: storeB, email, authEvents: busB });

    serverA = appA.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => serverA.once('listening', () => resolve()));
    serverB = appB.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => serverB.once('listening', () => resolve()));
    originA = `http://127.0.0.1:${(serverA.address() as AddressInfo).port}`;
    originB = `http://127.0.0.1:${(serverB.address() as AddressInfo).port}`;

    account = await createAccountFromGoogle(storeA, {
      sub: 'cross-instance-sub',
      email: 'cross-instance@example.test',
      emailVerified: true,
      name: 'Cross Instance',
    });
    account = await completeOnboarding(storeA, account, {
      username: 'cross_instance',
      displayName: 'Cross Instance',
      password: 'correct horse battery staple',
      timezone: 'UTC',
    }, await hashCode('correct horse battery staple'));
    other = await createAccountFromGoogle(storeA, {
      sub: 'cross-instance-other-sub',
      email: 'cross-instance-other@example.test',
      emailVerified: true,
      name: 'Other Account',
    });
    other = await completeOnboarding(storeA, other, {
      username: 'cross_other',
      displayName: 'Other Account',
      password: 'correct horse battery staple',
      timezone: 'UTC',
    }, await hashCode('correct horse battery staple'));
  }, 30_000);

  afterAll(async () => {
    for (const stream of streams) stream.close();
    for (const server of [serverA, serverB]) {
      if (!server) continue;
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await busA?.close();
    await busB?.close();
    if (db) await db.dropDatabase();
    await client?.close();
  });

  async function login(app: Express, identifier: string): Promise<LoginResult> {
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

  it('delivers account-wide revocation across two app instances and keeps normal logout session-scoped', async () => {
    const first = await login(appA, 'cross_instance');
    const second = await login(appB, 'cross_instance');
    const bystander = await login(appB, 'cross_other');

    const firstStream = await openSseStream(originA, first.cookie);
    const secondStream = await openSseStream(originB, second.cookie);
    const bystanderStream = await openSseStream(originB, bystander.cookie);
    streams.push(firstStream, secondStream, bystanderStream);

    const collection = db.collection('lq_auth_events');
    const stats = await db.command({ collStats: 'lq_auth_events' });
    expect(stats.capped).toBe(true);
    expect(await collection.countDocuments({ seed: true })).toBe(1);
    expect(await collection.countDocuments({ eventId: { $exists: true } })).toBe(0);

    // Normal logout must notify only the session that was revoked, even when
    // the connected stream is served by a different app instance.
    const normalStarted = Date.now();
    const normal = await request(appA)
      .post('/api/auth/logout')
      .set('Cookie', first.cookie);
    expect(normal.status).toBe(204);
    expectInvalidation(await firstStream.nextEvent(), 'sessions-revoked');
    const normalMs = Date.now() - normalStarted;
    expect(await secondStream.nextEvent(600)).toBeNull();
    expect(await bystanderStream.nextEvent(600)).toBeNull();

    // Re-authenticate the first device, then sign out all. The stream on
    // instance B must receive the event published by instance A.
    const renewed = await login(appA, 'cross_instance');
    const renewedStream = await openSseStream(originA, renewed.cookie);
    streams.push(renewedStream);

    const allStarted = Date.now();
    const all = await request(appA)
      .post('/api/auth/logout-all')
      .set('Cookie', renewed.cookie)
      .set('X-CSRF-Token', renewed.csrf);
    expect(all.status).toBe(204);
    const renewedFrame = await renewedStream.nextEvent();
    const secondFrame = await secondStream.nextEvent();
    const allMs = Date.now() - allStarted;
    expectInvalidation(renewedFrame, 'sessions-revoked');
    expectInvalidation(secondFrame, 'sessions-revoked');
    expect(await bystanderStream.nextEvent(600)).toBeNull();

    const serialized = `${renewedFrame?.raw ?? ''}\n${secondFrame?.raw ?? ''}`;
    for (const secret of [
      account.userId,
      account.email,
      account.username!,
      renewed.cookie,
      'csrf',
      'cookie',
    ]) {
      expect(serialized).not.toContain(secret);
    }

    // A revoked session cannot open a replacement stream.
    const reconnect = await fetch(`${originB}/api/auth/events`, {
      headers: { Cookie: second.cookie },
    });
    expect(reconnect.status).toBe(401);

    // A brand-new bus/process must not replay an old account-wide event to a
    // session created after that event. The capped collection still contains
    // the sign-out-all record; only events published after subscription are
    // eligible for delivery.
    const fresh = await login(appA, 'cross_instance');
    const busC = createMongoAuthEventBus({ getDb: async () => db });
    let replayed = 0;
    const unsubscribeLate = await busC.subscribe({
      userId: account.userId,
      sessionId: fresh.sessionId,
      listener: () => { replayed += 1; },
    });
    await new Promise((resolve) => setTimeout(resolve, 600));
    unsubscribeLate();
    await busC.close();
    expect(replayed).toBe(0);

    console.log(JSON.stringify({
      test: 'auth-event-fanout',
      normalLogoutPublishToReceiveMs: normalMs,
      signOutAllPublishToReceiveMs: allMs,
      collectionCapped: stats.capped === true,
      collectionName: 'lq_auth_events',
    }));
  }, 30_000);
});
