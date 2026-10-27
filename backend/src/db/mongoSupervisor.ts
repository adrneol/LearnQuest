import {
  classifyMongoError,
  describeMongoFailure,
  isRetryableMongoFailure,
  type MongoFailureClass,
} from './mongoErrors.js';
import { closeMongo, getMongoDb, pingMongo } from './mongo.js';

/**
 * Process-local MongoDB readiness supervisor.
 *
 * The HTTP listener is deliberately independent from database readiness:
 * liveness stays up while readiness is false, so a database outage does not
 * cause a restart loop. A failed connection is retried with bounded
 * exponential backoff. Readiness only becomes true after a successful ping
 * and the normal index initialization have completed.
 *
 * Destructive startup maintenance is not part of the retry loop. The
 * `onFirstReady` callback runs at most once per process, after the first
 * fully initialized connection. A later reconnect only restores readiness; it
 * never re-runs account-deletion recovery or any migration.
 */

export type MongoReadinessState =
  | 'unmanaged'
  | 'unconfigured'
  | 'starting'
  | 'ready'
  | 'unavailable'
  | 'stopped';

export interface MongoFailureSummary {
  classification: MongoFailureClass;
  retryable: boolean;
}

export interface MongoReadinessSnapshot {
  managed: boolean;
  configured: boolean;
  ready: boolean;
  state: MongoReadinessState;
  consecutiveFailures: number;
  lastFailure: MongoFailureSummary | null;
  nextRetryInMs: number | null;
  readyAt: string | null;
}

export interface MongoReadinessSource {
  snapshot(): MongoReadinessSnapshot;
}

export interface MongoSupervisorOptions {
  configured?: boolean;
  check?: () => Promise<void>;
  initialize?: () => Promise<void>;
  reset?: () => Promise<void>;
  retryBaseMs?: number;
  retryMaxMs?: number;
  heartbeatIntervalMs?: number;
  onFirstReady?: () => void | Promise<void>;
  log?: (message: string) => void;
  logError?: (message: string) => void;
  label?: string;
}

export interface MongoSupervisor extends MongoReadinessSource {
  /** Start the first check. Idempotent; resolves after that first attempt. */
  start(): Promise<void>;
  /** Cancel timers and prevent any further state transition. */
  stop(): void;
  /** Record a request-time database failure and schedule recovery. */
  markUnavailable(error: unknown): void;
  /** Run one check immediately, sharing any in-flight attempt. */
  retryNow(): Promise<void>;
}

type TimerKind = 'retry' | 'heartbeat';

export function createMongoSupervisor(options: MongoSupervisorOptions = {}): MongoSupervisor {
  const configured = options.configured ?? true;
  const check = options.check ?? pingMongo;
  const initialize = options.initialize ?? getMongoDb;
  const reset = options.reset ?? closeMongo;
  const retryBaseMs = Math.max(100, options.retryBaseMs ?? 1_000);
  const retryMaxMs = Math.max(retryBaseMs, options.retryMaxMs ?? 30_000);
  const heartbeatIntervalMs = Math.max(0, options.heartbeatIntervalMs ?? 30_000);
  const log = options.log ?? (() => undefined);
  const logError = options.logError ?? log;
  const label = options.label ?? 'MongoDB';

  let state: MongoReadinessState = configured ? 'starting' : 'unconfigured';
  let started = false;
  let stopped = false;
  let initialized = false;
  let firstReadyHandled = false;
  let consecutiveFailures = 0;
  let lastFailure: MongoFailureSummary | null = null;
  let readyAt: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timerKind: TimerKind | null = null;
  let retryDeadline: number | null = null;
  let inFlight: Promise<void> | null = null;
  let startPromise: Promise<void> | null = null;

  function clearTimer(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    timerKind = null;
    retryDeadline = null;
  }

  function schedule(delayMs: number, kind: TimerKind): void {
    clearTimer();
    timerKind = kind;
    if (kind === 'retry') retryDeadline = Date.now() + delayMs;
    timer = setTimeout(() => {
      timer = null;
      timerKind = null;
      retryDeadline = null;
      void attempt();
    }, delayMs);
    const unref = (timer as { unref?: () => void }).unref;
    if (typeof unref === 'function') unref.call(timer);
  }

  function retryDelayMs(failures: number): number {
    const exponent = Math.min(Math.max(failures - 1, 0), 10);
    return Math.min(retryMaxMs, retryBaseMs * 2 ** exponent);
  }

  function recordFailure(error: unknown): { classification: MongoFailureClass; retryable: boolean } {
    const classification = classifyMongoError(error);
    const retryable = isRetryableMongoFailure(classification);
    consecutiveFailures += 1;
    lastFailure = { classification, retryable };
    state = 'unavailable';
    readyAt = null;
    return { classification, retryable };
  }

  async function maybeResetClient(classification: MongoFailureClass): Promise<void> {
    if (!initialized) return;
    // A closed topology must be replaced immediately. For repeated TLS/network
    // failures, replace the client after a few attempts so a stuck driver
    // connection cannot prevent recovery indefinitely.
    if (classification !== 'CLIENT_LIFECYCLE_ERROR' && consecutiveFailures < 3) return;
    initialized = false;
    try {
      await reset();
    } catch {
      // A reset failure must not turn a connectivity failure into a crash.
      // The next attempt will create a fresh client anyway.
    }
  }

  function scheduleRecovery(failure: MongoFailureSummary, detail: string): void {
    if (!failure.retryable) {
      clearTimer();
      logError(`${label} is unavailable (${detail}); automatic retry disabled for this non-retryable failure.`);
      return;
    }
    if (timerKind === 'retry') return;
    const delay = retryDelayMs(consecutiveFailures);
    schedule(delay, 'retry');
    logError(`${label} is unavailable (${detail}); next connection attempt in ${delay} ms.`);
  }

  async function attempt(): Promise<void> {
    if (stopped || !configured) return;
    if (inFlight) return inFlight;

    inFlight = (async () => {
      try {
        await check();
        if (stopped) return;
        if (!initialized) {
          await initialize();
          if (stopped) return;
          initialized = true;
        }
        if (stopped) return;

        consecutiveFailures = 0;
        lastFailure = null;
        state = 'ready';
        readyAt = new Date().toISOString();
        clearTimer();
        if (!firstReadyHandled) {
          firstReadyHandled = true;
          try {
            await options.onFirstReady?.();
          } catch {
            // Startup maintenance is separate from readiness. It must never
            // make a healthy database look unavailable or crash the process.
            logError(`${label} startup maintenance did not complete; readiness is unaffected and no success is reported.`);
          }
        }
        if (stopped) return;
        if (heartbeatIntervalMs > 0) schedule(heartbeatIntervalMs, 'heartbeat');
        log(`${label} connection ready; database ping and index checks succeeded.`);
      } catch (error) {
        if (stopped) return;
        const failure = recordFailure(error);
        const detail = describeMongoFailure(error);
        clearTimer();
        await maybeResetClient(failure.classification);
        if (stopped) return;
        scheduleRecovery(failure, detail);
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  }

  return {
    start(): Promise<void> {
      if (started) return startPromise ?? Promise.resolve();
      started = true;
      if (!configured) {
        state = 'unconfigured';
        startPromise = Promise.resolve();
        return startPromise;
      }
      startPromise = attempt();
      return startPromise;
    },

    stop(): void {
      stopped = true;
      clearTimer();
      state = 'stopped';
      readyAt = null;
    },

    markUnavailable(error: unknown): void {
      if (!started || stopped || !configured) return;
      // The in-flight attempt owns the failure path. Multiple request errors
      // while a retry is pending must not create extra timers or shorten the
      // backoff. This keeps a failing database from being hammered by traffic.
      if (inFlight || timerKind === 'retry') return;
      const failure = recordFailure(error);
      const detail = describeMongoFailure(error);
      clearTimer();
      void maybeResetClient(failure.classification).then(() => {
        if (!stopped) scheduleRecovery(failure, detail);
      });
    },

    retryNow(): Promise<void> {
      if (stopped || !configured) return Promise.resolve();
      clearTimer();
      return attempt();
    },

    snapshot(): MongoReadinessSnapshot {
      return {
        managed: true,
        configured,
        ready: state === 'ready',
        state,
        consecutiveFailures,
        lastFailure: lastFailure ? { ...lastFailure } : null,
        nextRetryInMs: retryDeadline === null ? null : Math.max(0, retryDeadline - Date.now()),
        readyAt,
      };
    },
  };
}
