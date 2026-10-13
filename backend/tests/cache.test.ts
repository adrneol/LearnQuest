import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryCache } from '../src/cache/memoryCache.js';
import type { NormalizedSnapshot } from '../src/types/index.js';

vi.mock('../src/services/youtube/youtubeService.js', () => ({
  fetchPlaylistSnapshot: vi.fn(),
}));

import { fetchPlaylistSnapshot } from '../src/services/youtube/youtubeService.js';

function syntheticSnapshot(id: string, n: number): NormalizedSnapshot {
  return {
    playlistId: id,
    title: `Fixture ${id}`,
    channelTitle: 'chan',
    thumbnail: undefined,
    reportedCount: n,
    entries: Array.from({ length: n }, (_, i) => ({
      position: i + 1,
      videoId: `vid${i + 1}`,
      title: `Video ${i + 1} with a realistic-length title for byte estimation`,
      thumbnail: undefined,
      durationIso: 'PT5M30S',
      publishedAt: '2026-01-01T00:00:00Z',
    })),
    source: 'api',
    fetchedAt: new Date().toISOString(),
    snapshotVersion: 1,
  };
}

describe('bounded backend cache', () => {
  it('evicts least-recently-used entries beyond the cap', () => {
    const cache = createMemoryCache(() => 600, { maxEntries: () => 10 });
    for (let i = 0; i < 15; i++) cache.set(`k${i}`, syntheticSnapshot(`PL${i}`, 10));
    expect(cache.size()).toBe(10);
    // k0..k4 evicted; k5..k14 retained.
    expect(cache.get('k0')).toBeNull();
    expect(cache.get('k14')).not.toBeNull();
    // Hit refreshes recency: touch k5, add k15 → k6 evicted instead of k5.
    expect(cache.get('k5')).not.toBeNull();
    cache.set('k15', syntheticSnapshot('PL15', 10));
    expect(cache.get('k5')).not.toBeNull();
    expect(cache.get('k6')).toBeNull();
  });

  it('expires entries after TTL', async () => {
    let ttl = 600;
    const cache = createMemoryCache(() => ttl);
    cache.set('a', syntheticSnapshot('PLa', 5));
    expect(cache.get('a')).not.toBeNull();
    ttl = 0;
    // Force expiry by waiting a tick (expiresAt already passed for new reads).
    await new Promise((r) => setTimeout(r, 5));
    const cache2 = createMemoryCache(() => -1);
    cache2.set('b', syntheticSnapshot('PLb', 5));
    expect(cache2.get('b')).toBeNull();
  });

  it('stats report bounded counts without contents or keys', () => {
    const cache = createMemoryCache(() => 600, { maxEntries: () => 50 });
    cache.set('x', syntheticSnapshot('PLx', 100));
    const st = cache.stats();
    expect(st.entries).toBe(1);
    expect(st.maxEntries).toBe(50);
    expect(st.approxBytes).toBeGreaterThan(0);
    expect(JSON.stringify(st)).not.toContain('YOUTUBE_API_KEY');
  });

  it('concurrent identical requests share one upstream fetch', async () => {
    const snap = syntheticSnapshot('PLdedup1234567890', 3);
    (fetchPlaylistSnapshot as any).mockResolvedValue({ snapshot: snap });
    const app = createApp();
    const [r1, r2, r3] = await Promise.all([
      request(app).get('/api/playlist').query({ url: 'PLdedup1234567890' }),
      request(app).get('/api/playlist').query({ url: 'PLdedup1234567890' }),
      request(app).get('/api/playlist').query({ url: 'PLdedup1234567890' }),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(200);
    expect((fetchPlaylistSnapshot as any).mock.calls.length).toBe(1);
  });
});

describe('backend memory under representative playlist sizes', () => {
  it('profiles heap/RSS across 1/139/500/1000-entry snapshots through the cache', async () => {
    const cache = createMemoryCache(() => 600, { maxEntries: () => 50 });
    const before = process.memoryUsage();
    const rows: { n: number; heapUsed: number; rss: number; entries: number }[] = [];
    for (const n of [1, 139, 500, 1000]) {
      const snap = syntheticSnapshot(`PLmem${n}`, n);
      cache.set(`mem:${n}`, snap);
      if (global.gc) global.gc();
      const m = process.memoryUsage();
      rows.push({ n, heapUsed: m.heapUsed, rss: m.rss, entries: cache.size() });
    }
    // eslint-disable-next-line no-console
    console.log(
      `backend-mem before heap=${(before.heapUsed / 1048576).toFixed(1)}MB rss=${(before.rss / 1048576).toFixed(1)}MB :: ` +
        rows.map((r) => `N=${r.n} heap=${(r.heapUsed / 1048576).toFixed(1)}MB rss=${(r.rss / 1048576).toFixed(1)}MB`).join(' | '),
    );
    expect(cache.size()).toBe(4);
    // Sanity rails (generous): 1000-entry synthetic snapshot must not explode the heap.
    const growthMB = (rows[3].heapUsed - before.heapUsed) / 1048576;
    expect(growthMB).toBeLessThan(100);
    // Cache stays bounded and its stats endpoint exposes the bound.
    const app = createApp();
    const res = await request(app).get('/api/cache');
    expect(res.status).toBe(200);
    expect(res.body.maxEntries).toBeGreaterThan(0);
  });
});
