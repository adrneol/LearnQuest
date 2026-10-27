import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { connectMock } = vi.hoisted(() => ({ connectMock: vi.fn() }));

vi.mock('mongodb', () => ({
  MongoClient: {
    connect: connectMock,
  },
}));

describe('MongoDB connection lifecycle', () => {
  beforeEach(() => {
    connectMock.mockReset();
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017';
    process.env.MONGODB_DB_NAME = 'learnquest';
  });

  afterEach(async () => {
    const { closeMongo } = await import('../src/db/mongo.js');
    await closeMongo();
  });

  it('closes the shared client during shutdown and permits a fresh connection afterward', async () => {
    const first = {
      db: () => ({ command: async () => ({ ok: 1 }) }),
      close: vi.fn(async () => undefined),
    };
    const second = {
      db: () => ({ command: async () => ({ ok: 1 }) }),
      close: vi.fn(async () => undefined),
    };
    connectMock.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    const { pingMongo, closeMongo } = await import('../src/db/mongo.js');
    await pingMongo();
    await closeMongo();
    expect(first.close).toHaveBeenCalledTimes(1);

    await pingMongo();
    expect(connectMock).toHaveBeenCalledTimes(2);
    await closeMongo();
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it('retries after a failed connection instead of caching the rejection forever', async () => {
    connectMock.mockRejectedValueOnce(
      Object.assign(new Error('tlsv1 alert internal error'), {
        code: 'ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR',
      }),
    );
    const fakeClient = {
      db: () => ({ command: async () => ({ ok: 1 }) }),
      close: async () => undefined,
    };
    connectMock.mockResolvedValueOnce(fakeClient);

    const { pingMongo } = await import('../src/db/mongo.js');

    await expect(pingMongo()).rejects.toThrow();
    await expect(pingMongo()).resolves.toBeUndefined();
    expect(connectMock).toHaveBeenCalledTimes(2);
  });
});
