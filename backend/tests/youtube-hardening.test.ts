import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchPlaylistSnapshot } from '../src/services/youtube/youtubeService.js';
import { getApiStats, resetApiStats } from '../src/diagnostics/apiStats.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('YouTube upstream error classification and quota protection', () => {
  it('does not retry authentication/authorization 403 responses', async () => {
    resetApiStats();
    const calls: string[] = [];
    globalThis.fetch = (async (url: any) => {
      calls.push(String(url));
      return { ok: false, status: 403, text: async () => 'API key not valid. Please pass a valid API key.' } as Response;
    }) as any;

    await expect(fetchPlaylistSnapshot('PLauth403000000000000', 'bad-key')).rejects.toMatchObject({ status: 502 });
    expect(calls.filter((u) => u.includes('/playlists?'))).toHaveLength(1);
    expect(getApiStats().retries).toBe(0);
  });

  it('rejects a playlist whose reported count already exceeds the cap before paging', async () => {
    resetApiStats();
    const calls: string[] = [];
    globalThis.fetch = (async (url: any) => {
      calls.push(String(url));
      return json({ items: [{ snippet: { title: 'Huge' }, contentDetails: { itemCount: 1500 } }] });
    }) as any;

    await expect(fetchPlaylistSnapshot('PLhuge1500000000000000', 'key')).rejects.toMatchObject({ status: 400 });
    expect(calls.filter((u) => u.includes('/playlists?'))).toHaveLength(1);
    // No playlistItems/videos quota was spent on a playlist known to be too big.
    expect(calls.filter((u) => u.includes('/playlistItems?') || u.includes('/videos?'))).toHaveLength(0);
  });

  it('classifies observable placeholder reasons and never invents one', async () => {
    resetApiStats();
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      if (u.includes('/playlists?')) {
        return json({ items: [{ snippet: { title: 'Reasons' }, contentDetails: { itemCount: 5 } }] });
      }
      if (u.includes('/playlistItems?')) {
        return json({
          items: [
            { contentDetails: { videoId: 'gone' }, snippet: { title: '[Deleted video]' } },
            { contentDetails: { videoId: 'priv' }, snippet: { title: '[Private video]' } },
            { contentDetails: { videoId: 'nofind' }, snippet: { title: 'Video unavailable' } },
            { contentDetails: { videoId: 'region' }, snippet: { title: 'This video is not available in your country' } },
            { contentDetails: { videoId: 'mystery' }, snippet: { title: 'Ordinary title with no metadata row' } },
          ],
        });
      }
      if (u.includes('/videos?')) return json({ items: [] });
      return json({}, 404);
    }) as any;

    const { snapshot } = await fetchPlaylistSnapshot('PLreasons000000000000', 'key');
    const byVideo = new Map(snapshot.entries.map((e) => [e.videoId, e]));
    expect(byVideo.get('gone')?.unresolvedReason).toBe('deleted');
    expect(byVideo.get('priv')?.unresolvedReason).toBe('private');
    expect(byVideo.get('nofind')?.unresolvedReason).toBe('notFound');
    expect(byVideo.get('region')?.unresolvedReason).toBe('regionRestricted');
    expect(byVideo.get('mystery')?.unresolvedReason).toBe('unknown');
    expect(byVideo.get('gone')?.durationIso).toBeNull();
    expect(snapshot.snapshotVersion).toBe(2);
  });
});
