import type { RequestHandler } from 'express';
import type { MongoReadinessSource } from '../db/mongoSupervisor.js';

/**
 * Fail closed for account and learning-data routes while MongoDB readiness is
 * false. This intentionally runs before authentication: an unavailable
 * database must not be presented as a signed-out or empty account.
 */
export function requireMongoReady(readiness: MongoReadinessSource): RequestHandler {
  return (_req, res, next) => {
    const snapshot = readiness.snapshot();
    if (snapshot.configured && snapshot.ready) {
      next();
      return;
    }
    const retryAfterSec = snapshot.nextRetryInMs === null
      ? 5
      : Math.max(1, Math.ceil(snapshot.nextRetryInMs / 1_000));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', String(retryAfterSec));
    res.status(503).json({
      error: snapshot.configured
        ? 'The database is currently unavailable. The request was not applied; retry when the service is ready.'
        : 'Account services are not configured yet. Ask the administrator to complete backend setup.',
      code: snapshot.configured ? 'DATABASE_UNAVAILABLE' : 'SETUP_REQUIRED',
      retryable: snapshot.configured,
      retryAfterSec,
    });
  };
}
