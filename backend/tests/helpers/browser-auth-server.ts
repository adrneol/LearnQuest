/**
 * Test-only backend for the real-browser cross-profile acceptance run.
 *
 * This starts the real Express app, the real Mongo-backed event bus, and a
 * separate loopback control server used only by the Playwright harness to
 * create an isolated account and read test diagnostics. Nothing here is
 * imported by production code or exposed by the production app.
 *
 * Run with: npx tsx tests/helpers/browser-auth-server.ts
 */
import { createServer as createHttpServer } from 'node:http';
import { MongoClient } from 'mongodb';

const APP_ORIGIN = process.env.LQ_TEST_APP_ORIGIN;
const MONGO_URI = process.env.LQ_TEST_MONGO_URI;
const BE_PORT = Number(process.env.LQ_TEST_BE_PORT);
const CONTROL_PORT = Number(process.env.LQ_TEST_CONTROL_PORT);
const DB_NAME = process.env.LQ_TEST_DB_NAME ?? 'lq_browser_auth_test';

if (!APP_ORIGIN || !MONGO_URI || !Number.isInteger(BE_PORT) || !Number.isInteger(CONTROL_PORT)) {
  throw new Error('The browser test server requires LQ_TEST_APP_ORIGIN, LQ_TEST_MONGO_URI, LQ_TEST_BE_PORT, and LQ_TEST_CONTROL_PORT.');
}

Object.assign(process.env, {
  NODE_ENV: 'test',
  APP_ORIGIN,
  API_ORIGIN: `http://127.0.0.1:${BE_PORT}`,
  CORS_ORIGIN: APP_ORIGIN,
  MONGODB_URI: MONGO_URI,
  MONGODB_DB_NAME: DB_NAME,
  SESSION_SECRET: 'browser-test-session-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
  EMAIL_ACTION_HMAC_SECRET: 'browser-test-email-action-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
  GOOGLE_CLIENT_ID: 'browser-test-client.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'browser-test-client-secret',
  GOOGLE_REDIRECT_URI: `http://127.0.0.1:${BE_PORT}/api/auth/google/callback`,
  BREVO_API_KEY: 'browser-test-brevo-key',
  BREVO_SENDER_EMAIL: 'no-reply@example.test',
  BREVO_SENDER_NAME: 'LearnQuest Browser Test',
  RATE_LIMIT_PER_MIN: '10000',
  AUTH_RATE_LIMIT_PER_MIN: '10000',
  EMAIL_ACTION_RATE_LIMIT_PER_15MIN: '10000',
  TRUST_PROXY_HOPS: '0',
  SESSION_IDLE_HOURS: '168',
  SESSION_ABSOLUTE_DAYS: '30',
  EMAIL_ACTION_TTL_MIN: '30',
  EMAIL_ACTION_RESEND_SEC: '0',
});

const { createApp } = await import('../../src/app.js');
const { createDirectMongoAdapter } = await import('../../src/db/mongo.js');
const { createDataStore } = await import('../../src/store.js');
const { createAccountFromGoogle, completeOnboarding } = await import('../../src/auth/accounts.js');
const { hashCode } = await import('../../src/auth/crypto.js');
const { issueEmailActionToken } = await import('../../src/auth/actionTokens.js');
const { createMongoAuthEventBus, AUTH_EVENT_COLLECTION } = await import('../../src/auth/eventBus.js');
const { revokeAllSessions } = await import('../../src/auth/sessions.js');

const mongo = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 10_000 });
await mongo.connect();
const db = mongo.db(DB_NAME);
await db.dropDatabase();
const store = createDataStore(createDirectMongoAdapter(db));

const PASSWORD = 'correct horse battery staple';
const account = await createAccountFromGoogle(store, {
  sub: 'browser-profile-test-sub',
  email: 'profile-test@example.test',
  emailVerified: true,
  name: 'Profile Test',
});
const completed = await completeOnboarding(store, account, {
  username: 'profile_test',
  displayName: 'Profile Test',
  password: PASSWORD,
  timezone: 'UTC',
}, await hashCode(PASSWORD));

const mongoBus = createMongoAuthEventBus({ getDb: async () => db });
let activeStreams = 0;
const bus = {
  publish: mongoBus.publish,
  async subscribe(subscription: Parameters<typeof mongoBus.subscribe>[0]) {
    const unsubscribe = await mongoBus.subscribe(subscription);
    activeStreams += 1;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      activeStreams = Math.max(0, activeStreams - 1);
      unsubscribe();
    };
  },
  close: mongoBus.close,
};

const email = {
  configured: true,
  async sendActionEmail() {},
  async sendSecurityNotice() {},
};
const app = createApp({ store, email, authEvents: bus });
const backend = createHttpServer(app);
await new Promise<void>((resolve, reject) => {
  backend.once('error', reject);
  backend.listen(BE_PORT, '127.0.0.1', () => resolve());
});

async function activeSessionCount(): Promise<number> {
  const rows = await store.sessions.find(
    { userId: completed.userId, revokedAt: null },
    { limit: 100 },
  ) as Array<{ idleExpiresAt?: string; expiresAt?: string }>;
  const now = Date.now();
  return rows.filter((row) => {
    const idle = row.idleExpiresAt ? Date.parse(row.idleExpiresAt) : Number.POSITIVE_INFINITY;
    const absolute = row.expiresAt ? Date.parse(row.expiresAt) : Number.POSITIVE_INFINITY;
    return idle > now && absolute > now;
  }).length;
}

const control = createHttpServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${CONTROL_PORT}`);
    if (url.pathname === '/state') {
      res.statusCode = 200;
      res.end(JSON.stringify({
        ready: true,
        activeStreams,
        activeSessions: await activeSessionCount(),
        account: {
          userId: completed.userId,
          email: completed.email,
          username: completed.username,
          password: PASSWORD,
        },
      }));
      return;
    }
    if (url.pathname === '/latest-event') {
      const reason = url.searchParams.get('reason');
      const since = Number(url.searchParams.get('since') ?? 0);
      const filter: Record<string, unknown> = {
        eventId: { $exists: true },
        at: { $gte: new Date(since) },
      };
      if (reason) filter.reason = reason;
      const event = await db.collection(AUTH_EVENT_COLLECTION)
        .find(filter, { sort: { $natural: -1 }, limit: 1 })
        .next();
      res.statusCode = event ? 200 : 404;
      res.end(JSON.stringify(event
        ? { at: new Date(event.at as Date).getTime(), reason: event.reason }
        : { error: 'No matching event.' }));
      return;
    }
    if (url.pathname === '/reset-token' && req.method === 'POST') {
      const issued = await issueEmailActionToken(store, {
        userId: completed.userId,
        purpose: 'password_reset',
        accountEmailNormalized: completed.emailNormalized,
        emailNormalized: completed.emailNormalized,
        targetEmail: completed.email,
      });
      res.statusCode = 200;
      res.end(JSON.stringify({ token: issued.token }));
      return;
    }
    if (url.pathname === '/revoke-all' && req.method === 'POST') {
      const revoked = await revokeAllSessions(store, completed.userId);
      res.statusCode = 200;
      res.end(JSON.stringify({ revoked }));
      return;
    }
    if (url.pathname === '/drop-connections' && req.method === 'POST') {
      // Simulate a proxy/backend restart without destroying the session or the
      // database. Used only by the local transport acceptance harness.
      backend.closeAllConnections?.();
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not found.' }));
  } catch (error) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});
await new Promise<void>((resolve, reject) => {
  control.once('error', reject);
  control.listen(CONTROL_PORT, '127.0.0.1', () => resolve());
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  control.closeAllConnections?.();
  backend.closeAllConnections?.();
  await Promise.all([
    new Promise<void>((resolve) => control.close(() => resolve())),
    new Promise<void>((resolve) => backend.close(() => resolve())),
  ]);
  await bus.close();
  await db.dropDatabase();
  await mongo.close();
  process.exit(0);
}
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
process.on('disconnect', () => { void shutdown(); });

console.log(`LQ_TEST_SERVER_READY ${JSON.stringify({
  backendOrigin: `http://127.0.0.1:${BE_PORT}`,
  controlOrigin: `http://127.0.0.1:${CONTROL_PORT}`,
  account: {
    identifier: completed.username,
    email: completed.email,
    password: PASSWORD,
  },
  secrets: [completed.userId, completed.email, completed.username, PASSWORD, 'csrf'],
})}`);
