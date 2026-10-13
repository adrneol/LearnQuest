import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { validatePlaylistQuery } from '../schemas/playlistSchemas.js';
import { fetchPlaylistSnapshot } from '../services/youtube/youtubeService.js';
import type { MemoryCache } from '../cache/memoryCache.js';

export function createPlaylistController(cache: MemoryCache) {
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
      const { snapshot } = await fetchPlaylistSnapshot(raw, env.youtubeApiKey);
      cache.set(`raw:${raw}`, snapshot);
      cache.set(`id:${snapshot.playlistId}`, snapshot);
      res.json({ snapshot, cached: false });
    } catch (e) {
      next(e);
    }
  }

  return { getHealth, getPlaylist };
}
