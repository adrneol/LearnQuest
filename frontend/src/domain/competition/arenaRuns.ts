import { addDaysToDateKey, calendarWindowDates } from '../time/time.js';
import { normalizeSnapshotIdentity } from '../progress/identity.js';
import { arenaDayStart, arenaTimezone, forwardArenaWindow } from './arenaTime.js';
import {
  arenaComponents, computeArenaUserEvidence, DEFAULT_CHALLENGE, hashStringToUint32, isQualifyingArenaDay,
  mulberry32, rankBoard, type ArenaBoard, type ArenaDayEvidence, type Competitor,
} from './competition.js';
import { generateAlias, initialsOf } from './aliases.js';
import type { PlaylistSnapshot, ProgressRecord, StudySession } from '../../types/index.js';
import type { PlaybackSegment } from '../playback/playback.js';

export const ARENA_RUN_MODEL = 'arena-v3' as const;
export const ARENA_HISTORY_LIMIT = 20;
export const ARENA_SAMPLE_LIMIT = 90;

export type Difficulty = 'relaxed' | 'balanced' | 'challenging';
export interface ArenaSetup {
  name: string;
  kind: 'practice' | 'fixed';
  seed: number;
  opponents: number;
  days: number;
  difficulty: Difficulty;
}

export interface ArenaBasis {
  playlistId: string;
  title: string;
  /** Compact frozen occurrence records, with no notes or progress payload. */
  entries: [position: number, entryId: string, videoId: string, durationSec: number][];
}

export interface ArenaResult {
  asOf: string;
  dates: string[];
  observedDays: number;
  uniqueContentSec: number;
  daily: ArenaDayEvidence[];
  rank: number | null;
  score: number | null;
  rankedCount: number;
}

export interface ArenaSample { at: string; rank: number; of: number; score: number }

export interface ArenaRun {
  id: string;
  model: typeof ARENA_RUN_MODEL;
  setup: ArenaSetup;
  zone: string;
  startedAt: string;
  endsAt: string | null;
  dates: string[] | null;
  basis: ArenaBasis;
  state: 'active' | 'paused' | 'completed' | 'archived';
  result: ArenaResult | null;
  samples: ArenaSample[];
}

export interface ArenaLedger {
  version: 1;
  active: ArenaRun | null;
  history: ArenaRun[];
}

export const EMPTY_ARENA: ArenaLedger = { version: 1, active: null, history: [] };

export function freezeArenaBasis(snapshot: PlaylistSnapshot | undefined): ArenaBasis | null {
  if (!snapshot || snapshot.entries.length === 0 || snapshot.entries.length > 1000
    || snapshot.entries.some((entry) => entry.durationSec === null || !Number.isSafeInteger(entry.durationSec) || entry.durationSec < 0)
    || !snapshot.entries.some((entry) => entry.durationSec! > 0)) return null;
  return {
    playlistId: snapshot.playlistId, title: snapshot.title,
    entries: normalizeSnapshotIdentity(snapshot).entries.map((entry) =>
      [entry.position, entry.entryId!, entry.videoId, entry.durationSec!]),
  };
}

export function validArenaSetup(setup: ArenaSetup): boolean {
  return setup.name.trim().length > 0 && setup.name.trim().length <= 80
    && (setup.kind === 'practice' || setup.kind === 'fixed')
    && Number.isSafeInteger(setup.seed)
    && Number.isInteger(setup.opponents) && setup.opponents >= 1 && setup.opponents <= 2000
    && Number.isInteger(setup.days) && setup.days >= 1 && setup.days <= 90
    && ['relaxed', 'balanced', 'challenging'].includes(setup.difficulty);
}

export function makeArenaRun(id: string, setup: ArenaSetup, basis: ArenaBasis, timeZone: string, now: number): ArenaRun {
  if (!validArenaSetup(setup)) throw new Error('Check the simulation name, opponent count, and number of days.');
  const zone = arenaTimezone(timeZone);
  const today = calendarWindowDates(1, zone, now)[0];
  const midnight = setup.kind === 'fixed' ? arenaDayStart(today, zone) : now;
  const start = setup.kind === 'fixed' && now > midnight ? arenaDayStart(addDaysToDateKey(today, 1), zone) : now;
  const window = setup.kind === 'fixed' ? forwardArenaWindow(setup.days, zone, start) : null;
  return {
    id, model: ARENA_RUN_MODEL, setup: { ...setup, name: setup.name.trim() }, zone, basis,
    startedAt: new Date(start).toISOString(), endsAt: window ? new Date(window.end).toISOString() : null,
    dates: window?.dates ?? null, state: 'active', result: null, samples: [],
  };
}

export function arenaWindow(run: ArenaRun, now: number) {
  const started = Date.parse(run.startedAt);
  const end = run.endsAt ? Date.parse(run.endsAt) : Infinity;
  const today = calendarWindowDates(1, run.zone, Math.min(now, end))[0];
  if (!run.dates) {
    const cutoff = arenaDayStart(today, run.zone);
    const dates = Array.from({ length: run.setup.days }, (_, index) => addDaysToDateKey(today, index - run.setup.days));
    return { asOf: cutoff, dates, observedDays: dates.length, start: arenaDayStart(dates[0], run.zone),
      cutoff, scheduled: false, expired: false };
  }
  const observedDays = run.dates.filter((date) => date < today).length;
  const cutoff = observedDays > 0 ? Math.min(end, arenaDayStart(today, run.zone)) : started;
  return { asOf: Math.min(now, cutoff), dates: run.dates, observedDays, start: started, cutoff,
    scheduled: now < started, expired: now >= end };
}

export interface ArenaLearningData {
  progress: Record<string, ProgressRecord>;
  segments: PlaybackSegment[];
  sessions: StudySession[];
}

export function observeArena(run: ArenaRun, learning: ArenaLearningData, window: ReturnType<typeof arenaWindow>) {
  const { basis } = run;
  const snapshot: PlaylistSnapshot = {
    playlistId: basis.playlistId, title: basis.title, source: 'imported', fetchedAt: run.startedAt,
    reportedCount: basis.entries.length, snapshotVersion: 2,
    entries: basis.entries.map(([position, entryId, videoId, durationSec]) =>
      ({ position, entryId, videoId, durationSec, title: '' })),
  };
  const evidence = computeArenaUserEvidence({
    snapshot, ...learning, timeZone: run.zone, windowDates: window.dates, modelVersion: run.model, frozen: true,
    bounds: { start: window.start, end: window.cutoff },
  });
  return {
    asOf: new Date(window.asOf).toISOString(), dates: window.dates, observedDays: window.observedDays,
    uniqueContentSec: evidence.uniqueContentSec, daily: evidence.daily,
  };
}

/** Version 3 uses continuous pace, cadence and persistence traits. Difficulty shifts rival traits only. */
export function generateArenaRivals(run: ArenaRun, dates: string[], observedDays: number, total: number): Competitor[] {
  const { seed, opponents, days, difficulty } = run.setup;
  const names = new Set<string>();
  const aliasRandom = mulberry32(hashStringToUint32(`${run.model}:${seed}:names`));
  const intensity = difficulty === 'relaxed' ? 0.8 : difficulty === 'challenging' ? 1.18 : 1;
  const observed = dates.slice(0, observedDays).map((dateKey, day) => ({
    dateKey, day, weekend: [0, 6].includes(new Date(dateKey + 'T12:00:00Z').getUTCDay()),
  }));
  let boundary = 0;
  const lessonEnds = run.basis.entries.map((entry) => boundary += entry[3]);
  return Array.from({ length: opponents }, (_, index) => {
    const id = `rival-${index + 1}`;
    const rng = mulberry32(hashStringToUint32(`${run.model}:${seed}:${id}`));
    const name = generateAlias(aliasRandom, names);
    const cadence = Math.min(0.95, (0.22 + rng() * 0.62) * intensity);
    const pace = 0.32 + (rng() + rng()) * 0.58;
    const typicalMinutes = (12 + (rng() + rng()) * 31) * intensity;
    const endurance = rng();
    const ramp = 0.85 + rng() * 0.3;
    const sessions: Competitor['sessions'] = [];
    let uniqueContentSec = 0;
    let focusSec = 0;
    let qualifyingDays = 0;
    let verifiedCount = 0;
    let practiceMin = 0;
    for (const date of observed) {
      const daily = mulberry32(hashStringToUint32(`${seed}:${id}:${date.dateKey}`));
      const persistence = 1 - (date.day / Math.max(days, 1)) * (1 - endurance) * 0.55;
      if (daily() > cadence * persistence * (date.weekend ? 0.78 : 1)) continue;
      const focus = Math.round(60 * typicalMinutes * (0.35 + (daily() + daily()) * 0.68));
      const content = Math.min(total - uniqueContentSec, Math.round(focus * pace * ramp * (0.72 + daily() * 0.52)));
      if (content <= 0) break;
      const before = verifiedCount;
      while (verifiedCount < lessonEnds.length && lessonEnds[verifiedCount] <= uniqueContentSec + content) verifiedCount++;
      const completedVideo = verifiedCount > before;
      const qualifies = isQualifyingArenaDay({ contentGainSec: content, completedVideo, focusSec: focus, activePlaybackSec: 0 });
      const practice = Math.round(focus / 600 * daily());
      sessions.push({ day: date.day, dateKey: date.dateKey, focusSec: focus, contentSec: content,
        focusMin: focus / 60, contentMin: content / 60, effDay: 100 * content / focus,
        practiceMin: practice, completedVideo, activePlaybackSec: 0, qualifies });
      uniqueContentSec += content;
      focusSec += focus;
      qualifyingDays += Number(qualifies);
      practiceMin += practice;
    }
    const score = arenaComponents({ uniqueContentSec, playlistDurationSec: total, qualifyingDays, observedDays, windowDays: days });
    return {
      id, name, initials: initialsOf(name), tier: 'Normal', uniqueContentSec, verifiedCount, focusSec,
      activeDays: sessions.length, windowDays: days, sessions, efficiency: focusSec ? 100 * uniqueContentSec / focusSec : 0,
      practiceMin, arenaScore: score.score, eligibleDays: qualifyingDays, qualifyingDays, observedDays,
      progress: score.progress ?? 0, consistency: score.consistency ?? 0, provisional: score.provisional,
    };
  });
}

export function scoreArenaRun(run: ArenaRun, evidence: Omit<ArenaResult, 'rank' | 'score' | 'rankedCount'>, rivals?: Competitor[]): ArenaBoard {
  const total = run.basis.entries.reduce((sum, entry) => sum + entry[3], 0);
  return rankBoard({ ...DEFAULT_CHALLENGE, windowDays: run.setup.days },
    rivals ?? generateArenaRivals(run, evidence.dates, evidence.observedDays, total), {
      uniqueContentSec: evidence.uniqueContentSec, playlistDurationSec: total,
      qualifyingDays: evidence.daily.filter(isQualifyingArenaDay).length, observedDays: evidence.observedDays,
    });
}

export function sealArenaResult(evidence: Omit<ArenaResult, 'rank' | 'score' | 'rankedCount'>, board: ArenaBoard): ArenaResult {
  return { ...evidence, rank: board.userRank, score: board.userScore,
    rankedCount: board.rows.filter((row) => row.rank !== null).length };
}

export type ArenaAction =
  | { type: 'create'; run: ArenaRun; expectedId?: string; previous?: ArenaResult }
  | { type: 'pause' | 'complete'; id: string; result: ArenaResult }
  | { type: 'resume' | 'archive' | 'delete'; id: string }
  | { type: 'sample'; id: string; sample: ArenaSample };

export function transitionArena(ledger: ArenaLedger, action: ArenaAction): ArenaLedger {
  const active = ledger.active;
  switch (action.type) {
    case 'create': {
      if (active?.id !== action.expectedId || (active && (!action.previous || ledger.history.length >= ARENA_HISTORY_LIMIT))
        || active?.id === action.run.id || ledger.history.some((run) => run.id === action.run.id)) return ledger;
      return { ...ledger, active: action.run, history: active && action.previous
        ? [{ ...active, state: 'archived', result: action.previous }, ...ledger.history] : ledger.history };
    }
    case 'pause':
      return active?.id === action.id && active.state === 'active' && active.setup.kind === 'practice'
        ? { ...ledger, active: { ...active, state: 'paused', result: action.result } } : ledger;
    case 'resume':
      return active?.id === action.id && active.state === 'paused'
        ? { ...ledger, active: { ...active, state: 'active', result: null } } : ledger;
    case 'complete':
      return active?.id === action.id && ledger.history.length < ARENA_HISTORY_LIMIT
        ? { ...ledger, active: null, history: [{ ...active, state: 'completed', result: action.result }, ...ledger.history] } : ledger;
    case 'archive':
      return ledger.history.some((run) => run.id === action.id && run.state === 'completed')
        ? { ...ledger, history: ledger.history.map((run) => run.id === action.id ? { ...run, state: 'archived' } : run) } : ledger;
    case 'delete':
      return active?.id === action.id || ledger.history.some((run) => run.id === action.id)
        ? { ...ledger, active: active?.id === action.id ? null : active, history: ledger.history.filter((run) => run.id !== action.id) } : ledger;
    case 'sample':
      return active?.id === action.id && active.state === 'active' && active.samples.length < ARENA_SAMPLE_LIMIT
        && !active.samples.some((sample) => sample.at === action.sample.at)
        ? { ...ledger, active: { ...active, samples: [...active.samples, action.sample] } } : ledger;
  }
}

