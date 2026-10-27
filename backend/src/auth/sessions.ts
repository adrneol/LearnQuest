import { randomUUID } from 'node:crypto';
import type { DataStore } from '../store.js';
import { env } from '../config/env.js';
import { csrfToken, randomToken, safeEqual, sessionTokenHash } from './crypto.js';

export type SessionAuthMethod = 'password' | 'google_login' | 'google_register';

export interface SessionRecord {
  _id?: unknown;
  sessionId: string;
  userId: string;
  tokenHash: string;
  csrfToken: string;
  authMethod: SessionAuthMethod;
  /** Only for a short-lived Google registration onboarding session. */
  onboardingExpiresAt: string | null;
  onboardingGoogleSub: string | null;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  expiresAt: string;
  revokedAt: string | null;
  reauthenticatedAt: string;
  userAgent: string;
  ipHash: string;
}

export interface SessionOptions {
  userAgent?: string;
  ipHash?: string;
  authMethod?: SessionAuthMethod;
  onboardingExpiresAt?: string | null;
  onboardingGoogleSub?: string | null;
}

export interface CreatedSession {
  token: string;
  session: SessionRecord;
  maxAgeSec: number;
}

const MAX_USER_AGENT = 300;

export function sessionMaxAgeSec(): number {
  return env.sessionAbsoluteDays * 24 * 3600;
}

export async function createSession(
  store: DataStore,
  userId: string,
  opts?: SessionOptions,
): Promise<CreatedSession> {
  if (!env.sessionConfigured) throw Object.assign(new Error('Session configuration is incomplete.'), { status: 503, code: 'SETUP_REQUIRED' });
  const token = randomToken(32);
  const now = Date.now();
  const absolute = now + sessionMaxAgeSec() * 1000;
  const idle = now + env.sessionIdleHours * 3600 * 1000;
  const session: SessionRecord = {
    sessionId: randomUUID(),
    userId,
    tokenHash: sessionTokenHash(token),
    csrfToken: csrfToken(),
    authMethod: opts?.authMethod ?? 'password',
    onboardingExpiresAt: opts?.onboardingExpiresAt ?? null,
    onboardingGoogleSub: opts?.onboardingGoogleSub ?? null,
    createdAt: new Date(now).toISOString(),
    lastSeenAt: new Date(now).toISOString(),
    idleExpiresAt: new Date(idle).toISOString(),
    expiresAt: new Date(absolute).toISOString(),
    revokedAt: null,
    reauthenticatedAt: new Date(now).toISOString(),
    userAgent: (opts?.userAgent ?? '').slice(0, MAX_USER_AGENT),
    ipHash: opts?.ipHash ?? '',
  };
  await store.sessions.insertOne(session);
  return { token, session, maxAgeSec: sessionMaxAgeSec() };
}

export async function findSessionByToken(store: DataStore, token: string): Promise<SessionRecord | null> {
  if (!token || !env.sessionConfigured) return null;
  const hash = sessionTokenHash(token);
  const doc = (await store.sessions.findOne({ tokenHash: hash, revokedAt: null })) as SessionRecord | null;
  if (!doc) return null;
  const now = Date.now();
  if (Date.parse(doc.expiresAt) <= now || Date.parse(doc.idleExpiresAt) <= now) {
    await store.sessions.updateOne({ sessionId: doc.sessionId }, { $set: { revokedAt: new Date(now).toISOString() } });
    return null;
  }
  return doc;
}

/** Refresh idle expiry and last-seen; absolute expiry never extends. */
export async function touchSession(store: DataStore, session: SessionRecord): Promise<SessionRecord> {
  const now = Date.now();
  const idle = new Date(Math.min(now + env.sessionIdleHours * 3600 * 1000, Date.parse(session.expiresAt))).toISOString();
  const lastSeenAt = new Date(now).toISOString();
  await store.sessions.updateOne({ sessionId: session.sessionId }, { $set: { lastSeenAt, idleExpiresAt: idle } });
  return { ...session, lastSeenAt, idleExpiresAt: idle };
}

export async function rotateSession(
  store: DataStore,
  oldToken: string | null,
  userId: string,
  opts?: SessionOptions,
): Promise<CreatedSession> {
  if (oldToken) {
    await revokeSession(store, oldToken);
  }
  return createSession(store, userId, opts);
}

export async function revokeSession(store: DataStore, rawToken: string): Promise<boolean> {
  if (!rawToken || !env.sessionConfigured) return false;
  const r = await store.sessions.updateOne(
    { tokenHash: sessionTokenHash(rawToken), revokedAt: null },
    { $set: { revokedAt: new Date().toISOString() } },
  );
  return r.matchedCount > 0;
}

export async function revokeSessionById(store: DataStore, userId: string, sessionId: string): Promise<boolean> {
  const r = await store.sessions.updateOne(
    { userId, sessionId, revokedAt: null },
    { $set: { revokedAt: new Date().toISOString() } },
  );
  return r.matchedCount > 0;
}

export async function revokeAllSessions(store: DataStore, userId: string, exceptSessionId?: string): Promise<number> {
  const filter: Record<string, unknown> = { userId, revokedAt: null };
  if (exceptSessionId) filter.sessionId = { $ne: exceptSessionId };
  const active = await store.sessions.find(filter);
  for (const s of active) {
    await store.sessions.updateOne({ sessionId: s.sessionId }, { $set: { revokedAt: new Date().toISOString() } });
  }
  return active.length;
}

export async function listSessions(store: DataStore, userId: string) {
  const rows = (await store.sessions.find({ userId, revokedAt: null }, { sort: { lastSeenAt: -1 }, limit: 50 })) as SessionRecord[];
  const now = Date.now();
  return rows
    .filter((s) => Date.parse(s.expiresAt) > now && Date.parse(s.idleExpiresAt) > now)
    .map((s) => ({
      sessionId: s.sessionId,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      idleExpiresAt: s.idleExpiresAt,
      expiresAt: s.expiresAt,
      userAgent: s.userAgent,
      current: false,
    }));
}

export async function markReauthenticated(store: DataStore, sessionId: string): Promise<void> {
  await store.sessions.updateOne(
    { sessionId },
    { $set: { reauthenticatedAt: new Date().toISOString() } },
  );
}

export function isRecentAuth(session: SessionRecord): boolean {
  return Date.now() - Date.parse(session.reauthenticatedAt) <= env.reauthWindowMin * 60_000;
}

/**
 * Onboarding is only possible during the short-lived server-side Google
 * registration session that created the pending account. The Google subject is
 * stored on both the account and the session and must match.
 */
export function isGoogleOnboardingSession(session: SessionRecord, googleSub: string | null): boolean {
  if (!googleSub || session.authMethod !== 'google_register') return false;
  if (session.onboardingGoogleSub !== googleSub) return false;
  if (!session.onboardingExpiresAt) return false;
  return Date.parse(session.onboardingExpiresAt) > Date.now();
}

export function verifyCsrf(session: SessionRecord, headerValue: string | undefined): boolean {
  if (!headerValue) return false;
  return safeEqual(session.csrfToken, headerValue);
}
