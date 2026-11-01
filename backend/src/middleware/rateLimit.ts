import rateLimit, { type AugmentedRequest } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { env } from '../config/env.js';

function sendRateLimited(
  req: Request,
  res: Response,
  input: { error: string; code: string },
): void {
  const resetTime = (req as AugmentedRequest).rateLimit?.resetTime;
  const seconds = resetTime instanceof Date
    ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1_000))
    : 60;
  res.setHeader('Retry-After', String(seconds));
  res.status(429).json({
    error: input.error,
    code: input.code,
    retryAfterSec: seconds,
  });
}

/**
 * Per-client-IP limit. Express resolves `req.ip` through the configured number
 * of trusted proxy hops (see app.ts / TRUST_PROXY_HOPS), so Render's proxy is
 * handled while a client-supplied X-Forwarded-For cannot mint fresh buckets.
 *
 * A limiter is created per app rather than as a module singleton: its max is
 * read from the environment at composition time, and separate app instances
 * (notably tests) never share a bucket store.
 *
 * The long-lived authentication SSE stream is excluded. It has its own
 * authenticated per-account/per-process connection caps, and counting an
 * `EventSource` connection (plus a reconnect after a proxy restart) against the
 * general JSON request budget would make unrelated account requests fail with
 * a misleading 429.
 */
export function createApiLimiter() {
  return rateLimit({
    windowMs: 60_000,
    max: env.rateLimitPerMin,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req: Request) => req.method === 'GET' && req.path === '/auth/events',
    handler: (req, res) => {
      sendRateLimited(req, res, {
        error: 'Too many requests. Wait and try again.',
        code: 'RATE_LIMITED',
      });
    },
  });
}

/**
 * The SSE stream is outside the JSON request budget, but it must not become an
 * unbounded authentication/DB probe. This separate connection-attempt limit is
 * deliberately generous: a normal tab opens one stream, and the client's capped
 * backoff means a flapping proxy reaches at most roughly one attempt per minute.
 */
export function createAuthStreamConnectLimiter() {
  return rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: false,
    legacyHeaders: false,
    handler: (req, res) => {
      sendRateLimited(req, res, {
        error: 'Too many authentication stream connection attempts. Wait and try again.',
        code: 'STREAM_CONNECT_LIMIT',
      });
    },
  });
}
