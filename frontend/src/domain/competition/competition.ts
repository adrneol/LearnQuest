// Optional FICTIONAL competition simulator. Competitors are synthetic, seeded,
// and stored separately from real user events. Resetting a challenge never
// touches study history, goals, or achievements.

export type Tier = 'Ultra' | 'High' | 'Good' | 'Normal' | 'Average' | 'Below Average';

export const TIERS: Tier[] = ['Ultra', 'High', 'Good', 'Normal', 'Average', 'Below Average'];

export const DEFAULT_TIER_DIST: Record<Tier, number> = {
  Ultra: 2,
  High: 8,
  Good: 20,
  Normal: 30,
  Average: 25,
  'Below Average': 15,
};

export interface Competitor {
  id: string;
  name: string;
  initials: string;
  tier: Tier;
  /** synthetic aggregates over the challenge window, same definitions as user */
  uniqueContentSec: number;
  verifiedCount: number;
  focusSec: number;
  activeDays: number;
  windowDays: number;
  /** coherent per-day session history all aggregates derive from */
  sessions: SimDay[];
  /** derived aggregate efficiency (unique/focus*100) — informational only, never ranked */
  efficiency: number;
  /** practice minutes folded into focused time (notes/exercises), for display */
  practiceMin: number;
  /** Arena score: mean of eligible daily efficiencies (null when ineligible) */
  arenaScore: number | null;
  /** eligible active study days counted toward the arena score */
  eligibleDays: number;
}

/** One simulated challenge day. Efficiency varies per day within tier bounds. */
export interface SimDay {
  day: number;
  focusMin: number;
  contentMin: number;
  /** that day's efficiency percent (content/focus*100) */
  effDay: number;
  practiceMin: number;
  /** calendar identity (YYYY-MM-DD in the display timezone) when date-anchored */
  dateKey?: string;
}

export interface ChallengeConfig {
  seed: number;
  cohortSize: number; // incl. user, 10..2000
  tierDist: Record<Tier, number>;
  windowDays: number;
  /** max simulated study hours per rival per day (user history never capped) */
  dailyCapHours: number;
}

export const DEFAULT_CHALLENGE: ChallengeConfig = {
  seed: 20261013,
  cohortSize: 100,
  tierDist: { ...DEFAULT_TIER_DIST },
  windowDays: 14,
  dailyCapHours: 6,
};

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a string hash → uint32 (for date-anchored seeding). */
export function hashStringToUint32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Challenge-window calendar identities, oldest → newest, in the display
 * timezone. Same construction the Arena uses for the user's daily table, so
 * simulated dates and user dates align by construction. Stable within a
 * calendar day; sliding forward when the rolling window advances.
 */
export function challengeWindowDates(windowDays: number, timeZone: string, nowMs = Date.now()): string[] {
  const out: string[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    out.push(dateKeyInTimezone(new Date(nowMs - i * 86400000), timeZone));
  }
  return out;
}

/** Human window label, e.g. "Oct 5 – Oct 18, 2026". Falls back to ISO keys. */
export function windowLabel(dates: string[]): string {
  if (dates.length === 0) return '';
  try {
    const fmt = (k: string, withYear: boolean) => {
      const d = new Date(k.length === 10 ? `${k}T12:00:00Z` : k);
      return new Intl.DateTimeFormat('en-US', withYear ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' }).format(d);
    };
    if (dates.length === 1) return fmt(dates[0], true);
    return `${fmt(dates[0], false)} – ${fmt(dates[dates.length - 1], true)}`;
  } catch {
    return dates.length === 1 ? dates[0] : `${dates[0]} – ${dates[dates.length - 1]}`;
  }
}

import { generateAlias, initialsOf } from './aliases.js';
import { dateKeyInTimezone } from '../time/time.js';

/**
 * Tier EFFICIENCY BANDS (simulation-design assumptions, not population
 * benchmarks): plausible content-throughput ratios per tier. The 110% ceiling
 * bounds only fictional Ultra competitors — real user measurements are never
 * clamped. Kept deliberately separate from tier DISTRIBUTION (how many rivals
 * per tier), which must sum to 100%.
 */
export const TIER_BANDS: Record<Tier, [number, number]> = {
  Ultra: [1.0, 1.1],
  High: [0.85, 0.999],
  Good: [0.7, 0.849],
  Normal: [0.55, 0.699],
  Average: [0.4, 0.549],
  'Below Average': [0.2, 0.399],
};

/** Maximum downward deviation (percentage points) from the tier ceiling per day. */
export const TIER_DEVIATION: Record<Tier, number> = {
  Ultra: 15,
  High: 10,
  Good: 8,
  Normal: 6,
  Average: 5,
  'Below Average': 4,
};

/** Tier study habits: daily frequency + session-length range (minutes). */
export const TIER_HABITS: Record<Tier, { p: number; minMin: number; minMax: number }> = {
  Ultra: { p: 0.92, minMin: 60, minMax: 180 },
  High: { p: 0.8, minMin: 45, minMax: 120 },
  Good: { p: 0.65, minMin: 30, minMax: 90 },
  Normal: { p: 0.5, minMin: 20, minMax: 60 },
  Average: { p: 0.38, minMin: 15, minMax: 45 },
  'Below Average': { p: 0.25, minMin: 10, minMax: 30 },
};

/** Eligible active study days required: ≥3 for windows ≥3 days, else one per window day. */
export function requiredEligibleDays(windowDays: number): number {
  return windowDays >= 3 ? 3 : Math.max(1, windowDays);
}

/**
 * Arena score = arithmetic mean of eligible daily efficiencies (equal weight
 * per day). Deliberately different from the Efficiency page's aggregate ratio;
 * both derive from the same raw records and interval rules.
 */
export function arenaScore(dailyEffs: number[]): number | null {
  if (dailyEffs.length === 0) return null;
  return dailyEffs.reduce((a, b) => a + b, 0) / dailyEffs.length;
}

export function validateChallenge(cfg: ChallengeConfig): string[] {
  const errs: string[] = [];
  if (!Number.isInteger(cfg.cohortSize) || cfg.cohortSize < 10 || cfg.cohortSize > 2000) {
    errs.push('Cohort size must be an integer between 10 and 2000 (including you).');
  }
  const sum = TIERS.reduce((a, t) => a + (cfg.tierDist[t] ?? 0), 0);
  if (Math.abs(sum - 100) > 0.001) errs.push(`Tier percentages must sum to 100 (got ${sum}).`);
  for (const t of TIERS) {
    const v = cfg.tierDist[t] ?? 0;
    if (v < 0 || v > 100) errs.push(`Tier ${t} must be 0–100.`);
  }
  if (!Number.isInteger(cfg.seed)) errs.push('Seed must be an integer.');
  if (!Number.isFinite(cfg.dailyCapHours) || cfg.dailyCapHours < 1 || cfg.dailyCapHours > 12) {
    errs.push('Daily study cap must be between 1 and 12 hours.');
  }
  return errs;
}

/**
 * Generate deterministic synthetic competitors over a challenge window.
 * Dependency order per day: active? → focused minutes (capped by the
 * configured daily limit) → that day's efficiency within tier bounds →
 * new unique content = focus × efficiency (capped by remaining playlist
 * content) → record. Aggregates derive from the day records, so nothing can
 * disagree. Once the playlist is exhausted, new-content activity ends honestly
 * (practice continues separately and is never counted as new coverage).
 *
 * Date anchoring: pass `opts.anchorDates` (oldest → newest calendar keys for
 * the window). Each rival day is then seeded by (seed, rival index, date), so
 * the same calendar date reproduces the same activity across refreshes, while
 * an advancing rolling window slides to new dates and recomputed ranks. When
 * omitted, the legacy seed-only stream is used (stable; kept for tests).
 */
export function generateCompetitors(
  cfg: ChallengeConfig,
  playlist: { totalSec: number | null; n: number; avgVideoSec: number },
  opts?: { anchorDates?: string[] },
): Competitor[] {
  // Pass 1 — identities from their own stream: renaming never happens when
  // tiers, distributions, windows, or caps change; expanding the cohort
  // appends new identities (first k are stable).
  const nameRnd = mulberry32((cfg.seed ^ 0x9e3779b9) >>> 0);
  const used = new Set<string>();
  const names: { id: string; name: string; initials: string }[] = [];
  for (let i = 0; i < cfg.cohortSize - 1; i++) {
    const name = generateAlias(nameRnd, used);
    names.push({ id: `sim-${cfg.seed}-${i}`, name, initials: initialsOf(name) });
  }
  const anchored = opts?.anchorDates && opts.anchorDates.length === cfg.windowDays ? opts.anchorDates : null;
  // Pass 2 — behavior. Legacy path keeps the exact historical sequential stream
  // (tests depend on its stability). Anchored path derives tier per rival and
  // each day from (seed, rival, date) so refreshes reproduce and windows slide.
  const rnd = anchored ? null : mulberry32(cfg.seed);
  const out: Competitor[] = [];
  const total = playlist.totalSec ?? playlist.n * playlist.avgVideoSec;
  const pickTier = (roll: number): Tier => {
    let acc = 0;
    for (const t of TIERS) {
      acc += cfg.tierDist[t] ?? 0;
      if (roll < acc) return t;
    }
    return 'Normal';
  };
  for (let i = 0; i < cfg.cohortSize - 1; i++) {
    // tier by distribution (stable per rival in anchored mode)
    let tier: Tier;
    if (anchored) {
      const tierRnd = mulberry32((cfg.seed ^ Math.imul(i + 1, 2654435761) ^ 0x9e3779b9) >>> 0);
      tier = pickTier(tierRnd() * 100);
    } else {
      tier = pickTier((rnd as () => number)() * 100);
    }
    const habit = TIER_HABITS[tier];
    const [, hi] = TIER_BANDS[tier];
    const ceiling = hi * 100; // percentage points, e.g. Ultra 110
    const deviation = TIER_DEVIATION[tier]; // max downward deviation, percentage points
    const capMin = Math.max(30, Math.min(720, Math.round(cfg.dailyCapHours * 60)));
    const sessions: SimDay[] = [];
    let focusSec = 0;
    let uniqueSec = 0;
    for (let d = 0; d < cfg.windowDays; d++) {
      if (anchored) {
        const dateKey = (anchored as string[])[d];
        const dayRnd = mulberry32(hashStringToUint32(`${cfg.seed}:${i}:${dateKey}`));
        const rActive = dayRnd();
        if (rActive >= habit.p) continue;
        const rFocus = dayRnd();
        const rEff = dayRnd();
        const rPractice = dayRnd();
        // session length within tier habits AND the configured daily cap
        const sessMin = Math.min(capMin, Math.round(habit.minMin + rFocus * (habit.minMax - habit.minMin)));
        if (sessMin <= 0) continue;
        // that day's efficiency varies by date within tier bounds (never fixed forever)
        const effDay = Math.max(0, ceiling - rEff * deviation);
        const contentMin = (sessMin * effDay) / 100;
        const remaining = Math.max(0, total - uniqueSec);
        if (remaining <= 0) break; // course exhausted: no fabricated further coverage
        // Final partial day keeps its TRUE lower efficiency (ran out of new
        // material); the tier bound governs the sampled intention, documented below.
        const capped = Math.min(contentMin, remaining / 60);
        const practiceMin = Math.round(sessMin * (0.05 + rPractice * 0.15));
        sessions.push({ day: d, focusMin: sessMin, contentMin: capped, effDay: Math.round(capped > 0 ? (capped / sessMin) * 100 * 10 : 0) / 10, practiceMin, dateKey });
        focusSec += Math.round(sessMin * 60);
        uniqueSec += Math.round(capped * 60);
      } else {
        const r = rnd as () => number;
        if (r() >= habit.p) continue;
        // session length within tier habits AND the configured daily cap
        const sessMin = Math.min(capMin, Math.round(habit.minMin + r() * (habit.minMax - habit.minMin)));
        if (sessMin <= 0) continue;
        // that day's efficiency varies by date within tier bounds (never fixed forever)
        const effDay = Math.max(0, ceiling - r() * deviation);
        const contentMin = (sessMin * effDay) / 100;
        const remaining = Math.max(0, total - uniqueSec);
        if (remaining <= 0) break; // course exhausted: no fabricated further coverage
        // Final partial day keeps its TRUE lower efficiency (ran out of new
        // material); the tier bound governs the sampled intention, documented below.
        const capped = Math.min(contentMin, remaining / 60);
        const practiceMin = Math.round(sessMin * (0.05 + r() * 0.15));
        sessions.push({ day: d, focusMin: sessMin, contentMin: capped, effDay: Math.round(capped > 0 ? (capped / sessMin) * 100 * 10 : 0) / 10, practiceMin });
        focusSec += Math.round(sessMin * 60);
        uniqueSec += Math.round(capped * 60);
      }
    }
    uniqueSec = Math.min(uniqueSec, total); // bounded by what exists
    const days = sessions.length;
    const verifiedCount = Math.min(playlist.n, Math.floor(uniqueSec / Math.max(1, playlist.avgVideoSec)));
    const efficiency = focusSec > 0 ? (uniqueSec / focusSec) * 100 : 0;
    const practiceMin = sessions.reduce((a, s) => a + s.practiceMin, 0);
    const dailyEffs = sessions.filter((s) => s.focusMin > 0).map((s) => (s.contentMin / s.focusMin) * 100);
    const score = arenaScore(dailyEffs);
    out.push({
      id: names[i].id,
      name: names[i].name,
      initials: names[i].initials,
      tier,
      uniqueContentSec: uniqueSec,
      verifiedCount,
      focusSec,
      activeDays: days,
      windowDays: cfg.windowDays,
      sessions,
      efficiency,
      practiceMin,
      arenaScore: score,
      eligibleDays: dailyEffs.length,
    });
  }
  return out;
}

export interface RankedRow {
  id: string;
  name: string;
  isUser: boolean;
  tier: Tier | 'You';
  /** average daily efficiency %, or null when ineligible/unmeasurable */
  value: number | null;
  display: string;
  provisional: boolean;
  /** Competition rank ("1224") among scored rows; null while provisional. */
  rank: number | null;
  eligibleDays: number;
  windowDays: number;
}

export interface UserArenaInput {
  /** eligible daily efficiencies (percent) within the window, oldest → newest */
  dailyEffs: number[];
  /** secondary display stats (never ranked) */
  uniqueContentSec: number;
  verifiedCount: number;
  focusSec: number;
  activeDays: number;
}

function fmtHMS(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** FIXED efficiency-only ranking. Score = mean of eligible daily efficiencies. */
export function rankBoard(
  cfg: ChallengeConfig,
  competitors: Competitor[],
  user: UserArenaInput,
): {
  rows: RankedRow[];
  userRank: number | null;
  percentile: number | null;
  ahead: number;
  required: number;
  userScore: number | null;
  userEligible: number;
} {
  const required = requiredEligibleDays(cfg.windowDays);
  const userScore = arenaScore(user.dailyEffs);
  const userEligible = user.dailyEffs.length;
  const userRanked = userScore !== null && userEligible >= required;

  const rows: RankedRow[] = [
    ...competitors.map((c) => {
      const ok = c.arenaScore !== null && c.eligibleDays >= required;
      return {
        id: c.id,
        name: c.name,
        isUser: false,
        tier: c.tier,
        value: ok ? c.arenaScore : null,
        display: ok && c.arenaScore !== null ? `${c.arenaScore.toFixed(1)}%` : 'provisional',
        provisional: !ok,
        rank: null as number | null,
        eligibleDays: c.eligibleDays,
        windowDays: c.windowDays,
      };
    }),
    {
      id: 'user',
      name: 'You',
      isUser: true,
      tier: 'You' as const,
      value: userRanked && userScore !== null ? userScore : null,
      display:
        userScore === null
          ? 'no eligible days yet'
          : !userRanked
            ? `${userScore.toFixed(1)}% · provisional`
            : `${userScore.toFixed(1)}%`,
      provisional: !userRanked,
      rank: null,
      eligibleDays: userEligible,
      windowDays: cfg.windowDays,
    },
  ];
  // Scored rows first (desc, stable id tiebreak); provisionals after in id
  // order — a provisional user is NEVER ranked last as if scoring zero.
  const scored = rows
    .filter((r) => r.value !== null)
    .sort((a, b) => (b.value as number) - (a.value as number) || (a.id < b.id ? -1 : 1));
  const prov = rows.filter((r) => r.value === null).sort((a, b) => (a.id < b.id ? -1 : 1));
  const ordered = [...scored, ...prov];
  rows.length = 0;
  rows.push(...ordered);
  for (const r of scored) {
    r.rank = 1 + scored.filter((o) => (o.value as number) > (r.value as number)).length;
  }
  const me = rows.find((r) => r.isUser)!;
  const userRank = me.rank;
  const ahead = me.value !== null ? scored.filter((o) => !o.isUser && (o.value as number) > (me.value as number)).length : 0;
  const n = rows.length;
  // Convention: percentile = share of the cohort ranked STRICTLY BELOW you
  // (scored rows only). Provisional → null, not 0.
  const percentile =
    me.value === null || n <= 1
      ? null
      : (scored.filter((o) => !o.isUser && (o.value as number) < (me.value as number)).length / (n - 1)) * 100;
  return { rows, userRank, percentile, ahead, required, userScore, userEligible };
}

/**
 * Gap to the next rank UP in percentage points. Null when leading,
 * provisional, or otherwise indeterminable — never fabricated.
 */
export function gapToNext(userValue: number | null, rowAboveValue: number | null): string | null {
  if (userValue === null || rowAboveValue === null || !(rowAboveValue > userValue)) return null;
  return `${(rowAboveValue - userValue).toFixed(1)} percentage points`;
}
