import { parsePlaylistId } from '../utils/playlistId.js';

/**
 * Validate GET /api/playlist query and return the canonical playlist ID.
 * Cache and in-flight-dedupe keys use this value, so `/playlist?list=ID` and
 * the bare ID share one LRU entry instead of storing the same snapshot twice.
 */
export function validatePlaylistQuery(query: unknown): string {
  const q = (query ?? {}) as Record<string, unknown>;
  const raw = String(q.url ?? q.id ?? '');
  if (!raw || raw.length > 500) {
    const err = new Error('Provide ?url=<playlist URL or ID>.') as Error & { status: number };
    err.status = 400;
    throw err;
  }
  // Parsing both validates the shape and canonicalizes URL → playlist ID.
  return parsePlaylistId(raw);
}

/** `?refresh=1` bypasses a fresh cache entry to force upstream revalidation. */
export function isRefreshRequested(query: unknown): boolean {
  const q = (query ?? {}) as Record<string, unknown>;
  const v = q.refresh;
  return v === '1' || v === 'true' || v === 1 || v === true;
}
