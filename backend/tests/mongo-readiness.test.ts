import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createApp } from '../src/app.js';
import { createMemoryDb } from '../src/db/memoryAdapter.js';
import { createDataStore } from '../src/store.js';
import { createErrorHandler } from '../src/middleware/errors.js';
import type { MongoReadinessSnapshot, MongoReadinessSource } from '../src/db/mongoSupervisor.js';

function snapshot(overrides: Partial<MongoReadinessSnapshot> = {}): MongoReadinessSnapshot {
  return {
    managed: true,
    configured: true,
    ready: false,
    state: 'unavailable',
    consecutiveFailures: 1,
    lastFailure: { classification: 'TLS_FAILURE', retryable: true },
    nextRetryInMs: 2_000,
    readyAt: null,
    ...overrides,
  };
}

function readinessSource(value: MongoReadinessSnapshot): MongoReadinessSource {
  return { snapshot: () => value };
}

function testApp(value: MongoReadinessSnapshot) {
  const db = createMemoryDb();
  const store = createDataStore(db);
  const app = createApp({ store, readiness: readinessSource(value) });
  return { app, db };
}

describe('HTTP liveness versus MongoDB readiness', () => {
  it('keeps liveness up while readiness is unavailable and does not claim data operations are ready', async () => {
    const { app, db } = testApp(snapshot());
    try {
      const health = await request(app).get('/api/health');
      expect(health.status).toBe(200);
      expect(health.body).toMatchObject({
        ok: true,
        liveness: true,
        ready: false,
        readinessPath: '/api/ready',
        database: { state: 'unavailable', ready: false },
      });
      expect(JSON.stringify(health.body)).not.toContain('host');

      const ready = await request(app).get('/api/ready');
      expect(ready.status).toBe(503);
      expect(ready.body).toMatchObject({ ok: false, ready: false });
      expect(ready.headers['retry-after']).toBe('2');
    } finally {
      await db.close();
    }
  });

  it('reports readiness only when the supervisor is ready', async () => {
    const { app, db } = testApp(snapshot({
      ready: true,
      state: 'ready',
      consecutiveFailures: 0,
      lastFailure: null,
      nextRetryInMs: null,
      readyAt: '2026-10-28T00:00:00.000Z',
    }));
    try {
      const ready = await request(app).get('/api/ready');
      expect(ready.status).toBe(200);
      expect(ready.body).toMatchObject({ ok: true, ready: true, database: { state: 'ready' } });
    } finally {
      await db.close();
    }
  });

  it('keeps public auth configuration available but fails account and learning routes closed', async () => {
    const { app, db } = testApp(snapshot());
    try {
      expect((await request(app).get('/api/auth/config')).status).toBe(200);

      const account = await request(app).get('/api/account/data');
      expect(account.status).toBe(503);
      expect(account.body).toMatchObject({ code: 'DATABASE_UNAVAILABLE', retryable: true });
      expect(account.body).not.toHaveProperty('state');

      const playlist = await request(app).get('/api/playlists/PLtest123/summary');
      expect(playlist.status).toBe(503);
      expect(playlist.body.code).toBe('DATABASE_UNAVAILABLE');

      const login = await request(app).post('/api/auth/login').send({ identifier: 'x', password: 'y' });
      expect(login.status).toBe(503);
      expect(login.body.code).toBe('DATABASE_UNAVAILABLE');
    } finally {
      await db.close();
    }
  });

  it('returns a retryable failure, not an empty state, when a request loses the database', async () => {
    const value = snapshot({ ready: true, state: 'ready', nextRetryInMs: null, lastFailure: null });
    const db = createMemoryDb();
    const store = createDataStore(db);
    const brokenStore = {
      ...store,
      sessions: {
        ...store.sessions,
        async findOne(): Promise<never> {
          throw Object.assign(new Error('connection to private-host.example closed'), {
            name: 'MongoServerSelectionError',
            cause: Object.assign(new Error('tlsv1 alert internal error'), {
              name: 'MongoNetworkError',
              code: 'ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR',
            }),
          });
        },
      },
    };
    const app = createApp({ store: brokenStore, readiness: readinessSource(value) });
    try {
      const res = await request(app)
        .get('/api/account/data')
        .set('Cookie', 'lq_session=some-session-token');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ code: 'DATABASE_UNAVAILABLE', retryable: true });
      expect(res.body).not.toHaveProperty('state');
      expect(res.body).not.toHaveProperty('ok');
      expect(JSON.stringify(res.body)).not.toContain('private-host');
    } finally {
      await db.close();
    }
  });

  it('opens the route gate after readiness recovers without fabricating a signed-in account', async () => {
    const value = snapshot();
    const db = createMemoryDb();
    const store = createDataStore(db);
    const source: MongoReadinessSource = { snapshot: () => value };
    const app = createApp({ store, readiness: source });
    try {
      expect((await request(app).get('/api/account/data')).status).toBe(503);

      Object.assign(value, snapshot({ ready: true, state: 'ready', nextRetryInMs: null }));
      const account = await request(app).get('/api/account/data');
      expect(account.status).toBe(401);
      expect(account.body.code).toBe('UNAUTHENTICATED');
      expect(account.body).not.toHaveProperty('state');
    } finally {
      await db.close();
    }
  });

  it('uses SETUP_REQUIRED rather than DATABASE_UNAVAILABLE when MongoDB is not configured', async () => {
    const { app, db } = testApp(snapshot({
      configured: false,
      state: 'unconfigured',
      lastFailure: null,
      nextRetryInMs: null,
    }));
    try {
      const res = await request(app).get('/api/account/data');
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('SETUP_REQUIRED');
    } finally {
      await db.close();
    }
  });
});

describe('sanitized database error responses', () => {
  it('maps a driver failure to a retryable 503 without logging or returning secrets', async () => {
    const onMongoFailure = vi.fn();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = express();
    app.get('/boom', (_req, _res, next) => {
      next(Object.assign(new Error('mongodb+srv://alice:supersecret@private-host.example/learnquest'), {
        name: 'MongoServerSelectionError',
        cause: Object.assign(new Error('tlsv1 alert internal error'), {
          name: 'MongoNetworkError',
          code: 'ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR',
        }),
      }));
    });
    app.use(createErrorHandler({ onMongoFailure }));

    try {
      const res = await request(app).get('/boom');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ code: 'DATABASE_UNAVAILABLE', retryable: true });
      expect(JSON.stringify(res.body)).not.toContain('alice');
      expect(JSON.stringify(res.body)).not.toContain('supersecret');
      expect(JSON.stringify(res.body)).not.toContain('private-host');
      expect(JSON.stringify(res.body)).not.toContain('mongodb+srv');
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('alice');
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('supersecret');
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('private-host');
      expect(onMongoFailure).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('does not turn an ordinary application error into a database 503', async () => {
    const app = express();
    app.get('/boom', (_req, _res, next) => {
      next(Object.assign(new Error('ordinary failure'), { status: 400, code: 'ORDINARY' }));
    });
    app.use(createErrorHandler());

    const res = await request(app).get('/boom');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'ordinary failure', code: 'ORDINARY' });
  });
});
