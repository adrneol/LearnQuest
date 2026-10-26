import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { createApiRouter } from './routes/playlist.js';
import { createApiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { createMemoryCache } from './cache/memoryCache.js';

export function createApp() {
  const cache = createMemoryCache(() => env.cacheTtlSec, { maxEntries: () => env.cacheMaxEntries });
  const app = express();

  // Only the documented number of reverse-proxy hops may set the client IP.
  // Defaults to 1 (Render/most PaaS); set TRUST_PROXY_HOPS=0 for direct.
  const hops = env.trustProxyHops;
  if (hops > 0) app.set('trust proxy', hops);

  app.disable('x-powered-by');
  app.use(helmet({
    // JSON-only API: deny embedding/rendering and legacy plugin content.
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cors({ origin: env.corsOrigin, credentials: false, maxAge: 600 }));
  app.use('/api', createApiLimiter());
  app.use('/api', createApiRouter(cache));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
