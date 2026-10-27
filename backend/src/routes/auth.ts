import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DataStore } from '../store.js';
import { env, configStatus } from '../config/env.js';
import type { EmailService } from '../email/brevo.js';
import type { GoogleOAuthService } from '../auth/google.js';
import {
  boundedInt, completeOnboarding, createAccountFromGoogle, findAccountByIdentifier, findAccountById,
  safeAccount, setAccountPassword, updateAccountPreferences, validatePassword, validateTimezone, http,
  type Account, type SafeAccount,
} from '../auth/accounts.js';
import {
  burnPasswordCheck, hashCode, normalizeEmail, verifyCode,
} from '../auth/crypto.js';
import {
  findSessionByToken, markReauthenticated, revokeAllSessions, revokeSession,
  rotateSession, isRecentAuth,
} from '../auth/sessions.js';
import { issueChallenge, issueResetGrant, consumeResetGrant, verifyChallenge } from '../auth/otp.js';
import {
  clearSessionCookie, clientInfo, noStore, readSessionToken, requireAuth, requireCsrf,
  requireRecentAuth, setSessionCookie, type AuthedRequest,
} from '../auth/middleware.js';

const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(128),
});
const onboardingSchema = z.object({
  username: z.string().max(64),
  displayName: z.string().max(120),
  password: z.string().max(128),
  timezone: z.string().max(100).optional(),
  sessionLenMin: z.number().optional(),
  breakMin: z.number().optional(),
  minViableMin: z.number().optional(),
});
const forgotSchema = z.object({ identifier: z.string().trim().min(1).max(320) });
const verifyOtpSchema = z.object({
  challengeId: z.string().min(1).max(100),
  code: z.string().min(1).max(10),
});
const resetSchema = z.object({ resetToken: z.string().min(20).max(200), newPassword: z.string().max(128) });
const passwordChangeSchema = z.object({
  currentPassword: z.string().max(128).optional(),
  newPassword: z.string().max(128),
});
const reauthSchema = z.object({ password: z.string().max(128).optional() });

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw http(400, 'The request body is invalid.', 'INVALID_REQUEST');
  return result.data;
}

async function requireSetup(store: DataStore): Promise<void> {
  if (!env.sessionConfigured || !env.mongodbConfigured) {
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
  const otpLimiter = rateLimit({
    windowMs: 15 * 60_000,
    max: env.otpRateLimitPer15Min,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many verification requests. Wait 15 minutes and try again.' },
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
        config,
      });
    } catch (e) {
      next(e);
    }
  });

  router.get('/google/start', loginLimiter, async (_req, res, next) => {
    try {
      await requireSetup(store);
      const { url } = await google.start();
      res.json({ url });
    } catch (e) {
      next(e);
    }
  });

  router.get('/google/callback', loginLimiter, async (req, res) => {
    const fail = (code: string) => res.redirect(303, `${env.appOrigin}/#/auth?error=${encodeURIComponent(code)}`);
    try {
      if (typeof req.query.error === 'string') return fail('google_cancelled');
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const identity = await google.complete(code, state);
      const account = await createAccountFromGoogle(store, identity);
      const oldToken = readSessionToken(req);
      const info = clientInfo(req);
      const created = await rotateSession(store, oldToken, account.userId, info);
      setSessionCookie(res, created.token, created.maxAgeSec);
      await store.accounts.updateOne({ userId: account.userId }, { $set: { lastLoginAt: new Date().toISOString() } });
      return res.redirect(303, `${env.appOrigin}/#/${account.onboardingComplete ? 'dash' : 'onboarding'}`);
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
      const oldToken = readSessionToken(req);
      const info = clientInfo(req);
      const created = await rotateSession(store, oldToken, account.userId, info);
      setSessionCookie(res, created.token, created.maxAgeSec);
      await store.accounts.updateOne({ userId: account.userId }, { $set: { lastLoginAt: new Date().toISOString() } });
      res.json({ authenticated: true, user: safeAccount(account), csrfToken: created.session.csrfToken });
    } catch (e) {
      next(e);
    }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      const token = readSessionToken(req);
      if (token) await revokeSession(store, token);
      clearSessionCookie(res);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.post('/logout-all', auth, csrf, async (req: AuthedRequest, res, next) => {
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
      const info = clientInfo(req);
      const created = await rotateSession(store, readSessionToken(req), updated.userId, info);
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
      const created = await rotateSession(store, readSessionToken(req), account.userId, clientInfo(req));
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

  router.post('/forgot', otpLimiter, noStore, async (req, res, next) => {
    try {
      await requireSetup(store);
      if (!email.configured) {
        throw http(503, 'Password recovery email is not configured yet. Ask the administrator to set Brevo credentials.', 'SETUP_REQUIRED');
      }
      const body = parseBody(forgotSchema, req.body);
      const generic: { ok: true; challengeId: string; message: string } = {
        ok: true,
        challengeId: randomUUID(),
        message: 'If an account matches that username or email, a six-digit reset code has been sent. The code expires shortly.',
      };
      const account = await findAccountByIdentifier(store, body.identifier);
      if (!account || account.status !== 'active') {
        res.status(202).json(generic);
        return;
      }
      const prior = await store.challenges.find({ userId: account.userId, purpose: 'password_reset' }, { sort: { createdAt: -1 }, limit: 1 });
      const last = prior[0];
      if (last && Date.now() - Date.parse(last.createdAt) < env.otpResendSec * 1000) {
        res.status(202).json({ ...generic, challengeId: String(last.challengeId) });
        return;
      }
      const issued = await issueChallenge(store, {
        userId: account.userId,
        purpose: 'password_reset',
        emailNormalized: normalizeEmail(account.email),
        targetEmail: account.email,
      });
      generic.challengeId = issued.challengeId;
      try {
        await email.sendOtp({
          to: account.email,
          code: issued.code,
          expiresInMin: issued.expiresInMin,
          purpose: 'password_reset',
        });
      } catch (e) {
        await store.challenges.updateOne({ challengeId: issued.challengeId }, { $set: { consumedAt: new Date().toISOString() } });
        // Still generic: delivery failure must not reveal account existence.
        void e;
      }
      res.status(202).json(generic);
    } catch (e) {
      next(e);
    }
  });

  router.post('/otp/verify', otpLimiter, noStore, async (req, res, next) => {
    try {
      await requireSetup(store);
      const body = parseBody(verifyOtpSchema, req.body);
      const verified = await verifyChallenge(store, {
        challengeId: body.challengeId,
        code: body.code,
        purpose: 'password_reset',
      });
      if (!verified.ok || !verified.challenge) {
        throw http(400, 'The code is invalid or has expired. Request a new code.', 'INVALID_OTP');
      }
      const account = await findAccountById(store, verified.challenge.userId);
      if (!account || account.status !== 'active') throw http(400, 'The code is invalid or has expired.', 'INVALID_OTP');
      const grant = await issueResetGrant(store, account.userId);
      res.json({ ok: true, resetToken: grant.token, expiresAt: grant.expiresAt });
    } catch (e) {
      next(e);
    }
  });

  router.post('/password/reset', otpLimiter, noStore, async (req, res, next) => {
    try {
      await requireSetup(store);
      const body = parseBody(resetSchema, req.body);
      validatePassword(body.newPassword);
      const grant = await consumeResetGrant(store, body.resetToken);
      if (!grant) throw http(400, 'The reset authorization is invalid or expired. Request a new code.', 'INVALID_RESET_GRANT');
      const account = await findAccountById(store, grant.userId);
      if (!account || account.status !== 'active') throw http(400, 'The reset authorization is invalid.', 'INVALID_RESET_GRANT');
      const newHash = await hashCode(body.newPassword);
      await setAccountPassword(store, account, newHash);
      await revokeAllSessions(store, account.userId);
      await safeNotice(email, {
        to: account.email,
        subject: 'Your LearnQuest password was reset',
        message: `Your LearnQuest password was reset on ${new Date().toUTCString()}. All existing sessions were signed out. If this was not you, contact support immediately.`,
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
