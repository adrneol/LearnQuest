import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env, assertProductionConfig } from '../src/config/env.js';
import { emailActionUrl } from '../src/auth/actionTokens.js';
import { buildActionEmail } from '../src/email/brevo.js';

const PRODUCTION_ENV: Record<string, string> = {
  NODE_ENV: 'production',
  APP_ORIGIN: 'https://learn-quest-one.vercel.app',
  API_ORIGIN: 'https://learnquest-hhiv.onrender.com',
  CORS_ORIGIN: 'https://learn-quest-one.vercel.app',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/learnquest-config-test',
  GOOGLE_CLIENT_ID: 'test-google-client.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
  GOOGLE_REDIRECT_URI: 'https://learn-quest-one.vercel.app/api/auth/google/callback',
  BREVO_API_KEY: 'test-brevo-key',
  BREVO_SENDER_EMAIL: 'no-reply@example.test',
  SESSION_SECRET: 'test-session-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
  EMAIL_ACTION_HMAC_SECRET: 'test-email-action-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
  EMAIL_ACTION_TTL_MIN: '30',
  EMAIL_ACTION_RESEND_SEC: '60',
};
const saved: Record<string, string | undefined> = {};
const KEYS = [...Object.keys(PRODUCTION_ENV), 'OTP_TTL_MIN', 'OTP_HMAC_SECRET'];
for (const key of KEYS) saved[key] = process.env[key];

function restore(key: string): void {
  if (saved[key] === undefined) delete process.env[key];
  else process.env[key] = saved[key];
}

beforeEach(() => {
  for (const [key, value] of Object.entries(PRODUCTION_ENV)) process.env[key] = value;
  delete process.env.OTP_TTL_MIN;
  delete process.env.OTP_HMAC_SECRET;
});

afterEach(() => {
  for (const key of KEYS) restore(key);
});

describe('APP_ORIGIN configuration and action-link construction', () => {
  it('keeps local development on an explicitly configured localhost origin', () => {
    process.env.NODE_ENV = 'test';
    process.env.APP_ORIGIN = 'http://localhost:5173';
    expect(env.appOrigin).toBe('http://localhost:5173');
    const url = emailActionUrl('opaque-local-token-value-abcdefghijklmnopqrstuvwxyz', 'password_reset');
    expect(url).toBe('http://localhost:5173/#/reset-password?token=opaque-local-token-value-abcdefghijklmnopqrstuvwxyz');
    expect(new URL(url).search).toBe('');
  });

  it('uses the validated public production origin for reset and email-change links', () => {
    expect(env.appOrigin).toBe('https://learn-quest-one.vercel.app');
    const reset = emailActionUrl('opaque-production-token-value-abcdefghijklmnopqrstuvwxyz', 'password_reset');
    const change = emailActionUrl('opaque-production-token-value-abcdefghijklmnopqrstuvwxyz', 'email_change');
    expect(reset.startsWith('https://learn-quest-one.vercel.app/#/reset-password?token=')).toBe(true);
    expect(change.startsWith('https://learn-quest-one.vercel.app/#/verify-email?token=')).toBe(true);
    expect(new URL(reset).origin).toBe('https://learn-quest-one.vercel.app');
    expect(new URL(reset).search).toBe('');
    expect(new URL(reset).hash).toContain('token=');
    expect(reset).not.toContain('localhost');
  });

  it('rejects a caller-supplied foreign origin in a production action email', () => {
    const configured = emailActionUrl('opaque-production-token-value-abcdefghijklmnopqrstuvwxyz', 'password_reset');
    expect(() => buildActionEmail({
      to: 'learner@example.test',
      purpose: 'password_reset',
      actionUrl: configured,
      expiresInMin: 30,
    })).not.toThrow();
    expect(() => buildActionEmail({
      to: 'learner@example.test',
      purpose: 'password_reset',
      actionUrl: 'https://attacker.example/#/reset-password?token=opaque-token',
      expiresInMin: 30,
    })).toThrow(/configured APP_ORIGIN/);
  });

  it('fails closed when production omits APP_ORIGIN', () => {
    delete process.env.APP_ORIGIN;
    expect(() => env.appOrigin).toThrow(/APP_ORIGIN must be explicitly set/i);
    expect(() => assertProductionConfig()).toThrow(/Refusing to start with insecure production configuration/);
    expect(() => assertProductionConfig()).toThrow(/APP_ORIGIN must be explicitly set/i);
  });

  it('rejects localhost, private hosts, and HTTP origins in production', () => {
    process.env.APP_ORIGIN = 'http://localhost:5173';
    expect(() => env.appOrigin).toThrow(/https|public origin/i);
    process.env.APP_ORIGIN = 'https://127.0.0.1:5173';
    expect(() => env.appOrigin).toThrow(/public origin/i);
    process.env.APP_ORIGIN = 'https://[::1]:5173';
    expect(() => env.appOrigin).toThrow(/public origin/i);
    process.env.APP_ORIGIN = 'https://app.internal';
    expect(() => env.appOrigin).toThrow(/public origin/i);
  });

  it('rejects invalid URLs, unapproved schemes, credentials, and non-origin paths', () => {
    for (const value of [
      'not a url',
      'ftp://learn-quest-one.vercel.app',
      'https://user:secret@learn-quest-one.vercel.app',
      'https://learn-quest-one.vercel.app/reset-password',
      'https://learn-quest-one.vercel.app/?x=1',
      'https://learn-quest-one.vercel.app/#/reset-password',
    ]) {
      process.env.APP_ORIGIN = value;
      expect(() => env.appOrigin, value).toThrow(/APP_ORIGIN/);
    }
  });

  it('validates the numeric email-action policy during production startup', () => {
    process.env.EMAIL_ACTION_TTL_MIN = '0';
    expect(() => assertProductionConfig()).toThrow(/EMAIL_ACTION_TTL_MIN must be an integer/i);
    process.env.EMAIL_ACTION_TTL_MIN = '30';
    process.env.EMAIL_ACTION_RESEND_SEC = '1';
    expect(() => assertProductionConfig()).toThrow(/EMAIL_ACTION_RESEND_SEC must be an integer/i);
  });

  it('keeps the deployment blueprint on the public origin and explicit production mode', () => {
    // This static check is also covered by deployment-config.test.ts; it is
    // repeated here because the origin is the security-sensitive value.
    const yaml = readFileSync(new URL('../../render.yaml', import.meta.url), 'utf8');
    expect(yaml).toMatch(/key:\s*APP_ORIGIN\s*\n\s*value:\s*https:\/\/learn-quest-one\.vercel\.app/);
    expect(yaml).toMatch(/key:\s*NODE_ENV\s*\n\s*value:\s*production/);
  });
});
