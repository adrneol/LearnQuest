/**
 * Authenticated server-to-client invalidation stream.
 *
 * This is intentionally separate from `authSync.ts`: BroadcastChannel and
 * storage events are browser-profile-scoped, while this stream is coordinated
 * by the authenticated backend and therefore reaches other profiles and
 * devices. The SSE payload is one-way and minimal: it can only ask the existing
 * authentication provider to run its canonical signed-out transition. It
 * cannot sign a user in, restore a session, or select an account.
 */

export type ServerAuthInvalidationReason = 'sessions-revoked' | 'password-reset';

const AUTH_INVALIDATION_EVENT = 'auth-invalidated';
const AUTH_HEARTBEAT_EVENT = 'heartbeat';
const ALLOWED_REASONS = new Set<ServerAuthInvalidationReason>([
  'sessions-revoked',
  'password-reset',
]);
const MAX_PAYLOAD_LENGTH = 512;
const STABLE_CONNECTION_MS = 60_000;
// The server sends a named heartbeat every 25 s. Two missed intervals plus
// scheduling slack is treated as a dead stream, even when a proxy keeps the
// browser's connection object open after the upstream disappeared.
const HEARTBEAT_TIMEOUT_MS = 70_000;
const WATCHDOG_INTERVAL_MS = 10_000;

/**
 * Native EventSource retries three seconds after every failure. That is too
 * aggressive when a proxy is down or a free instance is sleeping: one tab would
 * spend 20 requests per minute on reconnects. The client closes the failed
 * source and reopens with this capped backoff instead. A connection that stays
 * healthy for a minute resets the delay.
 */
const DEFAULT_RECONNECT_DELAYS_MS = [3_000, 5_000, 10_000, 20_000, 40_000, 60_000] as const;

/**
 * Parse only the exact allow-listed payload shape. A malformed message is
 * ignored rather than closing the stream or changing authentication state.
 */
export function parseAuthInvalidationPayload(raw: unknown): ServerAuthInvalidationReason | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_PAYLOAD_LENGTH) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2) return null;
  if (record.type !== 'auth-invalidated') return null;
  if (typeof record.reason !== 'string') return null;
  if (!ALLOWED_REASONS.has(record.reason as ServerAuthInvalidationReason)) return null;
  return record.reason as ServerAuthInvalidationReason;
}

export interface AuthInvalidationStreamHandlers {
  onInvalidate: (reason: ServerAuthInvalidationReason) => void;
  /**
   * Called for every transport error before a controlled reconnect. The caller
   * must revalidate the existing server session; it must not treat the event as
   * proof that the session ended.
   */
  onError: () => void;
}

export interface AuthInvalidationStreamOptions {
  /** Test seam; production always uses the capped default schedule. */
  reconnectDelaysMs?: readonly number[];
  /** Test seam; production treats 70 seconds without a heartbeat as dead. */
  heartbeatTimeoutMs?: number;
  /** Test seam; production checks liveness every 10 seconds. */
  watchdogIntervalMs?: number;
}

/**
 * Open one credentialed same-origin SSE connection. Cookies remain HttpOnly and
 * browser-managed; no token is placed in the URL, headers, storage, or payload.
 * Returns an idempotent close function suitable for a React effect cleanup.
 */
export function openAuthInvalidationStream(
  handlers: AuthInvalidationStreamHandlers,
  options: AuthInvalidationStreamOptions = {},
): () => void {
  if (typeof EventSource === 'undefined') return () => undefined;

  const delays = options.reconnectDelaysMs?.length
    ? options.reconnectDelaysMs
    : DEFAULT_RECONNECT_DELAYS_MS;
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS;
  const watchdogIntervalMs = options.watchdogIntervalMs ?? WATCHDOG_INTERVAL_MS;
  let source: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stableTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdogTimer: ReturnType<typeof setInterval> | null = null;
  let lastHeartbeatAt = 0;
  let attempt = 0;
  let closed = false;

  const disposeSource = () => {
    if (stableTimer) {
      clearTimeout(stableTimer);
      stableTimer = null;
    }
    if (!source) return;
    source.removeEventListener(AUTH_INVALIDATION_EVENT, onMessage as EventListener);
    source.removeEventListener(AUTH_HEARTBEAT_EVENT, onHeartbeat as EventListener);
    source.onopen = null;
    source.onerror = null;
    source.close();
    source = null;
  };

  const close = () => {
    if (closed) return;
    closed = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (watchdogTimer) {
      clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
    disposeSource();
  };

  const scheduleReconnect = () => {
    if (closed) return;
    const delay = delays[Math.min(attempt, delays.length - 1)];
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
    const unref = (reconnectTimer as { unref?: () => void }).unref;
    if (typeof unref === 'function') unref.call(reconnectTimer);
  };

  const onMessage = (event: MessageEvent) => {
    const reason = parseAuthInvalidationPayload(event.data);
    if (!reason) return;
    close();
    handlers.onInvalidate(reason);
  };

  const onHeartbeat = () => {
    lastHeartbeatAt = Date.now();
  };

  function connect(): void {
    if (closed) return;
    let opened: EventSource;
    try {
      opened = new EventSource('/api/auth/events', { withCredentials: true });
    } catch {
      scheduleReconnect();
      return;
    }
    source = opened;
    lastHeartbeatAt = Date.now();
    opened.addEventListener(AUTH_INVALIDATION_EVENT, onMessage as EventListener);
    opened.addEventListener(AUTH_HEARTBEAT_EVENT, onHeartbeat as EventListener);
    opened.onopen = () => {
      if (closed || source !== opened) return;
      // Do not reset the backoff immediately: a proxy can accept the headers
      // and then drop the stream repeatedly. Only a minute of stability counts.
      if (stableTimer) clearTimeout(stableTimer);
      stableTimer = setTimeout(() => {
        stableTimer = null;
        attempt = 0;
      }, STABLE_CONNECTION_MS);
      const unref = (stableTimer as { unref?: () => void }).unref;
      if (typeof unref === 'function') unref.call(stableTimer);
    };
    opened.onerror = () => {
      if (closed || source !== opened) return;
      // Close first so the native implementation cannot start its own 3-second
      // retry in parallel with the controlled one below.
      disposeSource();
      handlers.onError();
      scheduleReconnect();
    };
  }

  watchdogTimer = setInterval(() => {
    if (closed || !source) return;
    if (Date.now() - lastHeartbeatAt <= heartbeatTimeoutMs) return;
    // A proxy might keep the browser-side connection open after the upstream
    // stream has gone away. The heartbeat is the only reliable liveness signal
    // in that case, so close and reconnect with the normal capped backoff.
    disposeSource();
    handlers.onError();
    scheduleReconnect();
  }, watchdogIntervalMs);
  const unrefWatchdog = (watchdogTimer as { unref?: () => void }).unref;
  if (typeof unrefWatchdog === 'function') unrefWatchdog.call(watchdogTimer);

  connect();
  return close;
}
