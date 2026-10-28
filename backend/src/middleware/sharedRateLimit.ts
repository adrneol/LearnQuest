import { createHash } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import type { DataStore } from '../store.js';

export interface SharedRateLimitOptions {
  /** Logical bucket, e.g. `auth-login` or `email-action`. */
  scope: string;
  windowMs: number;
  max: number;
  /** Optional key authority (for example a hashed account id). Defaults to req.ip. */
  key?: (req: Request) => string;
  /** Injectable clock for deterministic window-boundary tests. */
  now?: () => number;
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Atomic, cross-instance limiter for security-sensitive endpoints.
 *
 * A single `findOneAndUpdate` upsert increments a per-window counter keyed by a
 * hash of the scope, client identity, and fixed window. MongoDB's unique `_id`
 * makes the increment atomic across Render instances; the document carries a
 * Date `expireAt` for TTL cleanup. Raw IPs, emails, and usernames are never
 * stored. If the shared store is unavailable, security-sensitive requests fail
 * closed rather than silently falling back to per-instance counters.
 */
export function createSharedRateLimiter(
  store: DataStore,
  options: SharedRateLimitOptions,
): RequestHandler {
  const nowFn = options.now ?? Date.now;
  return async (req, res, next) => {
    const now = nowFn();
    const windowStart = Math.floor(now / options.windowMs) * options.windowMs;
    const identity = options.key ? options.key(req) : (req.ip || 'unknown');
    const id = digest(`${options.scope}:${identity}:${windowStart}`);
    const resetAt = windowStart + options.windowMs;
    try {
      const doc = await store.rateLimits.findOneAndUpdate(
        { _id: id },
        {
          $inc: { count: 1 },
          $setOnInsert: {
            scope: options.scope,
            windowStart: new Date(windowStart).toISOString(),
            expireAt: new Date(resetAt + 60_000),
          },
        },
        { upsert: true },
      );
      const count = Number(doc?.count ?? 1);
      const remaining = Math.max(0, options.max - count);
      res.setHeader('RateLimit-Limit', String(options.max));
      res.setHeader('RateLimit-Remaining', String(remaining));
      res.setHeader('RateLimit-Reset', String(Math.max(0, Math.ceil((resetAt - now) / 1000))));
      if (count > options.max) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil((resetAt - now) / 1000))));
        res.status(429).json({
          error: 'Too many security-sensitive requests. Wait and try again.',
          code: 'RATE_LIMITED',
          retryable: true,
        });
        return;
      }
      next();
    } catch (error: unknown) {
      // Never fail open for login, OAuth, reset, or email-action endpoints.
      console.error(JSON.stringify({
        level: 'error',
        event: 'shared_rate_limit_unavailable',
        scope: options.scope,
        code: (error as { code?: unknown })?.code ?? null,
      }));
      res.setHeader('Retry-After', '5');
      res.status(503).json({
        error: 'Security rate limiting is temporarily unavailable. The request was not applied; retry shortly.',
        code: 'RATE_LIMIT_UNAVAILABLE',
        retryable: true,
      });
    }
  };
}
