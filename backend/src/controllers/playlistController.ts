import type { Request, Response, NextFunction } from 'express';
import { env, configStatus, VERSION } from '../config/env.js';
import { validatePlaylistQuery, isRefreshRequested } from '../schemas/playlistSchemas.js';
import { fetchPlaylistSnapshot } from '../services/youtube/youtubeService.js';
import { recordCacheHit, recordCacheMiss, recordDedupHit, recordImport } from '../diagnostics/apiStats.js';
import type { MemoryCache } from '../cache/memoryCache.js';
import type { MongoReadinessSnapshot, MongoReadinessSource } from '../db/mongoSupervisor.js';

/**
 * When a caller supplies an in-memory test store there is no managed database.
 * Report that explicitly instead of claiming that MongoDB is ready.
 */
function readinessSnapshot(readiness?: MongoReadinessSource): MongoReadinessSnapshot {
  return readiness?.snapshot() ?? {
    managed: false,
    configured: env.mongodbConfigured,
    ready: false,
    state: 'unmanaged',
    consecutiveFailures: 0,
    lastFailure: null,
    nextRetryInMs: null,
    readyAt: null,
  };
}

export function createPlaylistController(cache: MemoryCache, readiness?: MongoReadinessSource) {
  // Dedupe equivalent in-flight fetches: concurrent refreshes for the same
  // playlist share one upstream request instead of hammering YouTube quota.
  const inflight = new Map<string, Promise<{ snapshot: import('../types/index.js').NormalizedSnapshot }>>();
  async function getHealth(_req: Request, res: Response): Promise<void> {
    const config = configStatus();
    const database = readinessSnapshot(readiness);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      // `ok` and `liveness` describe the HTTP process. Database readiness is
      // reported separately and never implied by a successful health check.
      ok: true,
      liveness: true,
      ready: database.ready,
      database,
      readinessPath: '/api/ready',
      hasKey: Boolean(env.youtubeApiKey),
      version: VERSION,
      time: new Date().toISOString(),
      setupRequired: config.setupRequired,
      authEnabled: config.authEnabled,
      configured: config.configured,
      missing: config.missing,
    });
  }

  async function getReadiness(_req: Request, res: Response): Promise<void> {
    const database = readinessSnapshot(readiness);
    if (!database.ready) {
      const retryAfterSec = database.nextRetryInMs === null
        ? 5
        : Math.max(1, Math.ceil(database.nextRetryInMs / 1_000));
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(503).json({
        ok: false,
        ready: false,
        database,
        retryAfterSec,
        version: VERSION,
        time: new Date().toISOString(),
      });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      ready: true,
      database,
      version: VERSION,
      time: new Date().toISOString(),
    });
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

  return { getHealth, getReadiness, getPlaylist };
}
