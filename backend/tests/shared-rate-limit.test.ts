import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type Express, type Request } from 'express';
import request from 'supertest';
import { createMemoryDb } from '../src/db/memoryAdapter.js';
import { createDataStore, type DataStore } from '../src/store.js';
import { createSharedRateLimiter } from '../src/middleware/sharedRateLimit.js';

let db: ReturnType<typeof createMemoryDb>;
let store: DataStore;
let now: number;

function limitedApp(limiter: ReturnType<typeof createSharedRateLimiter>): Express {
  const app = express();
  app.get('/limited', limiter, (_req, res) => res.json({ ok: true }));
  return app;
}

function client(name: string) {
  return { 'X-Test-Client': name };
}

beforeEach(() => {
  db = createMemoryDb();
  store = createDataStore(db);
  now = Date.UTC(2026, 9, 28, 12, 0, 0);
});

afterEach(async () => {
  await db.close();
});

describe('cross-instance security rate limiting', () => {
  it('shares one atomic window across logical backend instances', async () => {
    const options = {
      scope: 'test-shared',
      windowMs: 60_000,
      max: 2,
      now: () => now,
      key: (req: Request) => String(req.get('x-test-client') ?? req.ip),
    };
    // Two limiter instances represent two Render processes sharing MongoDB.
    const first = limitedApp(createSharedRateLimiter(store, options));
    const second = limitedApp(createSharedRateLimiter(store, options));

    expect((await request(first).get('/limited').set(client('a'))).status).toBe(200);
    expect((await request(second).get('/limited').set(client('a'))).status).toBe(200);
    const blocked = await request(second).get('/limited').set(client('a'));
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

    // A different client is not collaterally blocked.
    expect((await request(first).get('/limited').set(client('b'))).status).toBe(200);

    // A new fixed window resets the counter.
    now += 60_000;
    expect((await request(second).get('/limited').set(client('a'))).status).toBe(200);
  });

  it('stores only a digest of the client identity and a Date expiry', async () => {
    const app = limitedApp(createSharedRateLimiter(store, {
      scope: 'test-digest',
      windowMs: 60_000,
      max: 10,
      now: () => now,
      key: (req: Request) => String(req.get('x-test-client') ?? req.ip),
    }));
    await request(app).get('/limited').set(client('private-client-value'));
    const rows = await store.rateLimits.find({});
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('private-client-value');
    expect(rows[0].expireAt).toBeInstanceOf(Date);
    expect(rows[0].scope).toBe('test-digest');
  });

  it('fails closed instead of silently using an in-memory counter when the store is down', async () => {
    const app = limitedApp(createSharedRateLimiter(store, {
      scope: 'test-fail-closed',
      windowMs: 60_000,
      max: 10,
      now: () => now,
    }));
    const original = store.rateLimits.findOneAndUpdate.bind(store.rateLimits);
    store.rateLimits.findOneAndUpdate = async () => {
      throw Object.assign(new Error('simulated rate-limit store outage'), { code: 'MONGO_UNAVAILABLE' });
    };
    const res = await request(app).get('/limited');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('RATE_LIMIT_UNAVAILABLE');
    expect(res.body.retryable).toBe(true);
    store.rateLimits.findOneAndUpdate = original;
  });
});
