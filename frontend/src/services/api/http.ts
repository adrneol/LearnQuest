/** Shared credentialed API transport for account and playlist requests. */

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** API requests always stay on the frontend origin and use its /api proxy. */
export function getApiBase(): string {
  // Do not honor a build-time API origin here. Vercel forwards /api to Render,
  // while Vite forwards it to localhost:3001 in development. Keeping browser
  // requests same-origin is required by the production connect-src 'self'
  // policy and preserves first-party session cookies.
  return '';
}

export function apiUrl(path: string): string {
  const normalized = path.replace(/^\/+/, '').replace(/^api(?:\/|$)/, '');
  return `/api${normalized ? `/${normalized}` : ''}`;
}

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null | undefined): void {
  csrfToken = token || null;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Endpoints that are intentionally usable before a session exists. A 401 from
 * these means "wrong credentials" or "expired one-time link", not "the
 * session this tab already had has ended". Treating those as session expiry
 * replaces the sign-in form (and its server message) with a global account
 * error, which is how a failed password login used to lose its error text.
 */
const SESSIONLESS_AUTH_PATHS = new Set([
  '/auth/login',
  '/auth/forgot',
  '/auth/password/reset',
  '/auth/password/reset/validate',
  '/account/email/confirm',
]);

/**
 * Only these server codes prove that the session itself was rejected. A 401
 * for a wrong current password (password change, re-auth, email change,
 * account deletion) is a normal domain error and must not sign the user out.
 */
const SESSION_EXPIRY_CODES = new Set([
  'UNAUTHENTICATED',
  'SESSION_EXPIRED',
  'SESSION_REVOKED',
  'ACCOUNT_UNAVAILABLE',
]);

function isSessionlessAuthPath(path: string): boolean {
  const withoutQuery = path.split('?')[0].replace(/\/+$/, '');
  return SESSIONLESS_AUTH_PATHS.has(withoutQuery);
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  raw?: boolean;
}

export async function apiRequest<T = any>(path: string, opts: ApiRequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
  const abort = () => ctrl.abort();
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort();
    else opts.signal.addEventListener('abort', abort, { once: true });
  }
  try {
    const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (MUTATING.has(method) && csrfToken) headers['X-CSRF-Token'] = csrfToken;
    const res = await fetch(apiUrl(path), {
      method,
      credentials: 'include',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: ctrl.signal,
    });
    if (opts.raw) {
      if (!res.ok) throw new ApiError('The account export could not be downloaded.', res.status);
      return (await res.blob()) as unknown as T;
    }
    const text = await res.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    if (!res.ok) {
      const code = typeof parsed?.code === 'string' ? parsed.code : undefined;
      // Only a request made with an established session context can prove that
      // the session itself expired. A 401 from a sign-in/recovery endpoint, a
      // tab that never had a session, or a wrong-password check is a normal
      // domain error and must leave the authenticated session intact.
      const sessionRejected = code
        ? SESSION_EXPIRY_CODES.has(code)
        : !isSessionlessAuthPath(path);
      if (
        res.status === 401
        && typeof window !== 'undefined'
        && csrfToken
        && !isSessionlessAuthPath(path)
        && sessionRejected
      ) {
        window.dispatchEvent(new CustomEvent('lq:auth-expired'));
      }
      throw new ApiError(
        parsed?.error ?? `Request failed (HTTP ${res.status}).`,
        res.status,
        code,
      );
    }
    return parsed as T;
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new ApiError('The server took too long to respond. Check the connection and retry.', 0, 'TIMEOUT');
    }
    if (e instanceof ApiError) throw e;
    throw new ApiError('Could not reach the LearnQuest service. Check your connection and retry.', 0, 'NETWORK');
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', abort);
  }
}
