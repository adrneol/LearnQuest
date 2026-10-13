import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { validatePlaylistQuery, isRefreshRequested } from '../schemas/playlistSchemas.js';
import { fetchPlaylistSnapshot } from '../services/youtube/youtubeService.js';
import { recordCacheHit, recordCacheMiss, recordDedupHit, recordImport } from '../diagnostics/apiStats.js';
import type { MemoryCache } from '../cache/memoryCache.js';

export function createPlaylistController(cache: MemoryCache) {
  // Dedupe equivalent in-flight fetches: concurrent refreshes for the same
  // playlist share one upstream request instead of hammering YouTube quota.
  const inflight = new Map<string, Promise<{ snapshot: import('../types/index.js').NormalizedSnapshot }>>();
  async function getHealth(_req: Request, res: Response): Promise<void> {
    res.json({ ok: true, hasKey: Boolean(env.youtubeApiKey), version: '0.2.0', time: new Date().toISOString() });
  }

  async function getPlaylist(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const raw = validatePlaylistQuery(req.query);
      const refresh = isRefreshRequested(req.query);
      if (!refresh) {
        const cached = cache.get(`raw:${raw}`);
        if (cached) {
          recordCacheHit();
          res.json({ snapshot: cached, cached: true });
          return;
        }
      }
      recordCacheMiss();
      let p = inflight.get(`raw:${raw}`);
      if (p) {
        recordDedupHit();
      } else {
        p = fetchPlaylistSnapshot(raw, env.youtubeApiKey);
        inflight.set(`raw:${raw}`, p);
      }
      try {
        const { snapshot } = await p;
        // Success only: transient errors never poison the cache, and a valid
        // playlist never becomes unusable because of one failed fetch.
        cache.set(`raw:${raw}`, snapshot);
        cache.set(`id:${snapshot.playlistId}`, snapshot);
        recordImport(refresh);
        res.json({ snapshot, cached: false });
      } finally {
        if (inflight.get(`raw:${raw}`) === p) inflight.delete(`raw:${raw}`);
      }
    } catch (e) {
      next(e);
    }
  }

  return { getHealth, getPlaylist };
}
