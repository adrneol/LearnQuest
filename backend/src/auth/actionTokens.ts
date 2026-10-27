import { randomUUID } from 'node:crypto';
import type { DataStore } from '../store.js';
import { env } from '../config/env.js';
import { hmacHex, randomToken } from './crypto.js';

/**
 * Opaque, single-use email action tokens.
 *
 * Only an HMAC digest is persisted. The raw token exists only in the email
 * link and the request that consumes it. Tokens are purpose-bound, bound to
 * the account and (where relevant) to the email address that was verified when
 * the link was issued, and expire quickly.
 */
export type EmailActionPurpose = 'password_reset' | 'email_change';

export interface EmailActionTokenRecord {
  _id?: unknown;
  tokenId: string;
  tokenHash: string;
  userId: string;
  purpose: EmailActionPurpose;
  /** Account email at issue time; prevents use after an email change. */
  accountEmailNormalized: string;
  /** Reset: account email. Email change: the new address being verified. */
  emailNormalized: string;
  targetEmail: string;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
  lastSentAt: string;
}

export interface IssuedEmailActionToken {
  token: string;
  tokenId: string;
  expiresAt: string;
  expiresInMin: number;
  actionUrl: string;
}

export function emailActionUrl(token: string, purpose: EmailActionPurpose): string {
  const route = purpose === 'password_reset' ? 'reset-password' : 'verify-email';
  return `${env.appOrigin}/#/${route}?token=${encodeURIComponent(token)}`;
}

// Serialize link issuance for one account/purpose in this process. The
// database compare-and-set remains the cross-instance authority, but this
// prevents two concurrent requests in one instance from leaving two active
// links because both invalidated the same prior snapshot.
const issueLocks = new Map<string, Promise<unknown>>();

async function withIssueLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = issueLocks.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  issueLocks.set(key, next);
  try {
    return await next;
  } finally {
    if (issueLocks.get(key) === next) issueLocks.delete(key);
  }
}

function requireSecret(): string {
  const secret = env.emailActionHmacSecret;
  if (!secret) {
    throw Object.assign(new Error('Email action token configuration is incomplete.'), { status: 503, code: 'SETUP_REQUIRED' });
  }
  return secret;
}

/** HMAC digest, never the raw token. The purpose is part of the lookup. */
export function actionTokenDigest(token: string): string {
  return hmacHex(requireSecret(), `email-action:${token}`);
}

export async function latestEmailAction(
  store: DataStore,
  userId: string,
  purpose: EmailActionPurpose,
): Promise<EmailActionTokenRecord | null> {
  const rows = (await store.actionTokens.find(
    { userId, purpose },
    { sort: { createdAt: -1 }, limit: 1 },
  )) as EmailActionTokenRecord[];
  return rows[0] ?? null;
}

export async function issueEmailActionToken(
  store: DataStore,
  input: {
    userId: string;
    purpose: EmailActionPurpose;
    accountEmailNormalized: string;
    emailNormalized: string;
    targetEmail: string;
  },
): Promise<IssuedEmailActionToken> {
  requireSecret();
  return withIssueLock(`${input.userId}:${input.purpose}`, async () => {
    const now = Date.now();
    // Invalidate every outstanding link for this account and purpose. A person
    // may have requested a new link because the first did not arrive; old links
    // must not remain usable.
    const prior = (await store.actionTokens.find({
      userId: input.userId,
      purpose: input.purpose,
      consumedAt: null,
    })) as EmailActionTokenRecord[];
    for (const row of prior) {
      await store.actionTokens.updateOne(
        { tokenId: row.tokenId, consumedAt: null },
        { $set: { consumedAt: new Date(now).toISOString() } },
      );
    }

    const token = randomToken(32);
    const tokenId = randomUUID();
    const expiresInMin = env.emailActionTtlMin;
    const expiresAt = new Date(now + expiresInMin * 60_000).toISOString();
    const record: EmailActionTokenRecord = {
      tokenId,
      tokenHash: actionTokenDigest(token),
      userId: input.userId,
      purpose: input.purpose,
      accountEmailNormalized: input.accountEmailNormalized,
      emailNormalized: input.emailNormalized,
      targetEmail: input.targetEmail,
      createdAt: new Date(now).toISOString(),
      expiresAt,
      consumedAt: null,
      lastSentAt: new Date(now).toISOString(),
    };
    await store.actionTokens.insertOne(record);
    return {
      token,
      tokenId,
      expiresAt,
      expiresInMin,
      actionUrl: emailActionUrl(token, input.purpose),
    };
  });
}

/**
 * Atomic single-use consumption. Concurrent requests can never both receive
 * the record: the database compare-and-set is the authority.
 */
export async function consumeEmailActionToken(
  store: DataStore,
  rawToken: unknown,
  purpose: EmailActionPurpose,
): Promise<EmailActionTokenRecord | null> {
  if (typeof rawToken !== 'string' || rawToken.length < 20 || rawToken.length > 512) return null;
  const now = new Date().toISOString();
  const record = await store.actionTokens.findOneAndUpdate(
    {
      tokenHash: actionTokenDigest(rawToken),
      purpose,
      consumedAt: null,
      expiresAt: { $gt: now },
    },
    { $set: { consumedAt: now } },
  );
  return (record as EmailActionTokenRecord | null) ?? null;
}

export async function invalidateEmailAction(
  store: DataStore,
  tokenId: string,
): Promise<void> {
  await store.actionTokens.updateOne(
    { tokenId, consumedAt: null },
    { $set: { consumedAt: new Date().toISOString() } },
  );
}
