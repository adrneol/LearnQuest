/**
 * Same-origin UI synchronization for authentication changes. The event carries
 * only a reason, timestamp, a non-secret generation counter, and the sender's
 * random tab id: never a session token, cookie, user profile, learning data,
 * email address, or password.
 *
 * BroadcastChannel is preferred. When it is unavailable or throws, a
 * localStorage write emits a `storage` event in other same-origin tabs. Both
 * paths are safe to fail: the server session remains the authority and a later
 * request will still be rejected.
 *
 * BroadcastChannel can deliver a message to another channel object in the same
 * tab. The sender id lets a tab ignore that echo; otherwise a successful login
 * would immediately revalidate its own cookie and could clear the new session.
 *
 * v2 adds `sign-in` and `sign-out-unconfirmed`, so an older tab cannot keep
 * showing the previous account after another tab signs in, and a failed server
 * logout still clears every same-browser tab. Receivers accept only a strict
 * v2 shape from the current channel/key, a strict legacy v1 shape from the
 * legacy key, and ignore stale, future-dated, duplicate, or malformed events.
 */
export type AuthSyncReason =
  | 'sign-in'
  | 'sign-out'
  | 'sign-out-unconfirmed'
  | 'password-reset'
  | 'email-change'
  | 'account-deleted';

interface AuthSyncEvent {
  type: 'auth-change';
  reason: AuthSyncReason;
  at: number;
  /** Non-secret optimistic counter; receivers still revalidate the server. */
  generation: number;
  /** Random per-page-load sender id; never linked to an account. */
  sourceId: string;
}

const CHANNEL_NAME = 'lq-auth-sync-v2';
const STORAGE_KEY = 'lq-auth-sync-v2';
const LEGACY_STORAGE_KEY = 'lq-auth-sync-v1';
const VALID_REASONS: AuthSyncReason[] = [
  'sign-in', 'sign-out', 'sign-out-unconfirmed', 'password-reset', 'email-change', 'account-deleted',
];
// A notification is only useful while the action is current. Ignoring old
// signals prevents a delayed event from signing out a tab that has since
// signed back in; a skipped signal is still caught by the server on the next
// authenticated request or by the visibility revalidation check.
const MAX_EVENT_AGE_MS = 30_000;
const MAX_FUTURE_SKEW_MS = 5_000;
const MAX_SOURCE_ID_LENGTH = 128;
const MAX_SEEN_SOURCES = 64;
let generation = 0;

/**
 * Random, non-secret identity for one auth-sync endpoint. The value carries no
 * account or device data; it only suppresses a sender's own broadcast echo.
 * `crypto.randomUUID`/`getRandomValues` is preferred. The last-resort fallback
 * uses time and a high-resolution counter because this identifier is not a
 * credential; if it collides, the worst case is one ignored UI notification,
 * while the server session remains authoritative.
 */
export function createAuthSyncSourceId(): string {
  try {
    if (typeof crypto !== 'undefined') {
      if (typeof crypto.randomUUID === 'function') return `tab-${crypto.randomUUID()}`;
      if (typeof crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return `tab-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
      }
    }
  } catch {
    // Fall through to the non-security uniqueness fallback.
  }
  return `tab-${Date.now().toString(36)}-${Math.round(performance.now() * 1000).toString(36)}`;
}

/** Default endpoint identity for callers that do not own a provider scope. */
export const AUTH_SYNC_TAB_ID = createAuthSyncSourceId();

function isReason(value: unknown): value is AuthSyncReason {
  return typeof value === 'string' && VALID_REASONS.includes(value as AuthSyncReason);
}

interface ParsedAuthSyncEvent {
  reason: AuthSyncReason;
  sourceId: string | null;
  generation: number | null;
  at: number;
}

function parseEvent(value: unknown, shape: 'v2' | 'v1'): ParsedAuthSyncEvent | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as Record<string, unknown>;
  if (!isReason(event.reason)) return null;
  if (typeof event.at !== 'number' || !Number.isFinite(event.at)) return null;

  if (shape === 'v1') {
    if (event.type !== 'signed-out') return null;
    return { reason: event.reason, sourceId: null, generation: null, at: event.at };
  }

  if (event.type !== 'auth-change') return null;
  if (
    typeof event.generation !== 'number'
    || !Number.isSafeInteger(event.generation)
    || event.generation <= 0
  ) return null;
  if (
    typeof event.sourceId !== 'string'
    || event.sourceId.length === 0
    || event.sourceId.length > MAX_SOURCE_ID_LENGTH
  ) return null;
  return {
    reason: event.reason,
    sourceId: event.sourceId,
    generation: event.generation,
    at: event.at,
  };
}

function isFresh(at: number, now = Date.now()): boolean {
  const age = now - at;
  return Number.isFinite(age)
    && age >= -MAX_FUTURE_SKEW_MS
    && age <= MAX_EVENT_AGE_MS;
}

export function broadcastAuthChange(
  reason: AuthSyncReason,
  sourceId: string = AUTH_SYNC_TAB_ID,
): void {
  if (typeof window === 'undefined') return;
  generation += 1;
  const event: AuthSyncEvent = {
    type: 'auth-change',
    reason,
    at: Date.now(),
    generation,
    sourceId,
  };
  let sentWithChannel = false;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channel.postMessage(event);
      channel.close();
      sentWithChannel = true;
    }
  } catch {
    sentWithChannel = false;
  }
  if (sentWithChannel) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(event));
  } catch {
    // Both notification mechanisms are best-effort. The server rejection on
    // the next authenticated request remains authoritative.
  }
}

/** Backward-compatible name used by existing sign-out paths. */
export function broadcastAuthSignOut(reason: AuthSyncReason, sourceId?: string): void {
  broadcastAuthChange(reason, sourceId);
}

export function broadcastAuthSignIn(sourceId?: string): void {
  broadcastAuthChange('sign-in', sourceId);
}

export function subscribeAuthChange(
  handler: (reason: AuthSyncReason) => void,
  sourceId: string = AUTH_SYNC_TAB_ID,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const seenGenerations = new Map<string, number>();

  const accept = (parsed: ParsedAuthSyncEvent): boolean => {
    if (parsed.sourceId === sourceId) return false;
    if (!isFresh(parsed.at)) return false;
    if (!parsed.sourceId || parsed.generation === null) return true;
    const previous = seenGenerations.get(parsed.sourceId) ?? 0;
    if (parsed.generation <= previous) return false;
    seenGenerations.delete(parsed.sourceId);
    seenGenerations.set(parsed.sourceId, parsed.generation);
    if (seenGenerations.size > MAX_SEEN_SOURCES) {
      const oldest = seenGenerations.keys().next().value;
      if (oldest) seenGenerations.delete(oldest);
    }
    return true;
  };

  let channel: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (message: MessageEvent) => {
        const parsed = parseEvent(message.data, 'v2');
        if (parsed && accept(parsed)) handler(parsed.reason);
      };
    }
  } catch {
    channel = null;
  }

  const onStorage = (event: StorageEvent) => {
    if ((event.key !== STORAGE_KEY && event.key !== LEGACY_STORAGE_KEY) || !event.newValue) return;
    try {
      const parsed = parseEvent(
        JSON.parse(event.newValue),
        event.key === LEGACY_STORAGE_KEY ? 'v1' : 'v2',
      );
      if (parsed && accept(parsed)) handler(parsed.reason);
    } catch {
      // Ignore malformed or unrelated storage values.
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    channel?.close();
    window.removeEventListener('storage', onStorage);
  };
}

/** Backward-compatible name used by existing store wiring/tests. */
export function subscribeAuthSignOut(
  handler: (reason: AuthSyncReason) => void,
  sourceId?: string,
): () => void {
  return subscribeAuthChange(handler, sourceId);
}
