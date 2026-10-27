import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createBrevoEmailService } from '../src/email/brevo.js';

const EVENT_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  BREVO_API_KEY: 'test-brevo-api-key-never-print',
  BREVO_SENDER_EMAIL: 'no-reply@example.test',
  BREVO_SENDER_NAME: 'LearnQuest Test',
};
const TOKEN = 'opaque-action-token-that-must-never-be-logged';
const ACTION_URL = `https://learn-quest-one.vercel.app/#/reset-password?token=${TOKEN}`;
const RECIPIENT = 'learner@example.test';

const saved: Record<string, string | undefined> = {};
const originalFetch = globalThis.fetch;

function response(body: unknown, status = 201, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  } as unknown as Response;
}

beforeEach(() => {
  for (const key of Object.keys(EVENT_ENV)) {
    saved[key] = process.env[key];
    process.env[key] = EVENT_ENV[key];
  }
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('Brevo transactional delivery boundary', () => {
  it('awaits the provider request and records only a sanitized message id', async () => {
    const calls: Array<{ url: string; init: any }> = [];
    globalThis.fetch = (async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      return response({ messageId: '<20261027.abc@brevo>' }, 201, { 'x-sib-request-id': 'req_safe_123' });
    }) as any;
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const receipt = await createBrevoEmailService().sendActionEmail({
      to: RECIPIENT,
      purpose: 'password_reset',
      actionUrl: ACTION_URL,
      expiresInMin: 30,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.brevo.com/v3/smtp/email');
    const body = JSON.parse(calls[0].init.body);
    expect(body.sender).toEqual({ email: 'no-reply@example.test', name: 'LearnQuest Test' });
    expect(body.to).toEqual([{ email: RECIPIENT }]);
    expect(body.htmlContent).toContain(ACTION_URL);
    expect(body.textContent).toContain(ACTION_URL);
    expect(body.subject).toBe('Reset your LearnQuest password');
    expect(receipt).toEqual({ messageId: '<20261027.abc@brevo>' });

    const logs = [...info.mock.calls, ...error.mock.calls].flat().join(' ');
    expect(logs).toContain('email_provider_accepted');
    expect(logs).toContain('<20261027.abc@brevo>');
    expect(logs).not.toContain(TOKEN);
    expect(logs).not.toContain(RECIPIENT);
    expect(logs).not.toContain('test-brevo-api-key-never-print');
  });

  it('surfaces a rejected send without logging the provider body, recipient, or token', async () => {
    globalThis.fetch = (async () => response({
      code: 'invalid_parameter',
      // A hostile/verbose provider body must never be copied into logs.
      message: `recipient ${RECIPIENT} and token ${TOKEN}`,
    }, 400)) as any;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(createBrevoEmailService().sendActionEmail({
      to: RECIPIENT,
      purpose: 'password_reset',
      actionUrl: ACTION_URL,
      expiresInMin: 30,
    })).rejects.toMatchObject({ status: 502, code: 'EMAIL_DELIVERY_FAILED' });

    const logs = error.mock.calls.flat().join(' ');
    expect(logs).toContain('email_provider_rejected');
    expect(logs).toContain('"status":400');
    expect(logs).toContain('invalid_parameter');
    expect(logs).not.toContain(RECIPIENT);
    expect(logs).not.toContain(TOKEN);
  });

  it('classifies an IP/authentication rejection without logging the provider text or secrets', async () => {
    globalThis.fetch = (async () => response({
      code: 'unauthorized',
      message: `Unrecognised IP 203.0.113.9 for ${RECIPIENT}; token ${TOKEN}; see https://provider.invalid/security`,
    }, 401)) as any;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(createBrevoEmailService().sendActionEmail({
      to: RECIPIENT,
      purpose: 'password_reset',
      actionUrl: ACTION_URL,
      expiresInMin: 30,
    })).rejects.toMatchObject({ status: 502, code: 'EMAIL_DELIVERY_FAILED' });

    const logs = error.mock.calls.flat().join(' ');
    expect(logs).toContain('email_provider_rejected');
    expect(logs).toContain('"classification":"provider_auth"');
    expect(logs).toContain('"status":401');
    expect(logs).toContain('unauthorized');
    expect(logs).not.toContain('203.0.113.9');
    expect(logs).not.toContain('provider.invalid');
    expect(logs).not.toContain(RECIPIENT);
    expect(logs).not.toContain(TOKEN);
  });

  it('reports a provider timeout as a timeout, not a false success', async () => {
    globalThis.fetch = (async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }) as any;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(createBrevoEmailService().sendActionEmail({
      to: RECIPIENT,
      purpose: 'password_reset',
      actionUrl: ACTION_URL,
      expiresInMin: 30,
    })).rejects.toMatchObject({ status: 504, code: 'EMAIL_TIMEOUT' });

    expect(error.mock.calls.flat().join(' ')).toContain('email_provider_timeout');
  });

  it('fails closed when credentials are absent without making a request', async () => {
    delete process.env.BREVO_API_KEY;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;

    await expect(createBrevoEmailService().sendActionEmail({
      to: RECIPIENT,
      purpose: 'password_reset',
      actionUrl: ACTION_URL,
      expiresInMin: 30,
    })).rejects.toMatchObject({ status: 503, code: 'SETUP_REQUIRED' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
