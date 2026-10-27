/**
 * Sanitized MongoDB failure classification.
 *
 * Driver errors can contain cluster hostnames, IP addresses, and (for parse
 * errors) fragments of a connection string. Only allowlisted names, error
 * codes, labels, and TLS alert descriptions may leave this module. Raw error
 * messages are never returned or logged.
 */

export type MongoFailureClass =
  | 'INVALID_URI'
  | 'DNS_SRV_FAILURE'
  | 'NETWORK_TIMEOUT'
  | 'TLS_FAILURE'
  | 'AUTHENTICATION_FAILED'
  | 'AUTHORIZATION_FAILED'
  | 'ATLAS_ACCESS_DENIED'
  | 'PING_FAILED'
  | 'CLIENT_LIFECYCLE_ERROR'
  | 'UNKNOWN_ERROR';

export interface SanitizedMongoError {
  name: string;
  code: string | null;
  causeName: string | null;
  causeCode: string | null;
  reasonName: string | null;
  reasonCode: string | null;
}

interface SignalPattern {
  signal: string;
  pattern: RegExp;
}

const SIGNAL_PATTERNS: SignalPattern[] = [
  { signal: 'dns_not_found', pattern: /(enotfound|eai_again|eservfail)/i },
  { signal: 'srv_lookup', pattern: /(querysrv|query_srv|_mongodb\._tcp)/i },
  { signal: 'connection_refused', pattern: /(econnrefused)/i },
  { signal: 'connection_reset', pattern: /(econnreset|econnaborted)/i },
  { signal: 'host_unreachable', pattern: /(ehostunreach|enetunreach)/i },
  { signal: 'connect_timeout', pattern: /(etimedout|connect timeout|connection timed out)/i },
  { signal: 'server_selection_timeout', pattern: /(server selection timed out|serverselectiontimeout)/i },
  { signal: 'tls_alert', pattern: /((?:tls|ssl)v?[\d.]*\s*alert)/i },
  { signal: 'tls_handshake', pattern: /(handshake|ssl routines|tls routines)/i },
  { signal: 'certificate', pattern: /(certificate|cert_|self signed|self-signed)/i },
  { signal: 'hostname_mismatch', pattern: /(altname|hostname.*mismatch|does not match)/i },
  { signal: 'atlas_allowlist', pattern: /(whitelist|allowlist|access list|not allowed to access)/i },
  { signal: 'authentication', pattern: /(authentication failed|bad auth|invalid credentials)/i },
  { signal: 'authorization', pattern: /(not authorized|unauthorized)/i },
  { signal: 'atlas_paused', pattern: /(paused|resuming|cluster.*unavailable)/i },
];

const TLS_PATTERN = /((?:tls|ssl)|certificate|cert_|self signed|handshake)/i;
const DNS_PATTERN = /(enotfound|eai_again|eservfail|query_srv|querysrv|dns)/i;
const TIMEOUT_PATTERN = /(etimedout|econnrefused|econnreset|econnaborted|ehostunreach|enetunreach|server selection timed out|timed out|timeout)/i;
const ATLAS_ACCESS_PATTERN = /(whitelist|allowlist|access list|not allowed to access|ip.*not.*authorized)/i;

function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 80
    ? value
    : null;
}

function safeCode(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return safeString(value);
}

function causeOf(error: unknown): { name?: unknown; code?: unknown; message?: unknown } | undefined {
  return (error as { cause?: { name?: unknown; code?: unknown; message?: unknown } })?.cause;
}

function reasonOf(error: unknown): { name?: unknown; code?: unknown; message?: unknown } | undefined {
  return (error as { reason?: { name?: unknown; code?: unknown; message?: unknown } })?.reason;
}

export function sanitizeMongoError(error: unknown): SanitizedMongoError {
  const record = error as { name?: unknown; code?: unknown };
  const cause = causeOf(error);
  const reason = reasonOf(error);
  return {
    name: safeString(record?.name) ?? 'Error',
    code: safeCode(record?.code),
    causeName: safeString(cause?.name),
    causeCode: safeCode(cause?.code),
    reasonName: safeString(reason?.name),
    reasonCode: safeCode(reason?.code),
  };
}

/** Predefined, coarse signals only; never the raw driver message. */
export function mongoDiagnosticSignals(error: unknown): string[] {
  if (!(error instanceof Error)) return [];
  const signals = new Set<string>();
  const messages = [
    error.message,
    causeOf(error)?.message,
    reasonOf(error)?.message,
  ];
  for (const message of messages) {
    if (typeof message !== 'string') continue;
    for (const { signal, pattern } of SIGNAL_PATTERNS) {
      if (pattern.test(message)) signals.add(signal);
    }
  }
  return [...signals].sort();
}

/** Extract only the TLS alert description, never the surrounding message. */
export function tlsAlertDescription(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const messages = [
    error.message,
    causeOf(error)?.message,
    reasonOf(error)?.message,
  ];
  for (const message of messages) {
    if (typeof message !== 'string') continue;
    const match = message.match(/(?:tls|ssl)v?[\d.]*\s*alert\s+([a-z0-9 _-]+)/i);
    if (match) return match[1].trim().toLowerCase().replace(/\s+/g, '_');
  }
  return null;
}

export function classifyMongoError(error: unknown): MongoFailureClass {
  const sanitized = sanitizeMongoError(error);
  const name = sanitized.name.toLowerCase();
  const code = (sanitized.code ?? '').toLowerCase();
  const causeCode = (sanitized.causeCode ?? '').toLowerCase();
  const reasonCode = (sanitized.reasonCode ?? '').toLowerCase();
  const messages = [
    error instanceof Error ? error.message : '',
    typeof causeOf(error)?.message === 'string' ? String(causeOf(error)?.message) : '',
    typeof reasonOf(error)?.message === 'string' ? String(reasonOf(error)?.message) : '',
  ];
  const message = messages.join(' ').toLowerCase();

  if (name.includes('mongoparseerror') || message.includes('connection string')) return 'INVALID_URI';
  if (name.includes('mongotopologyclosed') || name.includes('mongoclientclosed')) return 'CLIENT_LIFECYCLE_ERROR';

  if (name.includes('mongoservererror') || name.includes('mongoserverselectionerror')) {
    if (code === '18' || causeCode === '18' || reasonCode === '18' || message.includes('authentication failed')) {
      return 'AUTHENTICATION_FAILED';
    }
    if (code === '13' || causeCode === '13' || reasonCode === '13' || message.includes('not authorized')) {
      return 'AUTHORIZATION_FAILED';
    }
  }

  if (ATLAS_ACCESS_PATTERN.test(message)) return 'ATLAS_ACCESS_DENIED';
  if (TLS_PATTERN.test(message) || TLS_PATTERN.test(code) || TLS_PATTERN.test(causeCode)) return 'TLS_FAILURE';
  if (
    DNS_PATTERN.test(message)
    || DNS_PATTERN.test(code)
    || DNS_PATTERN.test(causeCode)
    || DNS_PATTERN.test(sanitized.causeName ?? '')
  ) return 'DNS_SRV_FAILURE';
  if (
    TIMEOUT_PATTERN.test(message)
    || TIMEOUT_PATTERN.test(code)
    || TIMEOUT_PATTERN.test(causeCode)
    || name.includes('mongonetworkerror')
    || name.includes('mongoserverselectionerror')
  ) return 'NETWORK_TIMEOUT';
  if (name.includes('mongoservererror') || name.includes('mongonetworkerror')) return 'PING_FAILED';
  return 'UNKNOWN_ERROR';
}

export function isRetryableMongoFailure(classification: MongoFailureClass): boolean {
  return classification === 'NETWORK_TIMEOUT'
    || classification === 'DNS_SRV_FAILURE'
    || classification === 'TLS_FAILURE'
    || classification === 'PING_FAILED'
    || classification === 'UNKNOWN_ERROR';
}

/**
 * One-line, value-free detail for an application log. The raw message is not
 * included; a TLS alert description is the only message-derived field.
 */
export function describeMongoFailure(error: unknown): string {
  const classification = classifyMongoError(error);
  const sanitized = sanitizeMongoError(error);
  const parts = [
    `classification=${classification}`,
    `retryable=${isRetryableMongoFailure(classification)}`,
  ];
  if (sanitized.name !== 'Error') parts.push(`error=${sanitized.name}`);
  if (sanitized.code) parts.push(`code=${sanitized.code}`);
  if (sanitized.causeName) parts.push(`cause=${sanitized.causeName}`);
  if (sanitized.causeCode) parts.push(`causeCode=${sanitized.causeCode}`);
  if (sanitized.reasonName) parts.push(`reason=${sanitized.reasonName}`);
  if (sanitized.reasonCode) parts.push(`reasonCode=${sanitized.reasonCode}`);
  const alert = tlsAlertDescription(error);
  if (alert) parts.push(`tlsAlert=${alert}`);
  return parts.join(' ');
}
