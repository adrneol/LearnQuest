import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StoreProvider } from '../src/app/store.js';
import App from '../src/app/App.js';
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
  userId: 'user-route',
  email: 'route@example.test',
  username: 'route_learner',
  displayName: 'Route Learner',
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

const ACTIVE_PLAYLIST = 'PLroute0000000000000';
const ACTIVE_STATE = {
  ...EMPTY_STATE,
  playlists: {
    [ACTIVE_PLAYLIST]: {
      playlistId: ACTIVE_PLAYLIST,
      title: 'Playlist Leak Canary',
      reportedCount: 2,
      entries: [
        { position: 1, entryId: 'route-e1', videoId: 'route-v1', title: 'One', durationSec: 60 },
        { position: 2, entryId: 'route-e2', videoId: 'route-v2', title: 'Two', durationSec: 120 },
      ],
      source: 'api',
      fetchedAt: '2026-10-27T12:34:56.000Z',
      snapshotVersion: 2,
    },
  },
  meta: {
    [ACTIVE_PLAYLIST]: {
      archived: false,
      customTitle: 'Playlist Leak Canary',
      addedAt: '2026-10-01T00:00:00.000Z',
    },
  },
  activeId: ACTIVE_PLAYLIST,
};

const realFetch = globalThis.fetch;
const realHash = window.location.hash;

function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

function mockCloud(state: unknown = EMPTY_STATE) {
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    if (u.endsWith('/api/health')) return json({ ok: true, hasKey: true });
    if (u.endsWith('/api/auth/session')) {
      return json({ authenticated: true, user: USER, csrfToken: 'csrf-route', ...CONFIG });
    }
    if (u.endsWith('/api/account/data')) return json({ ok: true, state, version: 0 });
    if (u.endsWith('/api/account/sessions')) return json({ sessions: [] });
    return json({ error: 'not found' }, 404);
  }) as any;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  window.location.hash = realHash;
});

beforeEach(() => {
  // jsdom does not implement scrolling; navigation is asserted through the
  // hash and rendered section instead.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('standalone account route', () => {
  it('renders Account without the dashboard playlist-creation panel above it', async () => {
    mockCloud();
    window.location.hash = '#/account/profile';

    render(
      <StoreProvider mode="cloud">
        <App />
      </StoreProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Route Learner' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Profile/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/Password sign-in:/)).toBeInTheDocument();
    // No active playlist exists, but the dashboard onboarding/creation card
    // must not sit above the account page.
    expect(screen.queryByText('Your account is ready')).toBeNull();
    expect(screen.queryByLabelText('Playlist URL or ID')).toBeNull();
    expect(screen.queryByRole('button', { name: /Add your first playlist/ })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /Account settings/ }));
    expect(await screen.findByText('Learning preferences')).toBeInTheDocument();
    await waitFor(() => expect(window.location.hash).toBe('#/account/settings'));
    expect(screen.queryByText('Your account is ready')).toBeNull();
  });

  it.each([
    ['profile', /Password sign-in:/],
    ['settings', /Learning preferences/],
    ['security', /^Password$/],
  ])('renders the %s Account route without any active-playlist shell content', async (section, anchor) => {
    mockCloud(ACTIVE_STATE);
    window.location.hash = `#/account/${section}`;

    render(
      <StoreProvider mode="cloud">
        <App />
      </StoreProvider>,
    );

    expect(await screen.findByText(anchor)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Route Learner' })).toBeInTheDocument();
    // The active playlist must not affect the Account heading, header,
    // metadata row, playlist switcher, migration card, or onboarding content.
    expect(screen.queryByText('Playlist Leak Canary')).toBeNull();
    expect(screen.queryByText('Active playlist')).toBeNull();
    expect(screen.queryByText(/Active playlist:/)).toBeNull();
    expect(screen.queryByText(/fetched/i)).toBeNull();
    expect(screen.queryByText(/N=2/)).toBeNull();
    expect(screen.queryByText('Your account is ready')).toBeNull();
    expect(screen.queryByLabelText('Playlist URL or ID')).toBeNull();
    expect(screen.queryByText(/Local LearnQuest data found/)).toBeNull();
  });

  it('still shows the dashboard onboarding on the dashboard route with no playlist', async () => {
    mockCloud();
    window.location.hash = '#/dash';

    render(
      <StoreProvider mode="cloud">
        <App />
      </StoreProvider>,
    );

    expect(await screen.findByText('Your account is ready')).toBeInTheDocument();
    expect(screen.getByLabelText('Playlist URL or ID')).toBeInTheDocument();
  });

  it('still shows the active playlist title and metadata in the workspace shell', async () => {
    mockCloud(ACTIVE_STATE);
    window.location.hash = '#/dash';

    render(
      <StoreProvider mode="cloud">
        <App />
      </StoreProvider>,
    );

    expect(await screen.findByText(/Active playlist:/)).toBeInTheDocument();
    expect(screen.getAllByText(/Playlist Leak Canary/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/N=2/).length).toBeGreaterThan(0);
  });
});
