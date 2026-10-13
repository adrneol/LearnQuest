import { describe, it, expect } from 'vitest';
import { validateRange, rangeDuration } from '../src/domain/index.js';

describe('frontend range guards (generic N)', () => {
  it('adapts to any N without code changes', () => {
    for (const n of [1, 25, 139, 200, 500]) {
      const snap: any = {
        playlistId: 'PLx1234567890',
        title: 'T',
        reportedCount: n,
        entries: Array.from({ length: n }, (_, i) => ({
          position: i + 1,
          videoId: `v${i}`,
          title: `V${i}`,
          durationSec: 60,
        })),
        source: 'api',
        fetchedAt: new Date().toISOString(),
        snapshotVersion: 1,
      };
      expect(rangeDuration(snap, 1, n).totalSec).toBe(n * 60);
      expect(() => validateRange(1, n + 1, n)).toThrow();
    }
  });
});
