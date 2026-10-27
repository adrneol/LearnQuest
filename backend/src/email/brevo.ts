import { env } from '../config/env.js';

export interface OtpEmailInput {
  to: string;
  code: string;
  expiresInMin: number;
  purpose: 'password_reset' | 'email_change';
}

export interface SecurityNoticeInput {
  to: string;
  subject: string;
  message: string;
}

export interface EmailService {
  readonly configured: boolean;
  sendOtp(input: OtpEmailInput): Promise<void>;
  sendSecurityNotice(input: SecurityNoticeInput): Promise<void>;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function heading(purpose: OtpEmailInput['purpose']): string {
  return purpose === 'password_reset' ? 'Reset your LearnQuest password' : 'Verify your new LearnQuest email';
}

function intro(purpose: OtpEmailInput['purpose']): string {
  return purpose === 'password_reset'
    ? 'Use the code below to choose a new password. If you did not request a reset, you can ignore this email — your password has not changed.'
    : 'Use the code below to confirm this email address for your LearnQuest account. Until it is verified, your current email remains active.';
}

export function buildOtpEmail(input: OtpEmailInput): { subject: string; html: string; text: string } {
  const safeCode = escapeHtml(input.code);
  const subject = input.purpose === 'password_reset'
    ? 'Your LearnQuest password reset code'
    : 'Verify your new LearnQuest email address';
  const title = heading(input.purpose);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#0b0e1a;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your LearnQuest verification code expires in ${input.expiresInMin} minutes.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0b0e1a;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#141830;border:1px solid #2a3150;border-radius:16px;overflow:hidden;">
<tr><td style="padding:24px 28px;background:linear-gradient(135deg,#6d28d9,#0891b2);">
<span style="display:inline-block;background:rgba(255,255,255,.16);border-radius:10px;padding:8px 12px;font-weight:800;font-size:18px;color:#ffffff;">LearnQuest</span>
</td></tr>
<tr><td style="padding:28px;">
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#f8fafc;">${escapeHtml(title)}</h1>
<p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#cbd5e1;">${escapeHtml(intro(input.purpose))}</p>
<div style="margin:0 0 18px;padding:18px;text-align:center;background:#0b0e1a;border:1px solid #334155;border-radius:12px;letter-spacing:10px;font-size:34px;font-weight:800;color:#a5f3fc;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${safeCode}</div>
<p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#cbd5e1;">This code expires in <strong>${input.expiresInMin} minutes</strong>.</p>
<p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#fca5a5;">Never share this code. LearnQuest staff will never ask you for it.</p>
<p style="margin:0;font-size:13px;line-height:1.6;color:#94a3b8;">If you did not request this, you can safely ignore this email.</p>
</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid #2a3150;font-size:12px;color:#64748b;">LearnQuest · learning progress, without invented numbers.</td></tr>
</table>
</td></tr></table></body></html>`;
  const text = `LearnQuest — ${title}

${intro(input.purpose)}

Your code: ${input.code}

This code expires in ${input.expiresInMin} minutes.
Never share this code. LearnQuest staff will never ask you for it.

If you did not request this, you can safely ignore this email.

— LearnQuest`;
  return { subject, html, text };
}

async function brevoSend(payload: Record<string, unknown>): Promise<void> {
  if (!env.brevoConfigured) {
    throw Object.assign(new Error('Email delivery is not configured. Set BREVO_API_KEY and BREVO_SENDER_EMAIL.'), { status: 503, code: 'SETUP_REQUIRED' });
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': env.brevoApiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      // Never include the provider response body: it may echo recipient data.
      throw Object.assign(new Error('The email provider rejected the message. Check Brevo sender verification and API-key permissions.'), { status: 502, code: 'EMAIL_DELIVERY_FAILED' });
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw Object.assign(new Error('The email provider timed out. Try again shortly.'), { status: 504, code: 'EMAIL_TIMEOUT' });
    }
    if (e?.code === 'EMAIL_DELIVERY_FAILED' || e?.status === 503) throw e;
    throw Object.assign(new Error('The email could not be delivered. Try again shortly.'), { status: 502, code: 'EMAIL_DELIVERY_FAILED' });
  } finally {
    clearTimeout(timer);
  }
}

export function createBrevoEmailService(): EmailService {
  return {
    get configured() {
      return env.brevoConfigured;
    },
    async sendOtp(input) {
      const email = buildOtpEmail(input);
      await brevoSend({
        sender: { email: env.brevoSenderEmail, name: env.brevoSenderName },
        to: [{ email: input.to }],
        subject: email.subject,
        htmlContent: email.html,
        textContent: email.text,
      });
    },
    async sendSecurityNotice(input) {
      const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#0b0e1a;color:#e2e8f0;font-family:Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;background:#141830;border:1px solid #2a3150;border-radius:16px;padding:24px;">
<h1 style="font-size:20px;color:#f8fafc;margin:0 0 12px;">${escapeHtml(input.subject)}</h1>
<p style="font-size:15px;line-height:1.6;color:#cbd5e1;margin:0;">${escapeHtml(input.message)}</p>
<p style="font-size:12px;color:#64748b;margin:20px 0 0;">This is a security notice from LearnQuest.</p>
</div></body></html>`;
      await brevoSend({
        sender: { email: env.brevoSenderEmail, name: env.brevoSenderName },
        to: [{ email: input.to }],
        subject: input.subject,
        htmlContent: html,
        textContent: `${input.subject}\n\n${input.message}\n\n— LearnQuest`,
      });
    },
  };
}
