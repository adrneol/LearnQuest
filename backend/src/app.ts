import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { createApiRouter } from './routes/playlist.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { createMemoryCache } from './cache/memoryCache.js';

export function createApp() {
  const cache = createMemoryCache(() => env.cacheTtlSec);
  const app = express();
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(cors({ origin: env.corsOrigin, credentials: false }));
  app.use('/api', apiLimiter);
  app.use('/api', createApiRouter(cache));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
