import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAccountData } from '../src/services/api/authApi';

const realFetch = globalThis.fetch;

const baseState = {
  playlists: {}, meta: {}, activeId: null, progress: {},
  ranges: [], checkpoints: [], modules: [], sessions: [], goals: {},
  xp: [], achievements: {}, segments: [], playSessions: [], queue: {},
  flexGoals: [], challenge: { seed: 1, cohortSize: 100, tierDist: { Normal: 100 } },
  challengeEnabled: false, rankHistory: [],
  settings: { verifiedThreshold: 0.9 },
  prefs: { timezone: 'UTC', sessionLenMin: 25, breakMin: 5, minViableMin: 10 },
};

function payload(schemaVersion: number | undefined) {
  return {
    ok: true,
    schemaVersion,
    loadedAt: new Date().toISOString(),
    state: baseState,
    version: 7,
    userId: 'user_schema_test',
  };
}

beforeEach(() => {
  // The API client must never see a real backend here.
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('account data schema gate', () => {
  it('accepts the documented schemaVersion 1 payload', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(payload(1)), { status: 200 })) as unknown as typeof fetch;
    const out = await fetchAccountData();
    expect(out.version).toBe(7);
    expect(out.userId).toBe('user_schema_test');
  });

  it('refuses a payload from an incompatible server (missing schemaVersion)', async () => {
    const body = payload(undefined);
    delete (body as any).schemaVersion;
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
    await expect(fetchAccountData()).rejects.toMatchObject({ status: 502, code: 'INVALID_ACCOUNT_DATA' });
  });

  it('refuses a payload from a future server (schemaVersion 2)', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(payload(2)), { status: 200 })) as unknown as typeof fetch;
    await expect(fetchAccountData()).rejects.toMatchObject({ status: 502, code: 'INVALID_ACCOUNT_DATA' });
  });
});
