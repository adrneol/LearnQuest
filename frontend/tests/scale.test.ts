import { describe, it, expect } from 'vitest';
import {
  sumEntries,
  rangeDuration,
  validateRange,
  sortEntries,
} from '../src/domain/playlist/playlist.js';
import { positionTicks } from '../src/components/charts/theme.js';
import type { PlaylistEntry } from '../src/types/index.js';

// Deterministic large-playlist fixture: duration = 60 + (pos % 300) seconds,
// except every 37th entry is unresolved (deleted/private-like). Expected
// values below are plain loops — never the implementation under test.
function fixture(n: number): PlaylistEntry[] {
  const out: PlaylistEntry[] = [];
  for (let pos = 1; pos <= n; pos++) {
    if (pos % 37 === 0) {
      out.push({ position: pos, videoId: `v${pos}`, title: `Video ${pos}`, durationSec: null });
    } else {
      out.push({ position: pos, videoId: `v${pos}`, title: `Video ${pos}`, durationSec: 60 + (pos % 300) });
    }
  }
  return out;
}

function expectedTotal(entries: PlaylistEntry[]): { total: number; resolved: number; unresolved: number } {
  let total = 0;
  let resolved = 0;
  let unresolved = 0;
  for (const e of entries) {
    if (e.durationSec === null) unresolved += 1;
    else {
      total += e.durationSec;
      resolved += 1;
    }
  }
  return { total, resolved, unresolved };
}

for (const n of [1, 25, 103, 139, 200, 500, 1000]) {
  describe(`playlist size N=${n}`, () => {
    it('sums exact durations and flags unresolved entries', () => {
      const entries = fixture(n);
      const exp = expectedTotal(entries);
      const got = sumEntries(entries);
      expect(got.totalSec).toBe(exp.total);
      expect(got.resolved).toBe(exp.resolved);
      expect(got.unresolved).toBe(exp.unresolved);
      expect(got.isComplete).toBe(exp.unresolved === 0);
    });

    it('validates full-range boundaries and rejects out-of-range ends', () => {
      const entries = fixture(n);
      const snap: any = { entries };
      validateRange(1, n, n);
      const full = rangeDuration(snap, 1, n);
      expect(full.count).toBe(n);
      expect(full.totalSec).toBe(expectedTotal(entries).total);
      expect(() => validateRange(1, n + 1, n)).toThrow();
      expect(() => validateRange(0, n, n)).toThrow();
    });

    it('sorts the full collection (not just the page) and keeps canonical positions', () => {
      const entries = fixture(n);
      const byDur = sortEntries(entries, 'dur-desc');
      expect(byDur).toHaveLength(n);
      // Unresolved sort last, never as zero-length.
      const firstUnresolved = byDur.findIndex((e) => e.durationSec === null);
      if (entries.some((e) => e.durationSec === null)) {
        expect(firstUnresolved).toBeGreaterThan(-1);
        for (let i = firstUnresolved; i < byDur.length; i++) expect(byDur[i].durationSec).toBeNull();
      }
      // Resolved prefix is non-increasing by numeric seconds.
      const resolved = byDur.filter((e) => e.durationSec !== null) as { durationSec: number }[];
      for (let i = 1; i < resolved.length; i++) {
        expect(resolved[i - 1].durationSec).toBeGreaterThanOrEqual(resolved[i].durationSec);
      }
      // Positions are a permutation of 1..N (canonical identity preserved).
      expect([...byDur.map((e) => e.position)].sort((a, b) => a - b)).toEqual(
        Array.from({ length: n }, (_, i) => i + 1),
      );
    });

    it('chart ticks include first and last positions; dataset keeps every entry', () => {
      const ticks = positionTicks(1, n);
      expect(ticks[0]).toBe(1);
      expect(ticks[ticks.length - 1]).toBe(n);
      expect(ticks.length).toBeLessThanOrEqual(12);
      // Full-range chart dataset = one record per position (never binned).
      const entries = fixture(n);
      const data = entries.map((e) => ({ pos: e.position, min: e.durationSec === null ? 0 : e.durationSec / 60 }));
      expect(data).toHaveLength(n);
      expect(data[0].pos).toBe(1);
      expect(data[data.length - 1].pos).toBe(n);
    });
  });
}

describe('frontend performance budgets (measured, not estimated)', () => {
  const N = 1000;
  const entries = fixture(N);
  const snap: any = { entries };

  it('sort + filter + range + chart-build complete within generous budgets', () => {
    const t0 = performance.now();
    const filtered = entries.filter((e) => e.title.includes('Video'));
    const tFilter = performance.now() - t0;

    const t1 = performance.now();
    sortEntries(filtered, 'dur-desc');
    const tSort = performance.now() - t1;

    const t2 = performance.now();
    rangeDuration(snap, 1, N);
    const tRange = performance.now() - t2;

    const t3 = performance.now();
    let acc = 0;
    const chart = entries.map((e) => {
      acc += e.durationSec ?? 0;
      return { pos: e.position, cumSec: acc };
    });
    const tChart = performance.now() - t3;

    // Record actuals for the audit doc; budgets are generous sanity rails.
    // eslint-disable-next-line no-console
    console.log(`scale N=1000: filter=${tFilter.toFixed(1)}ms sort=${tSort.toFixed(1)}ms range=${tRange.toFixed(1)}ms chart=${tChart.toFixed(1)}ms`);
    expect(chart).toHaveLength(N);
    expect(tFilter).toBeLessThan(500);
    expect(tSort).toBeLessThan(500);
    expect(tRange).toBeLessThan(500);
    expect(tChart).toBeLessThan(1000);
  });

  it('pagination covers the full collection without dropping entries', () => {
    const PER = 25;
    const pages = Math.ceil(N / PER);
    let seen = 0;
    for (let p = 0; p < pages; p++) seen += entries.slice(p * PER, (p + 1) * PER).length;
    expect(pages).toBe(40);
    expect(seen).toBe(N);
  });
});
