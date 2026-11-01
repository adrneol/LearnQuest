import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StoreProvider, useStore } from '../src/app/store.js';
import { PasswordResetScreen } from '../src/features/auth/AuthScreens.js';
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
  userId: 'user-two-tabs',
  email: 'tabs@example.test',
  username: 'tabs_learner',
  displayName: 'Tabs Learner',
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
    text: async () => (body === null ? '' : JSON.stringify(body)),
    json: async () => body,
  } as Response;
}

class FakeBroadcastChannel {
  static all = new Set<FakeBroadcastChannel>();
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(public readonly name: string) {
    FakeBroadcastChannel.all.add(this);
  }

  postMessage(data: unknown): void {
    for (const channel of [...FakeBroadcastChannel.all]) {
      if (channel === this || channel.name !== this.name) continue;
      channel.onmessage?.({ data } as MessageEvent);
    }
  }

  close(): void {
    FakeBroadcastChannel.all.delete(this);
  }

  static reset(): void {
    FakeBroadcastChannel.all.clear();
  }
}

function Tab({ label, allDevices = false }: { label: string; allDevices?: boolean }) {
  const s = useStore();
  return (
    <div>
      <p>{label}</p>
      <button type="button" onClick={() => { void s.signOut(allDevices); }}>Sign out {label}</button>
    </div>
  );
}

function TwoTabs({ allDevices = false }: { allDevices?: boolean }) {
  return (
    <>
      <StoreProvider mode="cloud"><Tab label="TAB A" allDevices={allDevices} /></StoreProvider>
      <StoreProvider mode="cloud"><Tab label="TAB B" allDevices={allDevices} /></StoreProvider>
    </>
  );
}

function mockAuthenticatedFetch(opts: { logoutStatus?: number } = {}): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith('/api/auth/session')) {
      return json({ authenticated: true, user: USER, csrfToken: 'csrf-session', ...CONFIG });
    }
    if (u.endsWith('/api/account/data')) return json({ ok: true, state: EMPTY_STATE, version: 0 });
    if (u.endsWith('/api/auth/password/reset/validate')) return json({ ok: true, valid: true });
    if (u.endsWith('/api/auth/password/reset')) return json(null, 204);
    if (u.endsWith('/api/auth/logout-all')) return json(null, 204);
    if (u.endsWith('/api/auth/logout')) {
      return opts.logoutStatus && opts.logoutStatus >= 400
        ? json({ error: 'The server could not revoke this session.' }, opts.logoutStatus)
        : json(null, 204);
    }
    return json({ error: 'not found' }, 404);
  }) as any;
  return calls;
}

beforeEach(() => {
  FakeBroadcastChannel.reset();
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  setCsrfToken(null);
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setCsrfToken(null);
  localStorage.clear();
  FakeBroadcastChannel.reset();
});

describe('two independently initialized same-browser tabs', () => {
  it('both validate the shared server session without showing a sign-in screen', async () => {
    const calls = mockAuthenticatedFetch();
    render(<TwoTabs />);

    expect(await screen.findByText('TAB A')).toBeInTheDocument();
    expect(await screen.findByText('TAB B')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull();
    expect(calls.filter((u) => u.endsWith('/api/auth/session'))).toHaveLength(2);
  });

  it.each(['TAB A', 'TAB B'])('signing out in %s clears every tab sharing the session', async (label) => {
    const calls = mockAuthenticatedFetch();
    render(<TwoTabs />);
    expect(await screen.findByText('TAB A')).toBeInTheDocument();
    expect(await screen.findByText('TAB B')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: `Sign out ${label}` }));

    await waitFor(() => {
      expect(screen.getAllByRole('heading', { name: 'Sign in' })).toHaveLength(2);
    });
    expect(screen.queryByText('TAB A')).toBeNull();
    expect(screen.queryByText('TAB B')).toBeNull();
    expect(calls.filter((u) => u.endsWith('/api/auth/logout'))).toHaveLength(1);
  });

  it('clears every tab before a slow server logout finishes', async () => {
    let resolveLogout!: (response: Response) => void;
    let markLogoutStarted!: () => void;
    const logoutStarted = new Promise<void>((resolve) => { markLogoutStarted = resolve; });
    const logoutResponse = new Promise<Response>((resolve) => { resolveLogout = resolve; });
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      if (u.endsWith('/api/auth/session')) {
        return json({ authenticated: true, user: USER, csrfToken: 'csrf-session', ...CONFIG });
      }
      if (u.endsWith('/api/account/data')) return json({ ok: true, state: EMPTY_STATE, version: 0 });
      if (u.endsWith('/api/auth/logout')) {
        markLogoutStarted();
        return logoutResponse;
      }
      return json({ error: 'not found' }, 404);
    }) as any;

    render(<TwoTabs />);
    expect(await screen.findByText('TAB A')).toBeInTheDocument();
    expect(await screen.findByText('TAB B')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out TAB A' }));
    await logoutStarted;

    // Both the initiating tab and its peer render the signed-out state while
    // the server request is still pending. The server response is never used
    // as the trigger for the local transition.
    await waitFor(() => {
      expect(screen.getAllByRole('heading', { name: 'Sign in' })).toHaveLength(2);
    });
    expect(screen.queryByText('TAB A')).toBeNull();
    expect(screen.queryByText('TAB B')).toBeNull();

    resolveLogout(json(null, 204));
  });

  it('clears every tab through sign-out-all and calls the revoke-all endpoint once', async () => {
    const calls = mockAuthenticatedFetch();
    render(<TwoTabs allDevices />);
    expect(await screen.findByText('TAB A')).toBeInTheDocument();
    expect(await screen.findByText('TAB B')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out TAB A' }));

    await waitFor(() => {
      expect(screen.getAllByRole('heading', { name: 'Sign in' })).toHaveLength(2);
    });
    expect(calls.filter((u) => u.endsWith('/api/auth/logout-all'))).toHaveLength(1);
    expect(calls.filter((u) => u.endsWith('/api/auth/logout'))).toHaveLength(0);
  });

  it('clears every tab but reports an unconfirmed server logout instead of claiming success', async () => {
    const calls = mockAuthenticatedFetch({ logoutStatus: 503 });
    render(<TwoTabs />);
    expect(await screen.findByText('TAB A')).toBeInTheDocument();
    expect(await screen.findByText('TAB B')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out TAB A' }));

    await waitFor(() => {
      expect(screen.getAllByRole('heading', { name: 'Sign in' })).toHaveLength(2);
    });
    expect(screen.getAllByText(/could not confirm sign-out/i).length).toBeGreaterThanOrEqual(1);
    expect(calls.filter((u) => u.endsWith('/api/auth/logout'))).toHaveLength(1);
  });

  it('clears every open tab after a successful password reset without exposing the reset token', async () => {
    const calls = mockAuthenticatedFetch();
    render(
      <>
        <TwoTabs />
        <PasswordResetScreen token="opaque-reset-token" onExit={() => undefined} />
      </>,
    );
    expect(await screen.findByText('TAB A')).toBeInTheDocument();
    expect(await screen.findByText('TAB B')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-long-new-password' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a-long-new-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));

    await waitFor(() => {
      expect(screen.getAllByRole('heading', { name: 'Sign in' })).toHaveLength(2);
    });
    expect(screen.getByRole('heading', { name: 'Password reset complete' })).toBeInTheDocument();
    expect(calls.filter((u) => u.endsWith('/api/auth/password/reset'))).toHaveLength(1);
    expect(calls.filter((u) => u.endsWith('/api/auth/logout') || u.endsWith('/api/auth/logout-all'))).toHaveLength(0);
    expect(JSON.stringify(localStorage)).not.toContain('opaque-reset-token');
  });

  it('uses the canonical sign-out broadcast from the account error screen', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const calls: string[] = [];
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      calls.push(u);
      if (u.endsWith('/api/auth/session')) throw new Error('account service unavailable');
      if (u.endsWith('/api/auth/logout')) return json(null, 204);
      return json({ error: 'not found' }, 404);
    }) as any;
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem');

    render(<StoreProvider mode="cloud"><div>APP CONTENT</div></StoreProvider>);
    expect(await screen.findByRole('heading', { name: 'Your account data is unavailable' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(calls.some((u) => u.endsWith('/api/auth/logout'))).toBe(true));
    await waitFor(() => {
      expect(storageSpy.mock.calls.some(([key]) => key === 'lq-auth-sync-v2')).toBe(true);
    });
    expect(screen.queryByText('APP CONTENT')).toBeNull();
  });

  it('does not broadcast or claim success when a password reset fails', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      if (u.endsWith('/api/auth/password/reset/validate')) return json({ ok: true, valid: true });
      if (u.endsWith('/api/auth/password/reset')) {
        return json({ error: 'The account service is unavailable. Your password was not changed.' }, 503);
      }
      return json({ error: 'not found' }, 404);
    }) as any;
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem');

    render(<PasswordResetScreen token="opaque-reset-token" onExit={() => undefined} />);
    expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-long-new-password' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a-long-new-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));

    expect(await screen.findByText(/password was not changed/i)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Password reset complete' })).toBeNull();
    expect(storageSpy.mock.calls.some(([key]) => key === 'lq-auth-sync-v2')).toBe(false);
  });

  it('clears both tabs through the storage fallback when BroadcastChannel is unavailable', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    mockAuthenticatedFetch();
    render(<TwoTabs />);
    expect(await screen.findByText('TAB A')).toBeInTheDocument();
    expect(await screen.findByText('TAB B')).toBeInTheDocument();

    window.dispatchEvent(new StorageEvent('storage', {
      key: STORAGE_KEY,
      newValue: JSON.stringify({ type: 'signed-out', reason: 'sign-out', at: Date.now() }),
    }));

    await waitFor(() => {
      expect(screen.getAllByRole('heading', { name: 'Sign in' })).toHaveLength(2);
    });
    expect(screen.getAllByText(/You were signed out in another tab/i)).toHaveLength(2);
  });
});
