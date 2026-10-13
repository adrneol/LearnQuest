import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getApiStats, resetApiStats } from '../src/diagnostics/apiStats.js';

// Mocked upstream: deterministic pages/batches, no network, no quota spent.
const realFetch = globalThis.fetch;

function installUpstream(opts: {
  n: number;
  failVideosOnce?: boolean;
  quotaError?: boolean;
  calls: string[];
  videosAttempts?: { count: number };
  /** artificial latency (ms) so concurrent requests overlap in-flight */
  delayMs?: number;
}) {
  const ids = Array.from({ length: opts.n }, (_, i) => `vid${i + 1}`);
  let videosFailed = false;
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    opts.calls.push(u);
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    const json = (body: unknown, status = 200): Response =>
      ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;
    if (u.includes('/playlists?')) {
      if (opts.quotaError) {
        return { ok: false, status: 403, text: async () => 'quota exceeded for today' } as Response;
      }
      return json({ items: [{ snippet: { title: 'Course' }, contentDetails: { itemCount: opts.n } }] });
    }
    if (u.includes('/playlistItems?')) {
      const m = /pageToken=(\d+)/.exec(u);
      const start = m ? Number(m[1]) : 0;
      const page = ids.slice(start, start + 50);
      const next = start + 50 < ids.length ? String(start + 50) : '';
      return json({
        items: page.map((id) => ({ contentDetails: { videoId: id }, snippet: { title: `T ${id}` } })),
        ...(next ? { nextPageToken: next } : {}),
      });
    }
    if (u.includes('/videos?')) {
      if (opts.videosAttempts) opts.videosAttempts.count += 1;
      if (opts.failVideosOnce && !videosFailed) {
        videosFailed = true;
        return { ok: false, status: 503, text: async () => 'backend error' } as Response;
      }
      const idsParam = decodeURIComponent((u.match(/[?&]id=([^&]*)/)?.[1] ?? '').replace(/\+/g, ' '));
      const wanted = idsParam.split(',').filter(Boolean);
      return json({ items: wanted.map((id) => ({ id, contentDetails: { duration: 'PT5M0S' }, snippet: { title: `V ${id}` } })) });
    }
    return json({}, 404);
  }) as any;
}

beforeEach(() => {
  resetApiStats();
  process.env.YOUTUBE_API_KEY = 'test-key-never-logged';
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('API efficiency baseline (mocked upstream)', () => {
  it('importing 100 videos costs exactly 5 upstream calls (1+2+2), repeat is a cache hit', async () => {
    const calls: string[] = [];
    installUpstream({ n: 100, calls });
    const app = createApp();
    const r1 = await request(app).get('/api/playlist').query({ url: 'PLbaseline100aaaaaaaaaaaaaaaaaaaaaaaa' });
    expect(r1.status).toBe(200);
    expect(r1.body.cached).toBe(false);
    expect(r1.body.snapshot.entries).toHaveLength(100);
    expect(calls.filter((c) => c.includes('/playlists?'))).toHaveLength(1);
    expect(calls.filter((c) => c.includes('/playlistItems?'))).toHaveLength(2);
    expect(calls.filter((c) => c.includes('/videos?'))).toHaveLength(2);
    const s1 = getApiStats();
    expect(s1.upstreamRequests).toBe(5);
    expect(s1.quotaUnits).toBe(5);
    expect(s1.playlistImports).toBe(1);

    // Repeat: zero new upstream requests (navigation/reload must not refetch).
    const r2 = await request(app).get('/api/playlist').query({ url: 'PLbaseline100aaaaaaaaaaaaaaaaaaaaaaaa' });
    expect(r2.body.cached).toBe(true);
    expect(calls).toHaveLength(5);
    expect(getApiStats().cacheHits).toBe(1);
  });

  it('refresh=1 bypasses cache and revalidates upstream', async () => {
    const calls: string[] = [];
    installUpstream({ n: 25, calls });
    const app = createApp();
    const url = 'PLrefresh25aaaaaaaaaaaaaaaaaaaaaaaaaa';
    await request(app).get('/api/playlist').query({ url });
    expect(calls).toHaveLength(3); // 1 + 1 page + 1 batch
    const r = await request(app).get('/api/playlist').query({ url, refresh: '1' });
    expect(r.body.cached).toBe(false);
    expect(calls).toHaveLength(6);
    expect(getApiStats().playlistRefreshes).toBe(1);
  });

  it('concurrent identical requests share one upstream import (dedup)', async () => {
    const calls: string[] = [];
    // 60ms latency guarantees the three arrivals overlap while the first
    // import is still in flight (instant mocks would serialize instead).
    installUpstream({ n: 10, calls, delayMs: 60 });
    const app = createApp();
    const url = 'PLdedup10aaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const [a, b, c] = await Promise.all([
      request(app).get('/api/playlist').query({ url }),
      request(app).get('/api/playlist').query({ url }),
      request(app).get('/api/playlist').query({ url }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(c.status).toBe(200);
    // One import's worth of upstream calls despite 3 concurrent arrivals.
    expect(calls.filter((u) => u.includes('/playlists?'))).toHaveLength(1);
    expect(getApiStats().dedupHits).toBeGreaterThanOrEqual(1);
  });

  it('quota errors are never retried and never poison the cache', async () => {
    const calls: string[] = [];
    installUpstream({ n: 10, calls, quotaError: true });
    const app = createApp();
    const url = 'PLquota10aaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const r1 = await request(app).get('/api/playlist').query({ url });
    expect(r1.status).toBe(502);
    expect(r1.body.error).toMatch(/quota/i);
    expect(calls.filter((u) => u.includes('/playlists?'))).toHaveLength(1);
    expect(getApiStats().retries).toBe(0);
    // Retry later still reaches upstream (no poisoned negative cache).
    const r2 = await request(app).get('/api/playlist').query({ url });
    expect(r2.status).toBe(502);
    expect(calls.filter((u) => u.includes('/playlists?'))).toHaveLength(2);
  });

  it('transient 503 on videos.list is retried once with backoff, then succeeds', async () => {
    const calls: string[] = [];
    const videosAttempts = { count: 0 };
    installUpstream({ n: 10, calls, failVideosOnce: true, videosAttempts });
    const app = createApp();
    const r = await request(app).get('/api/playlist').query({ url: 'PLretry10aaaaaaaaaaaaaaaaaaaaaaaaaaa' });
    expect(r.status).toBe(200);
    expect(videosAttempts.count).toBe(2);
    expect(getApiStats().retries).toBe(1);
  });

  it('playlists over 1000 entries are rejected before metadata batching', async () => {
    const calls: string[] = [];
    installUpstream({ n: 1050, calls });
    const app = createApp();
    const r = await request(app).get('/api/playlist').query({ url: 'PLtoolarge1050aaaaaaaaaaaaaaaaaaaaaa' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/cap of 1000/i);
    // Rejected before any videos.list batch (no wasted metadata spend).
    expect(calls.some((c) => c.includes('/videos?'))).toBe(false);
    // Failed import cached nothing: a later valid import still works.
    expect(getApiStats().cacheHits).toBe(0);
  });

  it('importing 500 videos costs exactly 21 upstream calls; stats stay sanitized', async () => {
    const calls: string[] = [];
    installUpstream({ n: 500, calls });
    const app = createApp();
    const r = await request(app).get('/api/playlist').query({ url: 'PLfivehundredaaaaaaaaaaaaaaaaaaaaaa' });
    expect(r.status).toBe(200);
    expect(r.body.snapshot.entries).toHaveLength(500);
    expect(calls.filter((c) => c.includes('/playlistItems?'))).toHaveLength(10);
    expect(calls.filter((c) => c.includes('/videos?'))).toHaveLength(10);
    expect(calls).toHaveLength(21);
    expect(getApiStats().quotaUnits).toBe(21);
    const cache = await request(app).get('/api/cache');
    expect(cache.status).toBe(200);
    const body = JSON.stringify(cache.body);
    expect(body).not.toContain('test-key-never-logged');
    expect(body).not.toContain('PLfivehundred');
    expect(cache.body.api.byMethod['videos.list']).toBe(10);
    expect(cache.body.api.quotaUnits).toBe(21);
  });
});
