import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StoreProvider } from '../src/app/store.js';
import { AuthScreens } from '../src/features/auth/AuthScreens.js';
import {
  passwordLogin, validateAuthConfig, validateSessionResponse,
} from '../src/services/api/authApi.js';
import { apiRequest, setCsrfToken } from '../src/services/api/http.js';
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
  userId: 'user-1',
  email: 'learner@example.test',
  username: 'learner',
  displayName: 'Learner',
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

function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

const realFetch = globalThis.fetch;
const realHash = window.location.hash;

beforeEach(() => {
  window.location.hash = '';
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  globalThis.fetch = realFetch;
  window.location.hash = realHash;
  vi.restoreAllMocks();
});

describe('auth response boundary (MongoDB render regression)', () => {
  it('rejects a session response without configuration instead of reading .mongodb from undefined', async () => {
    expect(() => validateAuthConfig({ authenticated: false })).toThrow(/configuration/i);
    expect(() => validateSessionResponse({ authenticated: false })).toThrow(/configuration/i);

    globalThis.fetch = (async () => json({ authenticated: false })) as any;
    render(
      <StoreProvider mode="cloud">
        <div>APP CONTENT</div>
      </StoreProvider>,
    );
    expect(await screen.findByText(/account service did not return its configuration status|incompatible configuration/i)).toBeInTheDocument();
    expect(screen.queryByText('APP CONTENT')).toBeNull();
    expect(screen.queryByText(/reading 'mongodb'/i)).toBeNull();
    expect(screen.queryByText(/Something went wrong in this view/i)).toBeNull();
  });

  it('never turns a partial authenticated response into a session', () => {
    expect(() => validateSessionResponse({
      ...CONFIG,
      authenticated: true,
      user: USER,
      // csrfToken intentionally missing
    })).toThrow(/complete profile or security token/i);
    expect(() => validateSessionResponse({
      ...CONFIG,
      authenticated: true,
      csrfToken: 'csrf',
      // user intentionally missing
    })).toThrow(/complete profile or security token/i);
  });

  it('accepts a password login response without configuration and does not overwrite setup', async () => {
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      if (u.endsWith('/api/auth/session')) return json({ authenticated: false, ...CONFIG });
      if (u.endsWith('/api/auth/login')) {
        // Deliberately no config fields: the login endpoint is an auth
        // response, not a configuration payload. The old code assigned this
        // object to `setup`, then crashed reading `setup.configured.mongodb`.
        return json({ authenticated: true, user: USER, csrfToken: 'csrf-login' });
      }
      if (u.endsWith('/api/account/data')) return json({ ok: true, state: EMPTY_STATE, version: 0 });
      return json({ error: 'not found' }, 404);
    }) as any;

    render(
      <StoreProvider mode="cloud">
        <div>APP CONTENT</div>
      </StoreProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Username or email'), { target: { value: 'learner' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery staple' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('APP CONTENT')).toBeInTheDocument();
    expect(screen.queryByText(/reading 'mongodb'/i)).toBeNull();
    expect(screen.queryByText(/Something went wrong in this view/i)).toBeNull();
  });

  it('keeps a failed password login on the sign-in screen with no authenticated content', async () => {
    globalThis.fetch = (async (url: any) => {
      const u = String(url);
      if (u.endsWith('/api/auth/session')) return json({ authenticated: false, ...CONFIG });
      if (u.endsWith('/api/auth/login')) {
        return json({ error: 'Invalid username/email or password.', code: 'INVALID_CREDENTIALS' }, 401);
      }
      return json({ error: 'not found' }, 404);
    }) as any;

    render(
      <StoreProvider mode="cloud">
        <div>APP CONTENT</div>
      </StoreProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Username or email'), { target: { value: 'does-not-exist' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'anything at all' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Invalid username/email or password.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('APP CONTENT')).toBeNull();
  });

  it('does not expire a session for a sign-in 401 even if a stale CSRF token is in memory', async () => {
    globalThis.fetch = (async (url: any) => {
      if (String(url).endsWith('/api/auth/login')) {
        return json({ error: 'Invalid username/email or password.', code: 'INVALID_CREDENTIALS' }, 401);
      }
      return json({ error: 'not found' }, 404);
    }) as any;
    setCsrfToken('stale-csrf-token');
    const expired = vi.fn();
    window.addEventListener('lq:auth-expired', expired);
    try {
      await expect(apiRequest('/auth/login', {
        method: 'POST',
        body: { identifier: 'nobody', password: 'wrong' },
      })).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
      expect(expired).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('lq:auth-expired', expired);
      setCsrfToken(null);
    }
  });

  it('still reports an expired session for a 401 from an authenticated endpoint', async () => {
    globalThis.fetch = (async () => json({ error: 'Authentication required.', code: 'AUTH_REQUIRED' }, 401)) as any;
    setCsrfToken('live-csrf-token');
    const expired = vi.fn();
    window.addEventListener('lq:auth-expired', expired);
    try {
      await expect(apiRequest('/account/data')).rejects.toMatchObject({ status: 401 });
      expect(expired).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('lq:auth-expired', expired);
      setCsrfToken(null);
    }
  });

  it('rejects a successful-looking login response that lacks an account profile', async () => {
    globalThis.fetch = (async () => json({ authenticated: true, csrfToken: 'csrf' })) as any;
    await expect(passwordLogin('someone', 'whatever')).rejects.toMatchObject({ code: 'INVALID_AUTH_RESPONSE' });
  });
});

describe('Google intent UI separation', () => {
  it('uses login intent for sign-in and register intent for account creation', async () => {
    const onGoogle = vi.fn(async () => undefined);
    render(
      <AuthScreens
        setup={CONFIG}
        authError={null}
        onPasswordLogin={vi.fn(async () => undefined)}
        onGoogle={onGoogle}
      />,
    );
    expect(screen.queryByText(/six-digit/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    await waitFor(() => expect(onGoogle).toHaveBeenCalledWith('login'));

    fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    await waitFor(() => expect(onGoogle).toHaveBeenCalledWith('register'));
  });

  it('describes recovery as a single-use email link, not a numeric code', async () => {
    render(
      <AuthScreens
        setup={CONFIG}
        authError={null}
        onPasswordLogin={vi.fn(async () => undefined)}
        onGoogle={vi.fn(async () => undefined)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    expect(screen.getByRole('button', { name: 'Send password reset link' })).toBeInTheDocument();
    expect(screen.queryByText(/six-digit|verification code/i)).toBeNull();
  });
});

describe('email action links in the browser', () => {
  it('captures a reset token from the fragment, removes it from history, and posts it explicitly', async () => {
    const token = 'opaque-reset-token-abcdefghijklmnopqrstuvwxyz';
    window.location.hash = `#/reset-password?token=${token}`;
    const calls: Array<{ url: string; body: any }> = [];
    globalThis.fetch = (async (url: any, init?: any) => {
      const u = String(url);
      if (u.endsWith('/api/auth/session')) return json({ authenticated: false, ...CONFIG });
      if (u.endsWith('/api/auth/password/reset')) {
        calls.push({ url: u, body: JSON.parse(init.body) });
        return json(null, 204);
      }
      return json({ error: 'not found' }, 404);
    }) as any;

    render(
      <StoreProvider mode="cloud">
        <div>APP CONTENT</div>
      </StoreProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/reset-password');
    expect(document.body.textContent).not.toContain(token);

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new correct horse battery staple' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new correct horse battery staple' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByText('Password reset complete')).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0].body.token).toBe(token);
    expect(calls[0].body.newPassword).toBe('new correct horse battery staple');
  });

  it('does not verify an email on page load; it requires the explicit button POST', async () => {
    const token = 'opaque-email-token-abcdefghijklmnopqrstuvwxyz';
    window.location.hash = `#/verify-email?token=${token}`;
    const calls: any[] = [];
    globalThis.fetch = (async (url: any, init?: any) => {
      const u = String(url);
      if (u.endsWith('/api/auth/session')) return json({ authenticated: false, ...CONFIG });
      if (u.endsWith('/api/account/email/confirm')) {
        calls.push(JSON.parse(init.body));
        return json({ ok: true, email: 'new@example.test', message: 'Verified.' });
      }
      return json({ error: 'not found' }, 404);
    }) as any;

    render(
      <StoreProvider mode="cloud">
        <div>APP CONTENT</div>
      </StoreProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Verify your new email address' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/verify-email');
    expect(calls).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Verify email address' }));
    expect(await screen.findByText('Email verified')).toBeInTheDocument();
    expect(calls).toEqual([{ token }]);
  });
});
