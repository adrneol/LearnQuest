import { env } from '../config/env.js';

export type EmailActionPurpose = 'password_reset' | 'email_change';

export interface ActionEmailInput {
  to: string;
  purpose: EmailActionPurpose;
  actionUrl: string;
  expiresInMin: number;
}

export interface SecurityNoticeInput {
  to: string;
  subject: string;
  message: string;
}

/**
 * A provider acceptance receipt. It proves that Brevo accepted the API
 * request; it does not prove inbox delivery. Never treat it as a delivery
 * confirmation.
 */
export interface EmailDeliveryReceipt {
  messageId: string | null;
}

export interface EmailService {
  readonly configured: boolean;
  sendActionEmail(input: ActionEmailInput): Promise<EmailDeliveryReceipt | void>;
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

function assertActionUrl(actionUrl: string): URL {
  let url: URL;
  try {
    url = new URL(actionUrl);
  } catch {
    throw new Error('The email action URL is invalid.');
  }
  if (url.protocol !== 'https:' && !(env.nodeEnv !== 'production' && url.protocol === 'http:')) {
    throw new Error('The email action URL must use HTTPS.');
  }
  // The token belongs in the fragment so it is never sent to a web server,
  // email scanner, or analytics service in the page request.
  if (!url.hash.includes('token=')) {
    throw new Error('The email action URL must carry its token in the fragment.');
  }
  return url;
}

const COPY: Record<EmailActionPurpose, {
  subject: string;
  title: string;
  intro: string;
  button: string;
  ignore: string;
}> = {
  password_reset: {
    subject: 'Reset your LearnQuest password',
    title: 'Reset your LearnQuest password',
    intro: 'We received a request to reset the password for your LearnQuest account. Choose a new password using the secure one-time link below.',
    button: 'Reset password',
    ignore: 'If you did not request a password reset, you can ignore this email. Your password will not change.',
  },
  email_change: {
    subject: 'Verify your new LearnQuest email address',
    title: 'Verify your new LearnQuest email address',
    intro: 'We received a request to use this address for your LearnQuest account. Confirm it with the secure one-time link below.',
    button: 'Verify email address',
    ignore: 'If you did not request this change, you can ignore this email. Your current email address will stay active.',
  },
};

/** Responsive, accessible HTML plus a useful plain-text alternative. */
export function buildActionEmail(input: ActionEmailInput): { subject: string; html: string; text: string } {
  const url = assertActionUrl(input.actionUrl);
  const copy = COPY[input.purpose];
  const href = escapeHtml(url.toString());
  const expiry = `${input.expiresInMin} minute${input.expiresInMin === 1 ? '' : 's'}`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<title>${escapeHtml(copy.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#0b0e1a;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(copy.subject)}. This link expires in ${expiry}.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0b0e1a;">
<tr><td align="center" style="padding:28px 14px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#141830;border:1px solid #2a3150;border-radius:16px;overflow:hidden;">
<tr><td style="padding:22px 28px;background:#6d28d9;background:linear-gradient(135deg,#6d28d9,#0891b2);">
<span style="display:inline-block;background:rgba(255,255,255,.16);border-radius:10px;padding:8px 12px;font-weight:800;font-size:18px;line-height:1;color:#ffffff;">LearnQuest</span>
</td></tr>
<tr><td style="padding:30px 28px;">
<h1 style="margin:0 0 14px;font-size:23px;line-height:1.3;color:#f8fafc;">${escapeHtml(copy.title)}</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#cbd5e1;">${escapeHtml(copy.intro)}</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 18px;"><tr>
<td style="border-radius:10px;background:#7c3aed;">
<a href="${href}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:700;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(copy.button)}</a>
</td></tr></table>
<p style="margin:0 0 12px;font-size:13px;line-height:1.65;color:#94a3b8;">This secure link expires in <strong style="color:#e2e8f0;">${expiry}</strong> and can be used once. If the button does not work, copy this address into your browser:</p>
<p style="margin:0 0 18px;font-size:12px;line-height:1.6;word-break:break-all;color:#a5f3fc;">${href}</p>
<p style="margin:0 0 10px;font-size:13px;line-height:1.65;color:#94a3b8;">${escapeHtml(copy.ignore)}</p>
<p style="margin:0;font-size:12px;line-height:1.6;color:#64748b;">For your security, LearnQuest will never ask for your password, a verification code, or this link by email or chat.</p>
</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid #2a3150;font-size:12px;line-height:1.6;color:#64748b;">
LearnQuest · learning progress for your account.<br>
This message was sent because an action was requested for a LearnQuest account.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  const text = `LearnQuest — ${copy.title}

${copy.intro}

${copy.button}: ${url.toString()}

This secure link expires in ${expiry} and can be used once.

${copy.ignore}

For your security, LearnQuest will never ask for your password, a verification code, or this link by email or chat.

— LearnQuest
This message was sent because an action was requested for a LearnQuest account.`;
  return { subject: copy.subject, html, text };
}

export function buildSecurityNoticeEmail(input: SecurityNoticeInput): { subject: string; html: string; text: string } {
  const subject = input.subject.trim().slice(0, 180) || 'LearnQuest security notice';
  const message = input.message.trim().slice(0, 4_000);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#0b0e1a;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0b0e1a;"><tr><td align="center" style="padding:28px 14px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#141830;border:1px solid #2a3150;border-radius:16px;">
<tr><td style="padding:20px 28px;background:#6d28d9;background:linear-gradient(135deg,#6d28d9,#0891b2);">
<span style="display:inline-block;background:rgba(255,255,255,.16);border-radius:10px;padding:8px 12px;font-weight:800;font-size:18px;color:#ffffff;">LearnQuest</span>
</td></tr>
<tr><td style="padding:28px;">
<h1 style="margin:0 0 12px;font-size:21px;line-height:1.35;color:#f8fafc;">${escapeHtml(subject)}</h1>
<p style="margin:0;font-size:15px;line-height:1.65;color:#cbd5e1;">${escapeHtml(message)}</p>
<p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#64748b;">This is an automated security notice from LearnQuest. If you did not make this change, reset your password and contact the LearnQuest administrator.</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
  const text = `LearnQuest — ${subject}

${message}

This is an automated security notice from LearnQuest. If you did not make this change, reset your password and contact the LearnQuest administrator.`;
  return { subject, html, text };
}

/** Keep diagnostics to a short, known-safe alphabet. Never log content. */
function safeDiagnostic(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return /^[A-Za-z0-9<>@._:+-]+$/.test(trimmed) ? trimmed : null;
}

async function providerDiagnosticCode(res: Response): Promise<string | null> {
  try {
    const body = await res.json() as Record<string, unknown> | null;
    return safeDiagnostic(body?.code, 80);
  } catch {
    return null;
  }
}

async function brevoSend(payload: Record<string, unknown>, event: string): Promise<EmailDeliveryReceipt> {
  if (!env.brevoConfigured) {
    throw Object.assign(new Error('Email delivery is not configured yet.'), { status: 503, code: 'SETUP_REQUIRED' });
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
      // Never include the provider response body in the error or log: it can
      // echo recipient data. Only the HTTP status, a short provider code, and
      // a request identifier are safe diagnostic fields.
      const providerCode = await providerDiagnosticCode(res);
      const providerRequestId = safeDiagnostic(res.headers.get('x-sib-request-id'), 120);
      console.error(JSON.stringify({
        level: 'error',
        event: 'email_provider_rejected',
        kind: event,
        status: res.status,
        providerCode,
        providerRequestId,
      }));
      throw Object.assign(new Error('The email provider rejected the message. Check the sender address and provider configuration.'), { status: 502, code: 'EMAIL_DELIVERY_FAILED' });
    }
    let messageId: string | null = null;
    try {
      const body = await res.json() as Record<string, unknown> | null;
      messageId = safeDiagnostic(body?.messageId, 200);
    } catch {
      // Some providers return an empty body on acceptance. The HTTP status is
      // still authoritative for "accepted", not "delivered".
    }
    console.info(JSON.stringify({
      level: 'info',
      event: 'email_provider_accepted',
      kind: event,
      messageId,
    }));
    return { messageId };
  } catch (e: unknown) {
    const name = (e as { name?: string })?.name;
    const code = (e as { code?: string })?.code;
    const status = (e as { status?: number })?.status;
    if (name === 'AbortError') {
      console.error(JSON.stringify({ level: 'error', event: 'email_provider_timeout', kind: event }));
      throw Object.assign(new Error('The email provider timed out. Try again shortly.'), { status: 504, code: 'EMAIL_TIMEOUT' });
    }
    if (code === 'EMAIL_DELIVERY_FAILED' || status === 503) throw e;
    console.error(JSON.stringify({ level: 'error', event: 'email_provider_unreachable', kind: event }));
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
    async sendActionEmail(input) {
      const email = buildActionEmail(input);
      return brevoSend({
        sender: { email: env.brevoSenderEmail, name: env.brevoSenderName },
        to: [{ email: input.to }],
        subject: email.subject,
        htmlContent: email.html,
        textContent: email.text,
      }, input.purpose === 'password_reset' ? 'password_reset' : 'email_change');
    },
    async sendSecurityNotice(input) {
      const email = buildSecurityNoticeEmail(input);
      await brevoSend({
        sender: { email: env.brevoSenderEmail, name: env.brevoSenderName },
        to: [{ email: input.to }],
        subject: email.subject,
        htmlContent: email.html,
        textContent: email.text,
      }, 'security_notice');
    },
  };
}
