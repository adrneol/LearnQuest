import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

// Mock the youtube fetcher to avoid network
vi.mock('../src/services/youtube/youtubeService.js', () => ({
  fetchPlaylistSnapshot: vi.fn(),
}));

import { fetchPlaylistSnapshot } from '../src/services/youtube/youtubeService.js';

describe('API', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('health does not disclose secrets', async () => {
    process.env.YOUTUBE_API_KEY = 'secret123';
    const app = createApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('secret123');
    expect(res.body.hasKey).toBe(true);
  });

  it('rejects missing url param', async () => {
    const app = createApp();
    const res = await request(app).get('/api/playlist');
    expect(res.status).toBe(400);
  });

  it('returns snapshot and caches (no key leak)', async () => {
    const snap: any = {
      playlistId: 'PLtest1234567890',
      title: 'T',
      reportedCount: 2,
      entries: [
        { position: 1, videoId: 'a', title: 'A', durationSec: 60 },
        { position: 2, videoId: 'b', title: 'B', durationSec: 120 },
      ],
      source: 'api',
      fetchedAt: new Date().toISOString(),
      snapshotVersion: 1,
    };
    (fetchPlaylistSnapshot as any).mockResolvedValue({ snapshot: snap });
    const app = createApp();
    const r1 = await request(app).get('/api/playlist').query({ url: 'PLtest1234567890' });
    expect(r1.status).toBe(200);
    expect(r1.body.snapshot.entries).toHaveLength(2);
    expect(JSON.stringify(r1.body)).not.toContain('secret');
    const r2 = await request(app).get('/api/playlist').query({ url: 'PLtest1234567890' });
    expect(r2.body.cached).toBe(true);
  });

  it('maps upstream errors without stack traces', async () => {
    (fetchPlaylistSnapshot as any).mockRejectedValue(Object.assign(new Error('YouTube API quota exhausted.'), { status: 502 }));
    const app = createApp();
    const res = await request(app).get('/api/playlist').query({ url: 'PLtest1234567890' });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/quota/i);
    expect(res.body).not.toHaveProperty('stack');
  });
});
