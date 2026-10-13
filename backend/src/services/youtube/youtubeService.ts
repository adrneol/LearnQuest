import 'dotenv/config';
import { parsePlaylistId, httpError, MAX_ENTRIES } from '../../utils/playlistId.js';
import type { NormalizedEntry, NormalizedSnapshot } from '../../types/index.js';

const API_BASE = 'https://www.googleapis.com/youtube/v3';
const FETCH_TIMEOUT_MS = 10000;

async function ytFetch(path: string, apiKey: string): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(apiKey)}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    });
    if (res.status === 400) throw httpError('Invalid playlist or request rejected by YouTube API.', 400);
    if (res.status === 403) {
      const body = await res.text().catch(() => '');
      throw httpError(
        /quota/i.test(body)
          ? 'YouTube API quota exhausted. Try again tomorrow or use CSV/JSON import.'
          : 'YouTube API key invalid, restricted, or unauthorized.',
        502,
      );
    }
    if (res.status === 404) throw httpError('Playlist not found or private.', 404);
    if (!res.ok) throw httpError(`YouTube API error (HTTP ${res.status}).`, 502);
    return await res.json();
  } catch (e: any) {
    if (e?.name === 'AbortError') throw httpError('YouTube API timed out. Try again.', 504);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function detectUnresolvedReason(title: string): NormalizedEntry['unresolvedReason'] {
  const t = (title || '').toLowerCase();
  if (t.includes('deleted')) return 'deleted';
  if (t.includes('private')) return 'private';
  return 'unknown';
}

/**
 * Fetch + normalize a playlist. Returns ORIGINAL ISO durations — the frontend
 * domain engine parses them into seconds and computes every total.
 */
export async function fetchPlaylistSnapshot(
  rawInput: string,
  apiKey: string,
): Promise<{ snapshot: NormalizedSnapshot }> {
  if (!apiKey) throw httpError('Server is missing YOUTUBE_API_KEY. Add it to backend/.env — see .env.example.', 503);
  const playlistId = parsePlaylistId(rawInput);

  const pl = await ytFetch(`/playlists?part=snippet,contentDetails&id=${encodeURIComponent(playlistId)}`, apiKey);
  const plItem = pl?.items?.[0];
  if (!plItem) throw httpError('Playlist not found, private, or inaccessible.', 404);
  const title: string = plItem.snippet?.title ?? 'Untitled playlist';
  const channelTitle: string | undefined = plItem.snippet?.channelTitle;
  const thumb: string | undefined =
    plItem.snippet?.thumbnails?.medium?.url ?? plItem.snippet?.thumbnails?.default?.url;
  const reportedCount: number | null =
    typeof plItem.contentDetails?.itemCount === 'number' ? plItem.contentDetails.itemCount : null;

  const items: { videoId: string; title: string; thumbnail?: string; publishedAt?: string }[] = [];
  let pageToken = '';
  let guard = 0;
  for (;;) {
    if (guard++ > 25) throw httpError('Playlist too large to fetch safely.', 400);
    const data = await ytFetch(
      `/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${encodeURIComponent(playlistId)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
      apiKey,
    );
    for (const it of data?.items ?? []) {
      items.push({
        videoId: it?.contentDetails?.videoId ?? it?.snippet?.resourceId?.videoId ?? '',
        title: it?.snippet?.title ?? '(untitled)',
        thumbnail: it?.snippet?.thumbnails?.medium?.url ?? it?.snippet?.thumbnails?.default?.url,
        publishedAt: it?.snippet?.publishedAt,
      });
      if (items.length > MAX_ENTRIES) throw httpError(`Playlist exceeds supported cap of ${MAX_ENTRIES} entries.`, 400);
    }
    pageToken = data?.nextPageToken ?? '';
    if (!pageToken) break;
  }
  if (items.length === 0) {
    return {
      snapshot: {
        playlistId, title, channelTitle, thumbnail: thumb,
        reportedCount, entries: [], source: 'api',
        fetchedAt: new Date().toISOString(), snapshotVersion: 1,
      },
    };
  }

  // Batch videos.list in chunks of 50; dedupe requests, keep positional entries.
  const uniqueIds = [...new Set(items.map((i) => i.videoId).filter(Boolean))];
  const meta = new Map<string, { durationIso: string | null; title: string; thumbnail?: string }>();
  for (let i = 0; i < uniqueIds.length; i += 50) {
    const chunk = uniqueIds.slice(i, i + 50);
    let data: any = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        data = await ytFetch(
          `/videos?part=contentDetails,snippet&id=${encodeURIComponent(chunk.join(','))}`,
          apiKey,
        );
        break;
      } catch (e) {
        if (attempt === 1) throw e;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    for (const v of data?.items ?? []) {
      const id: string = v?.id;
      const iso: unknown = v?.contentDetails?.duration;
      meta.set(id, {
        durationIso: typeof iso === 'string' ? iso : null,
        title: v?.snippet?.title ?? '',
        thumbnail: v?.snippet?.thumbnails?.medium?.url,
      });
    }
  }

  const entries: NormalizedEntry[] = items.map((it, idx) => {
    const position = idx + 1;
    const m = it.videoId ? meta.get(it.videoId) : undefined;
    if (!it.videoId || !m) {
      return {
        position, videoId: it.videoId || '', title: it.title,
        thumbnail: it.thumbnail, durationIso: null,
        unresolvedReason: detectUnresolvedReason(it.title),
        publishedAt: it.publishedAt,
      };
    }
    return {
      position,
      videoId: it.videoId,
      title: m.title || it.title,
      thumbnail: m.thumbnail ?? it.thumbnail,
      durationIso: m.durationIso,
      ...(m.durationIso === null ? { unresolvedReason: 'missingDuration' as const } : {}),
      publishedAt: it.publishedAt,
    };
  });

  return {
    snapshot: {
      playlistId, title, channelTitle, thumbnail: thumb,
      reportedCount, entries, source: 'api',
      fetchedAt: new Date().toISOString(), snapshotVersion: 1,
    },
  };
}
