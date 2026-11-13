/**
 * LearnQuest backend readiness coordinator.
 *
 * Render free/paid web services spin down when idle. The first requests after
 * spin-down can time out or return `503 DATABASE_UNAVAILABLE` while MongoDB
 * reconnects. Before this module, the frontend treated those as fatal and
 * showed the connection-error screen, even though the backend usually became
 * ready seconds later.
 *
 * This module makes the cold start survivable:
 *  - One shared probe per app instance (`/api/ready`), never a per-component poll.
 *  - Bounded exponential backoff with jitter; honors `Retry-After` when present.
 *  - Distinguishes "still starting" (503/timeout/network) from "failed for
 *    good" (non-retryable status, or the attempt/time budget is exhausted).
 *  - Concurrent callers (bootstrap, health pill, SSE revalidate) share a
 *    single in-flight promise — no duplicate wake traffic.
 *  - Authentication expiry (401) is NOT the readiness layer's concern and is
 *    never retried here.
 *
 * UI subscribers get a live snapshot of the startup phase (`waking`, `ready`,
 * `failed`) and the attempt count so the shell can render an honest
 * "server starting…" state instead of an error.
 */

export type ReadinessState = 'unknown' | 'waking' | 'ready' | 'failed';

export interface ReadinessSnapshot {
  state: ReadinessState;
  /** Probe attempts so far in the current wake cycle (0 when ready/unknown). */
  attempt: number;
  /** Maximum attempts that will be made before giving up. */
  maxAttempts: number;
  /** Human-readable detail for the current phase; null when ready/unknown. */
  detail: string | null;
}

export interface WaitOptions {
  /** Hard ceiling on the whole wake cycle. Defaults to ~90s. */
  maxWaitMs?: number;
  /** Hard ceiling on attempts. Defaults to 8. */
  maxAttempts?: number;
  signal?: AbortSignal;
}

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 15_000;
const PROBE_TIMEOUT_MS = 10_000;

const listeners = new Set<(s: ReadinessSnapshot) => void>();
let snapshot: ReadinessSnapshot = { state: 'unknown', attempt: 0, maxAttempts: 8, detail: null };
let inflight: Promise<boolean> | null = null;

interface WakeCycle {
  startedAt: number;
  /** The largest caller budget currently attached to this shared cycle. */
  maxAttempts: number;
  /** The furthest caller deadline currently attached to this shared cycle. */
  deadline: number;
  waiters: number;
}

let cycle: WakeCycle | null = null;

function emit(next: ReadinessSnapshot) {
  snapshot = next;
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch {
      /* listener errors must not break the coordinator */
    }
  }
}

export function getReadinessSnapshot(): ReadinessSnapshot {
  return snapshot;
}

export function subscribeReadiness(listener: (s: ReadinessSnapshot) => void): () => void {
  listeners.add(listener);
  listener(snapshot);
  return () => listeners.delete(listener);
}

function jitter(delay: number): number {
  return Math.round(delay * (0.7 + Math.random() * 0.6));
}

function backoffDelay(attempt: number, retryAfterSec?: number): number {
  if (typeof retryAfterSec === 'number' && Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
    return Math.min(retryAfterSec * 1_000, MAX_DELAY_MS);
  }
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) {
      if (signal.aborted) {
        clearTimeout(t);
        reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        return;
      }
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      }, { once: true });
    }
  });
}

interface ProbeResult {
  ok: boolean;
  retryable: boolean;
  retryAfterSec?: number;
}

async function probeReady(): Promise<ProbeResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch('/api/ready', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
    // Any 2xx/3xx with a completed response proves the service processed the
    // request. Strict body-shape validation would false-negative on minor
    // server changes; /auth/session is the real gate for configuration.
    if (res.ok) return { ok: true, retryable: false };
    // 503 (starting/unavailable) and 5xx are transient; honor Retry-After.
    if (res.status === 503 || (res.status >= 500 && res.status < 600)) {
      const raw = res.headers.get('Retry-After');
      const seconds = raw ? Number(raw.trim()) : NaN;
      return { ok: false, retryable: true, retryAfterSec: Number.isFinite(seconds) && seconds > 0 ? seconds : undefined };
    }
    // A 404 means the backend is up but does not implement the readiness
    // probe yet (older deployment). Proceed: /auth/session is the real gate,
    // and its own retryable failures (503/timeout) get a second, bounded wake
    // cycle in bootstrap. Blocking forever on a 404 would hide the session
    // gate behind a probe mismatch.
    if (res.status === 404) return { ok: true, retryable: false };
    return { ok: false, retryable: false };
  } catch {
    // Network error / abort = still waking (or machine offline). Retryable.
    return { ok: false, retryable: true };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Wait until the backend reports ready, or the attempt/time budget is spent.
 * Concurrent callers share one wake cycle; after completion a subsequent
 * caller may start a new cycle (the backend may have slept again).
 */
export async function waitForBackendReady(opts: WaitOptions = {}): Promise<boolean> {
  if (snapshot.state === 'ready') return true; // backend already warm
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 8);
  const maxWaitMs = Math.max(0, opts.maxWaitMs ?? 90_000);
  const callerDeadline = Date.now() + maxWaitMs;

  if (opts.signal?.aborted) return false;
  if (cycle) {
    // A concurrent caller may need a longer budget than the first caller.
    // Its own deadline is still enforced below; extending the shared work only
    // prevents the first caller from prematurely failing everybody else.
    cycle.maxAttempts = Math.max(cycle.maxAttempts, maxAttempts);
    cycle.deadline = Math.max(cycle.deadline, callerDeadline);
    if (snapshot.state === 'waking') emit({ ...snapshot, maxAttempts: cycle.maxAttempts });
  } else {
    cycle = { startedAt: Date.now(), maxAttempts, deadline: callerDeadline, waiters: 0 };
  }

  if (!inflight) {
    inflight = (async () => {
      // Let the initiating caller subscribe before checking for subscribers.
      // An async function otherwise executes through that check synchronously.
      await Promise.resolve();
      try {
        for (let attempt = 1; ; attempt += 1) {
        const active = cycle;
        if (!active || active.waiters === 0) {
          emit({ state: 'unknown', attempt: 0, maxAttempts, detail: null });
          return false;
        }
        const probe = await probeReady();
        const current = cycle;
        if (!current || current.waiters === 0) {
          emit({ state: 'unknown', attempt: 0, maxAttempts: active.maxAttempts, detail: null });
          return false;
        }
        if (probe.ok) {
          emit({ state: 'ready', attempt: 0, maxAttempts: current.maxAttempts, detail: null });
          return true;
        }
        // Only surface the "server starting" state once a probe has actually
        // failed — a warm backend should never flash a wake screen.
        emit({
          state: 'waking',
          attempt,
          maxAttempts: current.maxAttempts,
          detail: 'The LearnQuest server is starting. Your data will load automatically when it is ready.',
        });
        if (!probe.retryable) {
          emit({
            state: 'failed',
            attempt,
            maxAttempts: current.maxAttempts,
            detail: 'The LearnQuest server responded with an error it cannot retry. Check the deployment, then retry.',
          });
          return false;
        }
        const remaining = current.deadline - Date.now();
        if (attempt >= current.maxAttempts || remaining <= 1_000) {
          emit({
            state: 'failed',
            attempt,
            maxAttempts: current.maxAttempts,
            detail: 'The LearnQuest server is still starting. Retry now, or wait a minute and try again.',
          });
          return false;
        }
        const delay = jitter(Math.min(backoffDelay(attempt - 1, probe.retryAfterSec), remaining));
        await sleep(delay);
        }
      } finally {
        inflight = null;
        cycle = null;
      }
    })();
  }

  return waitForSharedCycle(inflight, opts, maxWaitMs, maxAttempts);
}

/** A caller can leave a shared wake cycle without cancelling other callers. */
function waitForSharedCycle(
  shared: Promise<boolean>,
  opts: WaitOptions,
  maxWaitMs: number,
  maxAttempts: number,
): Promise<boolean> {
  const active = cycle;
  if (!active || opts.signal?.aborted) return Promise.resolve(false);
  active.waiters += 1;
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      opts.signal?.removeEventListener('abort', onAbort);
      unsubscribe();
      active.waiters = Math.max(0, active.waiters - 1);
      resolve(value);
    };
    const onAbort = () => finish(false);
    const timeout = setTimeout(() => finish(false), maxWaitMs);
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    unsubscribe = subscribeReadiness((next) => {
      if (next.state === 'waking' && next.attempt >= maxAttempts) finish(false);
    });
    if (settled) unsubscribe();
    shared.then(finish, () => finish(false));
  });
}

/** Test hook: reset module state so each test starts from scratch. */
export function __resetReadinessForTests(): void {
  inflight = null;
  cycle = null;
  listeners.clear();
  snapshot = { state: 'unknown', attempt: 0, maxAttempts: 8, detail: null };
}

/**
 * Force the coordinator back to `unknown` after a confirmed unavailability
 * (e.g. `/auth/session` returned 503/timeout although `/api/ready` had
 * answered). The next `waitForBackendReady()` runs a fresh wake cycle instead
 * of trusting a stale `ready` snapshot.
 */
export function markBackendUnavailable(): void {
  emit({ state: 'unknown', attempt: 0, maxAttempts: 8, detail: null });
}
