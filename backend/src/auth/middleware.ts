import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { createHash } from 'node:crypto';
import type { DataStore } from '../store.js';
import type { Account } from '../auth/accounts.js';
import {
  findSessionByToken,
  isRecentAuth,
  touchSession,
  verifyCsrf,
  type SessionRecord,
} from '../auth/sessions.js';
import { cookieHeader, parseCookies } from '../auth/crypto.js';
import { env } from '../config/env.js';
import { httpError } from '../services/userData.js';

export interface AuthContext {
  account: Account;
  session: SessionRecord;
  userId: string;
}

export interface AuthedRequest extends Request {
  auth?: AuthContext;
}

export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
}

export function setSessionCookie(res: Response, token: string, maxAgeSec: number): void {
  res.setHeader('Set-Cookie', cookieHeader(token, maxAgeSec));
}

export function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', cookieHeader(null, 0));
}

export function readSessionToken(req: Request): string | null {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[env.sessionCookieName] ?? null;
}

export function requireAuth(store: DataStore): RequestHandler {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const token = readSessionToken(req);
      if (!token) throw httpError('Sign in to continue.', 401, 'UNAUTHENTICATED');
      const session = await findSessionByToken(store, token);
      if (!session) {
        clearSessionCookie(res);
        throw httpError('Your session expired. Sign in again.', 401, 'SESSION_EXPIRED');
      }
      const account = await store.accounts.findOne({ userId: session.userId }) as Account | null;
      if (!account || account.status !== 'active') {
        clearSessionCookie(res);
        throw httpError('This account is unavailable. Sign in again.', 401, 'ACCOUNT_UNAVAILABLE');
      }
      const touched = await touchSession(store, session);
      req.auth = { account, session: touched, userId: account.userId };
      next();
    } catch (e) {
      next(e);
    }
  };
}

export function requireCsrf(req: AuthedRequest, _res: Response, next: NextFunction): void {
  try {
    if (!req.auth) throw httpError('Sign in to continue.', 401, 'UNAUTHENTICATED');
    const header = req.get('x-csrf-token');
    if (!verifyCsrf(req.auth.session, header)) {
      throw httpError('Security token missing or expired. Refresh the page and try again.', 403, 'CSRF_FAILED');
    }
    next();
  } catch (e) {
    next(e);
  }
}

export function requireRecentAuth(req: AuthedRequest, _res: Response, next: NextFunction): void {
  try {
    if (!req.auth) throw httpError('Sign in to continue.', 401, 'UNAUTHENTICATED');
    if (!isRecentAuth(req.auth.session)) {
      throw httpError('Please confirm your password or sign in again before this security-sensitive change.', 403, 'REAUTH_REQUIRED');
    }
    next();
  } catch (e) {
    next(e);
  }
}

/** Reject browser requests from an origin outside the exact allow-list. */
export function requireTrustedOrigin(req: Request, _res: Response, next: NextFunction): void {
  const origin = req.get('origin');
  if (origin) {
    try {
      const normalized = new URL(origin).origin;
      if (!env.corsOrigin.includes(normalized)) {
        next(httpError('Request origin is not allowed.', 403, 'ORIGIN_NOT_ALLOWED'));
        return;
      }
    } catch {
      next(httpError('Request origin is invalid.', 403, 'ORIGIN_NOT_ALLOWED'));
      return;
    }
  }
  next();
}

export function clientInfo(req: Request): { userAgent: string; ipHash: string } {
  // Hash the IP so rate/audit records never store a raw address.
  const ip = req.ip ?? '';
  return {
    userAgent: (req.get('user-agent') ?? '').slice(0, 300),
    ipHash: ip ? createHash('sha256').update(ip).digest('hex').slice(0, 24) : '',
  };
}
