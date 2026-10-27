import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { DataStore } from '../store.js';
import { env, configStatus } from '../config/env.js';
import type { EmailService } from '../email/brevo.js';
import type { GoogleOAuthService, GoogleAuthIntent } from '../auth/google.js';
import {
  boundedInt, completeOnboarding, createAccountFromGoogle, findAccountByGoogleSub,
  findAccountById, findAccountByIdentifier, isPasswordResetEligible, safeAccount,
  setAccountPassword, updateAccountPreferences, validatePassword, validateTimezone,
  http, type Account, type SafeAccount,
} from '../auth/accounts.js';
import {
  burnPasswordCheck, hashCode, normalizeEmail, verifyCode,
} from '../auth/crypto.js';
import {
  findSessionByToken, isGoogleOnboardingSession, isRecentAuth, markReauthenticated,
  revokeAllSessions, revokeSession, rotateSession,
} from '../auth/sessions.js';
import {
  consumeEmailActionToken, invalidateEmailAction, issueEmailActionToken, latestEmailAction,
} from '../auth/actionTokens.js';
import {
  clearSessionCookie, clientInfo, noStore, readSessionToken, requireAuth, requireCsrf,
  requireRecentAuth, setSessionCookie, type AuthedRequest,
} from '../auth/middleware.js';

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

export interface AuthRouterDeps {
  store: DataStore;
  email: EmailService;
  google: GoogleOAuthService;
}

export function createAuthRouter({ store, email, google }: AuthRouterDeps): Router {
  const router = Router();
  const auth = requireAuth(store);
  const csrf = requireCsrf;
  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    max: env.authRateLimitPerMin,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Wait 15 minutes and try again.' },
  });
  const emailActionLimiter = rateLimit({
    windowMs: 15 * 60_000,
    max: env.emailActionRateLimitPer15Min,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many email verification requests. Wait 15 minutes and try again.' },
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

  router.get('/google/start', loginLimiter, noStore, async (req, res, next) => {
    try {
      await requireSetup(store);
      const rawIntent = typeof req.query.intent === 'string' ? req.query.intent : 'login';
      if (rawIntent !== 'login' && rawIntent !== 'register') {
        throw http(400, 'Choose whether to sign in or create an account.', 'INVALID_OAUTH_INTENT');
      }
      const intent: GoogleAuthIntent = rawIntent;
      const { url } = await google.start(intent);
      res.json({ url, intent });
    } catch (e) {
      next(e);
    }
  });

  /**
   * Google callback. Login and registration intents are deliberately distinct:
   * an unknown identity arriving through login is never turned into an account.
   */
  router.get('/google/callback', loginLimiter, noStore, async (req, res) => {
    const fail = (code: string) => res.redirect(303, `${env.appOrigin}/#/auth?error=${encodeURIComponent(code)}`);
    try {
      if (typeof req.query.error === 'string') return fail('google_cancelled');
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const { identity, intent } = await google.complete(code, state);
      if (!identity.emailVerified) return fail('EMAIL_NOT_VERIFIED');

      const account = await findAccountByGoogleSub(store, identity.sub);
      const oldToken = readSessionToken(req);
      const info = clientInfo(req);

      if (intent === 'login') {
        if (!account) return fail('google_account_not_found');
        if (account.status !== 'active') return fail('ACCOUNT_UNAVAILABLE');
        const onboarding = !account.onboardingComplete;
        const created = await rotateSession(store, oldToken, account.userId, {
          ...info,
          authMethod: onboarding ? 'google_register' : 'google_login',
          onboardingExpiresAt: onboarding ? onboardingExpiry() : null,
          onboardingGoogleSub: onboarding ? identity.sub : null,
        });
        setSessionCookie(res, created.token, created.maxAgeSec);
        await store.accounts.updateOne({ userId: account.userId }, { $set: { lastLoginAt: new Date().toISOString() } });
        return res.redirect(303, `${env.appOrigin}/#/${onboarding ? 'onboarding' : 'dash'}`);
      }

      // Registration intent.
      if (account) {
        if (account.status !== 'active') return fail('ACCOUNT_UNAVAILABLE');
        if (account.onboardingComplete) {
          // An existing account is never silently signed in through the
          // registration route; the person must choose sign-in explicitly.
          return fail('google_account_exists');
        }
        // Resume an interrupted registration for the same Google subject. No
        // duplicate account is created.
        const created = await rotateSession(store, oldToken, account.userId, {
          ...info,
          authMethod: 'google_register',
          onboardingExpiresAt: onboardingExpiry(),
          onboardingGoogleSub: identity.sub,
        });
        setSessionCookie(res, created.token, created.maxAgeSec);
        await store.accounts.updateOne({ userId: account.userId }, { $set: { lastLoginAt: new Date().toISOString() } });
        return res.redirect(303, `${env.appOrigin}/#/onboarding`);
      }

      const emailOwner = await store.accounts.findOne({ emailNormalized: normalizeEmail(identity.email) });
      if (emailOwner) return fail('LINK_REQUIRED');

      let pending: Account;
      try {
        pending = await createAccountFromGoogle(store, identity);
      } catch (e: any) {
        return fail(typeof e?.code === 'string' ? e.code : 'google_registration_failed');
      }
      const created = await rotateSession(store, oldToken, pending.userId, {
        ...info,
        authMethod: 'google_register',
        onboardingExpiresAt: onboardingExpiry(),
        onboardingGoogleSub: identity.sub,
      });
      setSessionCookie(res, created.token, created.maxAgeSec);
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
      const created = await rotateSession(store, readSessionToken(req), account.userId, {
        ...clientInfo(req),
        authMethod: 'password',
      });
      setSessionCookie(res, created.token, created.maxAgeSec);
      await store.accounts.updateOne({ userId: account.userId }, { $set: { lastLoginAt: new Date().toISOString() } });
      res.json({ authenticated: true, user: safeAccount(account), csrfToken: created.session.csrfToken });
    } catch (e) {
      next(e);
    }
  });

  router.post('/logout', noStore, async (req, res, next) => {
    try {
      const token = readSessionToken(req);
      if (token) await revokeSession(store, token);
      clearSessionCookie(res);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.post('/logout-all', auth, csrf, noStore, async (req: AuthedRequest, res, next) => {
    try {
      await revokeAllSessions(store, req.auth!.userId);
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
      const updated = await completeOnboarding(store, account, {
        username: body.username,
        displayName: body.displayName,
        password: body.password,
        timezone: body.timezone,
        sessionLenMin: body.sessionLenMin,
        breakMin: body.breakMin,
        minViableMin: body.minViableMin,
      }, passwordHash);
      const created = await rotateSession(store, readSessionToken(req), updated.userId, {
        ...clientInfo(req),
        authMethod: 'password',
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
      const body = parseBody(reauthSchema, req.body);
      if (account.passwordHash) {
        const ok = body.password ? await verifyCode(body.password, account.passwordHash) : false;
        if (!ok) throw http(401, 'The password is incorrect.', 'INVALID_CREDENTIALS');
      } else if (!isRecentAuth(req.auth!.session)) {
        throw http(403, 'Sign in with Google again before this change.', 'REAUTH_REQUIRED');
      }
      await markReauthenticated(store, req.auth!.session.sessionId);
      res.json({ ok: true, reauthenticatedAt: new Date().toISOString() });
    } catch (e) {
      next(e);
    }
  });

  router.post('/password/change', auth, csrf, requireRecentAuth, noStore, async (req: AuthedRequest, res, next) => {
    try {
      const account = req.auth!.account;
      const body = parseBody(passwordChangeSchema, req.body);
      validatePassword(body.newPassword);
      if (account.passwordHash) {
        const ok = body.currentPassword ? await verifyCode(body.currentPassword, account.passwordHash) : false;
        if (!ok) throw http(401, 'The current password is incorrect.', 'INVALID_CREDENTIALS');
      }
      const newHash = await hashCode(body.newPassword);
      await setAccountPassword(store, account, newHash);
      await revokeAllSessions(store, account.userId, req.auth!.session.sessionId);
      const created = await rotateSession(store, readSessionToken(req), account.userId, {
        ...clientInfo(req),
        authMethod: 'password',
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
        message: `If an eligible account matches that username or email, you'll receive a password-reset link. It expires in ${env.emailActionTtlMin} minutes and can be used once.`,
      };
      const account = await findAccountByIdentifier(store, body.identifier);
      // A pending registration is not an eligible account: it has not chosen a
      // username/password and must finish Google onboarding instead. The public
      // response remains identical so this check is not an enumeration oracle.
      if (!isPasswordResetEligible(account)) {
        res.status(202).json(generic);
        return;
      }
      const latest = await latestEmailAction(store, account.userId, 'password_reset');
      if (latest && Date.now() - Date.parse(latest.createdAt) < env.emailActionResendSec * 1000) {
        res.status(202).json(generic);
        return;
      }
      const issued = await issueEmailActionToken(store, {
        userId: account.userId,
        purpose: 'password_reset',
        accountEmailNormalized: account.emailNormalized,
        emailNormalized: account.emailNormalized,
        targetEmail: account.email,
      });
      try {
        await email.sendActionEmail({
          to: account.email,
          purpose: 'password_reset',
          actionUrl: issued.actionUrl,
          expiresInMin: issued.expiresInMin,
        });
      } catch {
        // The response stays generic to avoid account enumeration. The token is
        // invalidated immediately and no success email claim is stored.
        await invalidateEmailAction(store, issued.tokenId);
        console.error('LearnQuest password-reset email delivery failed; the issued link was invalidated.');
      }
      res.status(202).json(generic);
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
      const record = await consumeEmailActionToken(store, body.token, 'password_reset');
      if (!record) {
        throw http(400, 'This password reset link is invalid, expired, or already used. Request a new link.', 'INVALID_RESET_TOKEN');
      }
      const account = await findAccountById(store, record.userId);
      if (
        !isPasswordResetEligible(account)
        || account.emailNormalized !== record.emailNormalized
        || account.emailNormalized !== record.accountEmailNormalized
      ) {
        throw http(400, 'This password reset link is invalid, expired, or already used. Request a new link.', 'INVALID_RESET_TOKEN');
      }
      const newHash = await hashCode(body.newPassword);
      await setAccountPassword(store, account, newHash);
      await revokeAllSessions(store, account.userId);
      await safeNotice(email, {
        to: account.email,
        subject: 'Your LearnQuest password was reset',
        message: `Your LearnQuest password was reset on ${new Date().toUTCString()}. All existing sessions were signed out. If this was not you, request another reset link immediately.`,
      });
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return router;
}

export { boundedInt, updateAccountPreferences, validateTimezone };
export type { Account, SafeAccount };
