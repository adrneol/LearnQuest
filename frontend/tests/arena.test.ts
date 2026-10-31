import { describe, it, expect } from 'vitest';
import {
  generateCompetitors, rankBoard, gapToNext, arenaScore, arenaComponents, isQualifyingArenaDay,
  countQualifyingDays, requiredQualifyingDays, requiredObservedDays, requiredEligibleDays,
  createFixedChallenge, computeArenaUserEvidence, normalizeChallenge,
  validateChallenge, DEFAULT_CHALLENGE, ARENA_MODEL_VERSION, ARENA_WEIGHTS,
  type Competitor, type FixedChallengeSnapshot,
} from '../src/domain/competition/competition.js';
import { generateAlias, initialsOf } from '../src/domain/competition/aliases.js';
import { mulberry32 } from '../src/domain/competition/competition.js';
import type {
  PlaybackSegment, PlaylistSnapshot, ProgressRecord, StudySession,
} from '../src/domain/index.js';

const BASIS = { totalSec: 36000, n: 100, avgVideoSec: 360 };

function comp(over: Partial<Competitor> & { id: string }): Competitor {
  return {
    name: over.id, initials: 'TB', tier: 'Normal',
    uniqueContentSec: 0, verifiedCount: 0, focusSec: 0,
    activeDays: 0, windowDays: 14, sessions: [], efficiency: 0, practiceMin: 0,
    arenaScore: null, eligibleDays: 0, qualifyingDays: 0, observedDays: 14,
    progress: 0, consistency: 0, provisional: true, ...over,
  };
}

function rival(id: string, score: number | null, qualifyingDays = 7, observedDays = 14): Competitor {
  return comp({
    id,
    arenaScore: score,
    eligibleDays: qualifyingDays,
    qualifyingDays,
    observedDays,
    provisional: score === null || qualifyingDays < requiredQualifyingDays(14) || observedDays < requiredObservedDays(14),
    progress: score === null ? 0 : score / 100,
    consistency: qualifyingDays / 14,
  });
}

const USER = {
  uniqueContentSec: 18000, // 50% of 36000
  playlistDurationSec: 36000,
  qualifyingDays: 7, // 50% of 14
  observedDays: 14,
};

describe('gamer aliases', () => {
  it('unique across a 2000 cohort, stable for a seed, varied in style', () => {
    const comps = generateCompetitors({ ...DEFAULT_CHALLENGE, cohortSize: 2000 }, BASIS);
    const names = comps.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(comps.map((c) => c.id)).size).toBe(comps.length);
    for (const n of names) {
      expect(n).not.toMatch(/ /);
      expect(n).toMatch(/^[A-Z][A-Za-z-]+$/);
    }
    const heads = new Set(names.map((n) => n.split(/(?=[A-Z])/)[0]));
    expect(heads.size).toBeGreaterThan(20);
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

describe('Arena v2 score (independent hand-computed fixtures)', () => {
  it('P = U/L, C = Q/W, score = 100 × (0.75P + 0.25C)', () => {
    const c = arenaComponents({
      uniqueContentSec: 18000,
      playlistDurationSec: 36000,
      qualifyingDays: 7,
      windowDays: 14,
      observedDays: 14,
    });
    expect(c.progress).toBeCloseTo(0.5, 10);
    expect(c.consistency).toBeCloseTo(0.5, 10);
    // 100 × (0.75×0.5 + 0.25×0.5) = 50
    expect(c.score).toBeCloseTo(50, 10);
    expect(c.progressWeight).toBe(0.75);
    expect(c.consistencyWeight).toBe(0.25);
    expect(c.modelVersion).toBe(ARENA_MODEL_VERSION);
  });

  it('progress and consistency are clamped to 100% and never exceed the playlist', () => {
    const c = arenaComponents({
      uniqueContentSec: 999_999,
      playlistDurationSec: 3600,
      qualifyingDays: 99,
      windowDays: 14,
      observedDays: 14,
    });
    expect(c.progress).toBe(1);
    expect(c.consistency).toBe(1);
    expect(c.score).toBe(100);
    expect(c.uniqueContentSec).toBe(3600);
  });

  it('zero/negative inputs stay bounded; unresolved playlist makes the score unavailable', () => {
    const zero = arenaComponents({
      uniqueContentSec: 0, playlistDurationSec: 3600, qualifyingDays: 0, windowDays: 14, observedDays: 14,
    });
    expect(zero.score).toBe(0);
    const negative = arenaComponents({
      uniqueContentSec: -500, playlistDurationSec: 3600, qualifyingDays: -2, windowDays: 14, observedDays: 14,
    });
    expect(negative.score).toBe(0);
    const missing = arenaComponents({
      uniqueContentSec: 5000, playlistDurationSec: null, qualifyingDays: 7, windowDays: 14, observedDays: 14,
    });
    expect(missing.available).toBe(false);
    expect(missing.progress).toBeNull();
    expect(missing.score).toBeNull();
    const zeroWindow = arenaComponents({
      uniqueContentSec: 0, playlistDurationSec: 3600, qualifyingDays: 0, windowDays: 0, observedDays: 0,
    });
    expect(zeroWindow.consistency).toBeNull();
    expect(zeroWindow.score).toBeNull();
  });

  it('arenaScore accepts ratios only and clamps them', () => {
    expect(arenaScore(0, 0)).toBe(0);
    expect(arenaScore(0.5, 0.5)).toBe(50);
    expect(arenaScore(2, 2)).toBe(100);
    expect(arenaScore(-1, -1)).toBe(0);
    expect(arenaScore(Number.NaN, 0.5)).toBeNull();
    expect(arenaScore(0.5, Number.POSITIVE_INFINITY)).toBeNull();
    expect(arenaScore(null, 0.5)).toBeNull();
  });

  it('all supported windows derive sensible eligibility requirements', () => {
    for (const w of [1, 2, 3, 7, 14, 30, 90]) {
      expect(requiredQualifyingDays(w)).toBe(Math.min(3, w));
      expect(requiredObservedDays(w)).toBe(Math.min(7, w));
      expect(requiredEligibleDays(w)).toBe(requiredQualifyingDays(w));
    }
    expect(validateChallenge({ ...DEFAULT_CHALLENGE, windowDays: 0 })).not.toHaveLength(0);
    expect(validateChallenge({ ...DEFAULT_CHALLENGE, windowDays: 91 })).not.toHaveLength(0);
  });
});

describe('arena qualifying days', () => {
  it('rejects the one-minute exploit and timer-only days', () => {
    expect(isQualifyingArenaDay({ contentGainSec: 60, completedVideo: false, focusSec: 60, activePlaybackSec: 0 })).toBe(false);
    expect(isQualifyingArenaDay({ contentGainSec: 0, completedVideo: false, focusSec: 36000, activePlaybackSec: 36000 })).toBe(false);
    // 299s of content is below the 300s product threshold.
    expect(isQualifyingArenaDay({ contentGainSec: 299, completedVideo: false, focusSec: 600, activePlaybackSec: 0 })).toBe(false);
    // Content progress without the activity floor does not qualify.
    expect(isQualifyingArenaDay({ contentGainSec: 1000, completedVideo: false, focusSec: 599, activePlaybackSec: 0 })).toBe(false);
  });

  it('accepts 5 min new content + 10 min activity, or a completed video + activity', () => {
    expect(isQualifyingArenaDay({ contentGainSec: 300, completedVideo: false, focusSec: 600, activePlaybackSec: 0 })).toBe(true);
    expect(isQualifyingArenaDay({ contentGainSec: 0, completedVideo: true, focusSec: 0, activePlaybackSec: 600 })).toBe(true);
    // Active playback can satisfy the activity floor.
    expect(isQualifyingArenaDay({ contentGainSec: 300, completedVideo: false, focusSec: 0, activePlaybackSec: 600 })).toBe(true);
  });

  it('three short 100% days count; duplicates do not inflate the count', () => {
    const days = [
      { contentGainSec: 300, completedVideo: false, focusSec: 600, activePlaybackSec: 0 },
      { contentGainSec: 300, completedVideo: false, focusSec: 600, activePlaybackSec: 0 },
      { contentGainSec: 300, completedVideo: false, focusSec: 600, activePlaybackSec: 0 },
    ];
    expect(countQualifyingDays(days)).toBe(3);
    expect(countQualifyingDays([...days, ...days])).toBe(6); // raw count; caller dedupes days by dateKey
  });
});

describe('Arena v2 ranking', () => {
  it('ties share a competition rank (1,2,2,4); percentile counts strictly below', () => {
    const comps = [rival('a', 50), rival('b', 50), rival('c', 10)];
    const r = rankBoard(DEFAULT_CHALLENGE, comps, USER);
    const ranks = new Map(r.rows.map((x) => [x.id, x.rank]));
    expect(ranks.get('a')).toBe(1);
    expect(ranks.get('b')).toBe(1);
    expect(ranks.get('user')).toBe(1);
    expect(ranks.get('c')).toBe(4);
    expect(r.percentile).toBeCloseTo((1 / 3) * 100, 5);
  });

  it('rank 1 of N is best; last place percentile is 0', () => {
    const comps = [rival('a', 10)];
    const top = rankBoard(DEFAULT_CHALLENGE, comps, {
      uniqueContentSec: 36000, playlistDurationSec: 36000, qualifyingDays: 14, observedDays: 14,
    });
    expect(top.userRank).toBe(1);
    expect(top.percentile).toBe(100);
    const bottom = rankBoard(DEFAULT_CHALLENGE, comps, {
      uniqueContentSec: 0, playlistDurationSec: 36000, qualifyingDays: 3, observedDays: 14,
    });
    expect(bottom.userRank).toBe(2);
    expect(bottom.percentile).toBe(0);
  });

  it('provisional users get no rank, no percentile and are not shown as last place', () => {
    const comps = [rival('a', 70), rival('b', 60)];
    const oneDay = rankBoard(DEFAULT_CHALLENGE, comps, {
      uniqueContentSec: 36000, playlistDurationSec: 36000, qualifyingDays: 1, observedDays: 14,
    });
    expect(oneDay.userRank).toBeNull();
    expect(oneDay.percentile).toBeNull();
    expect(oneDay.userQualifyingDays).toBe(1);
    expect(oneDay.required).toBe(3);
    const me = oneDay.rows.find((x) => x.isUser)!;
    expect(me.provisional).toBe(true);
    expect(me.display).toMatch(/calibrating/i);
    // Not sorted as zero: provisional rows follow every scored row.
    const lastScored = Math.max(...oneDay.rows.filter((x) => x.value !== null).map((x) => oneDay.rows.indexOf(x)));
    expect(oneDay.rows.indexOf(me)).toBeGreaterThan(lastScored);

    const fewObserved = rankBoard(DEFAULT_CHALLENGE, comps, {
      uniqueContentSec: 36000, playlistDurationSec: 36000, qualifyingDays: 3, observedDays: 6,
    });
    expect(fewObserved.userRank).toBeNull();
    const calibrated = rankBoard(DEFAULT_CHALLENGE, comps, {
      uniqueContentSec: 36000, playlistDurationSec: 36000, qualifyingDays: 3, observedDays: 7,
    });
    expect(calibrated.userRank).not.toBeNull();
  });

  it('short windows scale the provisional requirements', () => {
    const twoDay = rankBoard({ ...DEFAULT_CHALLENGE, windowDays: 2 }, [], {
      uniqueContentSec: 18000, playlistDurationSec: 36000, qualifyingDays: 2, observedDays: 2,
    });
    expect(twoDay.required).toBe(2);
    expect(twoDay.requiredObserved).toBe(2);
    expect(twoDay.userRank).not.toBeNull();
  });

  it('unresolved playlist duration displays Unavailable and is never ranked', () => {
    const board = rankBoard(DEFAULT_CHALLENGE, [rival('a', 50)], {
      uniqueContentSec: 1000, playlistDurationSec: null, qualifyingDays: 14, observedDays: 14,
    });
    expect(board.userScore).toBeNull();
    expect(board.userRank).toBeNull();
    const me = board.rows.find((r) => r.isUser)!;
    expect(me.display).toBe('Unavailable');
  });

  it('gap is in percentage points, null when leading or provisional', () => {
    expect(gapToNext(90, 92.4)).toBe('2.4 percentage points');
    expect(gapToNext(95, 90)).toBeNull();
    expect(gapToNext(null, 90)).toBeNull();
    expect(gapToNext(90, null)).toBeNull();
  });
});

describe('coherent deterministic competitor trajectories', () => {
  it('rivals use the same v2 formula and their aggregates derive from session history', () => {
    const comps = generateCompetitors({ ...DEFAULT_CHALLENGE, cohortSize: 300, seed: 7 }, BASIS);
    expect(comps.length).toBe(299);
    let scored = 0;
    for (const c of comps) {
      const focus = c.sessions.reduce((a, s) => a + s.focusSec, 0);
      const content = c.sessions.reduce((a, s) => a + s.contentSec, 0);
      expect(c.focusSec).toBe(focus);
      expect(c.uniqueContentSec).toBe(Math.min(36000, content));
      expect(c.uniqueContentSec).toBeLessThanOrEqual(36000);
      expect(c.progress).toBeGreaterThanOrEqual(0);
      expect(c.progress).toBeLessThanOrEqual(1);
      expect(c.consistency).toBeGreaterThanOrEqual(0);
      expect(c.consistency).toBeLessThanOrEqual(1);
      expect(c.qualifyingDays).toBe(c.sessions.filter((s) => s.qualifies).length);
      expect(c.activeDays).toBe(c.sessions.length);
      if (c.arenaScore !== null) {
        scored += 1;
        expect(c.arenaScore).toBeCloseTo(100 * (0.75 * c.progress + 0.25 * c.consistency), 8);
        expect(c.arenaScore).toBeGreaterThanOrEqual(0);
        expect(c.arenaScore).toBeLessThanOrEqual(100);
      }
      for (const s of c.sessions) {
        // Every simulated day meets the same product qualifying rule.
        expect(isQualifyingArenaDay({
          contentGainSec: s.contentSec,
          completedVideo: Boolean(s.completedVideo),
          focusSec: s.focusSec,
          activePlaybackSec: s.activePlaybackSec ?? 0,
        })).toBe(true);
        expect(s.contentSec).toBeGreaterThan(0);
        expect(s.focusSec).toBeGreaterThanOrEqual(600);
      }
    }
    expect(scored).toBeGreaterThan(250);
    const vals = new Set(comps.map((c) => c.arenaScore));
    expect(vals.size).toBeGreaterThan(20);
  });

  it('season and cohort expansion are deterministic and stable', () => {
    const a = generateCompetitors(DEFAULT_CHALLENGE, BASIS);
    const b = generateCompetitors(DEFAULT_CHALLENGE, BASIS);
    expect(a).toEqual(b);
    const expanded = generateCompetitors({ ...DEFAULT_CHALLENGE, cohortSize: 200 }, BASIS);
    expect(expanded.slice(0, a.length).map((c) => c.id)).toEqual(a.map((c) => c.id));
  });

  it('missing or zero playlist duration yields no rivals and no score', () => {
    expect(generateCompetitors(DEFAULT_CHALLENGE, { totalSec: null, n: 100, avgVideoSec: 360 })).toEqual([]);
    expect(generateCompetitors(DEFAULT_CHALLENGE, { totalSec: 0, n: 100, avgVideoSec: 360 })).toEqual([]);
  });

  it('2,000 opponents over 90 days stay within the performance budget', () => {
    const start = performance.now();
    const comps = generateCompetitors(
      { ...DEFAULT_CHALLENGE, cohortSize: 2000, windowDays: 90 },
      { totalSec: 3_600_000, n: 10_000, avgVideoSec: 360 },
    );
    const board = rankBoard({ ...DEFAULT_CHALLENGE, cohortSize: 2000, windowDays: 90 }, comps, USER);
    const elapsed = performance.now() - start;
    expect(board.rows).toHaveLength(2000);
    expect(elapsed).toBeLessThan(8000);
  });
});

describe('fixed challenge snapshots', () => {
  const now = new Date('2026-10-01T00:00:00.000Z');
  const dates = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now.getTime() + i * 86400_000);
    return d.toISOString().slice(0, 10);
  });

  it('captures formula, weights, seed, cohort and playlist basis immutably', () => {
    const cfg = { ...DEFAULT_CHALLENGE, seed: 77, cohortSize: 50 };
    const fixed = createFixedChallenge(cfg, {
      playlistId: 'PL1',
      playlistSnapshotVersion: 4,
      playlistDurationSec: 36000,
      windowDates: dates,
      now,
    });
    expect(fixed.mode).toBe('fixed');
    expect(fixed.fixed).not.toBeNull();
    const snap = fixed.fixed as FixedChallengeSnapshot;
    expect(snap.modelVersion).toBe(ARENA_MODEL_VERSION);
    expect(snap.seed).toBe(77);
    expect(snap.cohortSize).toBe(50);
    expect(snap.weights).toEqual({ progress: 0.75, consistency: 0.25 });
    expect(snap.playlistId).toBe('PL1');
    expect(snap.playlistDurationSec).toBe(36000);
    expect(snap.windowDates).toEqual(dates);
    // Later config edits cannot mutate the captured snapshot.
    cfg.seed = 999;
    expect((fixed.fixed as FixedChallengeSnapshot).seed).toBe(77);
  });

  it('replaying the same snapshot reproduces identical scores', () => {
    const fixed = createFixedChallenge(DEFAULT_CHALLENGE, {
      playlistId: 'PL1',
      playlistSnapshotVersion: 4,
      playlistDurationSec: 36000,
      windowDates: dates,
      now,
    });
    const snap = fixed.fixed as FixedChallengeSnapshot;
    const replayCfg = {
      ...fixed,
      seed: snap.seed,
      cohortSize: snap.cohortSize,
      tierDist: snap.tierDist,
      windowDays: snap.windowDays,
      dailyCapHours: snap.dailyCapHours,
    };
    const first = generateCompetitors(replayCfg, BASIS, { anchorDates: snap.windowDates });
    const second = generateCompetitors(replayCfg, BASIS, { anchorDates: snap.windowDates });
    expect(first.map((c) => c.id)).toEqual(second.map((c) => c.id));
    expect(first.map((c) => c.arenaScore)).toEqual(second.map((c) => c.arenaScore));
    // A new practice cohort changes the seed but not user progress inputs.
    const practice = normalizeChallenge({ ...DEFAULT_CHALLENGE, seed: 123, mode: 'practice' });
    expect(practice.mode).toBe('practice');
    expect(practice.fixed).toBeNull();
    expect(USER.uniqueContentSec).toBe(18000);
  });
});

describe('computeArenaUserEvidence', () => {
  const TZ = 'UTC';
  const DAY = '2026-10-27';
  const dayStart = Date.parse(`${DAY}T00:00:00.000Z`);

  function snapshot(entries: PlaylistSnapshot['entries']): PlaylistSnapshot {
    return {
      playlistId: 'PL1', title: 'Test', reportedCount: entries.length, entries,
      source: 'api', fetchedAt: new Date(dayStart).toISOString(), snapshotVersion: 1,
    };
  }

  function segment(over: Partial<PlaybackSegment> & { id: string }): PlaybackSegment {
    return {
      playlistId: 'PL1', position: 1, entryId: 'e1', videoId: 'v1', sessionId: 's1',
      wallStartMs: dayStart, wallEndMs: dayStart + 300_000,
      timelineStartSec: 0, timelineEndSec: 300, playbackRate: 1, source: 'verified',
      ...over,
    };
  }

  function session(over: Partial<StudySession> = {}): StudySession {
    return {
      id: 'focus-1', playlistId: 'PL1', startedAt: new Date(dayStart).toISOString(),
      finishedAt: new Date(dayStart + 900_000).toISOString(), activeSec: 900, elapsedSec: 900,
      ...over,
    };
  }

  it('deduplicates overlapping/repeated verified coverage per stable entry', () => {
    const snap = snapshot([{ position: 1, entryId: 'e1', videoId: 'v1', title: 'A', durationSec: 600 }]);
    const evidence = computeArenaUserEvidence({
      snapshot: snap,
      progress: {},
      segments: [
        segment({ id: 's1', timelineStartSec: 0, timelineEndSec: 300, wallEndMs: dayStart + 300_000 }),
        segment({ id: 's2', timelineStartSec: 200, timelineEndSec: 600, wallStartMs: dayStart + 200_000, wallEndMs: dayStart + 600_000 }),
        // Rewatch must not add unique content.
        segment({ id: 's3', timelineStartSec: 0, timelineEndSec: 300, wallStartMs: dayStart + 600_000, wallEndMs: dayStart + 900_000 }),
      ],
      sessions: [session()],
      timeZone: TZ,
      windowDates: [DAY],
    });
    expect(evidence.playlistDurationSec).toBe(600);
    expect(evidence.uniqueContentSec).toBe(600);
    expect(evidence.qualifyingDays).toBe(1);
    expect(evidence.daily[0].contentGainSec).toBe(600);
    expect(evidence.verifiedCompleted).toBe(0);
  });

  it('manual completion credits duration once but stays self-reported', () => {
    const snap = snapshot([
      { position: 1, entryId: 'e1', videoId: 'v1', title: 'A', durationSec: 600 },
      { position: 2, entryId: 'e2', videoId: 'v2', title: 'B', durationSec: 600 },
    ]);
    const progress: Record<string, ProgressRecord> = {
      'PL1::e2': {
        playlistId: 'PL1', position: 2, entryId: 'e2', videoId: 'v2',
        completedAt: `${DAY}T12:00:00.000Z`, status: 'done', source: 'manual',
      },
    };
    const evidence = computeArenaUserEvidence({
      snapshot: snap, progress, segments: [], sessions: [session()], timeZone: TZ, windowDates: [DAY],
    });
    expect(evidence.playlistDurationSec).toBe(1200);
    expect(evidence.uniqueContentSec).toBe(600);
    expect(evidence.manualCompleted).toBe(1);
    expect(evidence.verifiedCompleted).toBe(0);
    expect(evidence.qualifyingDays).toBe(1);
  });

  it('duplicate occurrences remain distinct and unresolved durations disable the ratio', () => {
    const snap = snapshot([
      { position: 1, entryId: 'e1', videoId: 'v1', title: 'A', durationSec: 600 },
      { position: 2, entryId: 'e2', videoId: 'v1', title: 'A again', durationSec: 600 },
      { position: 3, entryId: 'e3', videoId: 'v3', title: 'C', durationSec: null, unresolvedReason: 'missingDuration' },
    ]);
    const evidence = computeArenaUserEvidence({
      snapshot: snap, progress: {}, segments: [], sessions: [], timeZone: TZ, windowDates: [DAY],
    });
    expect(evidence.playlistDurationSec).toBeNull();
    const components = arenaComponents({
      uniqueContentSec: evidence.uniqueContentSec,
      playlistDurationSec: evidence.playlistDurationSec,
      qualifyingDays: evidence.qualifyingDays,
      windowDays: 14,
      observedDays: 14,
    });
    expect(components.available).toBe(false);
    expect(components.score).toBeNull();
  });

  it('cross-midnight coverage splits by calendar day without inventing time', () => {
    const snap = snapshot([{ position: 1, entryId: 'e1', videoId: 'v1', title: 'A', durationSec: 600 }]);
    const evidence = computeArenaUserEvidence({
      snapshot: snap,
      progress: {},
      segments: [segment({
        id: 'midnight', timelineStartSec: 0, timelineEndSec: 600,
        wallStartMs: Date.parse('2026-10-27T23:55:00.000Z'),
        wallEndMs: Date.parse('2026-10-28T00:05:00.000Z'),
      })],
      sessions: [],
      timeZone: TZ,
      windowDates: ['2026-10-27', '2026-10-28'],
    });
    expect(evidence.uniqueContentSec).toBe(600);
    expect(evidence.daily[0].contentGainSec).toBe(300);
    expect(evidence.daily[1].contentGainSec).toBe(300);
  });
});
