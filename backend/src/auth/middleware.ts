import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { createHash } from 'node:crypto';
import type { DataStore } from '../store.js';
import type { Account } from '../auth/accounts.js';
import {
  findSessionByToken,
  isRecentAuth,
  revokeSession,
  touchSession,
  verifyCsrf,
  type SessionRecord,
} from '../auth/sessions.js';
import { cookieHeader, oauthCookieHeader, parseCookies } from '../auth/crypto.js';
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

export const OAUTH_BINDING_MAX_AGE_SEC = 10 * 60;

export function setSessionCookie(res: Response, token: string, maxAgeSec: number): void {
  // append, not setHeader: an OAuth callback may also clear its flow cookie.
  res.append('Set-Cookie', cookieHeader(token, maxAgeSec));
}

export function clearSessionCookie(res: Response): void {
  res.append('Set-Cookie', cookieHeader(null, 0));
}

export function readSessionToken(req: Request): string | null {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[env.sessionCookieName] ?? null;
}

export function setOAuthBindingCookie(res: Response, binding: string): void {
  res.append('Set-Cookie', oauthCookieHeader(binding, OAUTH_BINDING_MAX_AGE_SEC));
}

export function clearOAuthBindingCookie(res: Response): void {
  res.append('Set-Cookie', oauthCookieHeader(null, 0));
}

export function readOAuthBindingCookie(req: Request): string | null {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[env.oauthCookieName] ?? null;
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
      // A short-lived Google registration session expires on its own schedule.
      // Enforcing it here (not only in /session and /onboarding) means every
      // authenticated surface agrees: an expired onboarding session is dead
      // everywhere, including the SSE stream. The error contract matches the
      // onboarding route's existing response so embedded/legacy clients see
      // one consistent code.
      if (session.authMethod === 'google_register') {
        const exp = session.onboardingExpiresAt ? Date.parse(session.onboardingExpiresAt) : 0;
        if (!Number.isFinite(exp) || exp <= Date.now()) {
          await revokeSession(store, token);
          clearSessionCookie(res);
          throw httpError('The account-setup session has expired. Sign in again to continue.', 403, 'ONBOARDING_SESSION_INVALID');
        }
      }
      const account = await store.accounts.findOne({ userId: session.userId }) as Account | null;
      if (!account || account.status !== 'active') {
        clearSessionCookie(res);
        throw httpError('This account is unavailable. Sign in again.', 401, 'ACCOUNT_UNAVAILABLE');
      }
      // Password changes/resets advance the account's password version. This
      // closes the verify-then-create race: a login that verified the old hash
      // just before a reset cannot remain valid after the version advances.
      if (
        session.passwordVersion !== undefined
        && session.passwordVersion !== null
        && Number(session.passwordVersion) !== Number(account.passwordVersion ?? 0)
      ) {
        await revokeSession(store, token);
        clearSessionCookie(res);
        throw httpError('This session was signed out after a password change. Sign in again.', 401, 'SESSION_REVOKED');
      }
      const touched = await touchSession(store, session);
      if (!touched) {
        clearSessionCookie(res);
        throw httpError('Your session expired or was signed out. Sign in again.', 401, 'SESSION_REVOKED');
      }
      req.auth = { account, session: touched, userId: account.userId };
      // Sliding cookie renewal: keep the browser cookie aligned with the
      // server-side sliding idle window (capped by the absolute expiry), so an
      // active user is never left with a stale 30-day cookie that dies while
      // the session is still valid. Inactive users still lose the cookie.
      // Renewal is limited to safe read methods: mutation responses may also
      // rotate or clear cookies, and browsers apply only one value per
      // Set-Cookie header slot — mixing both would make the outcome ambiguous.
      if (req.method === 'GET') {
        const absoluteRemainingSec = Math.floor((Date.parse(touched.expiresAt) - Date.now()) / 1000);
        const maxAgeSec = Math.max(0, Math.min(env.sessionIdleHours * 3600, absoluteRemainingSec));
        if (maxAgeSec > 0) setSessionCookie(res, token, maxAgeSec);
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

/**
 * Authenticated but not yet onboarded is not a valid learning account. It must
 * finish the explicit Google registration flow, never receive an empty account
 * state that a client could then write back as if it were real data.
 */
export function requireOnboarded(req: AuthedRequest, _res: Response, next: NextFunction): void {
  try {
    if (!req.auth) throw httpError('Sign in to continue.', 401, 'UNAUTHENTICATED');
    if (!req.auth.account.onboardingComplete || !req.auth.account.username) {
      throw httpError(
        'Finish your LearnQuest account setup before using account data.',
        409,
        'ONBOARDING_REQUIRED',
      );
    }
    next();
  } catch (e) {
    next(e);
  }
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
