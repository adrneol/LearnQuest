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

/**
 * Production contract (see backend/.env.example): the service origin WITHOUT
 * trailing slash or `/api` suffix. Empty = same-origin `/api`. Prefer the
 * same-origin proxy so session cookies remain first-party.
 */
export function getApiBase(): string {
  const raw = import.meta.env?.VITE_API_BASE_URL ?? '';
  return String(raw).replace(/\/+$/, '');
}

export function apiUrl(path: string): string {
  return `${getApiBase()}/api${path.startsWith('/') ? path : `/${path}`}`;
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
  '/account/email/confirm',
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
      // Only a request made with an established session context can prove that
      // the session expired. A 401 from a sign-in/recovery endpoint, or from a
      // tab that never had a session, is a normal domain error.
      if (
        res.status === 401
        && typeof window !== 'undefined'
        && csrfToken
        && !isSessionlessAuthPath(path)
      ) {
        window.dispatchEvent(new CustomEvent('lq:auth-expired'));
      }
      throw new ApiError(
        parsed?.error ?? `Request failed (HTTP ${res.status}).`,
        res.status,
        typeof parsed?.code === 'string' ? parsed.code : undefined,
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
