import type { DataStore } from '../store.js';

/**
 * Remove expired authentication artifacts whose historical TTL indexes were
 * declared on ISO-string `expiresAt` fields. MongoDB TTL indexes only expire
 * BSON Dates, so new documents also carry a Date `expireAt`, while this sweep
 * handles legacy string records without changing their schema in place.
 */
export async function purgeExpiredSecurityRecords(
  store: DataStore,
  now: Date = new Date(),
): Promise<{ sessions: number; actionTokens: number; oauthStates: number; rateLimits: number }> {
  const iso = now.toISOString();
  const [sessions, actionTokens, oauthStates, rateLimits] = await Promise.all([
    store.sessions.deleteMany({ expiresAt: { $lt: iso } }),
    store.actionTokens.deleteMany({ expiresAt: { $lt: iso } }),
    store.oauthStates.deleteMany({ expiresAt: { $lt: iso } }),
    store.rateLimits.deleteMany({ expireAt: { $lt: now } }),
  ]);
  return { sessions, actionTokens, oauthStates, rateLimits };
}
