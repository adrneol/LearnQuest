import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  waitForBackendReady,
  getReadinessSnapshot,
  subscribeReadiness,
  __resetReadinessForTests,
} from '../src/services/api/readiness';

const realFetch = globalThis.fetch;

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
}

beforeEach(() => {
  __resetReadinessForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = realFetch;
});

describe('backend readiness coordinator', () => {
  it('returns true immediately when the backend is ready', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ ready: true, ok: true })) as unknown as typeof fetch;
    await expect(waitForBackendReady()).resolves.toBe(true);
    expect(getReadinessSnapshot().state).toBe('ready');
  });

  it('wakes a sleeping backend, reports progress, and is not infinite', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      if (calls < 3) return jsonResponse({ error: 'database unavailable' }, { status: 503, headers: { 'Retry-After': '1' } });
      return jsonResponse({ ready: true });
    }) as unknown as typeof fetch;

    const seen: number[] = [];
    subscribeReadiness((s) => seen.push(s.attempt));
    const attempt = waitForBackendReady();
    // Drain the backoff/sleep phases deterministically.
    await vi.runAllTimersAsync();
    await expect(attempt).resolves.toBe(true);
    expect(calls).toBe(3);
    expect(getReadinessSnapshot().state).toBe('ready');
  });

  it('gives up after the bounded attempt budget with a clear detail', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ error: 'still starting' }, { status: 503 })) as unknown as typeof fetch;
    const attempt = waitForBackendReady({ maxAttempts: 3, maxWaitMs: 60_000 });
    await vi.runAllTimersAsync();
    await expect(attempt).resolves.toBe(false);
    const s = getReadinessSnapshot();
    expect(s.state).toBe('failed');
    expect(s.attempt).toBe(3);
    expect(s.detail).toBeTruthy();
  });

  it('treats 404 as an un-probeable but reachable backend (proceed once, no retry loop)', async () => {
    globalThis.fetch = vi.fn(async () => new Response('not found', { status: 404 })) as unknown as typeof fetch;
    await expect(waitForBackendReady({ maxAttempts: 5 })).resolves.toBe(true);
    expect(getReadinessSnapshot().state).toBe('ready');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight wake cycle across concurrent callers', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ ready: true })) as unknown as typeof fetch;
    const [a, b] = await Promise.all([waitForBackendReady(), waitForBackendReady()]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('uses the largest concurrent attempt budget without making the shorter caller wait longer', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ error: 'still starting' }, { status: 503 })) as unknown as typeof fetch;
    const short = waitForBackendReady({ maxAttempts: 1, maxWaitMs: 60_000 });
    const long = waitForBackendReady({ maxAttempts: 3, maxWaitMs: 60_000 });
    await vi.advanceTimersByTimeAsync(0);
    await expect(short).resolves.toBe(false);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    await expect(long).resolves.toBe(false);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('lets an aborted caller leave without cancelling a concurrent caller', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? jsonResponse({ error: 'warming' }, { status: 503 }) : jsonResponse({ ready: true });
    }) as unknown as typeof fetch;
    const controller = new AbortController();
    const cancelled = waitForBackendReady({ signal: controller.signal, maxWaitMs: 60_000 });
    const survivor = waitForBackendReady({ maxWaitMs: 60_000 });
    controller.abort();
    await vi.runAllTimersAsync();
    await expect(cancelled).resolves.toBe(false);
    await expect(survivor).resolves.toBe(true);
    expect(calls).toBe(2);
  });
});
