import { randomUUID } from 'node:crypto';
import type { DataStore } from '../store.js';
import { env } from '../config/env.js';
import { generateOtp, hmacHex, randomToken, safeEqual, sha256 } from './crypto.js';

export type OtpPurpose = 'password_reset' | 'email_change';

export interface ChallengeRecord {
  _id?: unknown;
  challengeId: string;
  userId: string;
  purpose: OtpPurpose;
  emailNormalized: string;
  targetEmail: string;
  digest: string;
  createdAt: string;
  expiresAt: string;
  attempts: number;
  maxAttempts: number;
  consumedAt: string | null;
  lastSentAt: string;
}

export interface IssuedChallenge {
  challengeId: string;
  code: string;
  expiresAt: string;
  expiresInMin: number;
}

function otpDigest(challengeId: string, userId: string, purpose: string, emailNormalized: string, code: string): string {
  if (!env.otpConfigured) throw Object.assign(new Error('OTP_HMAC_SECRET is not configured.'), { status: 503, code: 'SETUP_REQUIRED' });
  return hmacHex(env.otpHmacSecret, `${challengeId}:${purpose}:${userId}:${emailNormalized}:${code}`);
}

export async function issueChallenge(
  store: DataStore,
  input: { userId: string; purpose: OtpPurpose; emailNormalized: string; targetEmail: string },
): Promise<IssuedChallenge> {
  if (!env.otpConfigured) throw Object.assign(new Error('OTP configuration is incomplete.'), { status: 503, code: 'SETUP_REQUIRED' });
  const now = Date.now();
  const prior = await store.challenges.find({ userId: input.userId, purpose: input.purpose, consumedAt: null });
  for (const p of prior) {
    await store.challenges.updateOne({ challengeId: p.challengeId }, { $set: { consumedAt: new Date(now).toISOString() } });
  }
  const challengeId = randomUUID();
  const code = generateOtp();
  const expiresAt = new Date(now + env.otpTtlMin * 60_000).toISOString();
  const record: ChallengeRecord = {
    challengeId,
    userId: input.userId,
    purpose: input.purpose,
    emailNormalized: input.emailNormalized,
    targetEmail: input.targetEmail,
    digest: otpDigest(challengeId, input.userId, input.purpose, input.emailNormalized, code),
    createdAt: new Date(now).toISOString(),
    expiresAt,
    attempts: 0,
    maxAttempts: env.otpMaxAttempts,
    consumedAt: null,
    lastSentAt: new Date(now).toISOString(),
  };
  await store.challenges.insertOne(record);
  return { challengeId, code, expiresAt, expiresInMin: env.otpTtlMin };
}

export interface VerifyResult {
  ok: boolean;
  reason?: 'not_found' | 'expired' | 'used' | 'too_many_attempts' | 'invalid_code' | 'wrong_purpose';
  challenge?: ChallengeRecord;
}

export async function verifyChallenge(
  store: DataStore,
  input: { challengeId: unknown; purpose: OtpPurpose; code: unknown },
): Promise<VerifyResult> {
  const challengeId = typeof input.challengeId === 'string' ? input.challengeId : '';
  const code = typeof input.code === 'string' ? input.code.trim() : '';
  if (!challengeId || !/^\d{6}$/.test(code)) return { ok: false, reason: 'not_found' };
  const challenge = (await store.challenges.findOne({ challengeId })) as ChallengeRecord | null;
  if (!challenge) return { ok: false, reason: 'not_found' };
  if (challenge.purpose !== input.purpose) return { ok: false, reason: 'wrong_purpose' };
  if (challenge.consumedAt) return { ok: false, reason: 'used' };
  const now = Date.now();
  if (Date.parse(challenge.expiresAt) <= now) return { ok: false, reason: 'expired' };
  if (challenge.attempts >= challenge.maxAttempts) return { ok: false, reason: 'too_many_attempts' };

  const expected = otpDigest(challenge.challengeId, challenge.userId, challenge.purpose, challenge.emailNormalized, code);
  if (!safeEqual(expected, challenge.digest)) {
    await store.challenges.updateOne(
      { challengeId: challenge.challengeId, consumedAt: null },
      { $inc: { attempts: 1 }, $set: { lastAttemptAt: new Date(now).toISOString() } },
    );
    return { ok: false, reason: 'invalid_code' };
  }
  // Atomic single use: concurrent requests cannot both consume the code.
  const consumed = await store.challenges.findOneAndUpdate(
    { challengeId: challenge.challengeId, consumedAt: null, attempts: { $lt: challenge.maxAttempts } },
    { $set: { consumedAt: new Date(now).toISOString() } },
  );
  if (!consumed) return { ok: false, reason: 'used' };
  return { ok: true, challenge: consumed as ChallengeRecord };
}

export interface ResetGrant {
  grantId: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

function grantHash(token: string): string {
  if (!env.sessionConfigured) throw Object.assign(new Error('SESSION_SECRET is not configured.'), { status: 503, code: 'SETUP_REQUIRED' });
  return hmacHex(env.sessionSecret, `reset-grant:${token}`);
}

export async function issueResetGrant(store: DataStore, userId: string): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken(32);
  const now = Date.now();
  const expiresAt = new Date(now + 10 * 60_000).toISOString();
  const grant: ResetGrant = {
    grantId: randomUUID(),
    userId,
    tokenHash: grantHash(token),
    createdAt: new Date(now).toISOString(),
    expiresAt,
    consumedAt: null,
  };
  await store.resetGrants.insertOne(grant);
  return { token, expiresAt };
}

export async function consumeResetGrant(store: DataStore, token: unknown): Promise<ResetGrant | null> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const tokenHash = grantHash(token);
  const doc = (await store.resetGrants.findOne({ tokenHash, consumedAt: null })) as ResetGrant | null;
  if (!doc || Date.parse(doc.expiresAt) <= Date.now()) return null;
  const consumed = await store.resetGrants.findOneAndUpdate(
    { grantId: doc.grantId, consumedAt: null },
    { $set: { consumedAt: new Date().toISOString() } },
  );
  return consumed ? (consumed as ResetGrant) : null;
}

export function challengeTargetMatches(challenge: ChallengeRecord, emailNormalized: string): boolean {
  return safeEqual(challenge.emailNormalized, emailNormalized);
}

export function debugChallengeFingerprint(challenge: ChallengeRecord): string {
  // Ops-safe fingerprint only; never the digest or code.
  return sha256(`${challenge.challengeId}:${challenge.purpose}`).slice(0, 12);
}
