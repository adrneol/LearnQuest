import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { StoreProvider, useStore } from '../src/app/store.js';
import {
  openAuthInvalidationStream,
  parseAuthInvalidationPayload,
} from '../src/app/authEvents.js';
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
  emailActionTtlMin: 30,
};

const USER: AuthUser = {
  userId: 'user-server-events',
  email: 'events@example.test',
  username: 'events_learner',
  displayName: 'Events Learner',
  onboardingComplete: true,
  timezone: 'UTC',
  sessionLenMin: 25,
  breakMin: 5,
  minViableMin: 10,
  createdAt: '2026-10-01T00:00:00.000Z',
  hasPassword: true,
  googleLinked: false,
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

const realFetch = globalThis.fetch;

type Listener = (event: MessageEvent) => void;

/** Minimal EventSource double: it records construction and delivers real event objects. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  readonly withCredentials: boolean;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly readyState = 0;
  closed = false;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(url: string, options?: EventSourceInit) {
    this.url = url;
    this.withCredentials = options?.withCredentials === true;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
    this.onopen = null;
    this.onerror = null;
  }

  emit(type: string, data: string): void {
    if (this.closed) return;
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(new MessageEvent(type, { data }));
    }
  }

  emitOpen(): void {
    if (!this.closed) this.onopen?.(new Event('open'));
  }

  fail(): void {
    if (!this.closed) this.onerror?.(new Event('error'));
  }

  static reset(): void {
    FakeEventSource.instances = [];
  }
}

function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === null ? '' : JSON.stringify(body)),
    json: async () => body,
  } as Response;
}

function mockAuthenticatedFetch(options: { revokeSessionAfterLogin?: boolean } = {}): {
  calls: string[];
  revokeSession: () => void;
} {
  const calls: string[] = [];
  let sessionValid = true;
  globalThis.fetch = (async (url: unknown) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith('/api/auth/session')) {
      if (!sessionValid) {
        return json({
          authenticated: false,
          setupRequired: false,
          onboardingRequired: false,
          ...CONFIG,
        });
      }
      return json({ authenticated: true, user: USER, csrfToken: 'csrf-session', ...CONFIG });
    }
    if (u.endsWith('/api/account/data')) return json({ ok: true, state: EMPTY_STATE, version: 0 });
    if (u.endsWith('/api/auth/logout')) return json(null, 204);
    return json({ error: 'not found' }, 404);
  }) as typeof fetch;
  return {
    calls,
    revokeSession: () => {
      if (options.revokeSessionAfterLogin) sessionValid = false;
    },
  };
}

function Tab({ label }: { label: string }) {
  const store = useStore();
  return (
    <div>
      <p>{label}</p>
      <button type="button" onClick={() => { void store.signOut(false); }}>Sign out {label}</button>
      <button type="button" onClick={() => { void store.refreshSession(); }}>Refresh {label}</button>
    </div>
  );
}

function OneTab() {
  return <StoreProvider mode="cloud"><Tab label="TAB A" /></StoreProvider>;
}

function TwoTabs() {
  return (
    <>
      <StoreProvider mode="cloud"><Tab label="TAB A" /></StoreProvider>
      <StoreProvider mode="cloud"><Tab label="TAB B" /></StoreProvider>
    </>
  );
}

beforeEach(() => {
  FakeEventSource.reset();
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('BroadcastChannel', undefined);
  setCsrfToken(null);
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setCsrfToken(null);
  localStorage.clear();
  sessionStorage.clear();
  FakeEventSource.reset();
});

describe('auth invalidation payload parser', () => {
  it.each([
    ['sessions-revoked', '{"type":"auth-invalidated","reason":"sessions-revoked"}'],
    ['password-reset', '{"type":"auth-invalidated","reason":"password-reset"}'],
  ] as const)('accepts the exact %s payload', (expected, payload) => {
    expect(parseAuthInvalidationPayload(payload)).toBe(expected);
  });

  it.each([
    ['not json', '{not-json'],
    ['empty string', ''],
    ['array', '[]'],
    ['null', 'null'],
    ['wrong type', '{"type":"signed-in","reason":"sessions-revoked"}'],
    ['unknown reason', '{"type":"auth-invalidated","reason":"token-expired"}'],
    ['missing reason', '{"type":"auth-invalidated"}'],
    ['numeric reason', '{"type":"auth-invalidated","reason":1}'],
    ['extra account field', '{"type":"auth-invalidated","reason":"sessions-revoked","userId":"u1"}'],
    ['extra token field', '{"type":"auth-invalidated","reason":"password-reset","token":"secret"}'],
    ['oversized payload', `{"type":"auth-invalidated","reason":"sessions-revoked","pad":"${'x'.repeat(600)}"}`],
  ])('rejects %s without changing authentication state', (_label, payload) => {
    expect(parseAuthInvalidationPayload(payload)).toBeNull();
  });

  it('rejects non-string messages', () => {
    expect(parseAuthInvalidationPayload(undefined)).toBeNull();
    expect(parseAuthInvalidationPayload({ type: 'auth-invalidated', reason: 'sessions-revoked' })).toBeNull();
  });
});

describe('authenticated invalidation stream helper', () => {
  it('opens one credentialed same-origin stream without putting credentials in the URL', () => {
    const close = openAuthInvalidationStream({ onInvalidate: () => undefined, onError: () => undefined });

    expect(FakeEventSource.instances).toHaveLength(1);
    const source = FakeEventSource.instances[0];
    expect(source.url).toBe('/api/auth/events');
    expect(source.url).not.toContain('?');
    expect(source.url).not.toContain('token');
    expect(source.url).not.toContain('cookie');
    expect(source.withCredentials).toBe(true);

    close();
    expect(source.closed).toBe(true);
  });

  it('delivers a valid invalidation exactly once, closes the stream, and ignores repeats', () => {
    const onInvalidate = vi.fn();
    const onError = vi.fn();
    openAuthInvalidationStream({ onInvalidate, onError });
    const source = FakeEventSource.instances[0];

    source.emit('auth-invalidated', '{"type":"auth-invalidated","reason":"sessions-revoked"}');
    source.emit('auth-invalidated', '{"type":"auth-invalidated","reason":"sessions-revoked"}');
    source.fail();

    expect(onInvalidate).toHaveBeenCalledTimes(1);
    expect(onInvalidate).toHaveBeenCalledWith('sessions-revoked');
    expect(source.closed).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it('ignores malformed and non-allow-listed messages without closing or authenticating', () => {
    const onInvalidate = vi.fn();
    openAuthInvalidationStream({ onInvalidate, onError: () => undefined });
    const source = FakeEventSource.instances[0];

    source.emit('auth-invalidated', '{"type":"auth-invalidated","reason":"sessions-revoked","userId":"u1"}');
    source.emit('auth-invalidated', '{"type":"auth-invalidated","reason":"made-up"}');
    source.emit('auth-invalidated', 'not-json');

    expect(onInvalidate).not.toHaveBeenCalled();
    expect(source.closed).toBe(false);
  });

  it('closes a failed stream and reports one error before a controlled reconnect', () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const close = openAuthInvalidationStream(
      { onInvalidate: () => undefined, onError },
      { reconnectDelaysMs: [5_000] },
    );
    const first = FakeEventSource.instances[0];

    first.fail();
    first.fail();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(first.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(1);

    vi.advanceTimersByTime(4_999);
    expect(FakeEventSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(2);
    const second = FakeEventSource.instances[1];
    expect(second.closed).toBe(false);

    close();
    expect(second.closed).toBe(true);
    vi.useRealTimers();
  });

  it('reconnects when a proxy keeps a dead stream open without heartbeats', () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const close = openAuthInvalidationStream(
      { onInvalidate: () => undefined, onError },
      {
        reconnectDelaysMs: [5_000],
        heartbeatTimeoutMs: 20_000,
        watchdogIntervalMs: 5_000,
      },
    );
    const first = FakeEventSource.instances[0];
    first.emitOpen();

    vi.advanceTimersByTime(20_000);
    expect(first.closed).toBe(false);
    vi.advanceTimersByTime(5_000);
    expect(first.closed).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5_000);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances.filter((source) => !source.closed)).toHaveLength(1);

    // A real heartbeat resets the liveness window.
    const second = FakeEventSource.instances[1];
    second.emitOpen();
    vi.advanceTimersByTime(15_000);
    second.emit('heartbeat', '{}');
    vi.advanceTimersByTime(15_000);
    expect(second.closed).toBe(false);

    close();
    expect(second.closed).toBe(true);
    vi.useRealTimers();
  });

  it('never keeps more than one stream open while repeated reconnects fail', () => {
    vi.useFakeTimers();
    const close = openAuthInvalidationStream(
      { onInvalidate: () => undefined, onError: () => undefined },
      { reconnectDelaysMs: [1_000, 2_000] },
    );

    // A proxy can accept the headers and then drop the stream. An `open` that
    // immediately fails must not reset the backoff to the shortest delay.
    FakeEventSource.instances[0].emitOpen();
    FakeEventSource.instances[0].fail();
    vi.advanceTimersByTime(1_000);
    expect(FakeEventSource.instances).toHaveLength(2);

    FakeEventSource.instances[1].emitOpen();
    FakeEventSource.instances[1].fail();
    vi.advanceTimersByTime(1_999);
    expect(FakeEventSource.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(3);

    expect(FakeEventSource.instances.filter((source) => !source.closed)).toHaveLength(1);
    close();
    expect(FakeEventSource.instances.filter((source) => !source.closed)).toHaveLength(0);
    vi.useRealTimers();
  });

  it('is a safe no-op when EventSource is unavailable', () => {
    vi.stubGlobal('EventSource', undefined);
    const close = openAuthInvalidationStream({
      onInvalidate: () => undefined,
      onError: () => undefined,
    });
    expect(() => close()).not.toThrow();
  });
});

describe('canonical sign-out after server-pushed invalidation', () => {
  it('opens exactly one authenticated stream per provider and signs both clients out', async () => {
    const mock = mockAuthenticatedFetch();
    render(<TwoTabs />);

    expect(await screen.findByText('TAB A')).toBeInTheDocument();
    expect(await screen.findByText('TAB B')).toBeInTheDocument();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    expect(FakeEventSource.instances.every((source) => source.url === '/api/auth/events')).toBe(true);
    expect(FakeEventSource.instances.every((source) => source.withCredentials)).toBe(true);

    act(() => {
      for (const source of FakeEventSource.instances) {
        source.emit(
          'auth-invalidated',
          '{"type":"auth-invalidated","reason":"sessions-revoked"}',
        );
      }
    });

    await waitFor(() => {
      expect(screen.getAllByRole('heading', { name: 'Sign in' })).toHaveLength(2);
    });
    expect(screen.getAllByText(/signed out on another device or browser/i)).toHaveLength(2);
    expect(FakeEventSource.instances.every((source) => source.closed)).toBe(true);
    expect(mock.calls.filter((url) => url.endsWith('/api/auth/logout-all'))).toHaveLength(0);
    expect(mock.calls.filter((url) => url.endsWith('/api/auth/logout'))).toHaveLength(0);

    const storage = JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    });
    for (const secret of [USER.userId, USER.email, USER.username, 'csrf-session']) {
      expect(storage).not.toContain(secret);
    }
  });

  it('keeps one connection across unrelated state refreshes', async () => {
    mockAuthenticatedFetch();
    render(<OneTab />);
    expect(await screen.findByText('TAB A')).toBeInTheDocument();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0];

    act(() => {
      screen.getByRole('button', { name: 'Refresh TAB A' }).click();
    });
    await waitFor(() => expect(screen.getByText('TAB A')).toBeInTheDocument());

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(source.closed).toBe(false);
  });

  it('signs out immediately when a reconnect is rejected by the server', async () => {
    const mock = mockAuthenticatedFetch({ revokeSessionAfterLogin: true });
    render(<OneTab />);
    expect(await screen.findByText('TAB A')).toBeInTheDocument();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0];
    mock.revokeSession();

    act(() => {
      source.fail();
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    });
    expect(screen.getByText(/session ended or was signed out on another device/i)).toBeInTheDocument();
    await waitFor(() => expect(source.closed).toBe(true));
  });

  it('closes the stream when the user signs out locally', async () => {
    mockAuthenticatedFetch();
    render(<OneTab />);
    expect(await screen.findByText('TAB A')).toBeInTheDocument();
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    const source = FakeEventSource.instances[0];

    act(() => {
      screen.getByRole('button', { name: 'Sign out TAB A' }).click();
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    });
    await waitFor(() => expect(source.closed).toBe(true));
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
