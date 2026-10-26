import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { validatePlaylistQuery } from '../src/schemas/playlistSchemas.js';

vi.mock('../src/services/youtube/youtubeService.js', () => ({
  fetchPlaylistSnapshot: vi.fn(),
}));

import { fetchPlaylistSnapshot } from '../src/services/youtube/youtubeService.js';

const ID = 'PLcanonical0000000000';
const SNAP: any = {
  playlistId: ID,
  title: 'Canonical',
  reportedCount: 1,
  entries: [{ position: 1, videoId: 'v1', title: 'One', durationIso: 'PT1M' }],
  source: 'api',
  fetchedAt: '2026-10-01T00:00:00.000Z',
  snapshotVersion: 2,
};

const TOUCHED = ['PORT', 'CACHE_TTL_SEC', 'CACHE_MAX_ENTRIES', 'RATE_LIMIT_PER_MIN', 'TRUST_PROXY_HOPS', 'CORS_ORIGIN'];
const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of TOUCHED) original[k] = process.env[k];
  vi.resetAllMocks();
  (fetchPlaylistSnapshot as any).mockResolvedValue({ snapshot: SNAP });
});

afterEach(() => {
  for (const k of TOUCHED) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
});

describe('validated numeric environment', () => {
  it('rejects NaN, fractions, and out-of-range values with clear errors', () => {
    process.env.PORT = 'abc';
    expect(() => env.port).toThrow(/PORT must be an integer/);
    process.env.PORT = '3001.5';
    expect(() => env.port).toThrow(/PORT/);
    process.env.PORT = '0';
    expect(() => env.port).toThrow(/PORT/);
    process.env.PORT = '70000';
    expect(() => env.port).toThrow(/PORT/);

    process.env.CACHE_MAX_ENTRIES = '0';
    expect(() => env.cacheMaxEntries).toThrow(/CACHE_MAX_ENTRIES/);
    process.env.RATE_LIMIT_PER_MIN = 'Infinity';
    expect(() => env.rateLimitPerMin).toThrow(/RATE_LIMIT_PER_MIN/);
    process.env.TRUST_PROXY_HOPS = '-1';
    expect(() => env.trustProxyHops).toThrow(/TRUST_PROXY_HOPS/);

    process.env.PORT = '3456';
    expect(env.port).toBe(3456);
    delete process.env.CACHE_MAX_ENTRIES;
    expect(env.cacheMaxEntries).toBe(50);
  });
});

describe('canonical backend cache keys', () => {
  it('maps URL and bare ID to the same canonical query key', () => {
    const url = `https://www.youtube.com/playlist?list=${ID}`;
    expect(validatePlaylistQuery({ url })).toBe(ID);
    expect(validatePlaylistQuery({ id: ID })).toBe(ID);
  });

  it('serves a URL request and a bare-ID request from one cache entry/upstream fetch', async () => {
    process.env.YOUTUBE_API_KEY = 'test-key';
    const app = createApp();
    const r1 = await request(app).get('/api/playlist').query({ url: `https://youtube.com/playlist?list=${ID}` });
    expect(r1.status).toBe(200);
    expect(r1.body.cached).toBe(false);
    const r2 = await request(app).get('/api/playlist').query({ url: ID });
    expect(r2.status).toBe(200);
    expect(r2.body.cached).toBe(true);
    expect((fetchPlaylistSnapshot as any).mock.calls).toHaveLength(1);
  });
});

describe('proxy-aware rate limiting', () => {
  it('separates real clients and does not mint buckets from a spoofed left-most XFF entry', async () => {
    process.env.RATE_LIMIT_PER_MIN = '1';
    process.env.TRUST_PROXY_HOPS = '1';
    const app = createApp();

    const first = await request(app).get('/api/health').set('X-Forwarded-For', '6.6.6.6, 203.0.113.9');
    expect(first.status).toBe(200);
    // Same trusted-proxy-appended client IP, different spoofed left entry: still
    // the same bucket, so the second request is rejected.
    const spoofed = await request(app).get('/api/health').set('X-Forwarded-For', '7.7.7.7, 203.0.113.9');
    expect(spoofed.status).toBe(429);
    expect(spoofed.body.error).toMatch(/Too many requests/);

    // A genuinely different client IP gets its own bucket.
    const other = await request(app).get('/api/health').set('X-Forwarded-For', '203.0.113.10');
    expect(other.status).toBe(200);
  });

  it('does not trust forwarded headers when TRUST_PROXY_HOPS=0', async () => {
    process.env.RATE_LIMIT_PER_MIN = '1';
    process.env.TRUST_PROXY_HOPS = '0';
    const app = createApp();
    expect((await request(app).get('/api/health').set('X-Forwarded-For', '203.0.113.20')).status).toBe(200);
    // Direct mode ignores XFF, so both requests share the socket address bucket.
    expect((await request(app).get('/api/health').set('X-Forwarded-For', '203.0.113.21')).status).toBe(429);
  });
});
