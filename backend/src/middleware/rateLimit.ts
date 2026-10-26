import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

/**
 * Per-client-IP limit. Express resolves `req.ip` through the configured number
 * of trusted proxy hops (see app.ts / TRUST_PROXY_HOPS), so Render's proxy is
 * handled while a client-supplied X-Forwarded-For cannot mint fresh buckets.
 *
 * A limiter is created per app rather than as a module singleton: its max is
 * read from the environment at composition time, and separate app instances
 * (notably tests) never share a bucket store.
 */
export function createApiLimiter() {
  return rateLimit({
    windowMs: 60_000,
    max: env.rateLimitPerMin,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests. Wait a minute and try again, or use a JSON backup import.' },
    handler: (_req, res) => {
      res.status(429).json({ error: 'Too many requests. Wait a minute and try again, or use a JSON backup import.' });
    },
  });
}
