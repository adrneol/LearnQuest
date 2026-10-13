import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { validatePlaylistQuery } from '../schemas/playlistSchemas.js';
import { fetchPlaylistSnapshot } from '../services/youtube/youtubeService.js';
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
      const cached = cache.get(`raw:${raw}`);
      if (cached) {
        res.json({ snapshot: cached, cached: true });
        return;
      }
      let p = inflight.get(`raw:${raw}`);
      if (!p) {
        p = fetchPlaylistSnapshot(raw, env.youtubeApiKey);
        inflight.set(`raw:${raw}`, p);
      }
      try {
        const { snapshot } = await p;
        cache.set(`raw:${raw}`, snapshot);
        cache.set(`id:${snapshot.playlistId}`, snapshot);
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
