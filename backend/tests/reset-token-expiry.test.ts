import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildActionEmail } from '../src/email/brevo.js';
import { createMemoryDb } from '../src/db/memoryAdapter.js';
import { createDataStore, type DataStore } from '../src/store.js';
import {
  consumeEmailActionToken,
  emailActionUrl,
  inspectEmailActionToken,
  issueEmailActionToken,
} from '../src/auth/actionTokens.js';

const ENV: Record<string, string> = {
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://localhost:5173',
  API_ORIGIN: 'http://localhost:3001',
  EMAIL_ACTION_HMAC_SECRET: 'test-email-action-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
  EMAIL_ACTION_TTL_MIN: '10',
};
const saved: Record<string, string | undefined> = {};
const SAVED_KEYS = [...Object.keys(ENV), 'OTP_TTL_MIN'];
for (const key of SAVED_KEYS) saved[key] = process.env[key];

let db: ReturnType<typeof createMemoryDb>;
let store: DataStore;

function issue(purpose: 'password_reset' | 'email_change' = 'password_reset') {
  return issueEmailActionToken(store, {
    userId: 'user-expiry-test',
    purpose,
    accountEmailNormalized: 'learner@example.test',
    emailNormalized: 'learner@example.test',
    targetEmail: 'learner@example.test',
  });
}

beforeEach(() => {
  for (const [key, value] of Object.entries(ENV)) process.env[key] = value;
  // Make the current variable authoritative even if the developer's .env has
  // the legacy alias. The alias is covered by its own test below.
  delete process.env.OTP_TTL_MIN;
  db = createMemoryDb();
  store = createDataStore(db);
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-28T12:00:00.000Z'));
});

afterEach(async () => {
  vi.useRealTimers();
  await db.close();
  for (const key of SAVED_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('server-side email action token expiry', () => {
  it('derives the stored expiry and the email copy from one configured TTL', async () => {
    const issued = await issue();
    expect(issued.expiresInMin).toBe(10);
    expect(Date.parse(issued.expiresAt) - Date.parse(new Date().toISOString())).toBe(10 * 60_000);

    const record = await store.actionTokens.findOne({ tokenId: issued.tokenId });
    expect(record?.expiresAt).toBe(issued.expiresAt);
    expect(record?.createdAt).toBe('2026-10-28T12:00:00.000Z');

    const email = buildActionEmail({
      to: 'learner@example.test',
      purpose: 'password_reset',
      actionUrl: issued.actionUrl,
      expiresInMin: issued.expiresInMin,
    });
    expect(email.html).toContain('10 minutes');
    expect(email.text).toContain('10 minutes');
    expect(issued.actionUrl.startsWith(`${process.env.APP_ORIGIN}/#/reset-password?token=`)).toBe(true);
  });

  it('accepts a token before expiry and rejects it at the exact expiry boundary', async () => {
    const before = await issue();
    vi.setSystemTime(new Date(Date.parse(before.expiresAt) - 1));
    await expect(consumeEmailActionToken(store, before.token, 'password_reset')).resolves.toMatchObject({
      tokenId: before.tokenId,
      consumedAt: '2026-10-28T12:09:59.999Z',
    });

    const boundary = await issue();
    vi.setSystemTime(new Date(boundary.expiresAt));
    await expect(consumeEmailActionToken(store, boundary.token, 'password_reset')).resolves.toBeNull();

    // The expired record is still physically present and still unconsumed.
    const record = await store.actionTokens.findOne({ tokenId: boundary.tokenId });
    expect(record).toBeTruthy();
    expect(record?.consumedAt).toBeNull();
  });

  it('rejects a token 37 minutes after issue even though the record is still present', async () => {
    const issued = await issue();
    vi.setSystemTime(new Date(Date.parse(issued.expiresAt) + 27 * 60_000));
    await expect(consumeEmailActionToken(store, issued.token, 'password_reset')).resolves.toBeNull();
    expect(await store.actionTokens.count({ tokenId: issued.tokenId })).toBe(1);
    expect((await store.actionTokens.findOne({ tokenId: issued.tokenId }))?.consumedAt).toBeNull();
  });

  it('rejects replay after a successful consumption', async () => {
    const issued = await issue();
    const first = await consumeEmailActionToken(store, issued.token, 'password_reset');
    expect(first).toBeTruthy();
    expect(first?.consumedAt).toBe('2026-10-28T12:00:00.000Z');
    await expect(consumeEmailActionToken(store, issued.token, 'password_reset')).resolves.toBeNull();
  });

  it('allows at most one concurrent consumption of the same token', async () => {
    const issued = await issue();
    const results = await Promise.all([
      consumeEmailActionToken(store, issued.token, 'password_reset'),
      consumeEmailActionToken(store, issued.token, 'password_reset'),
      consumeEmailActionToken(store, issued.token, 'password_reset'),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(2);
  });

  it('rejects purpose mismatch without consuming the reset token', async () => {
    const issued = await issue('password_reset');
    await expect(consumeEmailActionToken(store, issued.token, 'email_change')).resolves.toBeNull();
    expect((await store.actionTokens.findOne({ tokenId: issued.tokenId }))?.consumedAt).toBeNull();
    await expect(consumeEmailActionToken(store, issued.token, 'password_reset')).resolves.toBeTruthy();
  });

  it('validates without consuming, then allows the explicit submit to consume', async () => {
    const issued = await issue();
    const inspected = await inspectEmailActionToken(store, issued.token, 'password_reset');
    expect(inspected.state).toBe('valid');
    expect(inspected.record?.tokenId).toBe(issued.tokenId);
    expect((await store.actionTokens.findOne({ tokenId: issued.tokenId }))?.consumedAt).toBeNull();

    await expect(consumeEmailActionToken(store, issued.token, 'password_reset')).resolves.toBeTruthy();
    const replayInspection = await inspectEmailActionToken(store, issued.token, 'password_reset');
    expect(replayInspection.state).toBe('invalid');
  });

  it('reports expired without consuming and distinguishes purpose/account lookups', async () => {
    const issued = await issue();
    vi.setSystemTime(new Date(issued.expiresAt));
    const inspected = await inspectEmailActionToken(store, issued.token, 'password_reset');
    expect(inspected.state).toBe('expired');
    expect((await store.actionTokens.findOne({ tokenId: issued.tokenId }))?.consumedAt).toBeNull();

    const wrongPurpose = await inspectEmailActionToken(store, issued.token, 'email_change');
    expect(wrongPurpose.state).toBe('invalid');
  });

  it('uses the legacy OTP_TTL_MIN alias when the current variable is absent', async () => {
    delete process.env.EMAIL_ACTION_TTL_MIN;
    process.env.OTP_TTL_MIN = '12';
    const issued = await issue();
    expect(issued.expiresInMin).toBe(12);
    expect(Date.parse(issued.expiresAt) - Date.now()).toBe(12 * 60_000);
  });

  it('builds email-change links for the matching hash route', async () => {
    const issued = await issue('email_change');
    expect(issued.actionUrl.startsWith(`${process.env.APP_ORIGIN}/#/verify-email?token=`)).toBe(true);
    expect(issued.actionUrl).not.toContain('/#/reset-password');
    expect(emailActionUrl('opaque-token-value-that-is-long-enough', 'email_change')).toContain('/#/verify-email?token=');
  });
});
