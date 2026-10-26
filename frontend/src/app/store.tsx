import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  computePlaylistProgress,
  computeRangeProgress,
  diffSnapshots,
  rangeDuration,
  rangeStatus,
  snapshotCompleteness,
  sumEntries,
  validateRange,
  evaluateAchievements,
  xpForFocusSession,
  dateKeyInTimezone,
  computeStreak,
  activeFocusDayKeys,
  formatSecondsHHMMSS,
  summarizeSegments,
  completionFromCoverage,
  goalProgress,
  formatGoalTarget,
  XP_RULES,
  normalizeSnapshotIdentity,
  reconcileProgress,
  reconcileLoadedProgress,
  reconcileSegments,
  reconcilePlaySessions,
  reconcileQueuePositions,
  identityKey,
  findProgressForEntry,
  buildEntryProgressIndex,
  isProgressComplete,
  buildReviewPatch,
  segmentIdentityKey,
  focusSessionDaySlices,
  splitPlaybackSegmentByDay,
  moveModuleWithinPlaylist,
  playlistRemovalPlan,
  validatePreferencePatch,
  sanitizePreferences,
  defaultPreferences,
  sanitizeSettings,
  isRecordableFocusSession,
} from '../domain/index.js';
import type { PlaybackSegment, Goal, AppPreferences, Module, RankSnapshot } from '../domain/index.js';
import type { ChallengeConfig } from '../domain/competition/competition.js';
import { DEFAULT_CHALLENGE, validateChallenge } from '../domain/competition/competition.js';
import type {
  PlaylistSnapshot, ProgressRecord, SavedRange, Checkpoint, StudySession, XpEvent, DayGoal,
  PlaySession, AppSettings,
} from '../domain/index.js';
import { kvGet, kvSet, kvClearAll, kvReplaceAll } from '../services/persistence/db.js';
import { buildBackup, validateBackup, type BackupState, type BackupMeta } from '../services/persistence/backup.js';
import { notify } from '../services/notifications/notify.js';

export type Prefs = AppPreferences;
export type { Module, RankSnapshot };

interface Store {
  ready: boolean;
  loadError: string | null;
  retryLoad: () => void;
  playlists: Record<string, PlaylistSnapshot>;
  meta: Record<string, BackupMeta>;
  activeId: string | null;
  progress: Record<string, ProgressRecord>;
  ranges: SavedRange[];
  checkpoints: Checkpoint[];
  modules: Module[];
  sessions: StudySession[];
  goals: Record<string, DayGoal>;
  xp: XpEvent[];
  achievements: Record<string, string>;
  prefs: Prefs;
  lastDiff: string | null;
  celebration: string | null;
  // v2: playback + flexible goals + simulated competition (isolated) + settings
  segments: PlaybackSegment[];
  playSessions: PlaySession[];
  queue: Record<string, number[]>;
  flexGoals: Goal[];
  challenge: ChallengeConfig;
  challengeEnabled: boolean;
  rankHistory: RankSnapshot[];
  settings: AppSettings;
  // actions
  addSnapshot: (s: PlaylistSnapshot) => void;
  removePlaylist: (id: string) => void;
  renamePlaylist: (id: string, title: string) => void;
  setArchived: (id: string, archived: boolean) => void;
  setActive: (id: string | null) => void;
  toggleDone: (playlistId: string, position: number, videoId: string) => void;
  updateRecord: (key: string, patch: Partial<ProgressRecord>) => void;
  deleteProgressRecord: (key: string) => void;
  saveRange: (r: Omit<SavedRange, 'id' | 'createdAt' | 'snapshotVersion' | 'status'>) => void;
  deleteRange: (id: string) => void;
  renameRange: (id: string, label: string) => void;
  editRange: (id: string, start: number, end: number) => void;
  saveCheckpoint: (c: Omit<Checkpoint, 'id' | 'createdAt' | 'completedAt' | 'snapshotVersion' | 'status'>) => void;
  deleteCheckpoint: (id: string) => void;
  renameCheckpoint: (id: string, label: string) => void;
  editCheckpoint: (id: string, start: number, end: number) => void;
  saveModule: (m: Omit<Module, 'id'>, id?: string) => void;
  deleteModule: (id: string) => void;
  moveModule: (id: string, dir: -1 | 1) => void;
  addSession: (s: Omit<StudySession, 'id' | 'dateKey'>) => void;
  deleteSession: (id: string) => void;
  setGoal: (g: DayGoal) => void;
  setPrefs: (p: Partial<Prefs>) => void;
  awardXp: (reason: string, points: number, dedupKey: string) => void;
  clearCelebration: () => void;
  // v2 actions
  addSegments: (segs: PlaybackSegment[]) => void;
  addPlaySession: (s: Omit<PlaySession, 'id'>) => void;
  addManualPlaySession: (s: Omit<PlaySession, 'id' | 'source'>) => void;
  markVerified: (playlistId: string, position: number, videoId: string) => void;
  /** Record a review, clear current flags, preserve annotations and append history. */
  markReviewed: (playlistId: string, position: number, source?: 'revision' | 'player') => void;
  setQueue: (playlistId: string, positions: number[]) => void;
  saveFlexGoal: (g: Omit<Goal, 'id' | 'createdAt' | 'achievedAt' | 'achievedValue'>) => void;
  updateFlexGoal: (id: string, patch: Partial<Goal>) => void;
  deleteFlexGoal: (id: string) => void;
  setChallenge: (patch: Partial<ChallengeConfig>) => void;
  setChallengeEnabled: (on: boolean) => void;
  resetChallenge: () => void;
  pushRank: (r: RankSnapshot) => void;
  setSettings: (patch: Partial<AppSettings>) => void;
  exportBackup: () => Promise<string>;
  importBackup: (json: string) => Promise<{ warnings: string[] }>;
  clearAllData: () => Promise<void>;
  clearCacheOnly: () => Promise<void>;
  setLastDiff: (s: string | null) => void;
}

export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('store not ready');
  return s;
};

interface GoalCtx {
  progress: Record<string, ProgressRecord>;
  segments: PlaybackSegment[];
  sessions: StudySession[];
  playSessions: PlaySession[];
  checkpoints: Checkpoint[];
  playlists: Record<string, PlaylistSnapshot>;
  prefs: Prefs;
}

function afterCreation(goal: Goal, iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  const created = Date.parse(goal.createdAt);
  return Number.isFinite(t) && Number.isFinite(created) && t >= created;
}

/** Eligible current value for a flexible goal from real records only. */
export function goalCurrentValue(g: Goal, ctx: GoalCtx): number {
  const inScopePlaylist = (pid: string) => !g.playlistId || pid === g.playlistId;
  const onDay = (isoMs: number) =>
    !g.dateKey || dateKeyInTimezone(new Date(isoMs), ctx.prefs.timezone) === g.dateKey;
  switch (g.metric) {
    case 'video-count': {
      const snapshotByIdentity = new Map<string, PlaylistSnapshot>();
      for (const p of Object.values(ctx.playlists)) snapshotByIdentity.set(p.playlistId, p);
      return Object.values(ctx.progress).filter(
        (p) => isProgressComplete(p)
          && inScopePlaylist(p.playlistId)
          && afterCreation(g, p.completedAt)
          && (!g.dateKey || dateKeyInTimezone(new Date(p.completedAt!), ctx.prefs.timezone) === g.dateKey),
      ).length;
    }
    case 'unique-content': {
      const scoped = ctx.segments.filter(
        (s) => inScopePlaylist(s.playlistId) && afterCreation(g, new Date(s.wallStartMs).toISOString()) && onDay(s.wallStartMs),
      );
      // Unique coverage is per playlist occurrence, split at local midnight.
      const byKey = new Map<string, PlaybackSegment[]>();
      for (const s of scoped) {
        for (const slice of splitPlaybackSegmentByDay(s, ctx.prefs.timezone)) {
          if (!onDay(slice.segment.wallStartMs)) continue;
          const k = segmentIdentityKey(slice.segment);
          const arr = byKey.get(k) ?? [];
          arr.push(slice.segment);
          byKey.set(k, arr);
        }
      }
      let total = 0;
      for (const arr of byKey.values()) total += summarizeSegments(arr).uniqueSec;
      return Math.round(total);
    }
    case 'focus-time': {
      let total = 0;
      for (const s of ctx.sessions) {
        if (g.playlistId && s.playlistId !== g.playlistId) continue;
        if (!afterCreation(g, s.startedAt)) continue;
        if (g.dateKey) {
          for (const slice of focusSessionDaySlices(s, ctx.prefs.timezone)) {
            if (slice.dateKey === g.dateKey) total += slice.sec;
          }
        } else {
          total += s.activeSec;
        }
      }
      return total;
    }
    case 'playback-time': {
      let total = 0;
      for (const s of ctx.segments) {
        if (!inScopePlaylist(s.playlistId) || !afterCreation(g, new Date(s.wallStartMs).toISOString())) continue;
        const slices = splitPlaybackSegmentByDay(s, ctx.prefs.timezone);
        for (const slice of slices) {
          if (!onDay(slice.segment.wallStartMs)) continue;
          total += Math.max(0, Math.round((slice.segment.wallEndMs - slice.segment.wallStartMs) / 1000));
        }
      }
      return total;
    }
    case 'checkpoint': {
      const c = ctx.checkpoints.find((x) => x.id === g.checkpointId);
      if (!c) return 0;
      if (c.completedAt && !afterCreation(g, c.completedAt)) return 0;
      const snap = ctx.playlists[c.playlistId];
      if (!snap) return 0;
      try {
        return computeRangeProgress(snap, c.start, c.end, ctx.progress).done;
      } catch {
        return 0;
      }
    }
  }
}

const Ctx = createContext<Store | null>(null);

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const DEFAULT_SETTINGS: AppSettings = { verifiedThreshold: 0.9 };

interface LoadedState {
  playlists: Record<string, PlaylistSnapshot>;
  meta: Record<string, BackupMeta>;
  activeId: string | null;
  progress: Record<string, ProgressRecord>;
  ranges: SavedRange[];
  checkpoints: Checkpoint[];
  modules: Module[];
  sessions: StudySession[];
  goals: Record<string, DayGoal>;
  xp: XpEvent[];
  achievements: Record<string, string>;
  prefs: Prefs;
  segments: PlaybackSegment[];
  playSessions: PlaySession[];
  queue: Record<string, number[]>;
  flexGoals: Goal[];
  challenge: ChallengeConfig;
  challengeEnabled: boolean;
  rankHistory: RankSnapshot[];
  settings: AppSettings;
}

function asRecord<T>(value: unknown): Record<string, T> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, T>) : {};
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Normalize persisted/restored data before it reaches React. Identity
 * reconciliation is applied against each playlist snapshot; malformed
 * auxiliary entries are dropped rather than allowed to crash calculations.
 */
function normalizeLoadedState(raw: Partial<LoadedState>, fallbackPrefs = defaultPreferences()): { state: LoadedState; orphans: number; moved: number } {
  const playlists: Record<string, PlaylistSnapshot> = {};
  for (const [key, value] of Object.entries(asRecord<PlaylistSnapshot>(raw.playlists))) {
    if (!value || !Array.isArray(value.entries)) continue;
    playlists[key] = normalizeSnapshotIdentity({ ...value, playlistId: value.playlistId ?? key });
  }
  const meta: Record<string, BackupMeta> = {};
  for (const [key, value] of Object.entries(asRecord<BackupMeta>(raw.meta))) {
    if (!playlists[key] || !value || typeof value.addedAt !== 'string') continue;
    meta[key] = { archived: Boolean(value.archived), customTitle: typeof value.customTitle === 'string' ? value.customTitle : undefined, addedAt: value.addedAt };
  }
  for (const key of Object.keys(playlists)) {
    if (!meta[key]) meta[key] = { archived: false, addedAt: new Date().toISOString() };
  }
  const rawProgress = asRecord<ProgressRecord>(raw.progress);
  let progress: Record<string, ProgressRecord> = {};
  let orphans = 0;
  let moved = 0;
  const handled = new Set<string>();
  for (const snap of Object.values(playlists)) {
    const scoped: Record<string, ProgressRecord> = {};
    for (const [key, rec] of Object.entries(rawProgress)) {
      if (rec && rec.playlistId === snap.playlistId) {
        scoped[key] = rec;
        handled.add(key);
      }
    }
    const r = reconcileLoadedProgress(snap, scoped);
    progress = { ...progress, ...r.progress };
    orphans += r.orphaned;
    moved += r.moved;
  }
  for (const [key, rec] of Object.entries(rawProgress)) {
    if (!handled.has(key) && rec) {
      // No current playlist owns this record: preserve it as review-only.
      progress[key] = { ...rec, orphaned: rec.orphaned ?? true, reviewReason: rec.reviewReason ?? 'unknown' };
    }
  }
  const ranges = asArray<SavedRange>(raw.ranges).filter((r) => r && playlists[r.playlistId]);
  const checkpoints = asArray<Checkpoint>(raw.checkpoints).filter((c) => c && playlists[c.playlistId]);
  const modules = asArray<Module>(raw.modules)
    .filter((m) => m && playlists[m.playlistId] && Array.isArray(m.positions))
    .map((m) => ({ ...m, positions: [...new Set(m.positions.filter((p) => Number.isInteger(p) && p > 0))].sort((a, b) => a - b) }));
  const sessions = asArray<StudySession>(raw.sessions)
    .filter((s) => s && Number.isFinite(s.activeSec) && s.activeSec >= 0 && typeof s.startedAt === 'string')
    .map((s) => ({ ...s, dateKey: typeof s.dateKey === 'string' ? s.dateKey : dateKeyInTimezone(new Date(s.startedAt), fallbackPrefs.timezone) }));
  const goals = asRecord<DayGoal>(raw.goals);
  const xp = asArray<XpEvent>(raw.xp).filter((x) => x && Number.isFinite(x.points) && typeof x.dedupKey === 'string');
  const achievements = asRecord<string>(raw.achievements);
  const prefs = sanitizePreferences(raw.prefs, fallbackPrefs);
  let segments = asArray<PlaybackSegment>(raw.segments).filter((s) => s && Number.isFinite(s.wallStartMs) && Number.isFinite(s.wallEndMs));
  let playSessions = asArray<PlaySession>(raw.playSessions).filter((s) => s && Number.isFinite(s.activePlaybackSec));
  const queue: Record<string, number[]> = {};
  for (const [pid, positions] of Object.entries(asRecord<number[]>(raw.queue))) {
    if (!playlists[pid] || !Array.isArray(positions)) continue;
    queue[pid] = positions.filter((p) => Number.isInteger(p) && p > 0);
  }
  for (const snap of Object.values(playlists)) {
    segments = reconcileSegments(undefined, snap, segments);
    playSessions = reconcilePlaySessions(undefined, snap, playSessions);
    if (queue[snap.playlistId]) queue[snap.playlistId] = reconcileQueuePositions(undefined, snap, queue[snap.playlistId]);
  }
  const flexGoals = asArray<Goal>(raw.flexGoals).filter((g) => g && g.id && g.metric && Number.isFinite(g.target));
  const challengeCandidate = { ...DEFAULT_CHALLENGE, ...asRecord(raw.challenge) } as ChallengeConfig;
  const challenge = validateChallenge(challengeCandidate).length ? DEFAULT_CHALLENGE : challengeCandidate;
  const settings = sanitizeSettings(raw.settings);
  const activeId = typeof raw.activeId === 'string' && playlists[raw.activeId] ? raw.activeId : null;
  return {
    state: {
      playlists,
      meta,
      activeId,
      progress,
      ranges,
      checkpoints,
      modules,
      sessions,
      goals,
      xp,
      achievements,
      prefs,
      segments,
      playSessions,
      queue,
      flexGoals,
      challenge,
      challengeEnabled: Boolean(raw.challengeEnabled),
      rankHistory: asArray<RankSnapshot>(raw.rankHistory).filter((r) => r && Number.isFinite(r.rank) && Number.isFinite(r.of)),
      settings,
    },
    orphans,
    moved,
  };
}

function rekeyModules(
  oldSnapshot: PlaylistSnapshot | undefined,
  newSnapshot: PlaylistSnapshot,
  modules: Module[],
): Module[] {
  if (!oldSnapshot) return modules;
  const oldEntries = normalizeSnapshotIdentity(oldSnapshot).entries;
  const newEntries = normalizeSnapshotIdentity(newSnapshot).entries;
  const oldByPos = new Map(oldEntries.map((e) => [e.position, e]));
  const newById = new Map(newEntries.map((e) => [e.entryId!, e]));
  return modules.map((m) => {
    if (m.playlistId !== newSnapshot.playlistId) return m;
    const mapped = m.positions
      .map((p) => {
        const oldEntry = oldByPos.get(p);
        if (!oldEntry) return null;
        return newById.get(oldEntry.entryId!)?.position ?? null;
      })
      .filter((p): p is number => p !== null);
    return { ...m, positions: [...new Set(mapped)].sort((a, b) => a - b) };
  });
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<Record<string, PlaylistSnapshot>>({});
  const [meta, setMeta] = useState<Record<string, BackupMeta>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, ProgressRecord>>({});
  const [ranges, setRanges] = useState<SavedRange[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [goals, setGoals] = useState<Record<string, DayGoal>>({});
  const [xp, setXp] = useState<XpEvent[]>([]);
  const [achievements, setAchievements] = useState<Record<string, string>>({});
  const [prefs, setPrefsState] = useState<Prefs>(() => defaultPreferences());
  const [segments, setSegments] = useState<PlaybackSegment[]>([]);
  const [playSessions, setPlaySessions] = useState<PlaySession[]>([]);
  const [queue, setQueueState] = useState<Record<string, number[]>>({});
  const [flexGoals, setFlexGoals] = useState<Goal[]>([]);
  const [challenge, setChallengeState] = useState<ChallengeConfig>(DEFAULT_CHALLENGE);
  const [challengeEnabled, setChallengeEnabledState] = useState(false);
  const [rankHistory, setRankHistory] = useState<RankSnapshot[]>([]);
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [lastDiff, setLastDiff] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<string | null>(null);
  const saveT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeChain = useRef<Promise<void>>(Promise.resolve());
  const loadAttempt = useRef(0);
  // Client-generated session ids are a second idempotency barrier in memory:
  // two finish clicks in one tick cannot both pass the stale `sessions` closure.
  const sessionKeys = useRef<Set<string>>(new Set());

  const applyState = useCallback((state: LoadedState) => {
    sessionKeys.current = new Set(
      state.sessions.map((s) => s.clientId).filter((v): v is string => typeof v === 'string' && v.length > 0),
    );
    setPlaylists(state.playlists);
    setMeta(state.meta);
    setActiveId(state.activeId);
    setProgress(state.progress);
    setRanges(state.ranges);
    setCheckpoints(state.checkpoints);
    setModules(state.modules);
    setSessions(state.sessions);
    setGoals(state.goals);
    setXp(state.xp);
    setAchievements(state.achievements);
    setPrefsState(state.prefs);
    setSegments(state.segments);
    setPlaySessions(state.playSessions);
    setQueueState(state.queue);
    setFlexGoals(state.flexGoals);
    setChallengeState(state.challenge);
    setChallengeEnabledState(state.challengeEnabled);
    setRankHistory(state.rankHistory);
    setSettingsState(state.settings);
  }, []);

  const load = useCallback(async () => {
    const attempt = ++loadAttempt.current;
    setLoadError(null);
    setReady(false);
    try {
      const [
        pl, m, a, pr, ra, cp, mo, se, go, x, ach, pf, sg, ps, qu, fg, ch, che, rh, st,
      ] = await Promise.all([
        kvGet<Record<string, PlaylistSnapshot>>('playlists'),
        kvGet<Record<string, BackupMeta>>('meta'),
        kvGet<string | null>('activeId'),
        kvGet<Record<string, ProgressRecord>>('progress'),
        kvGet<SavedRange[]>('ranges'),
        kvGet<Checkpoint[]>('checkpoints'),
        kvGet<Module[]>('modules'),
        kvGet<StudySession[]>('sessions'),
        kvGet<Record<string, DayGoal>>('goals'),
        kvGet<XpEvent[]>('xp'),
        kvGet<Record<string, string>>('achievements'),
        kvGet<Prefs>('prefs'),
        kvGet<PlaybackSegment[]>('segments'),
        kvGet<PlaySession[]>('playSessions'),
        kvGet<Record<string, number[]>>('queue'),
        kvGet<Goal[]>('flexGoals'),
        kvGet<ChallengeConfig>('challenge'),
        kvGet<boolean>('challengeEnabled'),
        kvGet<RankSnapshot[]>('rankHistory'),
        kvGet<AppSettings>('settings'),
      ]);
      if (attempt !== loadAttempt.current) return;
      const normalized = normalizeLoadedState({
        playlists: pl,
        meta: m,
        activeId: a ?? null,
        progress: pr,
        ranges: ra,
        checkpoints: cp,
        modules: mo,
        sessions: se,
        goals: go,
        xp: x,
        achievements: ach,
        prefs: pf,
        segments: sg,
        playSessions: ps,
        queue: qu,
        flexGoals: fg,
        challenge: ch,
        challengeEnabled: che,
        rankHistory: rh,
        settings: st,
      });
      applyState(normalized.state);
      if (normalized.orphans > 0 || normalized.moved > 0) {
        setLastDiff(
          `Storage migration reconciled ${normalized.moved} learning record${normalized.moved === 1 ? '' : 's'}. `
          + (normalized.orphans > 0
            ? `${normalized.orphans} record${normalized.orphans === 1 ? '' : 's'} no longer matched a video and were preserved for review in Reports.`
            : 'No records were lost.'),
        );
      }
      setReady(true);
    } catch {
      if (attempt !== loadAttempt.current) return;
      // A failed read is not an empty database. Do not initialize defaults or
      // start the writer: that would overwrite real records with blanks.
      setLoadError('LearnQuest could not read your local IndexedDB data. Nothing was overwritten. Retry the read; if it keeps failing, restore a JSON backup only after exporting the browser profile.');
      setReady(false);
    }
  }, [applyState]);

  useEffect(() => {
    void load();
  }, [load]);

  // debounced persist. Writes are best-effort per key: a quota failure on one
  // key must not break the session, and the user gets one actionable notice.
  const persistWarned = useRef(false);
  useEffect(() => {
    if (!ready) return;
    if (saveT.current) clearTimeout(saveT.current);
    saveT.current = setTimeout(() => {
      const writes: [string, unknown][] = [
        ['playlists', playlists],
        ['meta', meta],
        ['activeId', activeId],
        ['progress', progress],
        ['ranges', ranges],
        ['checkpoints', checkpoints],
        ['modules', modules],
        ['sessions', sessions],
        ['goals', goals],
        ['xp', xp],
        ['achievements', achievements],
        ['prefs', prefs],
        ['segments', segments],
        ['playSessions', playSessions],
        ['queue', queue],
        ['flexGoals', flexGoals],
        ['challenge', challenge],
        ['challengeEnabled', challengeEnabled],
        ['rankHistory', rankHistory],
        ['settings', settings],
      ];
      const run = (async () => {
        for (const [k, v] of writes) {
          try {
            await kvSet(k, v);
          } catch {
            if (!persistWarned.current) {
              persistWarned.current = true;
              try {
                notify('Storage write failed — the browser may be out of space. Export a JSON backup from Reports now.');
              } catch {
                /* notifications unavailable; data stays in memory for this session */
              }
            }
            break;
          }
        }
      })();
      // Destructive operations await this barrier so an in-flight debounced
      // write can never land after Clear All / restore and resurrect old data.
      writeChain.current = run.catch(() => undefined);
    }, 300);
    return () => {
      if (saveT.current) clearTimeout(saveT.current);
    };
  }, [ready, playlists, meta, activeId, progress, ranges, checkpoints, modules, sessions, goals, xp, achievements, prefs, segments, playSessions, queue, flexGoals, challenge, challengeEnabled, rankHistory, settings]);

  const awardXp = useCallback((reason: string, points: number, dedupKey: string) => {
    if (!Number.isFinite(points) || !dedupKey) return;
    setXp((prev) => {
      if (prev.some((e) => e.dedupKey === dedupKey)) return prev;
      return [...prev, { id: uid(), reason, points, dedupKey, at: new Date().toISOString() }];
    });
  }, []);

  // achievement evaluation runs when progress/sessions/checkpoints change
  useEffect(() => {
    if (!ready || !activeId || !playlists[activeId]) return;
    const snap = playlists[activeId];
    const prog = computePlaylistProgress(snap, progress);
    const focusedSec = sessions.reduce((a, s) => a + s.activeSec, 0);
    const days = activeFocusDayKeys(sessions, prefs.timezone).size;
    const cpsDone = checkpoints.filter((c) => c.playlistId === activeId && c.completedAt).length;
    const revDone = Object.values(progress).filter((p) => p.playlistId === activeId && p.revisionDoneAt).length;
    const newly = evaluateAchievements({
      completedVideos: prog.completedCount,
      totalVideos: prog.n,
      completedSec: prog.completedSec,
      totalSec: prog.totalSec,
      focusSessions: sessions.length,
      focusedSec,
      distinctDays: days,
      checkpointsDone: cpsDone,
      revisionsDone: revDone,
      already: new Set(Object.keys(achievements)),
    });
    if (newly.length > 0) {
      const now = new Date().toISOString();
      setAchievements((prev) => {
        const next = { ...prev };
        for (const k of newly) if (!next[k]) next[k] = now;
        return next;
      });
      for (const k of newly) awardXp(`achievement:${k}`, 25, `ach:${activeId}:${k}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, activeId, progress, sessions, checkpoints]);

  // checkpoint completion detection
  useEffect(() => {
    if (!ready || !activeId) return;
    const snap = playlists[activeId];
    if (!snap) return;
    setCheckpoints((prev) => {
      let changed = false;
      const next = prev.map((c) => {
        if (c.playlistId !== activeId || c.completedAt) return c;
        try {
          validateRange(c.start, c.end, snap.entries.length);
        } catch {
          return c;
        }
        const rp = computeRangeProgress(snap, c.start, c.end, progress);
        if (rp.remaining === 0 && rp.count > 0) {
          changed = true;
          return { ...c, completedAt: new Date().toISOString() };
        }
        return c;
      });
      if (changed) {
        const done = next.filter((c) => c.playlistId === activeId && c.completedAt && !prev.find((p) => p.id === c.id)?.completedAt);
        for (const d of done) {
          awardXp(`checkpoint:${d.label}`, XP_RULES.checkpointDone, `cp:${d.id}`);
          try {
            const r = rangeDuration(snap, d.start, d.end);
            setCelebration(
              `Checkpoint complete: ${d.label} — ${d.end - d.start + 1} videos${r.isComplete ? ` · ${formatSecondsHHMMSS(r.totalSec)}` : ' · duration incomplete'}.`,
            );
          } catch {
            setCelebration(`Checkpoint complete: ${d.label}.`);
          }
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, ready, activeId]);

  // flexible goal evaluation — achieved ONLY when the defined condition holds
  useEffect(() => {
    if (!ready || flexGoals.length === 0) return;
    const todayKey = dateKeyInTimezone(new Date(), prefs.timezone);
    setFlexGoals((prev) => {
      let changed = false;
      const next = prev.map((g) => {
        if (g.achievedAt || g.paused) return g;
        const current = goalCurrentValue(g, {
          progress, segments, sessions, playSessions, checkpoints, playlists, prefs,
        });
        const p = goalProgress(g, current, { todayKey });
        if (p.status === 'achieved' || p.status === 'exceeded') {
          changed = true;
          return { ...g, achievedAt: new Date().toISOString(), achievedValue: current };
        }
        return g;
      });
      if (changed) {
        for (const g of next) {
          const was = prev.find((x) => x.id === g.id);
          if (g.achievedAt && !(was?.achievedAt)) {
            awardXp(`goal:${g.label}`, 30, `goal:${g.id}`);
            setCelebration(`Goal achieved: ${g.label} — ${formatGoalTarget(g.metric, g.achievedValue ?? g.target)} recorded.`);
          }
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, segments, sessions, playSessions, checkpoints, ready]);

  const value: Store = useMemo(() => ({
    ready, loadError, retryLoad: () => { void load(); },
    playlists, meta, activeId, progress, ranges, checkpoints, modules, sessions, goals, xp, achievements, prefs, lastDiff, celebration,
    segments, playSessions, queue, flexGoals, challenge, challengeEnabled, rankHistory, settings,

    addSnapshot: (input) => {
      if (!input || !Array.isArray(input.entries)) {
        notify('That playlist snapshot is malformed and was not added.');
        return;
      }
      if (input.entries.length === 0) {
        notify('This playlist has no accessible entries; nothing was added or marked complete.');
        return;
      }
      if (input.entries.length > 1000) {
        notify('This playlist exceeds the supported 1000-entry limit.');
        return;
      }
      const s = normalizeSnapshotIdentity(input);
      const old = playlists[s.playlistId];
      const rec = reconcileProgress(old, s, progress);
      setProgress(rec.progress);
      if (old) {
        setSegments((prev) => reconcileSegments(old, s, prev));
        setPlaySessions((prev) => reconcilePlaySessions(old, s, prev));
        setQueueState((prev) => ({ ...prev, [s.playlistId]: reconcileQueuePositions(old, s, prev[s.playlistId]) }));
        setModules((prev) => rekeyModules(old, s, prev));
        const d = diffSnapshots(old, s);
        const parts: string[] = [];
        if (d.added.length) parts.push(`${d.added.length} added`);
        if (d.removed.length) parts.push(`${d.removed.length} removed`);
        if (d.moved.length) parts.push(`${d.moved.length} moved`);
        if (d.unresolvedNow.length) parts.push(`${d.unresolvedNow.length} unresolved`);
        if (rec.orphaned) parts.push(`${rec.orphaned} record${rec.orphaned === 1 ? '' : 's'} preserved for review`);
        if (parts.length) {
          setLastDiff(
            `Playlist updated (${s.title}): ${parts.join(', ')}. Progress follows each video identity, not its position.`
            + (rec.orphaned ? ' Unmatched records are available in Reports and are never counted for another video.' : ''),
          );
        }
        setRanges((rs) => rs.map((r) => r.playlistId === s.playlistId
          ? { ...r, status: rangeStatus(r.start, r.end, s.entries.length), snapshotVersion: s.snapshotVersion }
          : r));
        setCheckpoints((cs) => cs.map((c) => c.playlistId === s.playlistId
          ? { ...c, status: rangeStatus(c.start, c.end, s.entries.length), snapshotVersion: s.snapshotVersion }
          : c));
      }
      setPlaylists((prev) => ({ ...prev, [s.playlistId]: s }));
      setMeta((prev) => prev[s.playlistId]
        ? prev
        : { ...prev, [s.playlistId]: { archived: false, addedAt: new Date().toISOString() } });
      setActiveId(s.playlistId);
    },
    removePlaylist: (id) => {
      const plan = playlistRemovalPlan({
        progress,
        ranges,
        checkpoints,
        modules,
        sessions,
        segments,
        playSessions,
        flexGoals,
        queue,
      }, id);
      setPlaylists((p) => { const n = { ...p }; delete n[id]; return n; });
      setMeta((p) => { const n = { ...p }; delete n[id]; return n; });
      setProgress(plan.progress as Record<string, ProgressRecord>);
      setRanges(plan.ranges);
      setCheckpoints(plan.checkpoints);
      setModules(plan.modules);
      setSessions(plan.sessions);
      setSegments(plan.segments);
      setPlaySessions(plan.playSessions);
      setFlexGoals(plan.flexGoals as Goal[]);
      setQueueState(plan.queue);
      setActiveId((a) => (a === id ? null : a));
    },
    renamePlaylist: (id, title) => setMeta((p) => ({ ...p, [id]: { ...(p[id] ?? { archived: false, addedAt: new Date().toISOString() }), customTitle: title } })),
    setArchived: (id, archived) => setMeta((p) => ({ ...p, [id]: { ...(p[id] ?? { addedAt: new Date().toISOString() }), archived } })),
    setActive: (id) => setActiveId(id && playlists[id] ? id : null),

    toggleDone: (playlistId, position, videoId) => {
      const snap = playlists[playlistId];
      const entry = snap?.entries.find((e) => e.position === position);
      if (!snap || !entry || entry.videoId !== videoId) {
        notify('That lesson no longer matches the current playlist. Refresh or review the changed playlist.');
        return;
      }
      const key = identityKey(playlistId, entry.entryId!);
      const existing = findProgressForEntry(progress, playlistId, entry);
      const aliasKey = existing ? Object.keys(progress).find((k) => progress[k] === existing) : undefined;
      const wasDone = isProgressComplete(existing);
      if (wasDone) {
        // Patch completion only. Notes, confidence, revision history, flags and
        // question lists must survive unmarking.
        setProgress((prev) => {
          const next = {
            ...prev,
            [key]: {
              ...(existing ?? { playlistId, position, videoId, entryId: entry.entryId, status: 'in-progress' as const, completedAt: null }),
              playlistId,
              position,
              entryId: entry.entryId,
              videoId,
              completedAt: null,
              status: 'in-progress' as const,
            },
          };
          if (aliasKey && aliasKey !== key) delete next[aliasKey];
          return next;
        });
        return;
      }
      const now = new Date().toISOString();
      setProgress((prev) => {
        const next = {
          ...prev,
          [key]: {
            ...(existing ?? { playlistId, position, videoId, entryId: entry.entryId }),
            playlistId,
            position,
            entryId: entry.entryId,
            videoId,
            completedAt: now,
            status: 'done' as const,
            // A previously verified occurrence stays verified; self-reported
            // completion is always labelled manual.
            source: existing?.source === 'verified' ? 'verified' as const : 'manual' as const,
            orphaned: false,
            reviewReason: undefined,
          },
        };
        if (aliasKey && aliasKey !== key) delete next[aliasKey];
        return next;
      });
      const newKey = `done:${playlistId}:${entry.entryId}`;
      const legacyKey = `done:${playlistId}:${position}:${videoId}`;
      if (!xp.some((e) => e.dedupKey === newKey || e.dedupKey === legacyKey)) {
        awardXp('videoDone', XP_RULES.videoDone, newKey);
      }
    },
    markVerified: (playlistId, position, videoId) => {
      const snap = playlists[playlistId];
      const entry = snap?.entries.find((e) => e.position === position);
      if (!snap || !entry || entry.videoId !== videoId) return;
      const key = identityKey(playlistId, entry.entryId!);
      const now = new Date().toISOString();
      setProgress((prev) => {
        const existing = findProgressForEntry(prev, playlistId, entry);
        const aliasKey = existing ? Object.keys(prev).find((k) => prev[k] === existing) : undefined;
        const next = {
          ...prev,
          [key]: {
            ...(existing ?? { playlistId, position, videoId, entryId: entry.entryId }),
            playlistId,
            position,
            entryId: entry.entryId,
            videoId,
            completedAt: existing?.completedAt ?? now,
            status: 'done' as const,
            source: 'verified' as const,
            verifiedAt: now,
            orphaned: false,
            reviewReason: undefined,
          },
        };
        if (aliasKey && aliasKey !== key) delete next[aliasKey];
        return next;
      });
      const newKey = `done:${playlistId}:${entry.entryId}`;
      const legacyKey = `done:${playlistId}:${position}:${videoId}`;
      if (!xp.some((e) => e.dedupKey === newKey || e.dedupKey === legacyKey)) {
        awardXp('videoDone', XP_RULES.videoDone, newKey);
      }
    },
    markReviewed: (playlistId, position, source = 'revision') => {
      const snap = playlists[playlistId];
      const entry = snap?.entries.find((e) => e.position === position);
      if (!snap || !entry) return;
      const key = identityKey(playlistId, entry.entryId!);
      const now = new Date().toISOString();
      const todayKey = dateKeyInTimezone(new Date(now), prefs.timezone);
      setProgress((prev) => {
        const existing = findProgressForEntry(prev, playlistId, entry);
        const aliasKey = existing ? Object.keys(prev).find((k) => prev[k] === existing) : undefined;
        const review = buildReviewPatch(existing, now, todayKey, source);
        const next = {
          ...prev,
          [key]: {
            ...(existing ?? {
              playlistId,
              position: entry.position,
              videoId: entry.videoId,
              entryId: entry.entryId,
              status: 'in-progress' as const,
              completedAt: null,
            }),
            playlistId,
            position: entry.position,
            entryId: entry.entryId,
            videoId: entry.videoId,
            ...review.patch,
          },
        };
        if (aliasKey && aliasKey !== key) delete next[aliasKey];
        return next;
      });
      // Daily idempotency key: repeated clicks and even a re-render storm
      // cannot duplicate revision XP.
      awardXp('revision', XP_RULES.revisionDone, `rev:${playlistId}:${entry.entryId}:${todayKey}`);
    },
    updateRecord: (key, patch) => setProgress((prev) => {
      // Migrate a legacy position-keyed record (or any alias of the same
      // occurrence) into the canonical identity key instead of creating a
      // second record that hides annotations.
      let aliasKey: string | undefined;
      let base = prev[key];
      if (!base && patch.playlistId && patch.videoId) {
        for (const [k, rec] of Object.entries(prev)) {
          if (k === key || rec.playlistId !== patch.playlistId || rec.videoId !== patch.videoId) continue;
          const sameEntry = patch.entryId
            ? rec.entryId === patch.entryId || (!rec.entryId && rec.position === patch.position)
            : rec.position === patch.position;
          if (sameEntry && !rec.orphaned) {
            aliasKey = k;
            base = rec;
            break;
          }
        }
      }
      const merged: ProgressRecord = {
        ...(base ?? {
          playlistId: patch.playlistId ?? '',
          position: patch.position ?? 0,
          videoId: patch.videoId ?? '',
          status: 'in-progress' as const,
          completedAt: null,
        }),
        ...patch,
      };
      const next = { ...prev, [key]: merged };
      if (aliasKey) delete next[aliasKey];
      return next;
    }),
    deleteProgressRecord: (key) => setProgress((prev) => {
      if (!prev[key]) return prev;
      const n = { ...prev };
      delete n[key];
      return n;
    }),

    saveRange: (r) => setRanges((prev) => [...prev, { ...r, id: uid(), createdAt: new Date().toISOString(), snapshotVersion: playlists[r.playlistId]?.snapshotVersion ?? 1, status: 'valid' }]),
    deleteRange: (id) => setRanges((prev) => prev.filter((r) => r.id !== id)),
    renameRange: (id, label) => setRanges((prev) => prev.map((r) => (r.id === id ? { ...r, label } : r))),
    editRange: (id, start, end) => setRanges((prev) => prev.map((r) => {
      if (r.id !== id) return r;
      const n = playlists[r.playlistId]?.entries.length ?? 0;
      return { ...r, start, end, status: rangeStatus(start, end, n) };
    })),

    saveCheckpoint: (c) => setCheckpoints((prev) => [...prev, { ...c, id: uid(), createdAt: new Date().toISOString(), completedAt: null, snapshotVersion: playlists[c.playlistId]?.snapshotVersion ?? 1, status: 'valid' }]),
    deleteCheckpoint: (id) => setCheckpoints((prev) => prev.filter((c) => c.id !== id)),
    renameCheckpoint: (id, label) => setCheckpoints((prev) => prev.map((c) => (c.id === id ? { ...c, label } : c))),
    editCheckpoint: (id, start, end) => setCheckpoints((prev) => prev.map((c) => {
      if (c.id !== id) return c;
      const n = playlists[c.playlistId]?.entries.length ?? 0;
      return { ...c, start, end, completedAt: null, status: rangeStatus(start, end, n) };
    })),

    saveModule: (m, id) => setModules((prev) => (id ? prev.map((x) => (x.id === id ? { ...m, id } : x)) : [...prev, { ...m, id: uid() }])),
    deleteModule: (id) => setModules((prev) => prev.filter((m) => m.id !== id)),
    moveModule: (id, dir) => setModules((prev) => moveModuleWithinPlaylist(prev, id, dir)),

    addSession: (input) => {
      if (!isRecordableFocusSession(input.activeSec)) {
        notify('A focus session needs at least 10 active seconds.');
        return;
      }
      if (input.clientId && (sessions.some((s) => s.clientId === input.clientId) || sessionKeys.current.has(input.clientId))) {
        return;
      }
      if (input.clientId) sessionKeys.current.add(input.clientId);
      const started = new Date(input.startedAt);
      if (!Number.isFinite(started.getTime())) {
        notify('Focus session has an invalid start time and was not saved.');
        return;
      }
      const finished = input.finishedAt ? new Date(input.finishedAt) : null;
      if (finished && !Number.isFinite(finished.getTime())) {
        notify('Focus session has an invalid finish time and was not saved.');
        return;
      }
      const full: StudySession = {
        ...input,
        id: uid(),
        dateKey: dateKeyInTimezone(started, prefs.timezone),
        elapsedSec: Math.max(input.activeSec, Number.isFinite(input.elapsedSec) ? input.elapsedSec : input.activeSec),
      };
      setSessions((prev) => (full.clientId && prev.some((x) => x.clientId === full.clientId) ? prev : [...prev, full]));
      awardXp('focus', xpForFocusSession(full.activeSec), `focus:${full.clientId ?? full.id}`);
      const activityKey = dateKeyInTimezone(finished ?? started, prefs.timezone);
      awardXp('studyDay', XP_RULES.studyDay, `day:${activityKey}`);
    },
    deleteSession: (id) => setSessions((prev) => prev.filter((s) => s.id !== id)),
    setGoal: (g) => setGoals((prev) => ({ ...prev, [g.dateKey]: g })),
    setPrefs: (patch) => {
      const check = validatePreferencePatch(prefs, patch);
      if (check.errors.length) {
        notify(check.errors[0]);
        return;
      }
      setPrefsState(check.value);
    },
    awardXp,
    clearCelebration: () => setCelebration(null),
    addSegments: (segs) => setSegments((prev) => {
      const ids = new Set(prev.map((s) => s.id));
      const fresh = segs.filter((s) => !ids.has(s.id));
      return fresh.length ? [...prev, ...fresh] : prev;
    }),
    addPlaySession: (s) => setPlaySessions((prev) => [...prev, { ...s, id: uid() }]),
    addManualPlaySession: (s) => setPlaySessions((prev) => [...prev, { ...s, id: uid(), source: 'manual' as const }]),
    setQueue: (playlistId, positions) => setQueueState((prev) => ({ ...prev, [playlistId]: [...new Set(positions)] })),
    saveFlexGoal: (g) => setFlexGoals((prev) => [...prev, { ...g, id: uid(), createdAt: new Date().toISOString(), achievedAt: null, achievedValue: null }]),
    updateFlexGoal: (id, patch) => setFlexGoals((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g))),
    deleteFlexGoal: (id) => setFlexGoals((prev) => prev.filter((g) => g.id !== id)),
    setChallenge: (patch) => setChallengeState((prev) => ({ ...prev, ...patch })),
    setChallengeEnabled: (on) => setChallengeEnabledState(on),
    // NEVER clears real learning data — sim snapshots/history only.
    resetChallenge: () => { setRankHistory([]); },
    pushRank: (r) => setRankHistory((prev) => [...prev.slice(-100), r]),
    setSettings: (patch) => setSettingsState((prev) => sanitizeSettings({ ...prev, ...patch })),

    exportBackup: async () => {
      const state: BackupState = {
        playlists,
        meta,
        activeId,
        progress,
        ranges,
        checkpoints,
        modules,
        sessions,
        goals,
        xp,
        achievements,
        prefs,
        segments,
        playSessions,
        queue,
        flexGoals,
        challenge,
        challengeEnabled,
        rankHistory,
        settings,
      };
      return buildBackup(state);
    },
    importBackup: async (json) => {
      const validated = validateBackup(json);
      if (!validated.ok) throw new Error(validated.errors.join(' '));
      const normalized = normalizeLoadedState(validated.backup.state, defaultPreferences());
      const state = normalized.state;
      const data: Record<string, unknown> = {
        playlists: state.playlists,
        meta: state.meta,
        activeId: state.activeId,
        progress: state.progress,
        ranges: state.ranges,
        checkpoints: state.checkpoints,
        modules: state.modules,
        sessions: state.sessions,
        goals: state.goals,
        xp: state.xp,
        achievements: state.achievements,
        prefs: state.prefs,
        segments: state.segments,
        playSessions: state.playSessions,
        queue: state.queue,
        flexGoals: state.flexGoals,
        challenge: state.challenge,
        challengeEnabled: state.challengeEnabled,
        rankHistory: state.rankHistory,
        settings: state.settings,
      };
      // Single transaction: failure leaves the previous database untouched.
      // Wait for any write already in flight first, then replace atomically.
      if (saveT.current) clearTimeout(saveT.current);
      await writeChain.current;
      await kvReplaceAll(data);
      applyState(state);
      setLastDiff(
        `Backup restored (version ${validated.backup.version}) with all collections replaced atomically.`
        + (validated.backup.warnings.length ? ` ${validated.backup.warnings.join(' ')}` : ''),
      );
      return { warnings: validated.backup.warnings };
    },
    clearAllData: async () => {
      if (saveT.current) clearTimeout(saveT.current);
      await writeChain.current;
      await kvClearAll();
      const defaults = normalizeLoadedState({}, defaultPreferences()).state;
      applyState(defaults);
      setLastDiff(null);
      setCelebration(null);
      try {
        localStorage.removeItem('lq-focus-timer-v1');
        localStorage.removeItem('lq-nav-collapsed');
      } catch {
        /* storage may be unavailable; data is already cleared */
      }
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('lq:data-cleared'));
    },
    clearCacheOnly: async () => {
      // Keep learning records but drop metadata snapshots and positional queue.
      if (saveT.current) clearTimeout(saveT.current);
      await writeChain.current;
      setPlaylists({});
      setActiveId(null);
      setQueueState({});
      await kvSet('playlists', {});
      await kvSet('activeId', null);
      await kvSet('queue', {});
    },
    setLastDiff: (s) => setLastDiff(s),
  }), [ready, loadError, load, playlists, meta, activeId, progress, ranges, checkpoints, modules, sessions, goals, xp, achievements, prefs, lastDiff, celebration, segments, playSessions, queue, flexGoals, challenge, challengeEnabled, rankHistory, settings, applyState, awardXp]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { computePlaylistProgress, computeRangeProgress, rangeDuration, snapshotCompleteness, sumEntries, formatSecondsHHMMSS, computeStreak, summarizeSegments, completionFromCoverage, buildEntryProgressIndex, isProgressComplete };
