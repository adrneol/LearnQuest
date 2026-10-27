import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMongoSupervisor } from '../src/db/mongoSupervisor.js';

function tlsError(): Error {
  return Object.assign(new Error('tlsv1 alert internal error'), {
    name: 'MongoServerSelectionError',
    cause: Object.assign(new Error('tlsv1 alert internal error'), {
      name: 'MongoNetworkError',
      code: 'ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR',
    }),
  });
}

function authError(): Error {
  return Object.assign(new Error('Authentication failed.'), {
    name: 'MongoServerError',
    code: 18,
  });
}

function build(overrides: Parameters<typeof createMongoSupervisor>[0] = {}) {
  const check = vi.fn<() => Promise<void>>();
  const initialize = vi.fn<() => Promise<void>>();
  const reset = vi.fn<() => Promise<void>>();
  const onFirstReady = vi.fn<() => Promise<void>>();
  const supervisor = createMongoSupervisor({
    configured: true,
    retryBaseMs: 100,
    retryMaxMs: 250,
    heartbeatIntervalMs: 1_000,
    check,
    initialize,
    reset,
    onFirstReady,
    ...overrides,
  });
  return { supervisor, check, initialize, reset, onFirstReady };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('MongoDB readiness supervisor', () => {
  it('classifies an initial TLS failure, does not initialize indexes, and stays unready', async () => {
    const { supervisor, check, initialize } = build();
    check.mockRejectedValueOnce(tlsError());

    await supervisor.start();

    expect(supervisor.snapshot()).toMatchObject({
      configured: true,
      ready: false,
      state: 'unavailable',
      consecutiveFailures: 1,
      lastFailure: { classification: 'TLS_FAILURE', retryable: true },
    });
    expect(initialize).not.toHaveBeenCalled();
    expect(supervisor.snapshot().nextRetryInMs).toBeGreaterThan(0);
    supervisor.stop();
  });

  it('retries a failed connection and initializes only after the check succeeds', async () => {
    const { supervisor, check, initialize } = build();
    check.mockRejectedValueOnce(tlsError()).mockResolvedValueOnce(undefined);

    await supervisor.start();
    expect(initialize).not.toHaveBeenCalled();

    await supervisor.retryNow();

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(supervisor.snapshot()).toMatchObject({
      ready: true,
      state: 'ready',
      consecutiveFailures: 0,
      lastFailure: null,
    });
    expect(supervisor.snapshot().readyAt).toBeTruthy();
    supervisor.stop();
  });

  it('shares one in-flight attempt instead of creating concurrent retries', async () => {
    const { supervisor, check } = build();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    check.mockReturnValueOnce(gate);

    const first = supervisor.retryNow();
    const second = supervisor.retryNow();
    expect(check).toHaveBeenCalledTimes(1);

    release();
    await Promise.all([first, second]);
    expect(supervisor.snapshot().ready).toBe(true);
    supervisor.stop();
  });

  it('uses bounded exponential backoff and never schedules more than one retry timer', async () => {
    vi.useFakeTimers();
    const { supervisor, check } = build({ heartbeatIntervalMs: 0 });
    check.mockRejectedValue(tlsError());

    await supervisor.start();
    expect(supervisor.snapshot().nextRetryInMs).toBe(100);

    const seen: Array<number | null> = [];
    for (const expected of [200, 250, 250]) {
      await vi.advanceTimersByTimeAsync(supervisor.snapshot().nextRetryInMs ?? 0);
      seen.push(supervisor.snapshot().nextRetryInMs);
      expect(seen.at(-1)).toBe(expected);
    }
    expect(check.mock.calls.length).toBe(4);
    supervisor.stop();
  });

  it('does not shorten backoff or add timers for repeated request failures', async () => {
    vi.useFakeTimers();
    const { supervisor, check } = build({ heartbeatIntervalMs: 0 });
    check.mockRejectedValueOnce(tlsError()).mockResolvedValue(undefined);

    await supervisor.start();
    expect(supervisor.snapshot().nextRetryInMs).toBe(100);

    supervisor.markUnavailable(tlsError());
    supervisor.markUnavailable(tlsError());
    expect(supervisor.snapshot().nextRetryInMs).toBe(100);

    await vi.advanceTimersByTimeAsync(100);
    expect(check).toHaveBeenCalledTimes(2);
    expect(supervisor.snapshot().ready).toBe(true);
    supervisor.stop();
  });

  it('recovers after an injected failure without re-running index initialization', async () => {
    vi.useFakeTimers();
    const { supervisor, check, initialize } = build();
    check.mockResolvedValue(undefined);

    await supervisor.start();
    expect(supervisor.snapshot().ready).toBe(true);
    expect(initialize).toHaveBeenCalledTimes(1);

    supervisor.markUnavailable(tlsError());
    expect(supervisor.snapshot()).toMatchObject({
      ready: false,
      state: 'unavailable',
      lastFailure: { classification: 'TLS_FAILURE' },
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(supervisor.snapshot().ready).toBe(true);
    expect(initialize).toHaveBeenCalledTimes(1);
    supervisor.stop();
  });

  it('re-runs index initialization after an initialization failure and retries safely', async () => {
    vi.useFakeTimers();
    const { supervisor, check, initialize } = build();
    check.mockResolvedValue(undefined);
    initialize.mockRejectedValueOnce(tlsError()).mockResolvedValueOnce(undefined);

    await supervisor.start();
    expect(supervisor.snapshot().ready).toBe(false);
    expect(initialize).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(supervisor.snapshot().ready).toBe(true);
    expect(initialize).toHaveBeenCalledTimes(2);
    supervisor.stop();
  });

  it('replaces a closed client and retries instead of staying permanently unavailable', async () => {
    vi.useFakeTimers();
    const { supervisor, check, initialize, reset } = build();
    check.mockResolvedValue(undefined);

    await supervisor.start();
    expect(supervisor.snapshot().ready).toBe(true);

    supervisor.markUnavailable(Object.assign(new Error('topology is closed'), { name: 'MongoTopologyClosedError' }));
    expect(supervisor.snapshot()).toMatchObject({
      ready: false,
      lastFailure: { classification: 'CLIENT_LIFECYCLE_ERROR', retryable: true },
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(supervisor.snapshot().ready).toBe(true);
    expect(initialize).toHaveBeenCalledTimes(2);
    supervisor.stop();
  });

  it('replaces a stuck client after repeated failures and reinitializes after recovery', async () => {
    vi.useFakeTimers();
    const { supervisor, check, initialize, reset } = build();
    check
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(tlsError())
      .mockRejectedValueOnce(tlsError())
      .mockResolvedValue(undefined);

    await supervisor.start();
    expect(supervisor.snapshot().ready).toBe(true);

    supervisor.markUnavailable(tlsError());
    await vi.advanceTimersByTimeAsync(100);
    expect(reset).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(250);
    expect(supervisor.snapshot().ready).toBe(true);
    expect(initialize).toHaveBeenCalledTimes(2);
    supervisor.stop();
  });

  it('marks readiness unavailable after a heartbeat failure and recovers on the retry', async () => {
    vi.useFakeTimers();
    const { supervisor, check, initialize } = build();
    check
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(tlsError())
      .mockResolvedValueOnce(undefined);

    await supervisor.start();
    expect(supervisor.snapshot().ready).toBe(true);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(supervisor.snapshot()).toMatchObject({
      ready: false,
      state: 'unavailable',
      lastFailure: { classification: 'TLS_FAILURE' },
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(supervisor.snapshot().ready).toBe(true);
    expect(initialize).toHaveBeenCalledTimes(1);
    supervisor.stop();
  });

  it('stops scheduling retries and ignores state changes after shutdown', async () => {
    vi.useFakeTimers();
    const { supervisor, check } = build({ heartbeatIntervalMs: 0 });
    check.mockRejectedValue(tlsError());

    await supervisor.start();
    expect(check).toHaveBeenCalledTimes(1);
    supervisor.stop();
    expect(supervisor.snapshot().state).toBe('stopped');

    await vi.advanceTimersByTimeAsync(60_000);
    expect(check).toHaveBeenCalledTimes(1);
    expect(supervisor.snapshot().ready).toBe(false);
  });

  it('does not auto-retry a non-retryable authentication failure', async () => {
    vi.useFakeTimers();
    const { supervisor, check } = build({ heartbeatIntervalMs: 0 });
    check.mockRejectedValue(authError());

    await supervisor.start();
    expect(supervisor.snapshot()).toMatchObject({
      ready: false,
      state: 'unavailable',
      lastFailure: { classification: 'AUTHENTICATION_FAILED', retryable: false },
      nextRetryInMs: null,
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(check).toHaveBeenCalledTimes(1);
    supervisor.stop();
  });

  it('runs first-ready maintenance once and never on a later reconnect', async () => {
    vi.useFakeTimers();
    const { supervisor, check, onFirstReady } = build();
    check.mockResolvedValue(undefined);

    await supervisor.start();
    expect(onFirstReady).toHaveBeenCalledTimes(1);

    supervisor.markUnavailable(tlsError());
    await vi.advanceTimersByTimeAsync(100);
    expect(supervisor.snapshot().ready).toBe(true);
    expect(onFirstReady).toHaveBeenCalledTimes(1);
    supervisor.stop();
  });

  it('keeps the first-ready maintenance failure from changing database readiness', async () => {
    const { supervisor, check, onFirstReady } = build();
    check.mockResolvedValue(undefined);
    onFirstReady.mockRejectedValue(new Error('maintenance failed'));

    await supervisor.start();
    expect(supervisor.snapshot().ready).toBe(true);
    expect(onFirstReady).toHaveBeenCalledTimes(1);
    supervisor.stop();
  });

  it('is idempotent when start is called more than once', async () => {
    const { supervisor, check } = build();
    check.mockResolvedValue(undefined);

    await Promise.all([supervisor.start(), supervisor.start()]);
    await supervisor.start();
    expect(check).toHaveBeenCalledTimes(1);
    supervisor.stop();
  });
});
