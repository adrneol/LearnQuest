import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchPlaylistSnapshot } from '../src/services/youtube/youtubeService.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('youtube service contract', () => {
  it('paginates playlistItems, batches videos, and returns ORIGINAL ISO durations', async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('/playlists?')) {
        return jsonResponse({
          items: [{ snippet: { title: 'Course', channelTitle: 'Chan', thumbnails: {} }, contentDetails: { itemCount: 3 } }],
        });
      }
      if (u.includes('/playlistItems?')) {
        if (u.includes('pageToken')) {
          return jsonResponse({
            items: [{ contentDetails: { videoId: 'vid3' }, snippet: { title: 'V3' } }],
          });
        }
        return jsonResponse({
          items: [
            { contentDetails: { videoId: 'vid1' }, snippet: { title: 'V1' } },
            { contentDetails: { videoId: 'vid1' }, snippet: { title: 'V1 repeat' } },
          ],
          nextPageToken: 'TOK',
        });
      }
      if (u.includes('/videos?')) {
        return jsonResponse({
          items: [
            { id: 'vid1', contentDetails: { duration: 'PT1H2M3S' }, snippet: { title: 'Video One' } },
            // vid3 intentionally absent (deleted/private) -> unresolved, not fabricated
          ],
        });
      }
      return jsonResponse({}, 404);
    }) as any;

    const { snapshot } = await fetchPlaylistSnapshot('PLtest1234567890', 'KEY');
    expect(snapshot.playlistId).toBe('PLtest1234567890');
    expect(snapshot.entries).toHaveLength(3);
    // original order preserved, duplicates kept as separate positions
    expect(snapshot.entries.map((e) => e.position)).toEqual([1, 2, 3]);
    expect(snapshot.entries[0].durationIso).toBe('PT1H2M3S');
    expect(snapshot.entries[1].durationIso).toBe('PT1H2M3S');
    expect(snapshot.entries[2].durationIso).toBeNull();
    expect(snapshot.entries[2].unresolvedReason).toBeTruthy();
    // backend must NOT compute seconds — contract carries ISO only
    expect(snapshot).not.toHaveProperty('totalSec');
    for (const e of snapshot.entries) expect(e).not.toHaveProperty('durationSec');
    expect(calls.some((c) => c.includes('pageToken=TOK'))).toBe(true);
  });

  it('reports missing key without leaking anything', async () => {
    await expect(fetchPlaylistSnapshot('PLtest1234567890', '')).rejects.toMatchObject({ status: 503 });
  });
});
