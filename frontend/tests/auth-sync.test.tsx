import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StoreProvider } from '../src/app/store.js';
import { broadcastAuthSignOut, subscribeAuthSignOut } from '../src/app/authSync.js';
import { setCsrfToken } from '../src/services/api/http.js';
import type { AuthConfig, AuthUser } from '../src/services/api/authApi.js';

const CONFIG: AuthConfig = {
  nodeEnv: 'production',
  authEnabled: true,
  setupRequired: false,
  configured: {
    mongodb: true,
    google: true,
    brevo: true,
    session: true,
    emailLinks: true,
    youtube: false,
  },
  missing: [],
  cookieSecure: true,
  appOrigin: 'https://learn-quest-one.vercel.app',
};

const USER: AuthUser = {
  userId: 'user-sync',
  email: 'sync@example.test',
  username: 'sync_learner',
  displayName: 'Sync Learner',
  onboardingComplete: true,
  timezone: 'UTC',
  sessionLenMin: 25,
  breakMin: 5,
  minViableMin: 10,
  createdAt: '2026-10-01T00:00:00.000Z',
  hasPassword: true,
  googleLinked: true,
};

const EMPTY_STATE = {
  playlists: {}, meta: {}, activeId: null, progress: {}, ranges: [], checkpoints: [],
  modules: [], sessions: [], goals: {}, xp: [], achievements: {}, segments: [],
  playSessions: [], queue: {}, flexGoals: [],
  challenge: {
    seed: 20261013,
    cohortSize: 100,
    tierDist: { Ultra: 2, High: 8, Good: 20, Normal: 30, Average: 25, 'Below Average': 15 },
    windowDays: 14,
    dailyCapHours: 6,
  },
  challengeEnabled: false,
  rankHistory: [],
  settings: { verifiedThreshold: 0.9 },
  prefs: { timezone: 'UTC', sessionLenMin: 25, breakMin: 5, reducedMotion: false, minViableMin: 10 },
};

const STORAGE_KEY = 'lq-auth-sync-v1';
const realFetch = globalThis.fetch;

function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

function emitStorageSignOut(reason = 'sign-out') {
  window.dispatchEvent(new StorageEvent('storage', {
    key: STORAGE_KEY,
    newValue: JSON.stringify({ type: 'signed-out', reason, at: Date.now() }),
  }));
}

beforeEach(() => {
  setCsrfToken(null);
  localStorage.clear();
  window.location.hash = '';
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setCsrfToken(null);
});

describe('cross-tab auth sync messages', () => {
  it('broadcasts only a reason and timestamp through BroadcastChannel', () => {
    const sent: Array<{ name: string; data: any }> = [];
    class FakeBroadcastChannel {
      onmessage: ((event: MessageEvent) => void) | null = null;
      constructor(public name: string) {}
      postMessage(data: any) { sent.push({ name: this.name, data }); }
      close() {}
    }
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem');

    broadcastAuthSignOut('sign-out');

    expect(sent).toHaveLength(1);
    expect(sent[0].name).toBe('lq-auth-sync-v1');
    expect(Object.keys(sent[0].data).sort()).toEqual(['at', 'reason', 'type']);
    expect(sent[0].data).toMatchObject({ type: 'signed-out', reason: 'sign-out' });
    expect(typeof sent[0].data.at).toBe('number');
    // BroadcastChannel succeeded, so no storage fallback write is made.
    expect(storageSpy).not.toHaveBeenCalledWith(STORAGE_KEY, expect.anything());
    const serialized = JSON.stringify(sent[0].data);
    expect(serialized).not.toMatch(/token|cookie|email|password|user/i);
  });

  it('falls back to a same-origin storage event when BroadcastChannel is unavailable', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem');

    broadcastAuthSignOut('password-reset');

    expect(storageSpy).toHaveBeenCalledTimes(1);
    const [key, raw] = storageSpy.mock.calls[0];
    expect(key).toBe(STORAGE_KEY);
    const parsed = JSON.parse(String(raw));
    expect(parsed).toMatchObject({ type: 'signed-out', reason: 'password-reset' });
    expect(Object.keys(parsed).sort()).toEqual(['at', 'reason', 'type']);
    expect(String(raw)).not.toMatch(/token|cookie|@|userid/i);
  });

  it('falls back to storage when constructing BroadcastChannel throws', () => {
    vi.stubGlobal('BroadcastChannel', class {
      constructor() { throw new Error('BroadcastChannel blocked'); }
    });
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem');

    broadcastAuthSignOut('account-deleted');

    expect(storageSpy).toHaveBeenCalledWith(STORAGE_KEY, expect.any(String));
    expect(JSON.parse(storageSpy.mock.calls[0][1])).toMatchObject({
      type: 'signed-out',
      reason: 'account-deleted',
    });
  });

  it('delivers valid storage fallbacks and ignores malformed or unknown reasons', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const handler = vi.fn();
    const unsubscribe = subscribeAuthSignOut(handler);

    emitStorageSignOut('email-change');
    expect(handler).toHaveBeenCalledWith('email-change');

    handler.mockClear();
    window.dispatchEvent(new StorageEvent('storage', {
      key: STORAGE_KEY,
      newValue: JSON.stringify({ type: 'signed-out', reason: 'session-token-is-not-a-reason', at: 1 }),
    }));
    window.dispatchEvent(new StorageEvent('storage', {
      key: STORAGE_KEY,
      newValue: '{not-json',
    }));
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'unrelated-app-key',
      newValue: JSON.stringify({ type: 'signed-out', reason: 'sign-out', at: 1 }),
    }));
    expect(handler).not.toHaveBeenCalled();

    unsubscribe();
    emitStorageSignOut('sign-out');
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('store integration with cross-tab sign-out', () => {
  it('clears the authenticated UI when another tab signs out', async () => {
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      if (u.endsWith('/api/auth/session')) {
        return json({ authenticated: true, user: USER, csrfToken: 'csrf-session', ...CONFIG });
      }
      if (u.endsWith('/api/account/data')) return json({ ok: true, state: EMPTY_STATE, version: 0 });
      return json({ error: 'not found' }, 404);
    }) as any;
    localStorage.setItem('lq-focus-timer-v1', '{"startedAt":1}');

    render(
      <StoreProvider mode="cloud">
        <div>APP CONTENT</div>
      </StoreProvider>,
    );
    expect(await screen.findByText('APP CONTENT')).toBeInTheDocument();

    emitStorageSignOut('sign-out');

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('APP CONTENT')).toBeNull();
    expect(screen.getByText(/You were signed out in another tab/i)).toBeInTheDocument();
    expect(localStorage.getItem('lq-focus-timer-v1')).toBeNull();
  });

  it('shows the sign-in form and clears account state when the server rejects the session', async () => {
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      if (u.endsWith('/api/auth/session')) {
        return json({ authenticated: true, user: USER, csrfToken: 'csrf-session', ...CONFIG });
      }
      if (u.endsWith('/api/account/data')) return json({ ok: true, state: EMPTY_STATE, version: 0 });
      return json({ error: 'not found' }, 404);
    }) as any;
    localStorage.setItem('lq-focus-timer-v1', '{"startedAt":1}');

    render(
      <StoreProvider mode="cloud">
        <div>APP CONTENT</div>
      </StoreProvider>,
    );
    expect(await screen.findByText('APP CONTENT')).toBeInTheDocument();

    window.dispatchEvent(new CustomEvent('lq:auth-expired'));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText(/Your session ended or was signed out elsewhere/i)).toBeInTheDocument();
    expect(screen.queryByText('APP CONTENT')).toBeNull();
    expect(screen.queryByText(/account data is unavailable/i)).toBeNull();
    expect(localStorage.getItem('lq-focus-timer-v1')).toBeNull();
  });

  it('does not let a late login response repopulate a session after another tab signs out', async () => {
    let resolveLogin!: (response: Response) => void;
    const loginResponse = new Promise<Response>((resolve) => { resolveLogin = resolve; });
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      if (u.endsWith('/api/auth/session')) {
        return json({ authenticated: false, ...CONFIG });
      }
      if (u.endsWith('/api/auth/login')) return loginResponse;
      return json({ error: 'not found' }, 404);
    }) as any;

    render(
      <StoreProvider mode="cloud">
        <div>APP CONTENT</div>
      </StoreProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Username or email'), { target: { value: 'sync_learner' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery staple' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    emitStorageSignOut('sign-out');
    resolveLogin(json({ authenticated: true, user: USER, csrfToken: 'csrf-late' }));

    expect(await screen.findByText(/A sign-out happened in another tab while this request was in progress/i)).toBeInTheDocument();
    expect(screen.queryByText('APP CONTENT')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('keeps password recovery free of a cross-tab sign-out warning when this tab was already signed out', async () => {
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      if (u.endsWith('/api/auth/session')) return json({ authenticated: false, ...CONFIG });
      if (u.endsWith('/api/auth/forgot')) {
        return json({ ok: true, message: 'If an eligible account matches, a reset link will be sent.' }, 202);
      }
      return json({ error: 'not found' }, 404);
    }) as any;

    render(
      <StoreProvider mode="cloud">
        <div>APP CONTENT</div>
      </StoreProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();

    emitStorageSignOut('sign-out');
    expect(screen.queryByText(/You were signed out in another tab/i)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Reset your password' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Username or email'), { target: { value: 'learner' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send password reset link' }));
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.queryByText(/You were signed out in another tab/i)).toBeNull();
  });

  it('keeps a standalone reset-link screen free of a stale workspace sign-out notice', async () => {
    window.location.hash = '#/reset-password?token=opaque-reset-token-abcdefghijklmnopqrstuvwxyz';
    globalThis.fetch = (async (url: any) => {
      if (String(url).endsWith('/api/auth/session')) return json({ authenticated: false, ...CONFIG });
      if (String(url).endsWith('/api/auth/password/reset/validate')) return json({ ok: true, valid: true });
      return json({ error: 'not found' }, 404);
    }) as any;

    render(
      <StoreProvider mode="cloud">
        <div>APP CONTENT</div>
      </StoreProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
    emitStorageSignOut('password-reset');
    expect(screen.getByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
    expect(screen.queryByText(/signed out in another tab/i)).toBeNull();
    expect(screen.queryByText(/password was reset in another tab/i)).toBeNull();
  });

  it('does not let a late account load repopulate data after another tab signs out', async () => {
    let resolveData!: (response: Response) => void;
    let markDataRequested!: () => void;
    const dataRequested = new Promise<void>((resolve) => { markDataRequested = resolve; });
    const dataResponse = new Promise<Response>((resolve) => { resolveData = resolve; });
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      if (u.endsWith('/api/auth/session')) {
        return json({ authenticated: true, user: USER, csrfToken: 'csrf-session', ...CONFIG });
      }
      if (u.endsWith('/api/account/data')) {
        markDataRequested();
        return dataResponse;
      }
      return json({ error: 'not found' }, 404);
    }) as any;

    render(
      <StoreProvider mode="cloud">
        <div>APP CONTENT</div>
      </StoreProvider>,
    );
    await dataRequested;

    emitStorageSignOut('password-reset');
    resolveData(json({ ok: true, state: EMPTY_STATE, version: 0 }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText(/Your password was reset in another tab/i)).toBeInTheDocument();
    expect(screen.queryByText('APP CONTENT')).toBeNull();
  });
});
