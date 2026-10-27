import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, renderHook, screen, fireEvent, act, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { StoreProvider, useStore } from '../src/app/store.js';
import type { AuthConfig, AuthUser } from '../src/services/api/authApi.js';

const P = 'PLcloudp000000000000';
const Q = 'PLcloudq000000000000';

const CONFIG: AuthConfig = {
  nodeEnv: 'production',
  authEnabled: true,
  setupRequired: false,
  configured: {
    mongodb: true, google: true, brevo: true, session: true, emailLinks: true, youtube: false,
  },
  missing: [],
  cookieSecure: true,
  appOrigin: 'https://learn-quest-one.vercel.app',
};

const USER_A: AuthUser = {
  userId: 'user-cloud-a',
  email: 'a@example.test',
  username: 'cloud_a',
  displayName: 'Cloud A',
  onboardingComplete: true,
  timezone: 'UTC',
  sessionLenMin: 25,
  breakMin: 5,
  minViableMin: 10,
  createdAt: '2026-10-01T00:00:00.000Z',
  hasPassword: true,
  googleLinked: true,
};

const USER_B: AuthUser = {
  ...USER_A,
  userId: 'user-cloud-b',
  email: 'b@example.test',
  username: 'cloud_b',
  displayName: 'Cloud B',
};

function snapshot(playlistId: string, title: string): any {
  return {
    playlistId,
    title,
    channelTitle: 'Channel',
    reportedCount: 1,
    entries: [{ position: 1, entryId: 'eA', videoId: `${playlistId}-v1`, title: `${title} 1`, durationSec: 600 }],
    source: 'imported',
    fetchedAt: '2026-10-01T00:00:00.000Z',
    snapshotVersion: 1,
  };
}

function emptyState(): any {
  return {
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
}

function stateFor(playlistId: string, note: string): any {
  const snap = snapshot(playlistId, playlistId === P ? 'Course P' : 'Course Q');
  return {
    playlists: { [playlistId]: snap },
    meta: { [playlistId]: { archived: false, addedAt: '2026-10-01T00:00:00.000Z' } },
    activeId: playlistId,
    progress: {
      [`${playlistId}::eA`]: {
        playlistId,
        position: 1,
        entryId: 'eA',
        videoId: snap.entries[0].videoId,
        status: 'done',
        completedAt: '2026-10-02T00:00:00.000Z',
        notes: note,
      },
    },
    ranges: [], checkpoints: [], modules: [], sessions: [], goals: {}, xp: [],
    achievements: {}, segments: [], playSessions: [], queue: {}, flexGoals: [],
    challenge: {
      seed: 20261013,
      cohortSize: 100,
      tierDist: { Ultra: 2, High: 8, Good: 20, Normal: 30, Average: 25, 'Below Average': 15 },
      windowDays: 14,
      dailyCapHours: 6,
    },
    challengeEnabled: false, rankHistory: [],
    settings: { verifiedThreshold: 0.9 },
    prefs: { timezone: 'UTC', sessionLenMin: 25, breakMin: 5, minViableMin: 10 },
  };
}

interface FakeServer {
  authenticated: boolean;
  user: AuthUser;
  state: any;
  version: number;
  failData: boolean;
  failWrites: boolean;
  dataReads: number;
  writes: Array<{ collection: string; body: any }>;
}

function makeServer(playlistId = P, note = 'note A'): FakeServer {
  return {
    authenticated: true,
    user: USER_A,
    state: stateFor(playlistId, note),
    version: 0,
    failData: false,
    failWrites: false,
    dataReads: 0,
    writes: [],
  };
}

function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === null ? '' : JSON.stringify(body)),
    json: async () => body,
  } as Response;
}

const originalFetch = globalThis.fetch;

function installFetch(server: FakeServer) {
  globalThis.fetch = (async (url: any, init?: any) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    if (u.endsWith('/api/auth/session')) {
      if (!server.authenticated) return json({ authenticated: false, ...CONFIG });
      return json({ authenticated: true, user: server.user, csrfToken: 'csrf-live', ...CONFIG });
    }
    if (u.endsWith('/api/auth/login') && method === 'POST') {
      server.authenticated = true;
      return json({ authenticated: true, user: server.user, csrfToken: 'csrf-login' });
    }
    if (u.endsWith('/api/auth/logout') && method === 'POST') {
      server.authenticated = false;
      return json(null, 204);
    }
    if (u.endsWith('/api/auth/logout-all') && method === 'POST') {
      server.authenticated = false;
      return json(null, 204);
    }
    if (u.endsWith('/api/account/data') && method === 'GET') {
      if (!server.authenticated) return json({ error: 'Authentication required.', code: 'AUTH_REQUIRED' }, 401);
      server.dataReads += 1;
      if (server.failData) return json({ error: 'Cloud storage is unavailable. Nothing was overwritten.' }, 503);
      return json({ ok: true, state: server.state, version: server.version });
    }
    if (u.includes('/api/account/data/') && method === 'PUT') {
      if (!server.authenticated) return json({ error: 'Authentication required.', code: 'AUTH_REQUIRED' }, 401);
      const body = JSON.parse(init.body);
      const collection = u.split('/').pop()!;
      server.writes.push({ collection, body });
      if (server.failWrites) return json({ error: 'The save could not be completed.' }, 500);
      if (body.version !== server.version) return json({ error: 'Version conflict.', code: 'VERSION_CONFLICT' }, 409);
      server.state = { ...server.state, [collection]: body.items };
      server.version += 1;
      return json({ ok: true, version: server.version, collection, savedAt: new Date().toISOString() });
    }
    return json({ error: 'not found' }, 404);
  }) as any;
}

function wrapper({ children }: { children: ReactNode }) {
  return <StoreProvider mode="cloud">{children}</StoreProvider>;
}

/** Rendered only while the store is authenticated and ready. */
function Probe() {
  const s = useStore();
  return (
    <div>
      <p data-testid="who">{s.authUser?.username ?? 'signed out'}</p>
      <p data-testid="p-note">{s.progress[`${P}::eA`]?.notes ?? 'no P data'}</p>
      <p data-testid="q-note">{s.progress[`${Q}::eA`]?.notes ?? 'no Q data'}</p>
      <button type="button" onClick={() => { void s.signOut(); }}>Test sign out</button>
    </div>
  );
}

async function readyHook() {
  const hook = renderHook(() => useStore(), { wrapper });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return hook;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('cloud persistence and source-of-truth boundaries', () => {
  it('saves a change to the server and shows it in a second authenticated client context', async () => {
    const server = makeServer();
    installFetch(server);
    const first = await readyHook();
    expect(first.result.current.progress[`${P}::eA`].notes).toBe('note A');

    act(() => first.result.current.updateRecord(`${P}::eA`, { notes: 'edited in the first browser context' }));
    await waitFor(() => expect(server.state.progress[`${P}::eA`].notes).toBe('edited in the first browser context'));
    await waitFor(() => expect(first.result.current.syncStatus).toBe('saved'));
    expect(server.writes.some((w) => w.collection === 'progress')).toBe(true);
    first.unmount();

    // A second provider is a separate browser context using the same account.
    const second = await readyHook();
    expect(second.result.current.progress[`${P}::eA`].notes).toBe('edited in the first browser context');
    expect(second.result.current.playlists[P]).toBeTruthy();
  });

  it('rejects an incomplete account payload instead of treating missing collections as empty', async () => {
    const server = makeServer();
    server.state = {};
    installFetch(server);
    render(
      <StoreProvider mode="cloud">
        <Probe />
      </StoreProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Your account data is unavailable' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/incomplete learning data|nothing was overwritten/i);
    expect(screen.queryByTestId('p-note')).toBeNull();
    expect(server.writes).toHaveLength(0);
  });

  it('rejects null singleton placeholders as incomplete account data', async () => {
    const server = makeServer();
    server.state = { ...emptyState(), settings: null };
    installFetch(server);
    render(
      <StoreProvider mode="cloud">
        <Probe />
      </StoreProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Your account data is unavailable' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/incomplete learning data|nothing was overwritten/i);
    expect(screen.queryByTestId('p-note')).toBeNull();
    expect(server.writes).toHaveLength(0);
  });

  it('does not fabricate an empty account state when the initial cloud read fails', async () => {
    const server = makeServer();
    server.failData = true;
    installFetch(server);
    render(
      <StoreProvider mode="cloud">
        <Probe />
      </StoreProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Your account data is unavailable' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/nothing was overwritten|unavailable/i);
    expect(screen.queryByTestId('p-note')).toBeNull();
    expect(server.writes).toHaveLength(0);

    server.failData = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('p-note')).toHaveTextContent('note A');
    expect(server.writes).toHaveLength(0);
  });

  it('shows a failed save and retries it without claiming success', async () => {
    const server = makeServer();
    server.failWrites = true;
    installFetch(server);
    const hook = await readyHook();

    act(() => hook.result.current.updateRecord(`${P}::eA`, { notes: 'retry this save' }));
    await waitFor(() => expect(hook.result.current.syncStatus).toBe('error'));
    expect(hook.result.current.syncError).toMatch(/not saved|failed|could not/i);
    expect(server.state.progress[`${P}::eA`].notes).toBe('note A');

    server.failWrites = false;
    act(() => hook.result.current.retryCloudSave());
    await waitFor(() => expect(hook.result.current.syncStatus).toBe('saved'));
    expect(server.state.progress[`${P}::eA`].notes).toBe('retry this save');
  });

  it('treats a brand-new fully onboarded account with zero learning records as a valid empty account', async () => {
    const server = makeServer();
    server.state = emptyState();
    installFetch(server);
    const hook = await readyHook();

    expect(hook.result.current.loadError).toBeNull();
    expect(hook.result.current.ready).toBe(true);
    expect(hook.result.current.playlists).toEqual({});
    expect(hook.result.current.activeId).toBeNull();
    expect(hook.result.current.settings).toEqual({ verifiedThreshold: 0.9 });
    expect(hook.result.current.challenge.seed).toBe(20261013);
    expect(server.writes).toHaveLength(0);

    act(() => hook.result.current.addSnapshot(snapshot(P, 'First Course')));
    await waitFor(() => expect(server.state.playlists[P]).toBeTruthy());
    await waitFor(() => expect(hook.result.current.syncStatus).toBe('saved'));
    expect(server.state.activeId).toBe(P);
    expect(server.writes.some((w) => w.collection === 'playlists')).toBe(true);
  });

  it('routes a pending onboarding account to setup without loading account data', async () => {
    const server = makeServer();
    server.user = { ...USER_A, username: null, onboardingComplete: false, hasPassword: false };
    installFetch(server);
    render(
      <StoreProvider mode="cloud">
        <Probe />
      </StoreProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Finish your LearnQuest account' })).toBeInTheDocument();
    expect(server.dataReads).toBe(0);
    expect(server.writes).toHaveLength(0);
    expect(screen.queryByTestId('p-note')).toBeNull();
  });

  it('never exposes the previous account state after signing out and signing in as another user', async () => {
    const server = makeServer(P, 'only account A may see this');
    installFetch(server);
    render(
      <StoreProvider mode="cloud">
        <Probe />
      </StoreProvider>,
    );
    expect(await screen.findByTestId('who')).toHaveTextContent('cloud_a');
    expect(screen.getByTestId('p-note')).toHaveTextContent('only account A may see this');

    fireEvent.click(screen.getByRole('button', { name: 'Test sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('only account A may see this')).toBeNull();
    expect(screen.queryByTestId('p-note')).toBeNull();

    server.user = USER_B;
    server.state = stateFor(Q, 'account B data');
    server.version = 0;
    server.writes = [];
    fireEvent.change(screen.getByLabelText('Username or email'), { target: { value: 'cloud_b' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByTestId('who')).toHaveTextContent('cloud_b');
    expect(screen.getByTestId('q-note')).toHaveTextContent('account B data');
    expect(screen.getByTestId('p-note')).toHaveTextContent('no P data');
    expect(server.writes.every((w) => !JSON.stringify(w.body).includes('only account A may see this'))).toBe(true);
  });
});
