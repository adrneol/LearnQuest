import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomToken } from '../src/auth/crypto.js';

/**
 * Static guardrails for credential generation. These modules are the only
 * places that may mint authentication credentials, email action links, or
 * cross-tab authentication events. Non-security UI ids and fictional cohort
 * seeds are intentionally outside this list.
 */
const SECURITY_SOURCES = [
  'auth/crypto.ts',
  'auth/sessions.ts',
  'auth/actionTokens.ts',
  'auth/google.ts',
  'auth/middleware.ts',
  'routes/auth.ts',
  'routes/account.ts',
  'email/brevo.ts',
];

const FRONTEND_SECURITY_SOURCES = [
  'features/auth/AuthScreens.tsx',
  'features/auth/passwordStrength.ts',
  'app/authSync.ts',
  'services/api/authApi.ts',
  'services/api/http.ts',
];

function readBackend(path: string): string {
  return readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
}

function readFrontend(path: string): string {
  return readFileSync(new URL(`../../frontend/src/${path}`, import.meta.url), 'utf8');
}

describe('credential generation guardrails', () => {
  it('never uses Math.random in backend authentication or email-token modules', () => {
    for (const path of SECURITY_SOURCES) {
      expect(readBackend(path), path).not.toMatch(/Math\.random\s*\(/);
    }
  });

  it('never uses Math.random in frontend authentication or session-sync modules', () => {
    for (const path of FRONTEND_SECURITY_SOURCES) {
      expect(readFrontend(path), path).not.toMatch(/Math\.random\s*\(/);
    }
  });

  it('generates high-entropy URL-safe opaque tokens', () => {
    const tokens = Array.from({ length: 32 }, () => randomToken(32));
    expect(new Set(tokens).size).toBe(tokens.length);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
  });
});
