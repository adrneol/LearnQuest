import { randomBytes, timingSafeEqual, createHash, createHmac } from 'node:crypto';
import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';
import { env } from '../config/env.js';

/** Opaque, URL-safe random token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hmacHex(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value, 'utf8').digest('hex');
}

/** Constant-time string compare that does not throw on length mismatch. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Still do one comparison to keep the path roughly uniform; return false.
    try { timingSafeEqual(ab, ab); } catch { /* ignore */ }
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** Argon2id with a versioned PHC hash string stored in the account record. */
export async function hashCode(password: string): Promise<string> {
  return argonHash(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
  });
}

export async function verifyCode(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash) return false;
  try {
    return await argonVerify(storedHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | null = null;

/**
 * Verify against a dummy hash when the account does not exist so password
 * login timing does not reveal registration state.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  if (!dummyHash) dummyHash = hashCode('learnquest-dummy-password-not-an-account');
  await verifyCode(password, await dummyHash);
}

export function sessionTokenHash(token: string): string {
  if (!env.sessionSecret) throw new Error('SESSION_SECRET is not configured.');
  return hmacHex(env.sessionSecret, `session:${token}`);
}

export function csrfToken(): string {
  return randomToken(24);
}

export function cookieHeader(token: string | null, maxAgeSec: number): string {
  const name = env.sessionCookieName;
  const age = Math.max(0, Math.floor(maxAgeSec));
  const parts = [
    `${name}=${token ?? ''}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${age}`,
    // Explicit Expires makes deletion immediate even in clients that ignore
    // Max-Age. No Domain attribute: __Host- requires host-only scope.
    `Expires=${age === 0 ? 'Thu, 01 Jan 1970 00:00:00 GMT' : new Date(Date.now() + age * 1000).toUTCString()}`,
  ];
  if (env.cookieSecure) parts.push('Secure');
  return parts.join('; ');
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export function normalizeEmail(value: string): string {
  return value.trim().normalize('NFKC').toLowerCase();
}

export function normalizeUsername(value: string): string {
  return value.trim().normalize('NFKC').toLowerCase();
}
