import { describe, it, expect } from 'vitest';
import {
  generateCompetitors,
  challengeWindowDates,
  windowLabel,
  arenaScore,
  requiredEligibleDays,
  DEFAULT_CHALLENGE,
} from '../src/domain/competition/competition.js';
import { positionTicks } from '../src/components/charts/theme.js';

// Independent expectations below are hand-written numbers, never derived by
// calling the implementation under test to produce the expected value.

const BIG = { totalSec: 100_000_000, n: 100000, avgVideoSec: 600 };
const SMALL = { totalSec: 36000, n: 100, avgVideoSec: 360 };

// Hand-written tier ceilings + deviations from the spec (percentage points).
const CEIL: Record<string, number> = {
  Ultra: 110,
  High: 99.9,
  Good: 84.9,
  Normal: 69.9,
  Average: 54.9,
  'Below Average': 39.9,
};
const DEV: Record<string, number> = {
  Ultra: 15,
  High: 10,
  Good: 8,
  Normal: 6,
  Average: 5,
  'Below Average': 4,
};

function anchors(endIso: string, windowDays: number): string[] {
  // Build deterministic calendar keys ending at endIso (UTC), oldest → newest.
  const end = new Date(endIso + 'T12:00:00Z').getTime();
  const out: string[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    out.push(new Date(end - i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

describe('date-anchored simulation', () => {
  it('window dates are oldest-first, stable for the same instant, slide with time', () => {
    const a = challengeWindowDates(14, 'UTC', Date.UTC(2026, 9, 13, 12, 0));
    const b = challengeWindowDates(14, 'UTC', Date.UTC(2026, 9, 13, 18, 0));
    expect(a).toHaveLength(14);
    // Same calendar day in UTC → same window (stable on refresh).
    expect(b).toEqual(a);
    const next = challengeWindowDates(14, 'UTC', Date.UTC(2026, 9, 14, 12, 0));
    expect(next).toHaveLength(14);
    // Rolling window slides by exactly one day.
    expect(next[0]).toBe(a[1]);
    expect(next[13]).not.toBe(a[13]);
    // Oldest < newest lexicographically for ISO keys.
    expect(a[0] < a[13]).toBe(true);
  });

  it('window label names the exact first and last dates', () => {
    const dates = anchors('2026-10-18', 14); // 2026-10-05 … 2026-10-18
    expect(dates[0]).toBe('2026-10-05');
    expect(dates[13]).toBe('2026-10-18');
    const label = windowLabel(dates);
    // Independent expectation: must mention both ends, not a generic count.
    expect(label).toMatch(/Oct/);
    expect(label).toMatch(/5/);
    expect(label).toMatch(/18/);
    expect(label).toMatch(/2026/);
  });

  it('same anchor dates reproduce the same cohort; shifted window changes it', () => {
    const cfg = { ...DEFAULT_CHALLENGE, cohortSize: 60, seed: 1234, windowDays: 14 };
    const d1 = anchors('2026-10-18', 14);
    const d2 = anchors('2026-10-19', 14);
    const a = generateCompetitors(cfg, BIG, { anchorDates: d1 });
    const b = generateCompetitors(cfg, BIG, { anchorDates: d1 });
    expect(a).toEqual(b); // stable on refresh
    const c = generateCompetitors(cfg, BIG, { anchorDates: d2 });
    // Sliding window must change at least one rival's history (new date in).
    const same = a.every((r, i) => JSON.stringify(r.sessions) === JSON.stringify(c[i].sessions));
    expect(same).toBe(false);
    // Identities stay stable while histories slide.
    expect(c.map((r) => r.name)).toEqual(a.map((r) => r.name));
  });

  it('anchored daily efficiencies vary by date within tier bounds (huge playlist, no capping)', () => {
    const cfg = { ...DEFAULT_CHALLENGE, cohortSize: 200, seed: 42, windowDays: 14 };
    const comps = generateCompetitors(cfg, BIG, { anchorDates: anchors('2026-10-18', 14) });
    let varied = 0;
    for (const c of comps) {
      if (c.sessions.length < 5) continue;
      const effs = c.sessions.map((s) => (s.contentMin / s.focusMin) * 100);
      const hi = CEIL[c.tier];
      const dev = DEV[c.tier];
      for (const e of effs) {
        expect(e).toBeLessThanOrEqual(hi + 0.6);
        expect(e).toBeGreaterThanOrEqual(hi - dev - 0.6);
      }
      if (Math.max(...effs) - Math.min(...effs) > 0.5) varied += 1;
    }
    expect(varied).toBeGreaterThan(10);
  });

  it('anchored aggregates agree with day records; caps and playlist bounds hold', () => {
    const cfg = { ...DEFAULT_CHALLENGE, cohortSize: 120, seed: 7, windowDays: 14, dailyCapHours: 1 };
    const comps = generateCompetitors(cfg, SMALL, { anchorDates: anchors('2026-10-18', 14) });
    for (const c of comps) {
      const f = c.sessions.reduce((x, s) => x + Math.round(s.focusMin * 60), 0);
      const u = c.sessions.reduce((x, s) => x + Math.round(s.contentMin * 60), 0);
      expect(c.focusSec).toBe(f);
      expect(Math.abs(c.uniqueContentSec - u)).toBeLessThanOrEqual(c.sessions.length);
      expect(c.uniqueContentSec).toBeLessThanOrEqual(36000);
      expect(c.verifiedCount).toBeLessThanOrEqual(100);
      for (const s of c.sessions) {
        expect(s.focusMin).toBeLessThanOrEqual(60); // 1h cap binds
        expect(s.contentMin).toBeGreaterThanOrEqual(0);
        expect(s.dateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
      if (c.focusSec > 0) expect(c.efficiency).toBeCloseTo((c.uniqueContentSec / c.focusSec) * 100, 0);
    }
  });

  it('legacy (unanchored) generation stays deterministic', () => {
    const a = generateCompetitors(DEFAULT_CHALLENGE, SMALL);
    const b = generateCompetitors(DEFAULT_CHALLENGE, SMALL);
    expect(a).toEqual(b);
  });
});

describe('fair efficiency math (independent fixtures)', () => {
  it('arena score is the mean of eligible dailies; empty is unmeasurable', () => {
    // Hand-computed: (60 + 70 + 80) / 3 = 70.
    expect(arenaScore([60, 70, 80])).toBe(70);
    expect(arenaScore([])).toBeNull();
    expect(requiredEligibleDays(14)).toBe(3);
    expect(requiredEligibleDays(2)).toBe(2);
    expect(requiredEligibleDays(1)).toBe(1);
  });

  it('x-axis ticks always include the first and last playlist positions', () => {
    // 1–103 must not end at 100.
    const ticks = positionTicks(1, 103);
    expect(ticks[0]).toBe(1);
    expect(ticks[ticks.length - 1]).toBe(103);
    expect(ticks.length).toBeLessThanOrEqual(12);
    // Short ranges label every position.
    expect(positionTicks(1, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // Another length: 1–139 ends at 139.
    const t139 = positionTicks(1, 139);
    expect(t139[0]).toBe(1);
    expect(t139[t139.length - 1]).toBe(139);
  });
});
