import 'dotenv/config';
import { parsePlaylistId, httpError, MAX_ENTRIES } from '../../utils/playlistId.js';
import { recordUpstream, recordRetry, recordRetryFailure } from '../../diagnostics/apiStats.js';
import type { NormalizedEntry, NormalizedSnapshot } from '../../types/index.js';

const API_BASE = 'https://www.googleapis.com/youtube/v3';
const FETCH_TIMEOUT_MS = 10000;

/** Retryable: rate-limit, transient 5xx, and timeouts. Never quota/4xx. */
function isRetryable(e: any): boolean {
  if (e?.retryable === false) return false;
  const status = e?.status;
  if (e?.name === 'AbortError') return true;
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
  // Undifferentiated network failures (no HTTP status) are retryable; HTTP 4xx are not.
  if (status === undefined || status === null) return true;
  return false;
}

function backoffMs(attempt: number): number {
  const base = attempt === 0 ? 400 : 1200;
  return base + Math.floor(Math.random() * 200); // jitter
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function ytFetch(path: string, apiKey: string, method: 'playlists.list' | 'playlistItems.list' | 'videos.list'): Promise<any> {
  recordUpstream(method);
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
      const quota = /quota/i.test(body);
      const err = httpError(
        quota
          ? 'YouTube API quota exhausted. Try again tomorrow or use CSV/JSON import.'
          : 'YouTube API key invalid, restricted, or unauthorized.',
        502,
      );
      // Quota/auth failures must never be retried: retries burn quota (or
      // hammer a rejected key) for zero benefit. The 502 status is downstream-
      // facing only; the retry classifier must see the non-retryable flag.
      (err as any).retryable = false;
      throw err;
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

/**
 * Bounded retry for one upstream call: at most 2 retries, exponential
 * backoff with jitter, retryable errors only (429/5xx/timeouts). Quota (403),
 * 400, and 404 are never retried — retrying them burns quota for nothing.
 */
async function ytFetchRetry(
  path: string,
  apiKey: string,
  method: 'playlists.list' | 'playlistItems.list' | 'videos.list',
): Promise<any> {
  let last: any = null;
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      return await ytFetch(path, apiKey, method);
    } catch (e) {
      last = e;
      if (attempt >= 2 || !isRetryable(e)) {
        if (attempt >= 2 && isRetryable(e)) recordRetryFailure();
        throw e;
      }
      recordRetry();
      await sleep(backoffMs(attempt));
    }
  }
  throw last;
}

function detectUnresolvedReason(title: string): NormalizedEntry['unresolvedReason'] {
  const t = (title || '').toLowerCase();
  // Only reasons supported by observable YouTube placeholder text. A missing
  // metadata row without such evidence stays 'unknown' — never invented.
  if (t.includes('deleted video') || t.includes('video has been removed') || t.includes('video was removed')) return 'deleted';
  if (t.includes('private video') || t.includes('video is private')) return 'private';
  if (t.includes('not found') || t.includes('no longer available') || t.includes('video unavailable') || t.includes('video is unavailable')) return 'notFound';
  if (t.includes('not available in your country') || t.includes('blocked it in your country')) return 'regionRestricted';
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

  const pl = await ytFetchRetry(`/playlists?part=snippet,contentDetails&id=${encodeURIComponent(playlistId)}`, apiKey, 'playlists.list');
  const plItem = pl?.items?.[0];
  if (!plItem) throw httpError('Playlist not found, private, or inaccessible.', 404);
  const title: string = plItem.snippet?.title ?? 'Untitled playlist';
  const channelTitle: string | undefined = plItem.snippet?.channelTitle;
  const thumb: string | undefined =
    plItem.snippet?.thumbnails?.medium?.url ?? plItem.snippet?.thumbnails?.default?.url;
  const reportedCount: number | null =
    typeof plItem.contentDetails?.itemCount === 'number' && Number.isFinite(plItem.contentDetails.itemCount)
      ? plItem.contentDetails.itemCount
      : null;

  // Reject before paging/batching: a playlist that already reports an
  // unsupported size would otherwise spend many playlistItems/videos quota
  // units only to be rejected at the end.
  if (reportedCount !== null && reportedCount > MAX_ENTRIES) {
    throw httpError(`Playlist reports ${reportedCount} entries, exceeding the supported cap of ${MAX_ENTRIES}. Nothing was imported.`, 400);
  }

  const items: { videoId: string; title: string; thumbnail?: string; publishedAt?: string }[] = [];
  let pageToken = '';
  let guard = 0;
  for (;;) {
    if (guard++ > 25) throw httpError('Playlist too large to fetch safely.', 400);
    const data = await ytFetchRetry(
      `/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${encodeURIComponent(playlistId)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
      apiKey,
      'playlistItems.list',
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
        fetchedAt: new Date().toISOString(), snapshotVersion: 2,
      },
    };
  }

  // Batch videos.list in chunks of 50; dedupe requests, keep positional entries.
  const uniqueIds = [...new Set(items.map((i) => i.videoId).filter(Boolean))];
  const meta = new Map<string, { durationIso: string | null; title: string; thumbnail?: string }>();
  for (let i = 0; i < uniqueIds.length; i += 50) {
    const chunk = uniqueIds.slice(i, i + 50);
    const data: any = await ytFetchRetry(
      `/videos?part=contentDetails,snippet&id=${encodeURIComponent(chunk.join(','))}`,
      apiKey,
      'videos.list',
    );
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
      fetchedAt: new Date().toISOString(), snapshotVersion: 2,
    },
  };
}
