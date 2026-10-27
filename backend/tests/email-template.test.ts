import { describe, it, expect } from 'vitest';
import { buildActionEmail, buildSecurityNoticeEmail } from '../src/email/brevo.js';

const URL = 'https://learn-quest-one.vercel.app/#/reset-password?token=opaque-test-token-value';

describe('transactional email content', () => {
  it('builds branded HTML and plain text with the real fragment action link', () => {
    const email = buildActionEmail({
      to: 'learner@example.test',
      purpose: 'password_reset',
      actionUrl: URL,
      expiresInMin: 30,
    });
    expect(email.subject).toBe('Reset your LearnQuest password');
    expect(email.html).toContain('LearnQuest');
    expect(email.html).toContain('href="https://learn-quest-one.vercel.app/#/reset-password?token=opaque-test-token-value"');
    expect(email.html).toContain('30 minutes');
    expect(email.html).toContain('can be used once');
    expect(email.html).toContain('If you did not request');
    expect(email.html).toContain('viewport');
    expect(email.html).not.toMatch(/Your code:|six-digit|6-digit/i);
    expect(email.html).not.toMatch(/>\s*\d{6}\s*</);
    expect(email.text).toContain('Reset password:');
    expect(email.text).toContain(URL);
    expect(email.text).toContain('30 minutes');
    expect(email.text).toContain('If you did not request');
  });

  it('builds the email-change variant with matching truthful copy', () => {
    const verifyUrl = 'https://example.test/#/verify-email?token=another-opaque-token';
    const email = buildActionEmail({
      to: 'new@example.test',
      purpose: 'email_change',
      actionUrl: verifyUrl,
      expiresInMin: 45,
    });
    expect(email.subject).toMatch(/Verify your new LearnQuest email/);
    expect(email.html).toContain('Verify email address');
    expect(email.html).toContain('45 minutes');
    expect(email.text).toContain('Your current email address will stay active');
    expect(email.text).toContain(verifyUrl);
  });

  it('escapes untrusted security-notice text and never emits a numeric code', () => {
    const email = buildSecurityNoticeEmail({
      to: 'old@example.test',
      subject: 'Your <LearnQuest> email changed',
      message: 'The address changed to <new@example.test> & all sessions signed out.',
    });
    expect(email.html).toContain('&lt;LearnQuest&gt;');
    expect(email.html).toContain('&lt;new@example.test&gt;');
    expect(email.html).toContain('&amp;');
    expect(email.text).not.toMatch(/Your code:|six-digit/i);
  });

  it('rejects an action URL without a fragment token or without HTTPS in production', () => {
    expect(() => buildActionEmail({
      to: 'a@example.test',
      purpose: 'password_reset',
      actionUrl: 'https://example.test/#/reset-password',
      expiresInMin: 30,
    })).toThrow(/fragment/);
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => buildActionEmail({
        to: 'a@example.test',
        purpose: 'password_reset',
        actionUrl: 'http://example.test/#/reset-password?token=x',
        expiresInMin: 30,
      })).toThrow(/HTTPS/);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
