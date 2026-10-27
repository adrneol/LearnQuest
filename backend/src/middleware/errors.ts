import type { Request, Response, NextFunction } from 'express';
import {
  classifyMongoError,
  describeMongoFailure,
  isMongoAvailabilityFailure,
  isRetryableMongoFailure,
} from '../db/mongoErrors.js';

export interface ErrorHandlerOptions {
  /** Notify the connection supervisor that a request observed a database failure. */
  onMongoFailure?: (error: unknown) => void;
}

/**
 * User-facing errors only — never leak stacks, bodies, or secrets.
 *
 * MongoDB driver errors are converted to a retryable 503 with a sanitized log
 * line. The raw driver message can contain cluster hostnames, IP addresses, or
 * connection-string fragments, so it is never logged here.
 */
export function createErrorHandler(options: ErrorHandlerOptions = {}) {
  return function errorHandler(e: unknown, req: Request, res: Response, _next: NextFunction): void {
    const error = e as { status?: unknown; code?: unknown; message?: unknown } | null | undefined;
    if (isMongoAvailabilityFailure(e)) {
      const classification = classifyMongoError(e);
      const retryable = isRetryableMongoFailure(classification);
      options.onMongoFailure?.(e);
      const status = 503;
      console.error(JSON.stringify({
        level: 'error',
        requestId: res.getHeader('X-Request-Id') ?? null,
        method: req.method,
        path: req.path,
        status,
        code: 'DATABASE_UNAVAILABLE',
        mongo: describeMongoFailure(e),
        retryable,
      }));
      res.setHeader('Cache-Control', 'no-store');
      if (retryable) res.setHeader('Retry-After', '5');
      res.status(status).json({
        error: 'The database is unavailable. The request was not applied; retry when the service is ready.',
        code: 'DATABASE_UNAVAILABLE',
        retryable,
      });
      return;
    }

    const status = typeof error?.status === 'number' && error.status >= 400 && error.status <= 599 ? error.status : 500;
    const code = typeof error?.code === 'string' ? error.code : undefined;
    if (status >= 500) {
      // Safe structured log: request id, method, route, status — never bodies,
      // cookies, credentials, email action tokens, or connection strings.
      console.error(JSON.stringify({
        level: 'error',
        requestId: res.getHeader('X-Request-Id') ?? null,
        method: req.method,
        path: req.path,
        status,
        code: code ?? null,
        message: error?.message ?? 'internal error',
      }));
    }
    res.status(status).json({
      error: status === 500 ? 'Internal server error. The operation was not reported as successful; retry if appropriate.' : (error?.message ?? 'Request failed.'),
      ...(code ? { code } : {}),
    });
  };
}

/** Backwards-compatible handler for callers that do not need supervisor hooks. */
export const errorHandler = createErrorHandler();

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found.' });
}
