/**
 * Same-origin UI synchronization for authentication changes. The event carries
 * only a reason and a timestamp: never a session token, cookie, user profile,
 * learning data, email address, or password.
 *
 * BroadcastChannel is preferred. When it is unavailable or throws, a
 * localStorage write emits a `storage` event in other same-origin tabs. Both
 * paths are safe to fail: the server session remains the authority and a later
 * request will still be rejected.
 */
export type AuthSyncReason = 'sign-out' | 'password-reset' | 'email-change' | 'account-deleted';

interface AuthSyncEvent {
  type: 'signed-out';
  reason: AuthSyncReason;
  at: number;
}

const CHANNEL_NAME = 'lq-auth-sync-v1';
const STORAGE_KEY = 'lq-auth-sync-v1';
const VALID_REASONS: AuthSyncReason[] = ['sign-out', 'password-reset', 'email-change', 'account-deleted'];

function isEvent(value: unknown): value is AuthSyncEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return event.type === 'signed-out'
    && typeof event.reason === 'string'
    && VALID_REASONS.includes(event.reason as AuthSyncReason)
    && typeof event.at === 'number'
    && Number.isFinite(event.at);
}

export function broadcastAuthSignOut(reason: AuthSyncReason): void {
  if (typeof window === 'undefined') return;
  const event: AuthSyncEvent = { type: 'signed-out', reason, at: Date.now() };
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

export function subscribeAuthSignOut(handler: (reason: AuthSyncReason) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  let channel: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = (message: MessageEvent) => {
        if (isEvent(message.data)) handler(message.data.reason);
      };
    }
  } catch {
    channel = null;
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      const parsed: unknown = JSON.parse(event.newValue);
      if (isEvent(parsed)) handler(parsed.reason);
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
