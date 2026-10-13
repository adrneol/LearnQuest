import type { NormalizedSnapshot } from '../types/index.js';

export interface MemoryCache {
  get(key: string): NormalizedSnapshot | null;
  set(key: string, snapshot: NormalizedSnapshot): void;
  /** current entry count (expired entries purged lazily on access) */
  size(): number;
  /** measured stats for ops visibility (bounded scan, no key material) */
  stats(): { entries: number; approxBytes: number; maxEntries: number };
  clear(): void;
}

/**
 * Per-app instance cache: TTL expiry + hard LRU bound (default 50 playlists).
 * TTL alone cannot bound growth under distinct playlist IDs; the LRU cap keeps
 * Render free-tier RSS predictable. Recency refreshes on hit; eviction drops
 * the least-recently-used entry first. Never stores API keys (snapshots only).
 */
export function createMemoryCache(
  ttlSec: () => number,
  opts?: { maxEntries?: () => number },
): MemoryCache {
  const store = new Map<string, { snapshot: NormalizedSnapshot; expiresAt: number }>();
  const maxEntries = () => Math.max(1, Math.floor(opts?.maxEntries?.() ?? 50));
  const purgeExpired = () => {
    const now = Date.now();
    for (const [k, v] of store) {
      if (now > v.expiresAt) store.delete(k);
    }
  };
  return {
    get(key: string): NormalizedSnapshot | null {
      const hit = store.get(key);
      if (!hit) return null;
      if (Date.now() > hit.expiresAt) {
        store.delete(key);
        return null;
      }
      // LRU refresh (expiry unchanged)
      store.delete(key);
      store.set(key, hit);
      return hit.snapshot;
    },
    set(key: string, snapshot: NormalizedSnapshot): void {
      purgeExpired();
      if (store.has(key)) store.delete(key);
      store.set(key, { snapshot, expiresAt: Date.now() + ttlSec() * 1000 });
      while (store.size > maxEntries()) {
        const oldest = store.keys().next();
        if (oldest.done) break;
        store.delete(oldest.value);
      }
    },
    size(): number {
      purgeExpired();
      return store.size;
    },
    stats(): { entries: number; approxBytes: number; maxEntries: number } {
      purgeExpired();
      let bytes = 0;
      for (const { snapshot } of store.values()) {
        // approx: titles + ids dominate; avoids full JSON cost per entry
        bytes += snapshot.playlistId.length * 2 + (snapshot.title?.length ?? 0) * 2;
        bytes += snapshot.entries.length * 220;
      }
      return { entries: store.size, approxBytes: bytes, maxEntries: maxEntries() };
    },
    clear(): void {
      store.clear();
    },
  };
}
