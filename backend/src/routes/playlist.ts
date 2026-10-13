import { Router } from 'express';
import { createPlaylistController } from '../controllers/playlistController.js';
import type { MemoryCache } from '../cache/memoryCache.js';

export function createApiRouter(cache: MemoryCache) {
  const router = Router();
  const { getHealth, getPlaylist } = createPlaylistController(cache);
  router.get('/health', getHealth);
  router.get('/playlist', getPlaylist);
  router.get('/cache', (_req, res) => {
    // Ops visibility only: counts + approx bytes, never playlist contents or keys.
    res.json({ ok: true, ...cache.stats() });
  });
  return router;
}
