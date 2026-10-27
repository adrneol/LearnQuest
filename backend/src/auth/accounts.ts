import { randomUUID } from 'node:crypto';
import type { DataStore } from '../store.js';
import { normalizeEmail, normalizeUsername } from './crypto.js';

export interface Account {
  _id?: unknown;
  userId: string;
  googleSub: string | null;
  email: string;
  emailNormalized: string;
  username: string | null;
  usernameNormalized: string | null;
  displayName: string | null;
  passwordHash: string | null;
  passwordVersion: number;
  onboardingComplete: boolean;
  status: 'active' | 'deleting';
  timezone: string;
  sessionLenMin: number;
  breakMin: number;
  minViableMin: number;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  passwordChangedAt: string | null;
  emailChangedAt: string | null;
}

export interface SafeAccount {
  userId: string;
  email: string;
  username: string | null;
  displayName: string | null;
  onboardingComplete: boolean;
  timezone: string;
  sessionLenMin: number;
  breakMin: number;
  minViableMin: number;
  createdAt: string;
  hasPassword: boolean;
  googleLinked: boolean;
}

export function safeAccount(account: Account): SafeAccount {
  return {
    userId: account.userId,
    email: account.email,
    username: account.username,
    displayName: account.displayName,
    onboardingComplete: account.onboardingComplete,
    timezone: account.timezone,
    sessionLenMin: account.sessionLenMin,
    breakMin: account.breakMin,
    minViableMin: account.minViableMin,
    createdAt: account.createdAt,
    hasPassword: Boolean(account.passwordHash),
    googleLinked: Boolean(account.googleSub),
  };
}

export function validateUsername(value: unknown): string {
  if (typeof value !== 'string') throw http(400, 'Choose a username.', 'INVALID_USERNAME');
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$/.test(trimmed)) {
    throw http(400, 'Username must be 3-32 characters: letters, digits, underscore, dot, or hyphen; it must start with a letter or digit.', 'INVALID_USERNAME');
  }
  return trimmed;
}

export function validateDisplayName(value: unknown): string {
  if (typeof value !== 'string') throw http(400, 'Enter a display name.', 'INVALID_DISPLAY_NAME');
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 80) throw http(400, 'Display name must be 1-80 characters.', 'INVALID_DISPLAY_NAME');
  return trimmed;
}

export function validatePassword(value: unknown): string {
  if (typeof value !== 'string') throw http(400, 'Enter a password.', 'INVALID_PASSWORD');
  if (value.length < 12) throw http(400, 'Password must be at least 12 characters. A long passphrase is ideal.', 'WEAK_PASSWORD');
  if (value.length > 128) throw http(400, 'Password must be at most 128 characters.', 'INVALID_PASSWORD');
  return value;
}

export function validateTimezone(value: unknown): string {
  if (typeof value !== 'string' || value.length > 100) throw http(400, 'Select a valid display timezone.', 'INVALID_TIMEZONE');
  const tz = value.trim();
  if (tz === 'local') return tz;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    throw http(400, 'Select a valid IANA timezone.', 'INVALID_TIMEZONE');
  }
}

/**
 * A password reset is only meaningful for an account that finished
 * registration. Pending Google registrations have no password yet and would be
 * able to skip the onboarding step if they could consume a reset link.
 *
 * Every account email is verified by construction: Google registration stores
 * an address only after Google reports it verified, and email changes require
 * confirmation from the new address. There is deliberately no "resend to a
 * client-supplied address" path.
 */
export function isPasswordResetEligible(account: Account | null): account is Account {
  return Boolean(
    account
    && account.status === 'active'
    && account.onboardingComplete
    && account.email
    && account.emailNormalized
    && normalizeEmail(account.email) === account.emailNormalized,
  );
}

export function http(status: number, message: string, code?: string): Error & { status: number; code?: string } {
  return Object.assign(new Error(message), { status, code });
}

function isDuplicateKey(e: any): boolean {
  return e?.code === 11000 || /duplicate key/i.test(String(e?.message ?? ''));
}

// In-process serialization for single-instance deployments; MongoDB unique
// indexes are the cross-instance guarantee.
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  locks.set(key, next);
  try {
    return await next;
  } finally {
    if (locks.get(key) === next) locks.delete(key);
  }
}

export async function findAccountById(store: DataStore, userId: string): Promise<Account | null> {
  return (await store.accounts.findOne({ userId })) as Account | null;
}

export async function findAccountByGoogleSub(store: DataStore, sub: string): Promise<Account | null> {
  if (!sub) return null;
  return (await store.accounts.findOne({ googleSub: sub })) as Account | null;
}

export async function findAccountByIdentifier(store: DataStore, identifier: string): Promise<Account | null> {
  const trimmed = identifier.trim();
  if (!trimmed || trimmed.length > 320) return null;
  const email = normalizeEmail(trimmed);
  const username = normalizeUsername(trimmed);
  const [byEmail, byUsername] = await Promise.all([
    store.accounts.findOne({ emailNormalized: email }),
    store.accounts.findOne({ usernameNormalized: username }),
  ]);
  return (byEmail ?? byUsername) as Account | null;
}

export async function createAccountFromGoogle(
  store: DataStore,
  identity: { sub: string; email: string; emailVerified: boolean; name?: string },
): Promise<Account> {
  if (!identity.emailVerified) throw http(403, 'Google did not confirm a verified email address for this account.', 'EMAIL_NOT_VERIFIED');
  const emailNormalized = normalizeEmail(identity.email);
  return withLock(`google:${identity.sub}`, async () => {
    const existing = await store.accounts.findOne({ googleSub: identity.sub });
    if (existing) {
      if ((existing as Account).status === 'deleting') throw http(403, 'This account is being deleted.', 'ACCOUNT_DELETING');
      return existing as Account;
    }
    const emailOwner = await store.accounts.findOne({ emailNormalized });
    if (emailOwner) {
      // Never auto-link by email string. The owner must explicitly link from a
      // signed-in session if linking is added later.
      throw http(409, 'An account with this email already exists but is not linked to this Google identity. Sign in to the existing account, or contact support for a safe link flow.', 'LINK_REQUIRED');
    }
    const now = new Date().toISOString();
    const account: Account = {
      userId: randomUUID(),
      googleSub: identity.sub,
      email: identity.email.trim(),
      emailNormalized,
      username: null,
      usernameNormalized: null,
      displayName: identity.name?.trim().slice(0, 80) || null,
      passwordHash: null,
      passwordVersion: 0,
      onboardingComplete: false,
      status: 'active',
      timezone: 'local',
      sessionLenMin: 25,
      breakMin: 5,
      minViableMin: 10,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
      passwordChangedAt: null,
      emailChangedAt: null,
    };
    try {
      await store.accounts.insertOne(account);
      return account;
    } catch (e) {
      if (isDuplicateKey(e)) {
        const raced = (await store.accounts.findOne({ googleSub: identity.sub })) as Account | null;
        if (raced) return raced;
      }
      throw e;
    }
  });
}

export async function completeOnboarding(
  store: DataStore,
  account: Account,
  input: { username: unknown; displayName: unknown; password: unknown; timezone?: unknown; sessionLenMin?: unknown; breakMin?: unknown; minViableMin?: unknown },
  passwordHash: string,
): Promise<Account> {
  const username = validateUsername(input.username);
  const displayName = validateDisplayName(input.displayName);
  const usernameNormalized = normalizeUsername(username);
  const timezone = input.timezone === undefined ? account.timezone : validateTimezone(input.timezone);
  const sessionLenMin = input.sessionLenMin === undefined ? account.sessionLenMin : boundedInt(input.sessionLenMin, 1, 600, 'session length');
  const breakMin = input.breakMin === undefined ? account.breakMin : boundedInt(input.breakMin, 0, 240, 'break length');
  const minViableMin = input.minViableMin === undefined ? account.minViableMin : boundedInt(input.minViableMin, 1, 600, 'minimum viable session');
  return withLock(`username:${usernameNormalized}`, async () => {
    const owner = await store.accounts.findOne({ usernameNormalized });
    if (owner && owner.userId !== account.userId) throw http(409, 'That username is already taken. Choose another.', 'USERNAME_TAKEN');
    const now = new Date().toISOString();
    const updated: Account = {
      ...account,
      username,
      usernameNormalized,
      displayName,
      passwordHash,
      passwordVersion: (account.passwordVersion ?? 0) + 1,
      onboardingComplete: true,
      timezone,
      sessionLenMin,
      breakMin,
      minViableMin,
      updatedAt: now,
      passwordChangedAt: now,
    };
    // Never spread the whole account into $set: a MongoDB document read from
    // the driver includes the immutable `_id`, and updating that path fails
    // with "Would modify the immutable field '_id'". List only mutable fields.
    const result = await store.accounts.updateOne(
      // The onboarding predicate prevents a racing second submission from
      // overwriting an account that has already been completed.
      { userId: account.userId, status: 'active', onboardingComplete: false },
      {
        $set: {
          username: updated.username,
          usernameNormalized: updated.usernameNormalized,
          displayName: updated.displayName,
          passwordHash: updated.passwordHash,
          passwordVersion: updated.passwordVersion,
          onboardingComplete: updated.onboardingComplete,
          timezone: updated.timezone,
          sessionLenMin: updated.sessionLenMin,
          breakMin: updated.breakMin,
          minViableMin: updated.minViableMin,
          passwordChangedAt: updated.passwordChangedAt,
          updatedAt: updated.updatedAt,
        },
      },
    );
    if (result.matchedCount === 0) {
      throw http(409, 'This account is no longer available. Start registration again.', 'ACCOUNT_UNAVAILABLE');
    }
    if (result.modifiedCount === 0) {
      // A successful $set is expected to change the hash/version/timestamps.
      // No modification means the pending record changed underneath us; never
      // report setup completion when the persisted state was not confirmed.
      throw http(409, 'This account changed while setup was being saved. Reload and finish setup again.', 'ACCOUNT_CHANGED');
    }
    return updated;
  }).catch((e) => {
    // The cross-instance unique index is the final authority; report a usable
    // conflict instead of a generic 500 when two tabs race for one username.
    if (isDuplicateKey(e)) {
      throw http(409, 'That username is already taken. Choose another.', 'USERNAME_TAKEN');
    }
    throw e;
  });
}

export function boundedInt(value: unknown, min: number, max: number, label: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw http(400, `${label[0].toUpperCase()}${label.slice(1)} must be a whole number from ${min} to ${max}.`, 'INVALID_PREFERENCE');
  }
  return n;
}

export async function updateProfile(
  store: DataStore,
  account: Account,
  input: { username?: unknown; displayName?: unknown },
): Promise<Account> {
  const username = input.username === undefined ? account.username : validateUsername(input.username);
  const displayName = input.displayName === undefined ? account.displayName : validateDisplayName(input.displayName);
  const usernameNormalized = username ? normalizeUsername(username) : null;
  return withLock(`username:${usernameNormalized ?? 'none'}`, async () => {
    if (usernameNormalized) {
      const owner = await store.accounts.findOne({ usernameNormalized });
      if (owner && owner.userId !== account.userId) throw http(409, 'That username is already taken. Your other changes were not saved.', 'USERNAME_TAKEN');
    }
    const updated = { ...account, username, usernameNormalized, displayName, updatedAt: new Date().toISOString() };
    await store.accounts.updateOne(
      { userId: account.userId },
      { $set: { username: updated.username, usernameNormalized: updated.usernameNormalized, displayName: updated.displayName, updatedAt: updated.updatedAt } },
    );
    return updated;
  });
}

export async function updateAccountPreferences(
  store: DataStore,
  account: Account,
  input: { timezone?: unknown; sessionLenMin?: unknown; breakMin?: unknown; minViableMin?: unknown },
): Promise<Account> {
  const updated: Account = {
    ...account,
    timezone: input.timezone === undefined ? account.timezone : validateTimezone(input.timezone),
    sessionLenMin: input.sessionLenMin === undefined ? account.sessionLenMin : boundedInt(input.sessionLenMin, 1, 600, 'session length'),
    breakMin: input.breakMin === undefined ? account.breakMin : boundedInt(input.breakMin, 0, 240, 'break length'),
    minViableMin: input.minViableMin === undefined ? account.minViableMin : boundedInt(input.minViableMin, 1, 600, 'minimum viable session'),
    updatedAt: new Date().toISOString(),
  };
  await store.accounts.updateOne(
    { userId: account.userId },
    { $set: { timezone: updated.timezone, sessionLenMin: updated.sessionLenMin, breakMin: updated.breakMin, minViableMin: updated.minViableMin, updatedAt: updated.updatedAt } },
  );
  return updated;
}

export async function setAccountPassword(
  store: DataStore,
  account: Account,
  passwordHash: string,
  options?: { revokeMarker?: string },
): Promise<Account> {
  const now = new Date().toISOString();
  // Increment atomically. Two authorised password changes must not both write
  // the same absolute version and leave a session from the first change valid.
  const updated = await store.accounts.findOneAndUpdate(
    { userId: account.userId, status: 'active' },
    {
      $set: { passwordHash, passwordChangedAt: now, updatedAt: now },
      $inc: { passwordVersion: 1 },
    },
  ) as Account | null;
  if (!updated) {
    throw http(409, 'This account is no longer available. Nothing was changed.', 'ACCOUNT_UNAVAILABLE');
  }
  void options?.revokeMarker;
  return updated;
}

export async function setAccountEmail(store: DataStore, account: Account, email: string): Promise<Account> {
  const emailNormalized = normalizeEmail(email);
  const owner = await store.accounts.findOne({ emailNormalized });
  if (owner && owner.userId !== account.userId) throw http(409, 'That email address is unavailable.', 'EMAIL_TAKEN');
  const now = new Date().toISOString();
  const updated: Account = { ...account, email: email.trim(), emailNormalized, emailChangedAt: now, updatedAt: now };
  await store.accounts.updateOne(
    { userId: account.userId },
    { $set: { email: updated.email, emailNormalized, emailChangedAt: now, updatedAt: now } },
  );
  return updated;
}

export function publicGoogleIdentityFromClaims(claims: Record<string, unknown>): { sub: string; email: string; emailVerified: boolean; name?: string } {
  const sub = claims.sub;
  const email = claims.email;
  const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
  if (typeof sub !== 'string' || !sub || sub.length > 255) throw http(401, 'Google response is missing a stable subject identifier.', 'INVALID_GOOGLE_IDENTITY');
  if (typeof email !== 'string' || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    throw http(401, 'Google response is missing a valid email address.', 'INVALID_GOOGLE_IDENTITY');
  }
  return { sub, email, emailVerified, name: typeof claims.name === 'string' ? claims.name : undefined };
}
