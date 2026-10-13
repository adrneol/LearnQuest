import type { NormalizedSnapshot } from '../types/index.js';

export interface MemoryCache {
  get(key: string): NormalizedSnapshot | null;
  set(key: string, snapshot: NormalizedSnapshot): void;
}

/** Per-app instance cache (TTL seconds read live from config). */
export function createMemoryCache(ttlSec: () => number): MemoryCache {
  const store = new Map<string, { snapshot: NormalizedSnapshot; expiresAt: number }>();
  return {
    get(key: string): NormalizedSnapshot | null {
      const hit = store.get(key);
      if (!hit) return null;
      if (Date.now() > hit.expiresAt) {
        store.delete(key);
        return null;
      }
      return hit.snapshot;
    },
    set(key: string, snapshot: NormalizedSnapshot): void {
      store.set(key, { snapshot, expiresAt: Date.now() + ttlSec() * 1000 });
    },
  };
}
