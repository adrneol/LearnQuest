import { randomUUID } from 'node:crypto';
import { MongoCursorExhaustedError, type Collection, type Db, type Document, type FindCursor } from 'mongodb';
import { getMongoDb } from '../db/mongo.js';

/**
 * Server-to-server authentication invalidation fan-out.
 *
 * A process-local EventEmitter is not sufficient: Render can run more than one
 * instance, and a revocation handled by one instance must reach SSE clients
 * connected to every other instance. This bus therefore uses one bounded,
 * capped MongoDB collection plus one tailable-await cursor per backend process.
 * MongoDB is already the shared authority for sessions and is available on both
 * standalone development databases and the production replica set, so no new
 * broker or paid service is introduced.
 *
 * The collection contains internal routing fields only. Nothing in this module
 * is ever written to a client-visible SSE payload.
 */

export type AuthInvalidationReason = 'sessions-revoked' | 'password-reset';

export interface AuthInvalidationEvent {
  eventId: string;
  /** Internal account identifier used only for routing. Never sent to clients. */
  userId: string;
  /**
   * When set, only connections authenticated with this session receive the
   * event. `null` means account-wide (sign out all / password reset).
   */
  sessionId: string | null;
  reason: AuthInvalidationReason;
  /** Epoch milliseconds. Used only to scope delivery to newer subscriptions. */
  at: number;
}

export interface AuthInvalidationInput {
  userId: string;
  sessionId?: string | null;
  reason: AuthInvalidationReason;
}

export interface AuthEventSubscription {
  userId: string;
  sessionId: string;
  listener: (event: AuthInvalidationEvent) => void;
}

export interface AuthEventBus {
  publish(input: AuthInvalidationInput): Promise<void>;
  /**
   * Registering is asynchronous because the first subscriber on a process
   * starts the shared tail cursor. Once this resolves, events inserted after
   * subscription are visible to this process.
   */
  subscribe(input: AuthEventSubscription): Promise<() => void>;
  close(): Promise<void>;
}

export const AUTH_EVENT_COLLECTION = 'lq_auth_events';
const AUTH_EVENT_CAPPED_BYTES = 1024 * 1024;
const AUTH_EVENT_MAX_DOCS = 5_000;
const MAX_SEEN_EVENTS = 4_096;
const WATCHER_MAX_AWAIT_MS = 15_000;

function eventMatches(subscription: AuthEventSubscription, event: AuthInvalidationEvent): boolean {
  if (event.userId !== subscription.userId) return false;
  return event.sessionId === null || event.sessionId === subscription.sessionId;
}

function makeEvent(input: AuthInvalidationInput): AuthInvalidationEvent {
  return {
    eventId: randomUUID(),
    userId: input.userId,
    sessionId: input.sessionId ?? null,
    reason: input.reason,
    at: Date.now(),
  };
}

/**
 * In-process implementation used by tests and by embedders that have not
 * supplied a shared deployment bus. It deliberately does not claim
 * cross-instance delivery.
 */
export function createMemoryAuthEventBus(): AuthEventBus {
  const subscriptions = new Set<AuthEventSubscription>();
  return {
    async publish(input) {
      const event = makeEvent(input);
      for (const subscription of [...subscriptions]) {
        if (eventMatches(subscription, event)) subscription.listener(event);
      }
    },
    async subscribe(subscription) {
      subscriptions.add(subscription);
      return () => subscriptions.delete(subscription);
    },
    async close() {
      subscriptions.clear();
    },
  };
}

interface RawAuthEvent {
  eventId?: unknown;
  userId?: unknown;
  sessionId?: unknown;
  reason?: unknown;
  at?: unknown;
}

function parseDocument(doc: Document): AuthInvalidationEvent | null {
  const raw = doc as RawAuthEvent;
  if (typeof raw.eventId !== 'string' || raw.eventId.length === 0 || raw.eventId.length > 128) return null;
  if (typeof raw.userId !== 'string' || raw.userId.length === 0 || raw.userId.length > 256) return null;
  if (raw.sessionId !== null && (typeof raw.sessionId !== 'string' || raw.sessionId.length === 0)) return null;
  if (raw.reason !== 'sessions-revoked' && raw.reason !== 'password-reset') return null;
  const at = raw.at instanceof Date
    ? raw.at.getTime()
    : typeof raw.at === 'string' || typeof raw.at === 'number'
      ? Date.parse(String(raw.at))
      : NaN;
  if (!Number.isFinite(at)) return null;
  return {
    eventId: raw.eventId,
    userId: raw.userId,
    sessionId: raw.sessionId as string | null,
    reason: raw.reason,
    at,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const unref = (timer as { unref?: () => void }).unref;
    if (typeof unref === 'function') unref.call(timer);
  });
}

/**
 * Shared deployment bus. One process opens exactly one tailable cursor, no
 * matter how many SSE clients it serves. The cursor is bounded by the capped
 * collection and is not a polling interval: MongoDB blocks the getMore until a
 * new event arrives (or the bounded await expires).
 */
export interface MongoAuthEventBusOptions {
  /** Injectable database for isolated integration rehearsals; defaults to the app's configured MongoDB. */
  getDb?: () => Promise<Db>;
}

export function createMongoAuthEventBus(options: MongoAuthEventBusOptions = {}): AuthEventBus {
  const getDb = options.getDb ?? getMongoDb;
  let collectionPromise: Promise<Collection<Document>> | null = null;
  let watcherPromise: Promise<void> | null = null;
  let watcherReady: Promise<void> | null = null;
  let cursor: FindCursor<Document> | null = null;
  let activeAbort: AbortController | null = null;
  let closed = false;
  let started = false;
  const subscriptions = new Set<{ subscription: AuthEventSubscription; createdAt: number }>();
  const seen = new Map<string, number>();

  async function ensureCollection(): Promise<Collection<Document>> {
    if (!collectionPromise) {
      const attempt = (async () => {
        const db = await getDb();
        try {
          await db.createCollection(AUTH_EVENT_COLLECTION, {
            capped: true,
            size: AUTH_EVENT_CAPPED_BYTES,
            max: AUTH_EVENT_MAX_DOCS,
          });
        } catch (error) {
          // 48 = NamespaceExists. An existing collection is reused, but it
          // must still be capped or the tailable contract is not met.
          if ((error as { code?: number })?.code !== 48) throw error;
        }
        const stats = await db.command({ collStats: AUTH_EVENT_COLLECTION });
        if (stats.capped !== true) {
          throw new Error('The authentication event collection exists but is not capped; refusing to use it.');
        }
        const collection = db.collection<Document>(AUTH_EVENT_COLLECTION);
        // MongoDB returns cursor id 0 (and therefore no live tail) for a
        // tailable query against an empty capped collection. Capped
        // collections never lose records except to rollover, so one harmless
        // seed document keeps the collection non-empty forever. It parses as
        // no event and is never delivered to a client.
        if (await collection.estimatedDocumentCount() === 0) {
          await collection.insertOne({ seed: true, at: new Date() });
        }
        return collection;
      })();
      collectionPromise = attempt;
      void attempt.catch(() => {
        if (collectionPromise === attempt) collectionPromise = null;
      });
    }
    return collectionPromise;
  }

  function remember(eventId: string): void {
    seen.delete(eventId);
    seen.set(eventId, Date.now());
    while (seen.size > MAX_SEEN_EVENTS) {
      const oldest = seen.keys().next().value;
      if (!oldest) break;
      seen.delete(oldest);
    }
  }

  function dispatch(event: AuthInvalidationEvent): void {
    if (seen.has(event.eventId)) return;
    remember(event.eventId);
    for (const entry of [...subscriptions]) {
      // A subscription only receives events published after it was created.
      // Historical records are not replayed: the route revalidates the session
      // after subscribing, so a revocation that happened before the stream
      // existed is caught there. This also prevents an old account-wide event
      // from invalidating a session created after that event.
      if (event.at < entry.createdAt) continue;
      if (eventMatches(entry.subscription, event)) entry.subscription.listener(event);
    }
  }

  function acceptDocument(doc: Document): void {
    const event = parseDocument(doc);
    if (!event) return;
    dispatch(event);
  }

  async function tail(onReady: () => void, onFirstError: (error: unknown) => void): Promise<void> {
    let firstAttempt = true;
    let backoff = 250;
    while (!closed) {
      let active: FindCursor<Document> | null = null;
      const abort = new AbortController();
      activeAbort = abort;
      try {
        const collection = await ensureCollection();
        active = collection.find({}, {
          tailable: true,
          awaitData: true,
          maxAwaitTimeMS: WATCHER_MAX_AWAIT_MS,
          noCursorTimeout: true,
          signal: abort.signal,
        });
        cursor = active;
        let ready = false;
        while (!closed) {
          let doc: Document | null;
          try {
            // `tryNext`, unlike `next`, returns after one empty awaitData
            // getMore instead of looping until a document exists. That keeps
            // the cursor bounded and lets shutdown interrupt it.
            doc = await active.tryNext();
          } catch (error) {
            if (error instanceof MongoCursorExhaustedError) {
              if (firstAttempt && !ready) throw error;
              break;
            }
            throw error;
          }
          const initial = !ready;
          if (doc) acceptDocument(doc);
          if (initial) {
            ready = true;
            if (firstAttempt) {
              firstAttempt = false;
              started = true;
              backoff = 250;
              onReady();
            }
          }
        }
      } catch (error) {
        if (closed) return;
        if (firstAttempt) {
          onFirstError(error);
          return;
        }
        console.error(JSON.stringify({
          level: 'error',
          event: 'auth_event_watcher_unavailable',
          code: (error as { code?: unknown })?.code ?? null,
        }));
      } finally {
        if (cursor === active) cursor = null;
        if (activeAbort === abort) activeAbort = null;
        abort.abort();
        await active?.close().catch(() => undefined);
      }
      if (!closed) await sleep(backoff);
      backoff = Math.min(backoff * 2, 5_000);
    }
  }

  function ensureWatcher(): Promise<void> {
    if (closed) return Promise.reject(new Error('The authentication event bus is closed.'));
    if (watcherReady) return watcherReady;
    let resolveReady!: () => void;
    let rejectReady!: (error: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    watcherReady = ready;
    const attempt = tail(resolveReady, rejectReady);
    watcherPromise = attempt;
    void attempt.catch(() => undefined).then(() => {
      if (watcherPromise === attempt) watcherPromise = null;
      if (watcherReady === ready && !started) watcherReady = null;
    });
    return ready;
  }

  return {
    async publish(input) {
      if (closed) throw new Error('The authentication event bus is closed.');
      const event = makeEvent(input);
      let storageError: unknown = null;
      try {
        const collection = await ensureCollection();
        await collection.insertOne({
          eventId: event.eventId,
          userId: event.userId,
          sessionId: event.sessionId,
          reason: event.reason,
          at: new Date(event.at),
        });
      } catch (error) {
        storageError = error;
      }
      // Local delivery is still valuable when the shared log is temporarily
      // unavailable; session revocation already succeeded and remains
      // authoritative. Callers decide whether the storage failure is logged.
      dispatch(event);
      if (storageError) throw storageError;
    },

    async subscribe(subscription) {
      if (closed) throw new Error('The authentication event bus is closed.');
      const entry = { subscription, createdAt: Date.now() };
      subscriptions.add(entry);
      try {
        await ensureWatcher();
      } catch (error) {
        subscriptions.delete(entry);
        throw error;
      }
      return () => {
        subscriptions.delete(entry);
      };
    },

    async close() {
      closed = true;
      subscriptions.clear();
      seen.clear();
      const active = cursor;
      cursor = null;
      activeAbort?.abort();
      activeAbort = null;
      await active?.close().catch(() => undefined);
      // Do not wait for the bounded awaitData getMore to return. The closed
      // flag makes the loop exit as soon as the driver releases the cursor.
      void watcherPromise?.catch(() => undefined);
      watcherPromise = null;
      watcherReady = null;
    },
  };
}
