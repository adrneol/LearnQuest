/**
 * Sanitized YouTube API diagnostics: in-memory counters only.
 * Never records API keys, playlist IDs, URLs, titles, or user data —
 * only method counts, cache outcomes, retries, and quota-unit estimates.
 */

// Official quota-calculator costs for the list methods this backend uses
// (developers.google.com/youtube/v3/determine_quota_cost): each `*.list`
// call costs 1 unit (search would cost 100 but is never used here).
export const QUOTA_COST: Record<string, number> = {
  'playlists.list': 1,
  'playlistItems.list': 1,
  'videos.list': 1,
};

export interface ApiStats {
  upstreamRequests: number;
  byMethod: Record<string, number>;
  quotaUnits: number;
  cacheHits: number;
  cacheMisses: number;
  evictions: number;
  dedupHits: number;
  retries: number;
  retryFailures: number;
  playlistImports: number;
  playlistRefreshes: number;
  startedAt: string;
}

const counters: ApiStats = {
  upstreamRequests: 0,
  byMethod: {},
  quotaUnits: 0,
  cacheHits: 0,
  cacheMisses: 0,
  evictions: 0,
  dedupHits: 0,
  retries: 0,
  retryFailures: 0,
  playlistImports: 0,
  playlistRefreshes: 0,
  startedAt: new Date().toISOString(),
};

export function recordUpstream(method: string): void {
  counters.upstreamRequests += 1;
  counters.byMethod[method] = (counters.byMethod[method] ?? 0) + 1;
  counters.quotaUnits += QUOTA_COST[method] ?? 1;
}

export function recordCacheHit(): void {
  counters.cacheHits += 1;
}
export function recordCacheMiss(): void {
  counters.cacheMisses += 1;
}
export function recordEviction(): void {
  counters.evictions += 1;
}
export function recordDedupHit(): void {
  counters.dedupHits += 1;
}
export function recordRetry(): void {
  counters.retries += 1;
}
export function recordRetryFailure(): void {
  counters.retryFailures += 1;
}
export function recordImport(refresh: boolean): void {
  if (refresh) counters.playlistRefreshes += 1;
  else counters.playlistImports += 1;
}

export function getApiStats(): ApiStats {
  return { ...counters, byMethod: { ...counters.byMethod } };
}

export function resetApiStats(): void {
  counters.upstreamRequests = 0;
  counters.byMethod = {};
  counters.quotaUnits = 0;
  counters.cacheHits = 0;
  counters.cacheMisses = 0;
  counters.evictions = 0;
  counters.dedupHits = 0;
  counters.retries = 0;
  counters.retryFailures = 0;
  counters.playlistImports = 0;
  counters.playlistRefreshes = 0;
  counters.startedAt = new Date().toISOString();
}
