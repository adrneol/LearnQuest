import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../config/env.js';
import type { DataStore } from '../store.js';
import { randomToken, sha256 } from './crypto.js';
import { publicGoogleIdentityFromClaims } from './accounts.js';

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

export type GoogleAuthIntent = 'login' | 'register';

export interface GoogleOAuthResult {
  identity: GoogleIdentity;
  intent: GoogleAuthIntent;
}

export interface GoogleOAuthService {
  readonly configured: boolean;
  /**
   * `browserBinding` is a high-entropy value held only in a short-lived
   * HttpOnly cookie. Only its SHA-256 digest is stored with the state.
   */
  start(intent: GoogleAuthIntent, userId: string | null, browserBinding: string): Promise<{ url: string; state: string }>;
  complete(code: string, state: string, browserBinding: string): Promise<GoogleOAuthResult>;
}

interface GoogleStateDoc {
  _id?: unknown;
  stateHash: string;
  /** Digest of the initiating browser's HttpOnly flow cookie. */
  browserHash: string;
  nonce: string;
  verifier: string;
  intent: GoogleAuthIntent;
  /** Optional owner link for cascade deletion; never a credential. */
  userId?: string;
  createdAt: string;
  expiresAt: string;
  /** BSON Date used by the MongoDB TTL index. */
  expireAt?: Date;
  usedAt: string | null;
}

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

function base64urlSha256(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

/** Extra checks after jose validates signature, issuer, audience, and expiry. */
export function validateGoogleClaims(
  claims: Record<string, unknown>,
  expected: { nonce: string; clientId: string },
): GoogleIdentity {
  if (claims.aud !== expected.clientId && !(Array.isArray(claims.aud) && claims.aud.includes(expected.clientId))) {
    throw Object.assign(new Error('Google token audience mismatch.'), { status: 401, code: 'INVALID_GOOGLE_TOKEN' });
  }
  const issuer = String(claims.iss ?? '');
  if (!GOOGLE_ISSUERS.includes(issuer)) {
    throw Object.assign(new Error('Google token issuer mismatch.'), { status: 401, code: 'INVALID_GOOGLE_TOKEN' });
  }
  if (typeof claims.nonce !== 'string' || claims.nonce !== expected.nonce) {
    throw Object.assign(new Error('Google token nonce mismatch.'), { status: 401, code: 'INVALID_GOOGLE_TOKEN' });
  }
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) {
    throw Object.assign(new Error('Google token has expired.'), { status: 401, code: 'INVALID_GOOGLE_TOKEN' });
  }
  const identity = publicGoogleIdentityFromClaims(claims);
  if (!identity.emailVerified) {
    throw Object.assign(new Error('Google did not confirm a verified email address.'), { status: 403, code: 'EMAIL_NOT_VERIFIED' });
  }
  return identity;
}

export function createGoogleOAuthService(store: DataStore, deps?: {
  fetchImpl?: typeof fetch;
  verifyIdToken?: (idToken: string, expected: { nonce: string; clientId: string }) => Promise<GoogleIdentity>;
}): GoogleOAuthService {
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const verify = deps?.verifyIdToken ?? (async (idToken, expected) => {
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer: GOOGLE_ISSUERS,
      audience: expected.clientId,
      clockTolerance: 30,
    });
    return validateGoogleClaims(payload as Record<string, unknown>, expected);
  });

  return {
    get configured() {
      return env.googleConfigured;
    },
    async start(intent, userId, browserBinding) {
      if (!env.googleConfigured) {
        throw Object.assign(new Error('Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.'), { status: 503, code: 'SETUP_REQUIRED' });
      }
      if (intent !== 'login' && intent !== 'register') {
        throw Object.assign(new Error('Choose whether to sign in or create an account.'), { status: 400, code: 'INVALID_OAUTH_INTENT' });
      }
      if (typeof browserBinding !== 'string' || browserBinding.length < 32 || browserBinding.length > 512) {
        throw Object.assign(new Error('The Google sign-in browser binding is missing. Start again.'), { status: 400, code: 'INVALID_OAUTH_BINDING' });
      }
      const state = randomToken(32);
      const nonce = randomToken(24);
      const verifier = randomToken(48);
      const now = Date.now();
      const doc: GoogleStateDoc = {
        stateHash: sha256(state),
        browserHash: sha256(browserBinding),
        nonce,
        verifier,
        intent,
        ...(userId ? { userId } : {}),
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 10 * 60_000).toISOString(),
        expireAt: new Date(now + 10 * 60_000),
        usedAt: null,
      };
      await store.oauthStates.insertOne(doc);
      const params = new URLSearchParams({
        client_id: env.googleClientId,
        redirect_uri: env.googleRedirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        nonce,
        code_challenge: base64urlSha256(verifier),
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      return { url: `${GOOGLE_AUTH_URL}?${params.toString()}`, state };
    },
    async complete(code, state, browserBinding) {
      if (!env.googleConfigured) {
        throw Object.assign(new Error('Google sign-in is not configured.'), { status: 503, code: 'SETUP_REQUIRED' });
      }
      if (!code || !state || !browserBinding || code.length > 4096 || state.length > 512 || browserBinding.length > 512) {
        throw Object.assign(new Error('The Google sign-in response is incomplete.'), { status: 400, code: 'INVALID_OAUTH_CALLBACK' });
      }
      const now = new Date().toISOString();
      // Single-use state: consume atomically before exchanging the code. The
      // state is valid only in the browser that received the binding cookie;
      // a state copied to another browser cannot match the stored digest.
      const record = await store.oauthStates.findOneAndUpdate(
        {
          stateHash: sha256(state),
          browserHash: sha256(browserBinding),
          usedAt: null,
          expiresAt: { $gt: now },
        },
        { $set: { usedAt: now } },
      ) as GoogleStateDoc | null;
      if (!record) {
        throw Object.assign(new Error('This Google sign-in request is invalid, expired, or already used. Start again.'), { status: 400, code: 'INVALID_OAUTH_STATE' });
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10_000);
      let tokenResponse: any;
      try {
        const res = await fetchImpl(GOOGLE_TOKEN_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
          body: new URLSearchParams({
            code,
            client_id: env.googleClientId,
            client_secret: env.googleClientSecret,
            redirect_uri: env.googleRedirectUri,
            grant_type: 'authorization_code',
            code_verifier: record.verifier,
          }).toString(),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          throw Object.assign(new Error('Google rejected the sign-in exchange. Start again.'), { status: 401, code: 'GOOGLE_EXCHANGE_FAILED' });
        }
        tokenResponse = await res.json();
      } catch (e: any) {
        if (e?.name === 'AbortError') throw Object.assign(new Error('Google sign-in timed out. Try again.'), { status: 504, code: 'GOOGLE_TIMEOUT' });
        if (e?.status) throw e;
        throw Object.assign(new Error('Google sign-in could not be reached. Try again.'), { status: 502, code: 'GOOGLE_UNAVAILABLE' });
      } finally {
        clearTimeout(timer);
      }
      if (!tokenResponse || typeof tokenResponse.id_token !== 'string') {
        throw Object.assign(new Error('Google did not return an identity token.'), { status: 401, code: 'INVALID_GOOGLE_TOKEN' });
      }
      try {
        const identity = await verify(tokenResponse.id_token, { nonce: record.nonce, clientId: env.googleClientId });
        // State documents created by an older deployment have no intent. They
        // are treated as login, never as implicit registration.
        const intent: GoogleAuthIntent = record.intent === 'register' ? 'register' : 'login';
        return { identity, intent };
      } catch (e: any) {
        if (e?.status) throw e;
        throw Object.assign(new Error('Google identity token validation failed.'), { status: 401, code: 'INVALID_GOOGLE_TOKEN' });
      }
    },
  };
}
