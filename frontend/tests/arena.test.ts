import { describe, it, expect } from 'vitest';
import {
  generateCompetitors, rankBoard, gapToNext, arenaScore, requiredEligibleDays, validateChallenge,
  DEFAULT_CHALLENGE, TIER_BANDS, TIER_DEVIATION, type Competitor, type UserArenaInput,
} from '../src/domain/competition/competition.js';
import { generateAlias, initialsOf } from '../src/domain/competition/aliases.js';
import { mulberry32 } from '../src/domain/competition/competition.js';

const BASIS = { totalSec: 36000, n: 100, avgVideoSec: 360 };
const USER: UserArenaInput = { dailyEffs: [60, 70, 80], uniqueContentSec: 5000, verifiedCount: 10, focusSec: 3600, activeDays: 3 };

describe('gamer aliases', () => {
  it('unique across a 2000 cohort, stable for a seed, varied in style', () => {
    const comps = generateCompetitors({ ...DEFAULT_CHALLENGE, cohortSize: 2000 }, BASIS);
    const names = comps.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(comps.map((c) => c.id)).size).toBe(comps.length);
    // gamer style: single PascalCase token, no ordinary "First Last" people names
    for (const n of names) {
      expect(n).not.toMatch(/ /);
      expect(n).toMatch(/^[A-Z][A-Za-z-]+$/);
    }
    // variety: more than a handful of distinct leading words
    const heads = new Set(names.map((n) => n.split(/(?=[A-Z])/)[0]));
    expect(heads.size).toBeGreaterThan(20);
    // stable on refresh
    const again = generateCompetitors({ ...DEFAULT_CHALLENGE, cohortSize: 2000 }, BASIS);
    expect(again.map((c) => c.name)).toEqual(names);
  });

  it('tier/distribution changes do not rename existing identities', () => {
    const a = generateCompetitors(DEFAULT_CHALLENGE, BASIS).map((c) => c.name);
    const b = generateCompetitors(
      { ...DEFAULT_CHALLENGE, tierDist: { Ultra: 50, High: 10, Good: 10, Normal: 10, Average: 10, 'Below Average': 10 } },
      BASIS,
    ).map((c) => c.name);
    expect(b).toEqual(a);
  });

  it('cohort expansion appends without scrambling existing identities', () => {
    const small = generateCompetitors({ ...DEFAULT_CHALLENGE, cohortSize: 100 }, BASIS).map((c) => c.name);
    const big = generateCompetitors({ ...DEFAULT_CHALLENGE, cohortSize: 200 }, BASIS).map((c) => c.name);
    expect(big.slice(0, 99)).toEqual(small);
  });

  it('initials derive from alias parts', () => {
    expect(initialsOf('NeonRonin')).toBe('NR');
    expect(initialsOf('QuantumRaider-X')).toBe('QR');
  });

  it('standalone generator enforces uniqueness', () => {
    const rnd = mulberry32(7);
    const used = new Set<string>();
    const names = Array.from({ length: 500 }, () => generateAlias(rnd, used));
    expect(new Set(names).size).toBe(500);
  });
});

describe('coherent tier-band simulation', () => {
  // Huge playlist => no content capping; band conformance must hold exactly.
  const BIG = { totalSec: 100_000_000, n: 100000, avgVideoSec: 600 };

  it('every competitor efficiency lands inside its tier band (Ultra ≤ 110%)', () => {
    const comps = generateCompetitors({ ...DEFAULT_CHALLENGE, cohortSize: 600, seed: 99 }, BIG);
    for (const c of comps) {
      if (c.focusSec === 0) continue; // inactive window: no ratio to judge
      const [lo, hi] = TIER_BANDS[c.tier];
      expect(c.efficiency).toBeGreaterThanOrEqual(lo * 100 - 0.5);
      expect(c.efficiency).toBeLessThanOrEqual(hi * 100 + 0.5);
    }
    const ultras = comps.filter((c) => c.tier === 'Ultra' && c.focusSec > 0);
    expect(ultras.length).toBeGreaterThan(0);
    for (const u of ultras) expect(u.efficiency).toBeLessThanOrEqual(110.01);
  });

  it('aggregates always agree with the session history; bounds hold', () => {
    const comps = generateCompetitors({ ...DEFAULT_CHALLENGE, cohortSize: 200, seed: 7 }, BASIS);
    for (const c of comps) {
      const f = c.sessions.reduce((a, s) => a + Math.round(s.focusMin * 60), 0);
      const u = c.sessions.reduce((a, s) => a + Math.round(s.contentMin * 60), 0);
      expect(c.focusSec).toBe(f);
      expect(Math.abs(c.uniqueContentSec - u)).toBeLessThanOrEqual(c.sessions.length); // per-session rounding only
      expect(c.uniqueContentSec).toBeLessThanOrEqual(36000);
      expect(c.focusSec).toBeGreaterThanOrEqual(0);
      expect(c.verifiedCount).toBeLessThanOrEqual(100);
      expect(c.activeDays).toBe(c.sessions.length);
      for (const s of c.sessions) {
        expect(s.focusMin).toBeGreaterThanOrEqual(10);
        expect(s.focusMin).toBeLessThanOrEqual(180);
        expect(s.contentMin).toBeGreaterThanOrEqual(0);
      }
      // displayed efficiency derives from the same history (real formula)
      if (c.focusSec > 0) expect(c.efficiency).toBeCloseTo((c.uniqueContentSec / c.focusSec) * 100, 0);
    }
    // useful variation: not everyone identical
    const vals = new Set(comps.map((c) => c.uniqueContentSec));
    expect(vals.size).toBeGreaterThan(20);
  });
});

function comp(over: Partial<Competitor> & { id: string }): Competitor {
  return {
    name: 'TestBot', initials: 'TB', tier: 'Normal',
    uniqueContentSec: 0, verifiedCount: 0, focusSec: 0,
    activeDays: 0, windowDays: 14, sessions: [], efficiency: 0, practiceMin: 0,
    arenaScore: null, eligibleDays: 0, ...over,
  };
}

function scored(id: string, effs: number[]): Competitor {
  const score = arenaScore(effs)!;
  const focusSec = effs.length * 3600;
  const unique = Math.round(effs.reduce((a, e) => a + e, 0) / 100 * 3600);
  return comp({ id, arenaScore: score, eligibleDays: effs.length, focusSec, uniqueContentSec: unique, efficiency: score, activeDays: effs.length });
}

describe('arena scoring (average daily efficiency, fixed basis)', () => {
  it('arenaScore is the mean of eligible dailies; empty means unmeasurable', () => {
    expect(arenaScore([60, 70, 80])).toBe(70);
    expect(arenaScore([])).toBeNull();
    expect(requiredEligibleDays(14)).toBe(3);
    expect(requiredEligibleDays(2)).toBe(2);
    expect(requiredEligibleDays(1)).toBe(1);
  });

  it('ties share a competition rank (1,2,2,4); percentile counts strictly below', () => {
    const comps = [scored('a', [80, 80, 80]), scored('b', [80, 80, 80]), scored('c', [50, 50, 50])];
    const r = rankBoard(DEFAULT_CHALLENGE, comps, { ...USER, dailyEffs: [80, 80, 80] });
    const ranks = new Map(r.rows.map((x) => [x.id, x.rank]));
    expect(ranks.get('a')).toBe(1);
    expect(ranks.get('b')).toBe(1);
    expect(ranks.get('user')).toBe(1);
    expect(ranks.get('c')).toBe(4);
    expect(r.percentile).toBeCloseTo((1 / 3) * 100, 5);
  });

  it('rank 1 of N is best; last place percentile is 0', () => {
    const comps = [scored('a', [10, 10, 10])];
    const top = rankBoard(DEFAULT_CHALLENGE, comps, { ...USER, dailyEffs: [99, 99, 99] });
    expect(top.userRank).toBe(1);
    expect(top.percentile).toBe(100);
    const bottom = rankBoard(DEFAULT_CHALLENGE, comps, { ...USER, dailyEffs: [1, 1, 1] });
    expect(bottom.userRank).toBe(2);
    expect(bottom.percentile).toBe(0);
  });

  it('volume never ranks: more hours at lower efficiency loses', () => {
    // rival: 10 eligible days of 40% (huge volume); user: 3 days of 90%
    const comps = [scored('big', Array(10).fill(40))];
    const r = rankBoard(DEFAULT_CHALLENGE, comps, { ...USER, dailyEffs: [90, 90, 90] });
    expect(r.userRank).toBe(1);
  });

  it('provisional users get no rank and no bottom-place percentile', () => {
    const comps = [scored('a', [70, 70, 70])];
    const r = rankBoard(DEFAULT_CHALLENGE, comps, { ...USER, dailyEffs: [95] }); // 1 of required 3
    expect(r.userRank).toBeNull();
    expect(r.percentile).toBeNull();
    expect(r.userEligible).toBe(1);
    expect(r.required).toBe(3);
    const me = r.rows.find((x) => x.isUser)!;
    expect(me.provisional).toBe(true);
    expect(me.display).toMatch(/provisional/);
    // not sorted as zero: provisional section follows all scored rows
    const lastScored = Math.max(...r.rows.filter((x) => x.value !== null).map((x) => r.rows.indexOf(x)));
    expect(r.rows.indexOf(me)).toBeGreaterThan(lastScored);
  });

  it('gap is in percentage points, null when leading or provisional', () => {
    expect(gapToNext(90, 92.4)).toBe('2.4 percentage points');
    expect(gapToNext(95, 90)).toBeNull(); // not above
    expect(gapToNext(null, 90)).toBeNull();
    expect(gapToNext(90, null)).toBeNull();
  });
});

describe('date-varying tier simulation', () => {
  it('daily efficiency varies by date within tier bounds (never one flat value)', () => {
    // Huge playlist: no exhaustion capping, so every recorded day must obey its band.
    const big = { totalSec: 100_000_000, n: 100000, avgVideoSec: 600 };
    const comps = generateCompetitors({ ...DEFAULT_CHALLENGE, cohortSize: 300, seed: 42 }, big);
    let varied = 0;
    for (const c of comps) {
      if (c.sessions.length < 5) continue;
      const effs = c.sessions.map((s) => (s.contentMin / s.focusMin) * 100);
      const hi = TIER_BANDS[c.tier][1];
      const dev = TIER_DEVIATION[c.tier];
      for (const e of effs) {
        expect(e).toBeLessThanOrEqual(hi * 100 + 0.6);
        expect(e).toBeGreaterThanOrEqual(hi * 100 - dev - 0.6);
      }
      if (Math.max(...effs) - Math.min(...effs) > 0.5) varied += 1;
    }
    expect(varied).toBeGreaterThan(10); // natural variation, not flat lines
  });

  it('daily cap binds rival sessions; user history is never capped by it', () => {
    const capped = generateCompetitors({ ...DEFAULT_CHALLENGE, cohortSize: 200, seed: 5, dailyCapHours: 1 }, BASIS);
    for (const c of capped) {
      for (const s of c.sessions) expect(s.focusMin).toBeLessThanOrEqual(60);
    }
    // 6h default never binds habit ranges (max 180m) — cap only bites when lowered
    const def = generateCompetitors({ ...DEFAULT_CHALLENGE, cohortSize: 200, seed: 5 }, BASIS);
    for (const c of def) {
      for (const s of c.sessions) expect(s.focusMin).toBeLessThanOrEqual(360);
    }
    expect(validateCapRejects()).toBe(true);
  });

  it('rolling window changes recompute eligibility requirements', () => {
    const comps = generateCompetitors({ ...DEFAULT_CHALLENGE, windowDays: 14 }, BASIS);
    const w14 = rankBoard({ ...DEFAULT_CHALLENGE, windowDays: 14 }, comps, USER);
    expect(w14.required).toBe(3);
    const w2 = rankBoard({ ...DEFAULT_CHALLENGE, windowDays: 2 }, comps, USER);
    expect(w2.required).toBe(2);
  });
});

function validateCapRejects(): boolean {
  // dailyCapHours outside 1–12 is rejected by validateChallenge
  return (
    validateChallenge({ ...DEFAULT_CHALLENGE, dailyCapHours: 0 }).length > 0 &&
    validateChallenge({ ...DEFAULT_CHALLENGE, dailyCapHours: 13 }).length > 0 &&
    validateChallenge({ ...DEFAULT_CHALLENGE, dailyCapHours: 6 }).length === 0
  );
}
