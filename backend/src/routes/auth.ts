import { Router } from 'express';
import { z } from 'zod';
import { createSharedRateLimiter } from '../middleware/sharedRateLimit.js';
import { createAuthStreamConnectLimiter } from '../middleware/rateLimit.js';
import type { DataStore } from '../store.js';
import { env, configStatus } from '../config/env.js';
import type { EmailService } from '../email/brevo.js';
import type { GoogleOAuthService, GoogleAuthIntent } from '../auth/google.js';
import {
  boundedInt, completeOnboarding, createAccountFromGoogle, findAccountByGoogleSub,
  findAccountById, findAccountByIdentifier, isPasswordResetEligible, safeAccount,
  setAccountEmail, setAccountPassword, updateAccountPreferences, validatePassword, validateTimezone,
  http, type Account, type SafeAccount,
} from '../auth/accounts.js';
import {
  burnPasswordCheck, hashCode, normalizeEmail, randomToken, verifyCode,
} from '../auth/crypto.js';
import {
  findSessionByToken, isGoogleOnboardingSession, isRecentAuth, markReauthenticated,
  revokeAllSessions, revokeSession, rotateSession,
} from '../auth/sessions.js';
import {
  consumeEmailActionToken, inspectEmailActionToken, invalidateAllEmailActions, invalidateEmailAction,
  issueEmailActionToken, latestEmailAction,
} from '../auth/actionTokens.js';
import {
  clearOAuthBindingCookie, clearSessionCookie, clientInfo, noStore, readOAuthBindingCookie,
  readSessionToken, requireAuth, requireCsrf, requireRecentAuth, setOAuthBindingCookie,
  setSessionCookie, type AuthedRequest,
} from '../auth/middleware.js';
import { withAccountWriteLease } from '../auth/writeLease.js';
import type { AuthEventBus, AuthInvalidationReason } from '../auth/eventBus.js';

const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(128),
}).strict();
const onboardingSchema = z.object({
  username: z.string().max(64),
  displayName: z.string().max(120),
  password: z.string().max(128),
  timezone: z.string().max(100).optional(),
  sessionLenMin: z.number().optional(),
  breakMin: z.number().optional(),
  minViableMin: z.number().optional(),
}).strict();
const forgotSchema = z.object({ identifier: z.string().trim().min(1).max(320) }).strict();
const resetTokenSchema = z.object({ token: z.string().min(20).max(512) }).strict();
const resetSchema = z.object({
  token: z.string().min(20).max(512),
  newPassword: z.string().max(128),
}).strict();
const passwordChangeSchema = z.object({
  currentPassword: z.string().max(128).optional(),
  newPassword: z.string().max(128),
}).strict();
const reauthSchema = z.object({ password: z.string().max(128).optional() }).strict();

const GOOGLE_ONBOARDING_MINUTES = 30;

/**
 * SSE connection limits. They are deliberately process-local safety caps, not
 * an authentication policy: the cookie-authenticated session remains the only
 * subscription authority. A per-account cap also prevents one account from
 * exhausting all streams on an instance.
 */
const MAX_AUTH_STREAMS_PER_ACCOUNT = 20;
const MAX_AUTH_STREAMS_TOTAL = 1_000;
const AUTH_STREAM_HEARTBEAT_MS = 25_000;

/**
 * Notification failure must never turn a completed server-side revocation into
 * a client-visible failure. Session revocation is authoritative; the SSE event
 * is best-effort delivery. The log intentionally contains neither an account
 * identifier nor any credential.
 */
async function publishAuthInvalidation(
  authEvents: AuthEventBus,
  input: { userId: string; sessionId?: string | null; reason: AuthInvalidationReason },
): Promise<void> {
  try {
    await authEvents.publish(input);
  } catch {
    console.error(JSON.stringify({
      level: 'error',
      event: 'auth_invalidation_publish_failed',
      reason: input.reason,
    }));
  }
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw http(400, 'The request body is invalid.', 'INVALID_REQUEST');
  return result.data;
}

async function requireSetup(store: DataStore): Promise<void> {
  if (!env.sessionConfigured || !env.mongodbConfigured || !env.emailActionConfigured) {
    throw http(503, 'Account services are not configured yet. Ask the administrator to complete backend setup.', 'SETUP_REQUIRED');
  }
  void store;
}

async function safeNotice(email: EmailService, input: { to: string; subject: string; message: string }): Promise<void> {
  try {
    if (email.configured) await email.sendSecurityNotice(input);
  } catch {
    // Delivery failure must not turn a completed password change into an error.
  }
}

function onboardingExpiry(): string {
  return new Date(Date.now() + GOOGLE_ONBOARDING_MINUTES * 60_000).toISOString();
}

function requireCompletedAccount(account: Account): void {
  if (!account.onboardingComplete || !account.username) {
    throw http(409, 'Finish your LearnQuest account setup before using this action.', 'ONBOARDING_REQUIRED');
  }
}

/** The token must still belong to the account and email it was issued for. */
function resetBelongsToAccount(
  account: Account | null,
  record: { emailNormalized: string; accountEmailNormalized: string },
): account is Account {
  return Boolean(
    isPasswordResetEligible(account)
    && account.emailNormalized === record.emailNormalized
    && account.emailNormalized === record.accountEmailNormalized,
  );
}

/**
 * Retire legacy recovery grants that are no longer part of the current token
 * flow. They are only marked consumed; no document is deleted outside the
 * account-deletion cascade. The update is intentionally owner-scoped.
 */
async function invalidateLegacyRecoveryArtifacts(store: DataStore, userId: string): Promise<void> {
  const now = new Date().toISOString();
  for (const name of ['lq_reset_grants', 'lq_challenges'] as const) {
    const collection = store.adapter.collection(name);
    const rows = await collection.find({ userId, consumedAt: null });
    for (const row of rows) {
      await collection.updateOne({ _id: row._id, consumedAt: null }, { $set: { consumedAt: now } });
    }
  }
}

export interface AuthRouterDeps {
  store: DataStore;
  email: EmailService;
  google: GoogleOAuthService;
  authEvents: AuthEventBus;
}

export function createAuthRouter({ store, email, google, authEvents }: AuthRouterDeps): Router {
  const router = Router();
  const auth = requireAuth(store);
  const csrf = requireCsrf;
  const streamCounts = new Map<string, number>();
  let streamTotal = 0;
  const streamConnectLimiter = createAuthStreamConnectLimiter();
  // Shared across backend instances. A single Render instance is not assumed;
  // if the shared store is unavailable these security endpoints fail closed.
  const loginLimiter = createSharedRateLimiter(store, {
    scope: 'auth-password-login',
    windowMs: 15 * 60_000,
    max: env.authRateLimitPerMin,
  });
  const oauthLimiter = createSharedRateLimiter(store, {
    scope: 'auth-oauth',
    windowMs: 15 * 60_000,
    max: env.authRateLimitPerMin,
  });
  const emailActionLimiter = createSharedRateLimiter(store, {
    scope: 'email-action',
    windowMs: 15 * 60_000,
    max: env.emailActionRateLimitPer15Min,
  });

  router.get('/config', noStore, (_req, res) => {
    res.json(configStatus());
  });

  router.get('/session', noStore, async (req, res, next) => {
    try {
      const config = configStatus();
      const token = readSessionToken(req);
      if (!token || !env.sessionConfigured || !env.mongodbConfigured) {
        if (token) clearSessionCookie(res);
        res.json({ authenticated: false, ...config });
        return;
      }
      const session = await findSessionByToken(store, token);
      if (!session) {
        clearSessionCookie(res);
        res.json({ authenticated: false, ...config });
        return;
      }
      const account = await findAccountById(store, session.userId);
      if (!account || account.status !== 'active') {
        clearSessionCookie(res);
        res.json({ authenticated: false, ...config });
        return;
      }
      // The session-status endpoint must apply the same revocation rules as
      // protected routes. Otherwise a session whose password version is stale,
      // or an expired pending-registration session, could still render an
      // authenticated account shell until the next account request failed.
      const passwordVersionStale = session.passwordVersion !== undefined
        && session.passwordVersion !== null
        && Number(session.passwordVersion) !== Number(account.passwordVersion ?? 0);
      const onboardingExpired = !account.onboardingComplete
        && !isGoogleOnboardingSession(session, account.googleSub);
      if (passwordVersionStale || onboardingExpired) {
        await revokeSession(store, token);
        clearSessionCookie(res);
        res.json({ authenticated: false, ...config });
        return;
      }
      res.json({
        authenticated: true,
        user: safeAccount(account),
        csrfToken: session.csrfToken,
        onboardingRequired: !account.onboardingComplete,
        ...config,
      });
    } catch (e) {
      next(e);
    }
  });

  /**
   * Authenticated cross-profile/device invalidation stream.
   *
   * The account and session are derived only from the HttpOnly session cookie
   * by the existing `requireAuth` middleware. There is no account parameter,
   * token query string, or user-supplied identifier. The stream carries no
   * account data: only `auth-invalidated` with an allow-listed reason.
   */
  router.get('/events', streamConnectLimiter, auth, noStore, async (req: AuthedRequest, res, next) => {
    const userId = req.auth!.userId;
    const session = req.auth!.session;
    const token = readSessionToken(req);
    const activeForAccount = streamCounts.get(userId) ?? 0;
    if (streamTotal >= MAX_AUTH_STREAMS_TOTAL || activeForAccount >= MAX_AUTH_STREAMS_PER_ACCOUNT) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({
        error: 'Too many active authentication streams. Close some LearnQuest tabs and retry.',
        code: 'STREAM_LIMIT',
        retryable: true,
        retryAfterSec: 60,
      });
      return;
    }

    streamCounts.set(userId, activeForAccount + 1);
    streamTotal += 1;
    let released = false;
    let unsubscribe: (() => void) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let expiry: ReturnType<typeof setTimeout> | null = null;

    const release = () => {
      if (released) return;
      released = true;
      if (heartbeat) clearInterval(heartbeat);
      if (expiry) clearTimeout(expiry);
      heartbeat = null;
      expiry = null;
      unsubscribe?.();
      unsubscribe = null;
      const remaining = (streamCounts.get(userId) ?? 1) - 1;
      if (remaining > 0) streamCounts.set(userId, remaining);
      else streamCounts.delete(userId);
      streamTotal = Math.max(0, streamTotal - 1);
    };
    res.on('close', release);

    const sendInvalidation = (reason: AuthInvalidationReason) => {
      if (res.writableEnded) return;
      res.write(`event: auth-invalidated\ndata: ${JSON.stringify({ type: 'auth-invalidated', reason })}\n\n`);
      res.end();
    };

    try {
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
      res.setHeader('Connection', 'keep-alive');
      // Render and other reverse proxies may buffer a response unless told not
      // to. The headers are advisory; the heartbeat below also keeps idle
      // proxy connections from being treated as dead.
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      // Native EventSource reconnects three seconds after a transport failure
      // by default. A proxy restart or a sleeping free instance would turn that
      // into 20 requests per minute per tab. Tell the browser to wait instead;
      // the client also closes and applies capped backoff on error.
      res.write('retry: 30000\n\n');

      unsubscribe = await authEvents.subscribe({
        userId,
        sessionId: session.sessionId,
        listener: (event) => sendInvalidation(event.reason),
      });
      if (released || res.writableEnded) {
        unsubscribe();
        unsubscribe = null;
        return;
      }

      // Close the tiny race between the middleware's session check and the
      // subscription: a revocation that landed in between is caught here.
      const current = token ? await findSessionByToken(store, token) : null;
      if (!current || current.sessionId !== session.sessionId) {
        sendInvalidation('sessions-revoked');
        return;
      }

      // Sentinel after the listener is registered and the session re-check
      // passed. Tests and diagnostics can wait for it without guessing.
      res.write(': connected\n\n');

      heartbeat = setInterval(() => {
        if (!res.writableEnded) {
          // A named event, not only an SSE comment: the browser client cannot
          // observe comments, so a proxy that silently keeps a dead upstream
          // open would otherwise look healthy forever. The payload is empty
          // and carries no account or credential data.
          res.write('event: heartbeat\ndata: {}\n\n');
        }
      }, AUTH_STREAM_HEARTBEAT_MS);
      const unrefHeartbeat = (heartbeat as { unref?: () => void }).unref;
      if (typeof unrefHeartbeat === 'function') unrefHeartbeat.call(heartbeat);

      // Do not poll authentication. Re-check once when the session's existing
      // idle/absolute expiry is reached, then re-arm against the fresh record
      // if another request has legitimately extended the idle window.
      const armExpiry = (currentSession: typeof session) => {
        const expiresAt = Math.min(
          Date.parse(currentSession.idleExpiresAt),
          Date.parse(currentSession.expiresAt),
        );
        const delay = Number.isFinite(expiresAt) ? expiresAt - Date.now() : 0;
        expiry = setTimeout(async () => {
          expiry = null;
          if (released || res.writableEnded) return;
          try {
            const fresh = token ? await findSessionByToken(store, token) : null;
            if (!fresh) {
              res.end();
              return;
            }
            armExpiry(fresh);
          } catch {
            res.end();
          }
        }, Math.max(1_000, Math.min(delay + 1_000, 2_147_483_647)));
        const unrefExpiry = (expiry as { unref?: () => void }).unref;
        if (typeof unrefExpiry === 'function') unrefExpiry.call(expiry);
      };
      armExpiry(current);
    } catch (e) {
      release();
      if (!res.headersSent) next(e);
      else if (!res.writableEnded) res.end();
    }
  });

  router.get('/google/start', oauthLimiter, noStore, async (req, res, next) => {
    try {
      await requireSetup(store);
      const rawIntent = typeof req.query.intent === 'string' ? req.query.intent : 'login';
      if (rawIntent !== 'login' && rawIntent !== 'register' && rawIntent !== 'email_change') {
        throw http(400, 'Choose whether to sign in or create an account.', 'INVALID_OAUTH_INTENT');
      }
      const intent: GoogleAuthIntent = rawIntent;
      // If this browser already has a valid session, associate the short-lived
      // OAuth state with that account so account deletion can remove it. The
      // state still contains no profile or learning data.
      let ownerUserId: string | null = null;
      let ownerSession = null as Awaited<ReturnType<typeof findSessionByToken>>;
      try {
        const token = readSessionToken(req);
        const session = token ? await findSessionByToken(store, token) : null;
        if (session) {
          const owner = await findAccountById(store, session.userId);
          if (owner?.status === 'active') {
            ownerUserId = owner.userId;
            ownerSession = session;
          }
        }
      } catch {
        // An optional owner link must not make the public sign-in start fail.
      }
      if (intent === 'email_change') {
        if (!ownerUserId || !ownerSession) {
          throw http(401, 'Sign in before changing your email address.', 'AUTH_REQUIRED');
        }
        const account = await findAccountById(store, ownerUserId);
        if (!account || account.status !== 'active' || !account.onboardingComplete) {
          throw http(401, 'This account is not available for an email change.', 'ACCOUNT_UNAVAILABLE');
        }
        // A linked Google identity proves control by matching the stable
        // subject at callback time. Linking Google for the first time is only
        // allowed inside the server's recent-authentication window.
        if (!account.googleSub && !isRecentAuth(ownerSession)) {
          throw http(403, 'Sign in again with your password or Google before linking an identity to change your email.', 'RECENT_AUTH_REQUIRED');
        }
      }
      // Bind this authorization flow to this browser with a short-lived
      // HttpOnly cookie. The server stores only the digest alongside the state.
      const browserBinding = randomToken(32);
      let started: { url: string; state: string };
      if (ownerUserId) {
        try {
          started = await withAccountWriteLease(
            store,
            ownerUserId,
            () => google.start(intent, ownerUserId, browserBinding),
          );
        } catch (e: any) {
          if (e?.code !== 'ACCOUNT_UNAVAILABLE') throw e;
          // Do not turn an unavailable/deleting account into a sign-in error:
          // start a normal public flow whose state carries no owner link.
          started = await google.start(intent, null, browserBinding);
        }
      } else {
        started = await google.start(intent, null, browserBinding);
      }
      setOAuthBindingCookie(res, browserBinding);
      res.json({ url: started.url, intent });
    } catch (e) {
      next(e);
    }
  });

  /**
   * Google callback. The stable subject resolves an existing account from
   * either intent. Only an explicit registration intent may create a new
   * account, and a matching email never auto-links or signs in another account.
   */
  router.get('/google/callback', oauthLimiter, noStore, async (req, res) => {
    const fail = (code: string) => {
      clearOAuthBindingCookie(res);
      return res.redirect(303, `${env.appOrigin}/#/auth?error=${encodeURIComponent(code)}`);
    };
    try {
      if (typeof req.query.error === 'string') return fail('google_cancelled');
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const browserBinding = readOAuthBindingCookie(req);
      if (!browserBinding) return fail('invalid_oauth_state');
      const { identity, intent, userId } = await google.complete(code, state, browserBinding);
      if (!identity.emailVerified) return fail('EMAIL_NOT_VERIFIED');

      const account = await findAccountByGoogleSub(store, identity.sub);
      const oldToken = readSessionToken(req);
      const info = clientInfo(req);

      /**
       * Email change is Google-only in the product UI. The flow is bound to an
       * authenticated account, the initiating browser cookie, and (when one is
       * linked) the stable Google subject. It never emails a verification link.
       */
      if (intent === 'email_change') {
        const owner = userId ? await findAccountById(store, userId) : null;
        if (!owner || owner.status !== 'active' || !owner.onboardingComplete) {
          return fail('ACCOUNT_UNAVAILABLE');
        }
        if (owner.googleSub && owner.googleSub !== identity.sub) {
          return fail('GOOGLE_IDENTITY_MISMATCH');
        }
        if (!owner.googleSub) {
          // Linking a Google identity for the first time is a security-
          // sensitive act: it must happen inside the recent-auth window.
          const current = oldToken ? await findSessionByToken(store, oldToken) : null;
          if (!current || current.userId !== owner.userId || !isRecentAuth(current)) {
            return fail('RECENT_AUTH_REQUIRED');
          }
        }
        const emailOwner = await store.accounts.findOne({ emailNormalized: normalizeEmail(identity.email) });
        if (emailOwner && emailOwner.userId !== owner.userId) return fail('EMAIL_TAKEN');
        let changed: Account;
        try {
          changed = await withAccountWriteLease(store, owner.userId, async () => {
            const current = await findAccountById(store, owner.userId);
            if (!current || current.status !== 'active') {
              throw Object.assign(new Error('Account unavailable.'), { status: 409, code: 'ACCOUNT_UNAVAILABLE' });
            }
            if (current.googleSub && current.googleSub !== identity.sub) {
              throw Object.assign(new Error('Google identity mismatch.'), { status: 403, code: 'GOOGLE_IDENTITY_MISMATCH' });
            }
            const next = await setAccountEmail(store, current, identity.email);
            if (!current.googleSub) {
              await store.accounts.updateOne(
                { userId: current.userId },
                { $set: { googleSub: identity.sub, updatedAt: new Date().toISOString() } },
              );
            }
            await revokeAllSessions(store, current.userId);
            await invalidateAllEmailActions(store, current.userId, ['email_change']);
            return next;
          });
        } catch (e: any) {
          return fail(typeof e?.code === 'string' ? e.code : 'EMAIL_TAKEN');
        }
        await safeNotice(email, {
          to: owner.email,
          subject: 'Your LearnQuest account email was changed',
          message: `The account email was changed to ${changed.email} on ${new Date().toUTCString()}. All sessions were signed out. If this was not you, reset your password and contact the LearnQuest administrator.`,
        });
        clearOAuthBindingCookie(res);
        clearSessionCookie(res);
        return res.redirect(303, `${env.appOrigin}/#/auth?notice=email-changed`);
      }

      // The stable Google subject is the primary identity. An unknown subject
      // on sign-in is never turned into an account; the client offers the
      // explicit account-creation path instead.
      if (intent === 'login' && !account) return fail('google_account_not_found');

      if (account) {
        if (account.status !== 'active') return fail('ACCOUNT_UNAVAILABLE');
        // A Google identity already linked to a LearnQuest account resolves to
        // that account from BOTH sign-in and sign-up screens. It signs in
        // instead of creating a duplicate or showing a blunt "already exists"
        // error. An unfinished registration resumes its existing onboarding.
        const onboarding = !account.onboardingComplete;
        const created = await withAccountWriteLease(store, account.userId, async () => {
          const session = await rotateSession(store, oldToken, account.userId, {
            ...info,
            authMethod: onboarding ? 'google_register' : 'google_login',
            passwordVersion: account.passwordVersion ?? 0,
            onboardingExpiresAt: onboarding ? onboardingExpiry() : null,
            onboardingGoogleSub: onboarding ? identity.sub : null,
          });
          await store.accounts.updateOne({ userId: account.userId }, { $set: { lastLoginAt: new Date().toISOString() } });
          return session;
        });
        setSessionCookie(res, created.token, created.maxAgeSec);
        clearOAuthBindingCookie(res);
        return res.redirect(303, `${env.appOrigin}/#/${onboarding ? 'onboarding' : 'dash'}`);
      }

      // Explicit registration for a new Google subject. A verified email that
      // matches a different/unlinked account is never attached automatically.
      const emailOwner = await store.accounts.findOne({ emailNormalized: normalizeEmail(identity.email) });
      if (emailOwner) return fail('LINK_REQUIRED');

      let pending: Account;
      try {
        pending = await createAccountFromGoogle(store, identity);
      } catch (e: any) {
        return fail(typeof e?.code === 'string' ? e.code : 'google_registration_failed');
      }
      const created = await withAccountWriteLease(store, pending.userId, () => rotateSession(
        store,
        oldToken,
        pending.userId,
        {
          ...info,
          authMethod: 'google_register',
          passwordVersion: pending.passwordVersion ?? 0,
          onboardingExpiresAt: onboardingExpiry(),
          onboardingGoogleSub: identity.sub,
        },
      ));
      setSessionCookie(res, created.token, created.maxAgeSec);
      clearOAuthBindingCookie(res);
      return res.redirect(303, `${env.appOrigin}/#/onboarding`);
    } catch (e: any) {
      const code = typeof e?.code === 'string' ? e.code : 'google_failed';
      return fail(code);
    }
  });

  router.post('/login', loginLimiter, noStore, async (req, res, next) => {
    try {
      await requireSetup(store);
      const body = parseBody(loginSchema, req.body);
      const account = await findAccountByIdentifier(store, body.identifier);
      if (!account || account.status !== 'active' || !account.onboardingComplete || !account.passwordHash) {
        await burnPasswordCheck(body.password);
        throw http(401, 'Invalid username/email or password.', 'INVALID_CREDENTIALS');
      }
      const ok = await verifyCode(body.password, account.passwordHash);
      if (!ok) throw http(401, 'Invalid username/email or password.', 'INVALID_CREDENTIALS');
      let created;
      try {
        created = await withAccountWriteLease(store, account.userId, async () => {
          const session = await rotateSession(store, readSessionToken(req), account.userId, {
            ...clientInfo(req),
            authMethod: 'password',
            passwordVersion: account.passwordVersion ?? 0,
          });
          await store.accounts.updateOne({ userId: account.userId }, { $set: { lastLoginAt: new Date().toISOString() } });
          return session;
        });
      } catch (e: any) {
        // A concurrent deletion must not reveal whether the account exists.
        if (e?.code === 'ACCOUNT_UNAVAILABLE') {
          throw http(401, 'Invalid username/email or password.', 'INVALID_CREDENTIALS');
        }
        throw e;
      }
      setSessionCookie(res, created.token, created.maxAgeSec);
      res.json({ authenticated: true, user: safeAccount(account), csrfToken: created.session.csrfToken });
    } catch (e) {
      next(e);
    }
  });

  router.post('/logout', noStore, async (req, res, next) => {
    try {
      const token = readSessionToken(req);
      if (token) {
        // Capture the session before revoking it, so a same-profile tab that
        // shares this cookie can be notified without an account-wide event.
        const session = await findSessionByToken(store, token);
        const revoked = await revokeSession(store, token);
        if (revoked && session) {
          await publishAuthInvalidation(authEvents, {
            userId: session.userId,
            sessionId: session.sessionId,
            reason: 'sessions-revoked',
          });
        }
      }
      clearSessionCookie(res);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.post('/logout-all', auth, csrf, noStore, async (req: AuthedRequest, res, next) => {
    try {
      const userId = req.auth!.userId;
      const revoked = await revokeAllSessions(store, userId);
      if (revoked > 0) {
        await publishAuthInvalidation(authEvents, {
          userId,
          sessionId: null,
          reason: 'sessions-revoked',
        });
      }
      clearSessionCookie(res);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.post('/onboarding', auth, csrf, noStore, async (req: AuthedRequest, res, next) => {
    try {
      const account = req.auth!.account;
      if (account.onboardingComplete) throw http(409, 'This account has already completed setup.', 'ONBOARDING_COMPLETE');
      if (!isGoogleOnboardingSession(req.auth!.session, account.googleSub)) {
        throw http(403, 'This Google registration session has expired or does not belong to this account. Start account creation again.', 'ONBOARDING_SESSION_INVALID');
      }
      const body = parseBody(onboardingSchema, req.body);
      validatePassword(body.password);
      const passwordHash = await hashCode(body.password);
      const { updated, created } = await withAccountWriteLease(store, account.userId, async () => {
        const completed = await completeOnboarding(store, account, {
          username: body.username,
          displayName: body.displayName,
          password: body.password,
          timezone: body.timezone,
          sessionLenMin: body.sessionLenMin,
          breakMin: body.breakMin,
          minViableMin: body.minViableMin,
        }, passwordHash);
        const session = await rotateSession(store, readSessionToken(req), completed.userId, {
          ...clientInfo(req),
          authMethod: 'password',
          passwordVersion: completed.passwordVersion ?? 0,
        });
        return { updated: completed, created: session };
      });
      setSessionCookie(res, created.token, created.maxAgeSec);
      res.json({ user: safeAccount(updated), csrfToken: created.session.csrfToken });
    } catch (e) {
      next(e);
    }
  });

  router.post('/reauth', auth, csrf, noStore, async (req: AuthedRequest, res, next) => {
    try {
      const account = req.auth!.account;
      requireCompletedAccount(account);
      const body = parseBody(reauthSchema, req.body);
      if (account.passwordHash) {
        const ok = body.password ? await verifyCode(body.password, account.passwordHash) : false;
        if (!ok) throw http(401, 'The password is incorrect.', 'INVALID_CREDENTIALS');
      } else if (!isRecentAuth(req.auth!.session)) {
        throw http(403, 'Sign in with Google again before this change.', 'REAUTH_REQUIRED');
      }
      await withAccountWriteLease(store, account.userId, () => markReauthenticated(store, req.auth!.session.sessionId));
      res.json({ ok: true, reauthenticatedAt: new Date().toISOString() });
    } catch (e) {
      next(e);
    }
  });

  router.post('/password/change', auth, csrf, requireRecentAuth, noStore, async (req: AuthedRequest, res, next) => {
    try {
      const account = req.auth!.account;
      requireCompletedAccount(account);
      const body = parseBody(passwordChangeSchema, req.body);
      validatePassword(body.newPassword);
      if (account.passwordHash) {
        const ok = body.currentPassword ? await verifyCode(body.currentPassword, account.passwordHash) : false;
        if (!ok) throw http(401, 'The current password is incorrect.', 'INVALID_CREDENTIALS');
      }
      const newHash = await hashCode(body.newPassword);
      const created = await withAccountWriteLease(store, account.userId, async () => {
        const updated = await setAccountPassword(store, account, newHash);
        await revokeAllSessions(store, account.userId, req.auth!.session.sessionId);
        // A password change makes every outstanding emailed action stale. This
        // includes a reset link an attacker may have requested before the owner
        // regained control, and any pending email-change verification.
        await invalidateAllEmailActions(store, updated.userId);
        return rotateSession(store, readSessionToken(req), updated.userId, {
          ...clientInfo(req),
          authMethod: 'password',
          passwordVersion: updated.passwordVersion ?? 0,
        });
      });
      setSessionCookie(res, created.token, created.maxAgeSec);
      await safeNotice(email, {
        to: account.email,
        subject: 'Your LearnQuest password was changed',
        message: `Your LearnQuest password was changed on ${new Date().toUTCString()}. If this was not you, reset your password immediately.`,
      });
      res.json({ ok: true, csrfToken: created.session.csrfToken });
    } catch (e) {
      next(e);
    }
  });

  /**
   * Request a password-reset link. The response is identical for known and
   * unknown accounts, and never contains a token or challenge identifier.
   */
  router.post('/forgot', emailActionLimiter, noStore, async (req, res, next) => {
    try {
      await requireSetup(store);
      if (!email.configured) {
        throw http(503, 'Password recovery is temporarily unavailable. Try again later.', 'SETUP_REQUIRED');
      }
      const body = parseBody(forgotSchema, req.body);
      const generic = {
        ok: true as const,
        message: `If an eligible account matches that username or email, we'll send a password-reset link. It expires in ${env.emailActionTtlMin} minutes and can be used once.`,
      };
      const account = await findAccountByIdentifier(store, body.identifier);
      // A pending registration is not an eligible account: it has not chosen a
      // username/password and must finish Google onboarding instead. The public
      // response remains identical so this check is not an enumeration oracle.
      if (!isPasswordResetEligible(account)) {
        console.info(JSON.stringify({ level: 'info', event: 'password_reset_not_eligible' }));
        res.status(202).json(generic);
        return;
      }
      const latest = await latestEmailAction(store, account.userId, 'password_reset');
      if (latest && Date.now() - Date.parse(latest.createdAt) < env.emailActionResendSec * 1000) {
        console.info(JSON.stringify({ level: 'info', event: 'password_reset_cooldown' }));
        res.status(202).json(generic);
        return;
      }
      try {
        await withAccountWriteLease(store, account.userId, async () => {
          const issued = await issueEmailActionToken(store, {
            userId: account.userId,
            purpose: 'password_reset',
            accountEmailNormalized: account.emailNormalized,
            emailNormalized: account.emailNormalized,
            targetEmail: account.email,
          });
          console.info(JSON.stringify({ level: 'info', event: 'password_reset_email_requested' }));
          try {
            await email.sendActionEmail({
              to: account.email,
              purpose: 'password_reset',
              actionUrl: issued.actionUrl,
              expiresInMin: issued.expiresInMin,
            });
          } catch {
            // The response stays generic to avoid account enumeration. The token
            // is invalidated immediately and no success email claim is stored.
            // The provider adapter already emitted a sanitized failure event.
            await invalidateEmailAction(store, issued.tokenId);
            console.error(JSON.stringify({ level: 'error', event: 'password_reset_email_failed_token_invalidated' }));
          }
        });
      } catch (e: any) {
        if (e?.code === 'ACCOUNT_UNAVAILABLE') {
          // Same generic response as unknown/ineligible: never reveal that a
          // concurrent deletion changed this account's state.
          res.status(202).json(generic);
          return;
        }
        throw e;
      }
      res.status(202).json(generic);
    } catch (e) {
      next(e);
    }
  });

  /**
   * Read-only status check for the reset page. It validates the token and the
   * account/email binding without consuming anything, so a user who opens an
   * expired link sees an expired state immediately instead of a form that
   * would only be rejected after they choose a password. GET is still never
   * used: the fragment token is submitted explicitly.
   */
  router.post('/password/reset/validate', emailActionLimiter, noStore, async (req, res, next) => {
    try {
      await requireSetup(store);
      const body = parseBody(resetTokenSchema, req.body);
      const inspected = await inspectEmailActionToken(store, body.token, 'password_reset');
      if (inspected.state === 'expired') {
        throw http(400, 'This password reset link has expired. Request a new link.', 'EXPIRED_RESET_TOKEN');
      }
      if (inspected.state !== 'valid' || !inspected.record) {
        throw http(400, 'This password reset link is invalid or has already been used. Request a new link.', 'INVALID_RESET_TOKEN');
      }
      const account = await findAccountById(store, inspected.record.userId);
      if (!resetBelongsToAccount(account, inspected.record)) {
        throw http(400, 'This password reset link is invalid or has already been used. Request a new link.', 'INVALID_RESET_TOKEN');
      }
      res.json({ ok: true, valid: true });
    } catch (e) {
      next(e);
    }
  });

  /** Complete a reset with the single-use link token. GET never consumes it. */
  router.post('/password/reset', emailActionLimiter, noStore, async (req, res, next) => {
    try {
      await requireSetup(store);
      const body = parseBody(resetSchema, req.body);
      // Validate before consuming so a weak password does not burn the link.
      validatePassword(body.newPassword);
      // Read-only inspection lets us acquire the account write lease before
      // consuming the one-time token. If the account is already deleting, the
      // link is rejected without consuming it or writing anything.
      const inspected = await inspectEmailActionToken(store, body.token, 'password_reset');
      if (inspected.state !== 'valid' || !inspected.record) {
        throw http(400, 'This password reset link is invalid, expired, or already used. Request a new link.', 'INVALID_RESET_TOKEN');
      }
      const account = await findAccountById(store, inspected.record.userId);
      if (!resetBelongsToAccount(account, inspected.record)) {
        throw http(400, 'This password reset link is invalid, expired, or already used. Request a new link.', 'INVALID_RESET_TOKEN');
      }
      const newHash = await hashCode(body.newPassword);
      try {
        await withAccountWriteLease(store, account.userId, async () => {
          const record = await consumeEmailActionToken(store, body.token, 'password_reset');
          if (!record) {
            throw http(400, 'This password reset link is invalid, expired, or already used. Request a new link.', 'INVALID_RESET_TOKEN');
          }
          const current = await findAccountById(store, record.userId);
          if (!resetBelongsToAccount(current, record)) {
            throw http(400, 'This password reset link is invalid, expired, or already used. Request a new link.', 'INVALID_RESET_TOKEN');
          }
          const updated = await setAccountPassword(store, current, newHash);
          await revokeAllSessions(store, updated.userId);
          // Burn every outstanding emailed action, not only reset links: a
          // pending email-change confirmation must not survive a password reset.
          await invalidateAllEmailActions(store, updated.userId);
          await invalidateLegacyRecoveryArtifacts(store, updated.userId);
          await safeNotice(email, {
            to: updated.email,
            subject: 'Your LearnQuest password was reset',
            message: `Your LearnQuest password was reset on ${new Date().toUTCString()}. All existing sessions were signed out. If this was not you, request another reset link immediately.`,
          });
        });
      } catch (e: any) {
        if (e?.code === 'ACCOUNT_UNAVAILABLE') {
          throw http(400, 'This password reset link is invalid, expired, or already used. Request a new link.', 'INVALID_RESET_TOKEN');
        }
        throw e;
      }
      // Publish only after the write lease has completed the password update,
      // session revocation, and token invalidation. A failed/reused/expired
      // token never reaches this point.
      await publishAuthInvalidation(authEvents, {
        userId: account.userId,
        sessionId: null,
        reason: 'password-reset',
      });
      // The reset request may carry the browser's old session cookie. Clear it
      // here as well as revoking the server record so this browser is visibly
      // signed out before the client broadcasts the event to other tabs.
      clearSessionCookie(res);
      console.info(JSON.stringify({ level: 'info', event: 'password_reset_completed' }));
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return router;
}

export { boundedInt, updateAccountPreferences, validateTimezone };
export type { Account, SafeAccount };
