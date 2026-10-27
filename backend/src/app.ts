import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { env } from './config/env.js';
import { createApiRouter } from './routes/playlist.js';
import { createAuthRouter } from './routes/auth.js';
import { createAccountRouter } from './routes/account.js';
import { createPlaylistManagementRouter } from './routes/playlists.js';
import { createApiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { createMemoryCache } from './cache/memoryCache.js';
import { createDataStore, type DataStore } from './store.js';
import { getMongoAdapter } from './db/mongo.js';
import { createBrevoEmailService, type EmailService } from './email/brevo.js';
import { createGoogleOAuthService, type GoogleOAuthService } from './auth/google.js';
import { requireTrustedOrigin } from './auth/middleware.js';

export interface AppDependencies {
  store?: DataStore;
  email?: EmailService;
  google?: GoogleOAuthService;
}

export function createApp(deps: AppDependencies = {}) {
  const cache = createMemoryCache(() => env.cacheTtlSec, { maxEntries: () => env.cacheMaxEntries });
  const store = deps.store ?? createDataStore(getMongoAdapter());
  const email = deps.email ?? createBrevoEmailService();
  const google = deps.google ?? createGoogleOAuthService(store);
  const app = express();

  // Only the documented number of reverse-proxy hops may set the client IP.
  // Defaults to 1 (Render/most PaaS); set TRUST_PROXY_HOPS=0 for direct.
  const hops = env.trustProxyHops;
  if (hops > 0) app.set('trust proxy', hops);

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const id = randomUUID();
    res.setHeader('X-Request-Id', id);
    next();
  });
  app.use(helmet({
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
  // Largest accepted body is the account import envelope; every collection is
  // independently capped again by the repository validators.
  app.use(express.json({ limit: Math.min(env.accountMaxStateBytes + 256 * 1024, 16 * 1024 * 1024) }));
  app.use(cors({
    origin: env.corsOrigin,
    credentials: true,
    maxAge: 600,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'X-CSRF-Token'],
    exposedHeaders: ['X-Request-Id'],
  }));
  app.use(requireTrustedOrigin);
  app.use('/api', createApiLimiter());
  app.use('/api/auth', createAuthRouter({ store, email, google }));
  app.use('/api/account', createAccountRouter({ store, email }));
  app.use('/api/playlists', createPlaylistManagementRouter(store));
  app.use('/api', createApiRouter(cache));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
