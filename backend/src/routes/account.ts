import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { DataStore } from '../store.js';
import { env } from '../config/env.js';
import type { EmailService } from '../email/brevo.js';
import {
  safeAccount, setAccountEmail, setAccountPassword, updateAccountPreferences,
  updateProfile, findAccountById, http, type Account,
} from '../auth/accounts.js';
import { hashCode, normalizeEmail, verifyCode } from '../auth/crypto.js';
import {
  isRecentAuth, listSessions, revokeAllSessions, revokeSessionById,
} from '../auth/sessions.js';
import {
  consumeEmailActionToken, invalidateEmailAction, issueEmailActionToken, latestEmailAction,
} from '../auth/actionTokens.js';
import {
  clearSessionCookie, noStore, requireAuth, requireCsrf, requireRecentAuth,
  type AuthedRequest,
} from '../auth/middleware.js';
import {
  USER_COLLECTIONS, type UserCollectionName,
} from '../store.js';
import {
  deleteAllUserData, emptyUserState, getUserStateExport, readUserState, replaceAllUserState,
  replaceUserCollection, validateStatePayload, type UserState,
} from '../services/userData.js';

const profileSchema = z.object({
  username: z.string().max(64).optional(),
  displayName: z.string().max(120).optional(),
}).strict();
const prefsSchema = z.object({
  timezone: z.string().max(100).optional(),
  sessionLenMin: z.number().optional(),
  breakMin: z.number().optional(),
  minViableMin: z.number().optional(),
}).strict();
const collectionSchema = z.object({
  version: z.number().int().min(0),
  items: z.unknown(),
}).strict();
const importSchema = z.object({
  version: z.number().int().min(0).optional(),
  backup: z.unknown().optional(),
  state: z.unknown().optional(),
}).strict();
const migrateSchema = z.object({
  migrationId: z.string().min(8).max(100),
  version: z.number().int().min(0).optional(),
  state: z.unknown(),
}).strict();
const emailChangeSchema = z.object({
  newEmail: z.string().trim().max(320),
  password: z.string().max(128).optional(),
}).strict();
const emailConfirmSchema = z.object({
  token: z.string().min(20).max(512),
}).strict();
const deleteSchema = z.object({
  confirmUsername: z.string().max(64),
  password: z.string().max(128).optional(),
}).strict();

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw http(400, 'The request body is invalid.', 'INVALID_REQUEST');
  return result.data;
}

function arrayMergeById(existing: any[], incoming: any[], idOf: (x: any) => string, dedupeBy?: (x: any) => string) {
  const out = [...existing];
  const ids = new Set(existing.map(idOf));
  const custom = new Set(dedupeBy ? existing.map(dedupeBy) : []);
  let added = 0;
  let skipped = 0;
  for (const item of incoming) {
    const id = idOf(item);
    const customKey = dedupeBy ? dedupeBy(item) : id;
    if (ids.has(id) || (dedupeBy && custom.has(customKey))) {
      skipped++;
      continue;
    }
    ids.add(id);
    if (dedupeBy) custom.add(customKey);
    out.push(item);
    added++;
  }
  return { items: out, added, skipped };
}

function mapMerge(existing: Record<string, any>, incoming: Record<string, any>) {
  const out = { ...incoming, ...existing };
  return { value: out, added: Object.keys(out).length - Object.keys(existing).length, skipped: Object.keys(incoming).filter((k) => k in existing).length };
}

/**
 * Deterministic local-to-cloud conflict rules:
 * - Existing cloud records win on identical stable IDs.
 * - Missing cloud records are added; no existing record is overwritten.
 * - XP is deduped by dedupKey; review history travels inside its record.
 * - Singletons keep the cloud value unless it is null/empty.
 */
export function mergeMigrationState(existing: UserState, incoming: UserState) {
  const summary: Record<string, { added: number; skipped: number }> = {};
  const out: UserState = emptyUserState();
  for (const key of ['playlists', 'meta', 'progress', 'goals', 'achievements', 'queue'] as const) {
    const merged = mapMerge(existing[key] as Record<string, any>, incoming[key] as Record<string, any>);
    (out as any)[key] = merged.value;
    summary[key] = { added: merged.added, skipped: merged.skipped };
  }
  for (const key of ['ranges', 'checkpoints', 'modules', 'sessions', 'xp', 'segments', 'playSessions', 'flexGoals', 'rankHistory'] as const) {
    const idOf = (x: any) => String(x?.id ?? '');
    const dedupeBy = key === 'xp' ? (x: any) => String(x?.dedupKey ?? x?.id) : key === 'sessions' ? (x: any) => String(x?.clientId || x?.id) : undefined;
    const merged = arrayMergeById(existing[key] as any[], incoming[key] as any[], idOf, dedupeBy);
    (out as any)[key] = merged.items;
    summary[key] = { added: merged.added, skipped: merged.skipped };
  }
  out.activeId = existing.activeId && existing.playlists[existing.activeId] ? existing.activeId : incoming.activeId;
  out.challenge = existing.challenge ?? incoming.challenge;
  out.challengeEnabled = existing.challengeEnabled || incoming.challengeEnabled;
  out.settings = existing.settings ?? incoming.settings;
  out.prefs = existing.prefs ?? incoming.prefs;
  return { state: out, summary };
}

export interface AccountRouterDeps {
  store: DataStore;
  email: EmailService;
}

async function notifyPreviousEmail(
  email: EmailService,
  input: { to: string; subject: string; message: string },
): Promise<void> {
  try {
    if (email.configured) await email.sendSecurityNotice(input);
  } catch {
    // The email change already committed; a notice failure is non-fatal but
    // is not reported as a successful delivery.
  }
}

export function createAccountRouter({ store, email }: AccountRouterDeps): Router {
  const router = Router();
  const auth = requireAuth(store);
  const emailActionLimiter = rateLimit({
    windowMs: 15 * 60_000,
    max: env.emailActionRateLimitPer15Min,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many email verification requests. Wait 15 minutes and try again.' },
  });

  /**
   * Public, token-only endpoint. The action token is a bearer secret delivered
   * to the new email address; the POST is explicit so mail scanners that open
   * links via GET cannot change an account.
   */
  router.post('/email/confirm', emailActionLimiter, noStore, async (req, res, next) => {
    try {
      const body = parseBody(emailConfirmSchema, req.body);
      const record = await consumeEmailActionToken(store, body.token, 'email_change');
      if (!record) {
        throw http(400, 'This email verification link is invalid, expired, or already used. Request a new one.', 'INVALID_EMAIL_TOKEN');
      }
      const account = await findAccountById(store, record.userId);
      if (
        !account
        || account.status !== 'active'
        || account.emailNormalized !== record.accountEmailNormalized
      ) {
        throw http(400, 'This email verification link is invalid, expired, or already used. Request a new one.', 'INVALID_EMAIL_TOKEN');
      }
      let updated: Account;
      try {
        updated = await setAccountEmail(store, account, record.emailNormalized);
      } catch (e: any) {
        throw e?.status ? e : http(409, 'That email address is unavailable.', 'EMAIL_TAKEN');
      }
      // A verified email change is security-sensitive: every existing session
      // is revoked and the person must authenticate with the new address.
      await revokeAllSessions(store, updated.userId);
      await notifyPreviousEmail(email, {
        to: account.email,
        subject: 'Your LearnQuest account email was changed',
        message: `The account email was changed to ${updated.email} on ${new Date().toUTCString()}. All sessions were signed out. If this was not you, reset your password and contact the LearnQuest administrator.`,
      });
      res.json({
        ok: true,
        email: updated.email,
        message: 'Email verified and updated. All sessions were signed out; sign in again with the new address.',
      });
    } catch (e) {
      next(e);
    }
  });

  router.use(auth);
  router.use(noStore);

  router.get('/', (req: AuthedRequest, res) => {
    res.json({ user: safeAccount(req.auth!.account) });
  });

  router.patch('/profile', requireCsrf, async (req: AuthedRequest, res, next) => {
    try {
      const body = parseBody(profileSchema, req.body);
      const updated = await updateProfile(store, req.auth!.account, {
        username: body.username,
        displayName: body.displayName,
      });
      res.json({ user: safeAccount(updated) });
    } catch (e) {
      next(e);
    }
  });

  router.patch('/preferences', requireCsrf, async (req: AuthedRequest, res, next) => {
    try {
      const body = parseBody(prefsSchema, req.body);
      const account = req.auth!.account;
      const updated = await updateAccountPreferences(store, account, body);
      // Mirror timezone/session defaults into the learning preferences record
      // so every device sees the same values, without discarding reducedMotion.
      const prefDoc = await store.data('prefs').findOne({ userId: account.userId, key: 'singleton' });
      const current = prefDoc?.value && typeof prefDoc.value === 'object' ? prefDoc.value : {};
      const nextPrefs = {
        ...current,
        ...(body.timezone !== undefined ? { timezone: updated.timezone } : {}),
        ...(body.sessionLenMin !== undefined ? { sessionLenMin: updated.sessionLenMin } : {}),
        ...(body.breakMin !== undefined ? { breakMin: updated.breakMin } : {}),
        ...(body.minViableMin !== undefined ? { minViableMin: updated.minViableMin } : {}),
      };
      await store.data('prefs').updateOne(
        { userId: account.userId, key: 'singleton' },
        { $set: { userId: account.userId, key: 'singleton', value: nextPrefs, updatedAt: new Date().toISOString(), order: 0 } },
        { upsert: true },
      );
      res.json({ user: safeAccount(updated) });
    } catch (e) {
      next(e);
    }
  });

  router.get('/data', async (req: AuthedRequest, res, next) => {
    try {
      const state = await readUserState(store, req.auth!.userId);
      res.json({ ok: true, ...state });
    } catch (e) {
      next(e);
    }
  });

  router.put('/data/:collection', requireCsrf, async (req: AuthedRequest, res, next) => {
    try {
      const name = req.params.collection as UserCollectionName;
      if (!USER_COLLECTIONS.includes(name)) throw http(404, 'Unknown data collection.', 'NOT_FOUND');
      const body = parseBody(collectionSchema, req.body);
      const saved = await replaceUserCollection(store, req.auth!.userId, name, body.items, body.version);
      res.json({ ok: true, ...saved, savedAt: new Date().toISOString() });
    } catch (e) {
      next(e);
    }
  });

  router.post('/import', requireCsrf, async (req: AuthedRequest, res, next) => {
    try {
      const body = parseBody(importSchema, req.body);
      const raw = extractBackupState(body.backup ?? body.state, body.backup);
      const current = await readUserState(store, req.auth!.userId);
      const baseVersion = body.version ?? current.version;
      const result = await replaceAllUserState(store, req.auth!.userId, raw, baseVersion);
      res.json({ ok: true, version: result.version, collections: USER_COLLECTIONS.length });
    } catch (e) {
      next(e);
    }
  });

  router.post('/migrate', requireCsrf, async (req: AuthedRequest, res, next) => {
    try {
      const body = parseBody(migrateSchema, req.body);
      const prior = await store.migrations.findOne({ userId: req.auth!.userId, migrationId: body.migrationId });
      if (prior) {
        res.json({ ok: true, alreadyApplied: true, ...prior.result });
        return;
      }
      const incoming = validateStatePayload(extractBackupState(body.state, undefined));
      const current = await readUserState(store, req.auth!.userId);
      const merged = mergeMigrationState(current.state, incoming);
      const baseVersion = body.version ?? current.version;
      const result = await replaceAllUserState(store, req.auth!.userId, merged.state, baseVersion);
      const payload = {
        migratedAt: new Date().toISOString(),
        fromSchema: (body.state as any)?.schemaVersion ?? (body.state as any)?.version ?? 1,
        collections: merged.summary,
      };
      await store.migrations.insertOne({
        userId: req.auth!.userId,
        migrationId: body.migrationId,
        result: payload,
        createdAt: new Date().toISOString(),
      });
      res.json({ ok: true, version: result.version, ...payload });
    } catch (e) {
      next(e);
    }
  });

  router.get('/export', async (req: AuthedRequest, res, next) => {
    try {
      const account = req.auth!.account;
      const data = await getUserStateExport(store, req.auth!.userId);
      res.setHeader('Content-Disposition', `attachment; filename="learnquest-account-${new Date().toISOString().slice(0, 10)}.json"`);
      res.json({
        ...data,
        account: {
          username: account.username,
          displayName: account.displayName,
          email: account.email,
          timezone: account.timezone,
          hasPassword: Boolean(account.passwordHash),
          createdAt: account.createdAt,
        },
      });
    } catch (e) {
      next(e);
    }
  });

  router.get('/sessions', async (req: AuthedRequest, res, next) => {
    try {
      const sessions = await listSessions(store, req.auth!.userId);
      res.json({
        sessions: sessions.map((s) => ({ ...s, current: s.sessionId === req.auth!.session.sessionId })),
      });
    } catch (e) {
      next(e);
    }
  });

  router.delete('/sessions/:sessionId', requireCsrf, async (req: AuthedRequest, res, next) => {
    try {
      const ok = await revokeSessionById(store, req.auth!.userId, req.params.sessionId);
      if (!ok) throw http(404, 'Session not found.', 'NOT_FOUND');
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  router.post('/email/change', requireCsrf, requireRecentAuth, async (req: AuthedRequest, res, next) => {
    try {
      if (!email.configured) throw http(503, 'Email delivery is not configured. Ask the administrator to set Brevo credentials.', 'SETUP_REQUIRED');
      const account = req.auth!.account;
      const body = parseBody(emailChangeSchema, req.body);
      const newEmail = body.newEmail.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail) || newEmail.length > 320) throw http(400, 'Enter a valid email address.', 'INVALID_EMAIL');
      if (normalizeEmail(newEmail) === account.emailNormalized) throw http(400, 'That is already your current email address.', 'SAME_EMAIL');
      const owner = await store.accounts.findOne({ emailNormalized: normalizeEmail(newEmail) });
      if (owner && owner.userId !== account.userId) throw http(409, 'That email address is unavailable.', 'EMAIL_TAKEN');
      if (account.passwordHash) {
        const ok = body.password ? await verifyCode(body.password, account.passwordHash) : false;
        if (!ok) throw http(401, 'The password is incorrect.', 'INVALID_CREDENTIALS');
      }
      const latest = await latestEmailAction(store, account.userId, 'email_change');
      if (latest && Date.now() - Date.parse(latest.createdAt) < env.emailActionResendSec * 1000) {
        throw http(429, `Wait ${env.emailActionResendSec} seconds before requesting another verification link.`, 'EMAIL_ACTION_COOLDOWN');
      }
      const issued = await issueEmailActionToken(store, {
        userId: account.userId,
        purpose: 'email_change',
        accountEmailNormalized: account.emailNormalized,
        emailNormalized: normalizeEmail(newEmail),
        targetEmail: newEmail,
      });
      try {
        await email.sendActionEmail({
          to: newEmail,
          purpose: 'email_change',
          actionUrl: issued.actionUrl,
          expiresInMin: issued.expiresInMin,
        });
      } catch (e) {
        await invalidateEmailAction(store, issued.tokenId);
        throw e;
      }
      res.status(202).json({
        ok: true,
        email: newEmail,
        expiresInMin: issued.expiresInMin,
        message: `A verification link was sent to ${newEmail}. Your current email remains active until it is opened.`,
      });
    } catch (e) {
      next(e);
    }
  });

  router.post('/delete', requireCsrf, requireRecentAuth, async (req: AuthedRequest, res, next) => {
    try {
      const account = req.auth!.account;
      const body = parseBody(deleteSchema, req.body);
      if (!account.username || body.confirmUsername !== account.username) {
        throw http(400, 'Type your exact username to confirm account deletion.', 'CONFIRMATION_MISMATCH');
      }
      if (account.passwordHash) {
        const ok = body.password ? await verifyCode(body.password, account.passwordHash) : false;
        if (!ok) throw http(401, 'The password is incorrect.', 'INVALID_CREDENTIALS');
      } else if (!isRecentAuth(req.auth!.session)) {
        throw http(403, 'Sign in with Google again before deleting this account.', 'REAUTH_REQUIRED');
      }
      await store.accounts.updateOne({ userId: account.userId }, { $set: { status: 'deleting', updatedAt: new Date().toISOString() } });
      try {
        await deleteAllUserData(store, account.userId);
        await store.sessions.deleteMany({ userId: account.userId });
        await store.accounts.deleteOne({ userId: account.userId });
      } catch (e) {
        // Roll back the deletion marker so the still-signed-in owner can retry.
        await store.accounts.updateOne({ userId: account.userId }, { $set: { status: 'active', updatedAt: new Date().toISOString() } });
        throw e;
      }
      clearSessionCookie(res);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return router;
}

/**
 * Extract the learning-data object from an export/backup envelope. A payload
 * that only carries metadata (version/timestamp) must never be treated as an
 * empty state, because that would silently replace the account with defaults.
 */
function extractBackupState(raw: unknown, backup: unknown): unknown {
  const candidate = raw as any;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw http(400, 'The backup payload is invalid.', 'INVALID_BACKUP');
  }
  const version = candidate.version ?? candidate.schemaVersion ?? (backup as any)?.version;
  if (version !== undefined && (!Number.isInteger(version) || version < 1 || version > 3)) {
    throw http(400, 'Unsupported backup version.', 'INVALID_BACKUP');
  }
  const state = candidate.state ?? candidate.data ?? candidate;
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw http(400, 'The backup has no learning data.', 'INVALID_BACKUP');
  }
  if (!USER_COLLECTIONS.some((name) => Object.prototype.hasOwnProperty.call(state, name))) {
    throw http(400, 'The backup has no recognizable learning-data collections.', 'INVALID_BACKUP');
  }
  return state;
}

export { setAccountPassword, hashCode };
export type { UserState };
