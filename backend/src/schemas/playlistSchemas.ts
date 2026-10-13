import { parsePlaylistId } from '../utils/playlistId.js';

/** Validate GET /api/playlist query. Returns the raw user input for ID parsing. */
export function validatePlaylistQuery(query: unknown): string {
  const q = (query ?? {}) as Record<string, unknown>;
  const raw = String(q.url ?? q.id ?? '');
  if (!raw || raw.length > 500) {
    const err = new Error('Provide ?url=<playlist URL or ID>.') as Error & { status: number };
    err.status = 400;
    throw err;
  }
  // Syntax-check the ID/URL shape early (full fetch validates the rest)
  parsePlaylistId(raw);
  return raw;
}

/** `?refresh=1` bypasses a fresh cache entry to force upstream revalidation. */
export function isRefreshRequested(query: unknown): boolean {
  const q = (query ?? {}) as Record<string, unknown>;
  const v = q.refresh;
  return v === '1' || v === 'true' || v === 1 || v === true;
}
