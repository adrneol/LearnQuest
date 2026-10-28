import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMemoryDb } from '../src/db/memoryAdapter.js';
import { createDataStore, type DataStore } from '../src/store.js';
import { createSession } from '../src/auth/sessions.js';
import { purgeExpiredSecurityRecords } from '../src/services/securityMaintenance.js';

const ENV: Record<string, string> = {
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:5173',
  API_ORIGIN: 'http://localhost:3001',
  CORS_ORIGIN: 'http://localhost:5173',
  SESSION_SECRET: 'test-session-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
  EMAIL_ACTION_HMAC_SECRET: 'test-email-action-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
  SESSION_IDLE_HOURS: '168',
  SESSION_ABSOLUTE_DAYS: '30',
};
const saved: Record<string, string | undefined> = {};
let db: ReturnType<typeof createMemoryDb>;
let store: DataStore;

beforeEach(() => {
  for (const [key, value] of Object.entries(ENV)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  db = createMemoryDb();
  store = createDataStore(db);
});

afterEach(async () => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await db.close();
});

describe('security-record lifecycle', () => {
  it('stores a BSON Date TTL field on new sessions', async () => {
    const created = await createSession(store, 'session-user', { passwordVersion: 0 });
    const doc = await store.sessions.findOne({ sessionId: created.session.sessionId });
    expect(doc?.expireAt).toBeInstanceOf(Date);
    expect((doc?.expireAt as Date).toISOString()).toBe(doc?.expiresAt);
  });

  it('purges legacy ISO-string records and rate-limit windows that TTL indexes cannot expire', async () => {
    const old = new Date(Date.now() - 60_000).toISOString();
    await store.sessions.insertOne({ sessionId: 'old-session', expiresAt: old });
    await store.actionTokens.insertOne({ tokenId: 'old-token', expiresAt: old });
    await store.oauthStates.insertOne({ stateHash: 'old-state', expiresAt: old });
    await store.rateLimits.insertOne({ _id: 'old-window', expireAt: new Date(Date.now() - 60_000) });
    await store.sessions.insertOne({ sessionId: 'live-session', expiresAt: new Date(Date.now() + 60_000).toISOString() });

    const removed = await purgeExpiredSecurityRecords(store);
    expect(removed).toEqual({ sessions: 1, actionTokens: 1, oauthStates: 1, rateLimits: 1 });
    expect(await store.sessions.count({ sessionId: 'live-session' })).toBe(1);
    expect(await store.sessions.count({ sessionId: 'old-session' })).toBe(0);
  });
});
