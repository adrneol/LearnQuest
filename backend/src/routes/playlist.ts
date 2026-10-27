import { Router } from 'express';
import { createPlaylistController } from '../controllers/playlistController.js';
import { getApiStats } from '../diagnostics/apiStats.js';
import type { MemoryCache } from '../cache/memoryCache.js';
import type { MongoReadinessSource } from '../db/mongoSupervisor.js';

export function createApiRouter(cache: MemoryCache, readiness?: MongoReadinessSource) {
  const router = Router();
  const { getHealth, getReadiness, getPlaylist } = createPlaylistController(cache, readiness);
  router.get('/health', getHealth);
  router.get('/ready', getReadiness);
  router.get('/playlist', getPlaylist);
  router.get('/cache', (_req, res) => {
    // Ops visibility only: counts + approx bytes, never playlist contents,
    // keys, URLs, or user data.
    res.json({ ok: true, ...cache.stats(), api: getApiStats() });
  });
  return router;
}
