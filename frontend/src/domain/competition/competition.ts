// Optional FICTIONAL competition simulator. Competitors are synthetic, seeded,
// and stored separately from real user events. Version 2 scores sustainable
// completion instead of average daily efficiency:
//
//   P = min(U / L, 1)        progress (covered content / resolved playlist)
//   C = min(Q / W, 1)        consistency (qualifying days / window days)
//   Arena = 100 x (0.75 P + 0.25 C)
//
// The weights are a product policy choice, not a scientific constant. XP,
// hours, streaks, and tier are never inputs. A user or rival is provisional
// until at least 3 qualifying days and 7 observed calendar days exist.

import { generateAlias, initialsOf } from './aliases.js';
import { calendarWindowDates, zonedNoonMs, attributeFocusByDay, attributePlaybackByDay, splitPlaybackSegmentByDay } from '../time/time.js';
import { supportedZone } from '../time/timezones.js';
import { mergeIntervals } from '../playback/playback.js';
import { buildEntryProgressIndex, isProgressComplete } from '../progress/identity.js';
import type { PlaybackSegment } from '../playback/playback.js';
import type { PlaylistSnapshot, ProgressRecord, StudySession } from '../../types/index.js';

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

export const ARENA_MODEL_VERSION = 'arena-v2' as const;
export const ARENA_WEIGHTS = Object.freeze({ progress: 0.75, consistency: 0.25 });
export const ARENA_MIN_QUALIFYING_DAYS = 3;
export const ARENA_MIN_OBSERVED_DAYS = 7;
export const ARENA_QUALIFY_CONTENT_SEC = 300;
export const ARENA_QUALIFY_ACTIVITY_SEC = 600;

export interface Competitor {
  id: string;
  name: string;
  initials: string;
  tier: Tier;
  /** synthetic aggregate content covered over the window (bounded by L) */
  uniqueContentSec: number;
  /** context only: entries plausibly completed */
  verifiedCount: number;
  /** simulated focused/active time, context only */
  focusSec: number;
  activeDays: number;
  windowDays: number;
  /** coherent day history; all aggregates derive from it */
  sessions: SimDay[];
  /** informational aggregate throughput, never ranked */
  efficiency: number;
  practiceMin: number;
  /** arena-v2 score (null when the playlist basis is unavailable) */
  arenaScore: number | null;
  /** qualifying days (alias retained for older callers/UI) */
  eligibleDays: number;
  qualifyingDays: number;
  observedDays: number;
  progress: number;
  consistency: number;
  provisional: boolean;
}

/** One simulated challenge day. */
export interface SimDay {
  day: number;
  /** Display convenience in minutes; exact values live in focusSec/contentSec. */
  focusMin: number;
  contentMin: number;
  /** Exact simulated seconds for this day. */
  focusSec: number;
  contentSec: number;
  /** informational content/focus percentage */
  effDay: number;
  practiceMin: number;
  /** calendar identity (YYYY-MM-DD in the display timezone) when anchored */
  dateKey?: string;
  /** Arena v2 evidence: a completed video can substitute for 5 minutes */
  completedVideo?: boolean;
  /** active playback evidence, context only */
  activePlaybackSec?: number;
  /** whether this day meets the v2 qualifying-day rule */
  qualifies?: boolean;
}

export interface FixedChallengeSnapshot {
  seasonId: string;
  modelVersion: string;
  seed: number;
  cohortSize: number;
  tierDist: Record<Tier, number>;
  windowDays: number;
  dailyCapHours: number;
  startedAt: string;
  endsAt: string;
  playlistId: string | null;
  playlistSnapshotVersion: number | null;
  playlistDurationSec: number | null;
  /** Frozen entry count / average duration used only for rival simulation. */
  playlistEntryCount?: number | null;
  playlistAvgVideoSec?: number | null;
  windowDates: string[];
  weights: { progress: number; consistency: number };
}

export interface ChallengeConfig {
  seed: number;
  cohortSize: number; // incl. user, 10..2000
  tierDist: Record<Tier, number>;
  windowDays: number;
  /** max simulated study hours per rival per day (user history never capped) */
  dailyCapHours: number;
  mode?: 'practice' | 'fixed';
  modelVersion?: string;
  fixed?: FixedChallengeSnapshot | null;
}

export const DEFAULT_CHALLENGE: ChallengeConfig = {
  seed: 20261013,
  cohortSize: 100,
  tierDist: { ...DEFAULT_TIER_DIST },
  windowDays: 14,
  dailyCapHours: 6,
  mode: 'practice',
  modelVersion: ARENA_MODEL_VERSION,
  fixed: null,
};

/** Normalize old persisted challenge settings without losing valid values. */
export function normalizeChallenge(raw: unknown): ChallengeConfig {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const candidate: ChallengeConfig = {
    ...DEFAULT_CHALLENGE,
    ...r,
    tierDist: { ...DEFAULT_TIER_DIST, ...(r.tierDist && typeof r.tierDist === 'object' ? r.tierDist as Record<Tier, number> : {}) },
    mode: r.mode === 'fixed' ? 'fixed' : 'practice',
    modelVersion: ARENA_MODEL_VERSION,
    fixed: r.fixed && typeof r.fixed === 'object' ? r.fixed as FixedChallengeSnapshot : null,
  } as ChallengeConfig;
  if (validateChallenge(candidate).length) {
    return { ...DEFAULT_CHALLENGE, tierDist: { ...DEFAULT_TIER_DIST } };
  }
  return candidate;
}

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
 * timezone. DST-safe calendar arithmetic: the current partial day is included.
 */
export function challengeWindowDates(windowDays: number, timeZone: string, nowMs = Date.now()): string[] {
  return calendarWindowDates(windowDays, timeZone, nowMs);
}

/** Human window label, e.g. "Oct 5 – Oct 18, 2026". */
export function windowLabel(dates: string[], timeZone = 'UTC'): string {
  if (dates.length === 0) return '';
  try {
    const zone = supportedZone(timeZone);
    const fmt = (k: string, withYear: boolean) => {
      const d = k.length === 10 ? new Date(zonedNoonMs(k, zone)) : new Date(k);
      return new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        ...(withYear ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' }),
      }).format(d);
    };
    if (dates.length === 1) return fmt(dates[0], true);
    return `${fmt(dates[0], false)} – ${fmt(dates[dates.length - 1], true)}`;
  } catch {
    return dates.length === 1 ? dates[0] : `${dates[0]} – ${dates[dates.length - 1]}`;
  }
}

/**
 * Legacy tier efficiency bands, retained only as simulation-design context for
 * session lengths. Rankings in v2 do not use these percentages.
 */
export const TIER_BANDS: Record<Tier, [number, number]> = {
  Ultra: [1.0, 1.1],
  High: [0.85, 0.999],
  Good: [0.7, 0.849],
  Normal: [0.55, 0.699],
  Average: [0.4, 0.549],
  'Below Average': [0.2, 0.399],
};

export const TIER_DEVIATION: Record<Tier, number> = {
  Ultra: 15,
  High: 10,
  Good: 8,
  Normal: 6,
  Average: 5,
  'Below Average': 4,
};

/** Arena v2 latent profiles (design assumptions, not population statistics). */
export const TIER_PROFILES: Record<Tier, {
  progress: [number, number];
  consistency: [number, number];
  activity: number;
}> = {
  Ultra: { progress: [0.98, 1.0], consistency: [0.85, 0.95], activity: 0.9 },
  High: { progress: [0.9, 0.98], consistency: [0.7, 0.85], activity: 0.8 },
  Good: { progress: [0.75, 0.9], consistency: [0.55, 0.72], activity: 0.65 },
  Normal: { progress: [0.55, 0.75], consistency: [0.4, 0.58], activity: 0.5 },
  Average: { progress: [0.35, 0.55], consistency: [0.25, 0.4], activity: 0.38 },
  'Below Average': { progress: [0.15, 0.35], consistency: [0.15, 0.25], activity: 0.25 },
};

/** Tier study habits, used only for context session lengths. */
export const TIER_HABITS: Record<Tier, { p: number; minMin: number; minMax: number }> = {
  Ultra: { p: 0.92, minMin: 60, minMax: 180 },
  High: { p: 0.8, minMin: 45, minMax: 120 },
  Good: { p: 0.65, minMin: 30, minMax: 90 },
  Normal: { p: 0.5, minMin: 20, minMax: 60 },
  Average: { p: 0.38, minMin: 15, minMax: 45 },
  'Below Average': { p: 0.25, minMin: 10, minMax: 30 },
};

/** Qualifying days needed for a ranked score (fixed product rule). */
export function requiredQualifyingDays(windowDays: number): number {
  return Math.min(ARENA_MIN_QUALIFYING_DAYS, Math.max(1, Math.floor(windowDays)));
}

/** Observed calendar days required for a ranked score. */
export function requiredObservedDays(windowDays: number): number {
  return Math.min(ARENA_MIN_OBSERVED_DAYS, Math.max(1, Math.floor(windowDays)));
}

/** Backwards-compatible alias used by older imports. */
export const requiredEligibleDays = requiredQualifyingDays;

export interface ArenaDayEvidence {
  dateKey?: string;
  contentGainSec: number;
  completedVideo: boolean;
  focusSec: number;
  activePlaybackSec: number;
}

/** The v2 qualifying-day rule, applied identically to the user and rivals. */
export function isQualifyingArenaDay(day: ArenaDayEvidence): boolean {
  const content = Number.isFinite(day.contentGainSec) ? Math.max(0, day.contentGainSec) : 0;
  const activity = Math.max(
    Number.isFinite(day.focusSec) ? day.focusSec : 0,
    Number.isFinite(day.activePlaybackSec) ? day.activePlaybackSec : 0,
  );
  return (content >= ARENA_QUALIFY_CONTENT_SEC || day.completedVideo) && activity >= ARENA_QUALIFY_ACTIVITY_SEC;
}

export function countQualifyingDays(days: ArenaDayEvidence[]): number {
  return days.reduce((n, day) => n + (isQualifyingArenaDay(day) ? 1 : 0), 0);
}

export interface ArenaScoreInput {
  uniqueContentSec: number;
  playlistDurationSec: number | null;
  qualifyingDays: number;
  windowDays: number;
  observedDays?: number;
}

export interface ArenaComponents {
  modelVersion: string;
  available: boolean;
  progress: number | null;
  consistency: number | null;
  score: number | null;
  uniqueContentSec: number;
  playlistDurationSec: number | null;
  qualifyingDays: number;
  windowDays: number;
  observedDays: number;
  provisional: boolean;
  requiredQualifyingDays: number;
  requiredObservedDays: number;
  progressWeight: number;
  consistencyWeight: number;
}

/** Bounded v2 score from ratios in [0,1]. */
export function arenaScore(progress: number | null, consistency: number | null): number | null {
  if (progress === null || consistency === null) return null;
  if (!Number.isFinite(progress) || !Number.isFinite(consistency)) return null;
  const p = Math.min(1, Math.max(0, progress));
  const c = Math.min(1, Math.max(0, consistency));
  return 100 * (ARENA_WEIGHTS.progress * p + ARENA_WEIGHTS.consistency * c);
}

export function arenaComponents(input: ArenaScoreInput): ArenaComponents {
  const windowDays = Number.isFinite(input.windowDays) ? Math.max(0, Math.floor(input.windowDays)) : 0;
  const observedDays = Number.isFinite(input.observedDays)
    ? Math.min(windowDays, Math.max(0, Math.floor(input.observedDays as number)))
    : windowDays;
  const qualifyingDays = Number.isFinite(input.qualifyingDays)
    ? Math.max(0, Math.min(windowDays, Math.floor(input.qualifyingDays)))
    : 0;
  const L = input.playlistDurationSec;
  const available = typeof L === 'number' && Number.isFinite(L) && L > 0;
  const U = Number.isFinite(input.uniqueContentSec) ? Math.max(0, input.uniqueContentSec) : 0;
  const progress = available ? Math.min(1, U / (L as number)) : null;
  const consistency = windowDays > 0 ? Math.min(1, qualifyingDays / windowDays) : null;
  const score = arenaScore(progress, consistency);
  const requiredQ = requiredQualifyingDays(windowDays);
  const requiredO = requiredObservedDays(windowDays);
  return {
    modelVersion: ARENA_MODEL_VERSION,
    available,
    progress,
    consistency,
    score,
    uniqueContentSec: available ? Math.min(U, L as number) : U,
    playlistDurationSec: available ? L as number : null,
    qualifyingDays,
    windowDays,
    observedDays,
    provisional: score !== null && (qualifyingDays < requiredQ || observedDays < requiredO),
    requiredQualifyingDays: requiredQ,
    requiredObservedDays: requiredO,
    progressWeight: ARENA_WEIGHTS.progress,
    consistencyWeight: ARENA_WEIGHTS.consistency,
  };
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
  if (!Number.isInteger(cfg.windowDays) || cfg.windowDays < 1 || cfg.windowDays > 90) {
    errs.push('Competition window must be an integer from 1 to 90 days.');
  }
  if (cfg.mode !== undefined && cfg.mode !== 'practice' && cfg.mode !== 'fixed') errs.push('Arena mode is invalid.');
  if (cfg.fixed !== undefined && cfg.fixed !== null) {
    if (typeof cfg.fixed !== 'object' || typeof cfg.fixed.seasonId !== 'string' || !Array.isArray(cfg.fixed.windowDates)) {
      errs.push('Fixed challenge snapshot is invalid.');
    }
  }
  return errs;
}

/**
 * Create a fixed challenge snapshot. Configuration, model version, weights and
 * the cohort seed are captured once; later practice edits cannot alter the run.
 */
export function createFixedChallenge(
  cfg: ChallengeConfig,
  input: {
    playlistId: string | null;
    playlistSnapshotVersion: number | null;
    playlistDurationSec: number | null;
    playlistEntryCount?: number | null;
    playlistAvgVideoSec?: number | null;
    windowDates: string[];
    now?: Date;
  },
): ChallengeConfig {
  const now = input.now ?? new Date();
  const dates = input.windowDates.length === cfg.windowDays
    ? [...input.windowDates]
    : challengeWindowDates(cfg.windowDays, 'UTC', now.getTime());
  return normalizeChallenge({
    ...cfg,
    mode: 'fixed',
    modelVersion: ARENA_MODEL_VERSION,
    fixed: {
      seasonId: `arena-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      modelVersion: ARENA_MODEL_VERSION,
      seed: cfg.seed,
      cohortSize: cfg.cohortSize,
      tierDist: { ...cfg.tierDist },
      windowDays: cfg.windowDays,
      dailyCapHours: cfg.dailyCapHours,
      startedAt: now.toISOString(),
      endsAt: new Date(now.getTime() + cfg.windowDays * 86400_000).toISOString(),
      playlistId: input.playlistId,
      playlistSnapshotVersion: input.playlistSnapshotVersion,
      playlistDurationSec: input.playlistDurationSec,
      playlistEntryCount: input.playlistEntryCount ?? null,
      playlistAvgVideoSec: input.playlistAvgVideoSec ?? null,
      windowDates: dates,
      weights: { ...ARENA_WEIGHTS },
    },
  });
}

/** Deterministic scalar in [0,1) per (seed, rival, date, field). */
function draw(seed: number, rival: number, dateKey: string, field: string): number {
  return mulberry32(hashStringToUint32(`${seed}:${ARENA_MODEL_VERSION}:${rival}:${dateKey}:${field}`))();
}

function pickBetween(lo: number, hi: number, roll: number): number {
  return lo + (hi - lo) * Math.min(0.999999, Math.max(0, roll));
}

function pickTier(dist: Record<Tier, number>, roll: number): Tier {
  let acc = 0;
  const r = roll * 100;
  for (const t of TIERS) {
    acc += dist[t] ?? 0;
    if (r < acc) return t;
  }
  return 'Normal';
}

/**
 * Generate deterministic synthetic competitors with comparable learning
 * trajectories. Each rival receives a target progress/consistency profile,
 * selects qualifying dates deterministically, allocates monotonic content, and
 * is then scored by exactly the same v2 functions as the user.
 */
export function generateCompetitors(
  cfg: ChallengeConfig,
  playlist: { totalSec: number | null; n: number; avgVideoSec: number },
  opts?: { anchorDates?: string[] },
): Competitor[] {
  const total = playlist.totalSec;
  // Arena is unavailable when any duration is unresolved. Never substitute an
  // average estimate for the denominator.
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return [];

  const nameRnd = mulberry32((cfg.seed ^ 0x9e3779b9) >>> 0);
  const used = new Set<string>();
  const names: { id: string; name: string; initials: string }[] = [];
  for (let i = 0; i < cfg.cohortSize - 1; i++) {
    const name = generateAlias(nameRnd, used);
    names.push({ id: `sim-${cfg.seed}-${i}`, name, initials: initialsOf(name) });
  }
  const anchored = opts?.anchorDates && opts.anchorDates.length === cfg.windowDays ? opts.anchorDates : null;
  const windowDates = anchored ?? Array.from({ length: cfg.windowDays }, (_, d) => `day:${d}`);
  const capMin = Math.max(30, Math.min(720, Math.round(cfg.dailyCapHours * 60)));
  const requiredQ = requiredQualifyingDays(cfg.windowDays);

  const out: Competitor[] = [];
  for (let i = 0; i < cfg.cohortSize - 1; i++) {
    const tier = pickTier(cfg.tierDist, draw(cfg.seed, i, 'season', 'tier'));
    const profile = TIER_PROFILES[tier];
    const targetProgress = pickBetween(profile.progress[0], profile.progress[1], draw(cfg.seed, i, 'season', 'progress'));
    const targetConsistency = pickBetween(profile.consistency[0], profile.consistency[1], draw(cfg.seed, i, 'season', 'consistency'));
    const targetContent = targetProgress * total;
    let targetDays = Math.min(cfg.windowDays, Math.round(targetConsistency * cfg.windowDays));
    targetDays = Math.min(targetDays, Math.floor(targetContent / ARENA_QUALIFY_CONTENT_SEC));
    targetDays = Math.max(0, targetDays);

    // Date selection: deterministic activity + weekday/rest pattern. Selecting
    // the highest scores yields the target count and allows the window to slide
    // while keeping identities stable.
    const ranked = windowDates.map((dateKey, d) => {
      let score = draw(cfg.seed, i, dateKey, 'active');
      const weekday = anchored ? new Date(`${dateKey}T12:00:00Z`).getUTCDay() : d % 7;
      if (weekday === 0 || weekday === 6) score *= 0.72;
      else if (weekday === 1) score *= 0.92;
      if (draw(cfg.seed, i, dateKey, 'rest') < 0.08) score *= 0.25;
      return { dateKey, d, score };
    }).sort((a, b) => b.score - a.score || a.d - b.d);
    const selected = ranked.slice(0, targetDays).sort((a, b) => a.d - b.d);

    const sessions: SimDay[] = [];
    let uniqueSec = 0;
    let focusSec = 0;
    let practiceMin = 0;
    let verifiedCount = 0;
    if (selected.length > 0) {
      const base = ARENA_QUALIFY_CONTENT_SEC;
      const remaining = Math.max(0, targetContent - selected.length * base);
      const weights = selected.map((x) => 0.6 + draw(cfg.seed, i, x.dateKey, 'weight'));
      const weightSum = weights.reduce((a, b) => a + b, 0);
      for (let s = 0; s < selected.length; s++) {
        const x = selected[s];
        const gainSec = Math.min(total - uniqueSec, base + (remaining * weights[s]) / Math.max(1, weightSum));
        if (gainSec <= 0) break;
        const [lo, hi] = TIER_BANDS[tier];
        const efficiency = pickBetween(lo, hi, draw(cfg.seed, i, x.dateKey, 'efficiency'));
        let focus = Math.max(ARENA_QUALIFY_ACTIVITY_SEC, gainSec / Math.max(0.2, efficiency));
        focus = Math.min(capMin * 60, focus);
        if (focus < ARENA_QUALIFY_ACTIVITY_SEC) break;
        // Content gain cannot exceed what the bounded study time could observe at
        // this rival's throughput. Prevents impossible 19h/day trajectories.
        const actualGain = Math.min(gainSec, focus * Math.max(0.2, efficiency));
        const completedVideo = actualGain >= Math.max(playlist.avgVideoSec, ARENA_QUALIFY_CONTENT_SEC)
          && draw(cfg.seed, i, x.dateKey, 'completed') < 0.35;
        if (actualGain < ARENA_QUALIFY_CONTENT_SEC && !completedVideo) break;
        const contentGainSec = Math.round(actualGain);
        const focusRounded = Math.round(focus);
        const qualifies = isQualifyingArenaDay({
          contentGainSec,
          completedVideo,
          focusSec: focusRounded,
          activePlaybackSec: 0,
        });
        sessions.push({
          day: x.d,
          focusMin: Math.round(focusRounded / 60),
          contentMin: Math.round((contentGainSec / 60) * 10) / 10,
          focusSec: focusRounded,
          contentSec: contentGainSec,
          effDay: Math.round((contentGainSec / Math.max(1, focusRounded)) * 1000) / 10,
          practiceMin: Math.round((focusRounded / 60) * (0.05 + draw(cfg.seed, i, x.dateKey, 'practice') * 0.1)),
          dateKey: anchored ? x.dateKey : undefined,
          completedVideo,
          activePlaybackSec: Math.round(gainSec),
          qualifies,
        });
        uniqueSec += contentGainSec;
        focusSec += focusRounded;
        practiceMin += sessions[sessions.length - 1].practiceMin;
        if (completedVideo) verifiedCount += 1;
      }
    }
    uniqueSec = Math.min(Math.round(uniqueSec), total);
    const qualifyingDays = sessions.reduce((n, s) => n + (s.qualifies ? 1 : 0), 0);
    const components = arenaComponents({
      uniqueContentSec: uniqueSec,
      playlistDurationSec: total,
      qualifyingDays,
      windowDays: cfg.windowDays,
      observedDays: cfg.windowDays,
    });
    out.push({
      id: names[i].id,
      name: names[i].name,
      initials: names[i].initials,
      tier,
      uniqueContentSec: uniqueSec,
      verifiedCount: Math.min(playlist.n, verifiedCount),
      focusSec,
      activeDays: sessions.length,
      windowDays: cfg.windowDays,
      sessions,
      efficiency: focusSec > 0 ? (uniqueSec / focusSec) * 100 : 0,
      practiceMin,
      arenaScore: components.score,
      eligibleDays: qualifyingDays,
      qualifyingDays,
      observedDays: cfg.windowDays,
      progress: components.progress ?? 0,
      consistency: components.consistency ?? 0,
      provisional: components.provisional || qualifyingDays < requiredQ,
    });
  }
  return out;
}

export interface RankedRow {
  id: string;
  name: string;
  isUser: boolean;
  tier: Tier | 'You';
  /** arena-v2 score, or null when unmeasurable/provisional */
  value: number | null;
  display: string;
  provisional: boolean;
  /** Competition rank ("1224") among scored rows; null while provisional. */
  rank: number | null;
  eligibleDays: number;
  qualifyingDays: number;
  observedDays: number;
  windowDays: number;
  progress: number | null;
  consistency: number | null;
}

export interface UserArenaInput {
  uniqueContentSec: number;
  playlistDurationSec: number | null;
  qualifyingDays: number;
  observedDays: number;
  /** context only */
  focusSec?: number;
  verifiedCount?: number;
  activeDays?: number;
}

export interface ArenaBoard {
  rows: RankedRow[];
  userRank: number | null;
  percentile: number | null;
  ahead: number;
  required: number;
  requiredObserved: number;
  userScore: number | null;
  userEligible: number;
  userQualifyingDays: number;
  userObservedDays: number;
  components: ArenaComponents;
}

function rowFromCompetitor(c: Competitor): RankedRow {
  const provisional = c.provisional || c.arenaScore === null;
  return {
    id: c.id,
    name: c.name,
    isUser: false,
    tier: c.tier,
    value: provisional ? null : c.arenaScore,
    display: provisional || c.arenaScore === null ? 'Calibrating' : `${c.arenaScore.toFixed(1)}%`,
    provisional,
    rank: null,
    eligibleDays: c.qualifyingDays,
    qualifyingDays: c.qualifyingDays,
    observedDays: c.observedDays,
    windowDays: c.windowDays,
    progress: c.progress,
    consistency: c.consistency,
  };
}

export function rankBoard(
  cfg: ChallengeConfig,
  competitors: Competitor[],
  user: UserArenaInput,
): ArenaBoard {
  const components = arenaComponents({
    uniqueContentSec: user.uniqueContentSec,
    playlistDurationSec: user.playlistDurationSec,
    qualifyingDays: user.qualifyingDays,
    windowDays: cfg.windowDays,
    observedDays: user.observedDays,
  });
  const userRanked = components.score !== null && !components.provisional;
  const rows: RankedRow[] = [
    ...competitors.map(rowFromCompetitor),
    {
      id: 'user',
      name: 'You',
      isUser: true,
      tier: 'You' as const,
      value: userRanked ? components.score : null,
      display: components.score === null
        ? 'Unavailable'
        : !userRanked
          ? `${components.score.toFixed(1)}% · calibrating`
          : `${components.score.toFixed(1)}%`,
      provisional: !userRanked,
      rank: null,
      eligibleDays: components.qualifyingDays,
      qualifyingDays: components.qualifyingDays,
      observedDays: components.observedDays,
      windowDays: cfg.windowDays,
      progress: components.progress,
      consistency: components.consistency,
    },
  ];
  // Scored rows first: score desc, then progress, consistency, stable id.
  // Equal scores share a competition rank (1, 2, 2, 4).
  const scored = rows
    .filter((r) => r.value !== null)
    .sort((a, b) => (b.value as number) - (a.value as number)
      || (b.progress ?? 0) - (a.progress ?? 0)
      || (b.consistency ?? 0) - (a.consistency ?? 0)
      || (a.id < b.id ? -1 : 1));
  const provisional = rows.filter((r) => r.value === null).sort((a, b) => (a.id < b.id ? -1 : 1));
  const ordered = [...scored, ...provisional];
  rows.length = 0;
  rows.push(...ordered);
  for (const r of scored) {
    r.rank = 1 + scored.filter((o) => (o.value as number) > (r.value as number)).length;
  }
  const me = rows.find((r) => r.isUser)!;
  const userRank = me.rank;
  const ahead = me.value !== null
    ? scored.filter((o) => !o.isUser && (o.value as number) > (me.value as number)).length
    : 0;
  const scoredRivals = scored.filter((o) => !o.isUser);
  const percentile = me.value === null || scoredRivals.length === 0
    ? null
    : (scoredRivals.filter((o) => (o.value as number) < (me.value as number)).length / scoredRivals.length) * 100;
  return {
    rows,
    userRank,
    percentile,
    ahead,
    required: components.requiredQualifyingDays,
    requiredObserved: components.requiredObservedDays,
    userScore: components.score,
    userEligible: components.qualifyingDays,
    userQualifyingDays: components.qualifyingDays,
    userObservedDays: components.observedDays,
    components,
  };
}

/** Gap to the next rank UP in percentage points. Null when leading/provisional. */
export function gapToNext(userValue: number | null, rowAboveValue: number | null): string | null {
  if (userValue === null || rowAboveValue === null || !(rowAboveValue > userValue)) return null;
  return `${(rowAboveValue - userValue).toFixed(1)} percentage points`;
}

export interface ArenaUserEvidence {
  playlistDurationSec: number | null;
  uniqueContentSec: number;
  focusSec: number;
  verifiedCompleted: number;
  manualCompleted: number;
  daily: ArenaDayEvidence[];
  qualifyingDays: number;
}

/**
 * Derive the user's v2 inputs from the same stable occurrence identities and
 * interval unions used by Progress and Efficiency. Completed entries credit
 * their full duration (manual completion is still counted but reported
 * separately); otherwise only verified timeline coverage is credited, capped
 * per entry. Daily content gain is cumulative-new coverage, so rewatches never
 * create new qualifying content.
 */
export function computeArenaUserEvidence(input: {
  snapshot: PlaylistSnapshot;
  progress: Record<string, ProgressRecord>;
  segments: PlaybackSegment[];
  sessions: StudySession[];
  timeZone: string;
  windowDates: string[];
}): ArenaUserEvidence {
  const { snapshot, progress, segments, sessions, timeZone, windowDates } = input;
  const pid = snapshot.playlistId;
  const entryKeyOf = (entry: PlaylistSnapshot['entries'][number]) =>
    `${pid}::${entry.entryId ?? `${entry.position}:${entry.videoId}`}`;
  const byEntry = new Map<string, PlaybackSegment[]>();
  for (const seg of segments) {
    if (seg.playlistId !== pid || seg.source !== 'verified') continue;
    const key = `${seg.playlistId}::${seg.entryId ?? `${seg.position}:${seg.videoId}`}`;
    const arr = byEntry.get(key) ?? [];
    arr.push(seg);
    byEntry.set(key, arr);
  }
  const byDaySegments = attributePlaybackByDay(segments.filter((x) => x.playlistId === pid && x.source === 'verified'), timeZone);
  const focusByDay = attributeFocusByDay(sessions.filter((x) => x.playlistId === pid), timeZone);
  const progressIndex = buildEntryProgressIndex(snapshot, progress);
  const completedByDay = new Map<string, number>();
  const dailyGain = new Map<string, number>();
  let playlistDurationSec = 0;
  let unique = 0;
  let verifiedCompleted = 0;
  let manualCompleted = 0;

  for (const entry of snapshot.entries) {
    const duration = entry.durationSec;
    if (duration === null || !Number.isFinite(duration)) {
      playlistDurationSec = NaN;
      continue;
    }
    if (playlistDurationSec === playlistDurationSec) playlistDurationSec += duration;
    const rec = progressIndex.get(entry.position);
    const complete = Boolean(rec && !rec.orphaned && rec.completedAt && rec.status === 'done');
    if (complete) {
      const day = calendarWindowDates(1, timeZone, Date.parse(rec!.completedAt!))[0];
      if (day) completedByDay.set(day, (completedByDay.get(day) ?? 0) + 1);
    }
    if (isProgressComplete(rec)) {
      unique += duration;
      if (rec?.source === 'verified') verifiedCompleted += 1;
      else manualCompleted += 1;
    }
    const entrySegments = byEntry.get(entryKeyOf(entry)) ?? [];
    if (entrySegments.length === 0) continue;
    // Cumulative-new verified coverage by calendar day.
    const slices = entrySegments.flatMap((seg) => splitPlaybackSegmentByDay(seg, timeZone).map((slice) => ({
      dateKey: slice.dateKey,
      start: slice.segment.timelineStartSec,
      end: slice.segment.timelineEndSec,
    })));
    const byDate = new Map<string, [number, number][]>();
    for (const slice of slices) {
      const arr = byDate.get(slice.dateKey) ?? [];
      arr.push([slice.start, slice.end]);
      byDate.set(slice.dateKey, arr);
    }
    let seen: [number, number][] = [];
    let seenMs = 0;
    for (const key of [...byDate.keys()].sort()) {
      seen = mergeIntervals([...seen, ...(byDate.get(key) ?? [])]);
      const union = seen.reduce((sum, [a, b]) => sum + Math.max(0, b - a), 0);
      const gain = Math.max(0, union - seenMs);
      seenMs = union;
      if (!complete && gain > 0) dailyGain.set(key, (dailyGain.get(key) ?? 0) + gain);
    }
    if (!complete) unique += Math.min(duration, seenMs);
  }
  const focusSec = sessions
    .filter((x) => x.playlistId === pid)
    .reduce((sum, x) => sum + Math.max(0, x.activeSec), 0);
  if (!Number.isFinite(playlistDurationSec) || playlistDurationSec <= 0) playlistDurationSec = NaN;
  const playlistL = Number.isFinite(playlistDurationSec) ? playlistDurationSec : null;
  const daily = windowDates.map((dateKey) => {
    const daySegments = byDaySegments.get(dateKey) ?? [];
    const activePlaybackSec = daySegments.reduce((sum, s) => sum + Math.max(0, Math.round((s.wallEndMs - s.wallStartMs) / 1000)), 0);
    return {
      dateKey,
      contentGainSec: Math.round(dailyGain.get(dateKey) ?? 0),
      completedVideo: (completedByDay.get(dateKey) ?? 0) > 0,
      focusSec: focusByDay.get(dateKey) ?? 0,
      activePlaybackSec,
    };
  });
  return {
    playlistDurationSec: playlistL,
    uniqueContentSec: Math.round(playlistL !== null ? Math.min(unique, playlistL) : unique),
    focusSec,
    verifiedCompleted,
    manualCompleted,
    daily,
    qualifyingDays: countQualifyingDays(daily),
  };
}
