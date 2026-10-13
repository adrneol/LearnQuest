import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
} from '../domain/index.js';
import type { PlaybackSegment, Goal } from '../domain/index.js';
import type { ChallengeConfig } from '../domain/competition/competition.js';
import { DEFAULT_CHALLENGE } from '../domain/competition/competition.js';
import type {
  PlaylistSnapshot, ProgressRecord, SavedRange, Checkpoint, StudySession, XpEvent, DayGoal,
  PlaySession, AppSettings,
} from '../domain/index.js';
import { kvGet, kvSet, kvDump, kvClearAll } from '../services/persistence/db.js';

export interface Module {
  id: string;
  playlistId: string;
  name: string;
  positions: number[];
  goalSec?: number;
}

export interface Prefs {
  timezone: string;
  sessionLenMin: number;
  breakMin: number;
  reducedMotion: boolean;
  minViableMin: number;
}

interface PlaylistMeta {
  archived: boolean;
  customTitle?: string;
  addedAt: string;
}

export interface RankSnapshot {
  at: string;
  rank: number;
  of: number;
  metric: string;
}

interface Store {
  ready: boolean;
  playlists: Record<string, PlaylistSnapshot>;
  meta: Record<string, PlaylistMeta>;
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
  importBackup: (json: string) => Promise<void>;
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

/** Eligible current value for a flexible goal from real records only. */
export function goalCurrentValue(
  g: Goal,
  ctx: GoalCtx,
): number {
  const inScopePlaylist = (pid: string) => !g.playlistId || pid === g.playlistId;
  const onDay = (isoMs: number) =>
    !g.dateKey || dateKeyInTimezone(new Date(isoMs), ctx.prefs.timezone) === g.dateKey;
  switch (g.metric) {
    case 'video-count': {
      return Object.values(ctx.progress).filter(
        (p) => p.completedAt && inScopePlaylist(p.playlistId) && (!g.dateKey || dateKeyInTimezone(new Date(p.completedAt), ctx.prefs.timezone) === g.dateKey),
      ).length;
    }
    case 'unique-content': {
      const scoped = ctx.segments.filter((s) => inScopePlaylist(s.playlistId) && onDay(s.wallStartMs));
      // unique coverage per (playlist, position)
      const byKey = new Map<string, PlaybackSegment[]>();
      for (const s of scoped) {
        const k = `${s.playlistId}::${s.position}`;
        const arr = byKey.get(k) ?? [];
        arr.push(s);
        byKey.set(k, arr);
      }
      let total = 0;
      for (const arr of byKey.values()) total += summarizeSegments(arr).uniqueSec;
      return Math.round(total);
    }
    case 'focus-time': {
      return ctx.sessions
        .filter((s) => (!g.playlistId || s.playlistId === g.playlistId) && (!g.dateKey || s.dateKey === g.dateKey))
        .reduce((a, s) => a + s.activeSec, 0);
    }
    case 'playback-time': {
      return ctx.segments
        .filter((s) => inScopePlaylist(s.playlistId) && onDay(s.wallStartMs))
        .reduce((a, s) => a + Math.max(0, Math.round((s.wallEndMs - s.wallStartMs) / 1000)), 0);
    }
    case 'checkpoint': {
      const c = ctx.checkpoints.find((x) => x.id === g.checkpointId);
      if (!c) return 0;
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
const key = (playlistId: string, position: number) => `${playlistId}::${position}`;

const DEFAULT_PREFS: Prefs = {
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
  sessionLenMin: 25,
  breakMin: 5,
  reducedMotion: false,
  minViableMin: 10,
};

const DEFAULT_SETTINGS: AppSettings = { verifiedThreshold: 0.9 };

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [playlists, setPlaylists] = useState<Record<string, PlaylistSnapshot>>({});
  const [meta, setMeta] = useState<Record<string, PlaylistMeta>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, ProgressRecord>>({});
  const [ranges, setRanges] = useState<SavedRange[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [goals, setGoals] = useState<Record<string, DayGoal>>({});
  const [xp, setXp] = useState<XpEvent[]>([]);
  const [achievements, setAchievements] = useState<Record<string, string>>({});
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
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
  const saveT = useRef<any>(null);

  // load
  useEffect(() => {
    (async () => {
      const [pl, m, a, pr, ra, cp, mo, se, go, x, ach, pf, sg, ps, qu, fg, ch, che, rh, st] = await Promise.all([
        kvGet<Record<string, PlaylistSnapshot>>('playlists'),
        kvGet<Record<string, PlaylistMeta>>('meta'),
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
      if (pl) setPlaylists(pl);
      if (m) setMeta(m);
      if (a) setActiveId(a);
      if (pr) setProgress(pr);
      if (ra) setRanges(ra);
      if (cp) setCheckpoints(cp);
      if (mo) setModules(mo);
      if (se) setSessions(se);
      if (go) setGoals(go);
      if (x) setXp(x);
      if (ach) setAchievements(ach);
      if (pf) setPrefsState({ ...DEFAULT_PREFS, ...pf });
      if (sg) setSegments(sg);
      if (ps) setPlaySessions(ps);
      if (qu) setQueueState(qu);
      if (fg) setFlexGoals(fg);
      if (ch) setChallengeState({ ...DEFAULT_CHALLENGE, ...ch });
      if (typeof che === 'boolean') setChallengeEnabledState(che);
      if (rh) setRankHistory(rh);
      if (st) setSettingsState({ ...DEFAULT_SETTINGS, ...st });
      setReady(true);
    })();
  }, []);

  // debounced persist
  useEffect(() => {
    if (!ready) return;
    clearTimeout(saveT.current);
    saveT.current = setTimeout(() => {
      kvSet('playlists', playlists);
      kvSet('meta', meta);
      kvSet('activeId', activeId);
      kvSet('progress', progress);
      kvSet('ranges', ranges);
      kvSet('checkpoints', checkpoints);
      kvSet('modules', modules);
      kvSet('sessions', sessions);
      kvSet('goals', goals);
      kvSet('xp', xp);
      kvSet('achievements', achievements);
      kvSet('prefs', prefs);
      kvSet('segments', segments);
      kvSet('playSessions', playSessions);
      kvSet('queue', queue);
      kvSet('flexGoals', flexGoals);
      kvSet('challenge', challenge);
      kvSet('challengeEnabled', challengeEnabled);
      kvSet('rankHistory', rankHistory);
      kvSet('settings', settings);
    }, 300);
  }, [ready, playlists, meta, activeId, progress, ranges, checkpoints, modules, sessions, goals, xp, achievements, prefs, segments, playSessions, queue, flexGoals, challenge, challengeEnabled, rankHistory, settings]);

  const awardXp = (reason: string, points: number, dedupKey: string) => {
    setXp((prev) => {
      if (prev.some((e) => e.dedupKey === dedupKey)) return prev;
      return [...prev, { id: uid(), reason, points, dedupKey, at: new Date().toISOString() }];
    });
  };

  // achievement evaluation runs when progress/sessions/checkpoints change
  useEffect(() => {
    if (!ready || !activeId || !playlists[activeId]) return;
    const snap = playlists[activeId];
    const prog = computePlaylistProgress(snap, progress);
    const focusedSec = sessions.reduce((a, s) => a + s.activeSec, 0);
    // Distinct active days from interval attribution (cross-midnight aware),
    // not stored labels — a session split across midnight counts both days.
    const days = activeFocusDayKeys(sessions, prefs.timezone).size;
    const cpsDone = checkpoints.filter((c) => c.playlistId === activeId && c.completedAt).length;
    const revDone = Object.values(progress).filter((p) => p.playlistId === activeId && (p as any).revisionDoneAt).length;
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
    ready, playlists, meta, activeId, progress, ranges, checkpoints, modules, sessions, goals, xp, achievements, prefs, lastDiff, celebration,
    segments, playSessions, queue, flexGoals, challenge, challengeEnabled, rankHistory, settings,

    addSnapshot: (s) => {
      setPlaylists((prev) => {
        const old = prev[s.playlistId];
        if (old) {
          const d = diffSnapshots(old, s);
          const parts: string[] = [];
          if (d.added.length) parts.push(`${d.added.length} added`);
          if (d.removed.length) parts.push(`${d.removed.length} removed`);
          if (d.moved.length) parts.push(`${d.moved.length} moved`);
          if (d.unresolvedNow.length) parts.push(`${d.unresolvedNow.length} unresolved`);
          if (parts.length) setLastDiff(`Playlist updated (${s.title}): ${parts.join(', ')}. Saved ranges/checkpoints kept with original boundaries — review any flagged needsReview.`);
          // mark ranges/checkpoints needsReview without clamping
          setRanges((rs) => rs.map((r) => r.playlistId === s.playlistId ? { ...r, status: rangeStatus(r.start, r.end, s.entries.length) as any, snapshotVersion: s.snapshotVersion } : r));
          setCheckpoints((cs) => cs.map((c) => c.playlistId === s.playlistId ? { ...c, status: rangeStatus(c.start, c.end, s.entries.length) as any, snapshotVersion: s.snapshotVersion } : c));
        }
        return { ...prev, [s.playlistId]: s };
      });
      setMeta((prev) => prev[s.playlistId] ? prev : { ...prev, [s.playlistId]: { archived: false, addedAt: new Date().toISOString() } });
      setActiveId(s.playlistId);
    },
    removePlaylist: (id) => {
      setPlaylists((p) => { const n = { ...p }; delete n[id]; return n; });
      setMeta((p) => { const n = { ...p }; delete n[id]; return n; });
      setRanges((rs) => rs.filter((r) => r.playlistId !== id));
      setCheckpoints((cs) => cs.filter((c) => c.playlistId !== id));
      setModules((ms) => ms.filter((m) => m.playlistId !== id));
      setActiveId((a) => (a === id ? null : a));
    },
    renamePlaylist: (id, title) => setMeta((p) => ({ ...p, [id]: { ...(p[id] ?? { archived: false, addedAt: new Date().toISOString() }), customTitle: title } })),
    setArchived: (id, archived) => setMeta((p) => ({ ...p, [id]: { ...(p[id] ?? { addedAt: new Date().toISOString() }), archived } })),
    setActive: (id) => setActiveId(id),

    toggleDone: (playlistId, position, videoId) => {
      const k = key(playlistId, position);
      setProgress((prev) => {
        const cur = prev[k];
        const isDone = cur?.status === 'done' && cur.completedAt;
        if (isDone) {
          const n = { ...prev };
          delete n[k];
          return n;
        }
        const now = new Date().toISOString();
        // Checkbox completion is explicitly MANUAL — never misrepresented as verified.
        return { ...prev, [k]: { playlistId, position, videoId, completedAt: now, status: 'done', source: 'manual' } };
      });
      // XP dedup (no double reward)
      awardXp('videoDone', XP_RULES.videoDone, `done:${playlistId}:${position}:${videoId}`);
    },
    markVerified: (playlistId, position, videoId) => {
      const k = key(playlistId, position);
      const now = new Date().toISOString();
      setProgress((prev) => ({
        ...prev,
        [k]: { ...(prev[k] ?? { playlistId, position, videoId, status: 'done' as const }), playlistId, position, videoId, completedAt: prev[k]?.completedAt ?? now, status: 'done' as const, source: 'verified' as const, verifiedAt: now },
      }));
      awardXp('videoDone', XP_RULES.videoDone, `done:${playlistId}:${position}:${videoId}`);
    },
    updateRecord: (k2, patch) => setProgress((prev) => {
      const base: ProgressRecord = prev[k2] ?? { playlistId: '', position: 0, videoId: '', status: 'in-progress', completedAt: null };
      return { ...prev, [k2]: { ...base, ...patch } as ProgressRecord };
    }),

    saveRange: (r) => setRanges((prev) => [...prev, { ...r, id: uid(), createdAt: new Date().toISOString(), snapshotVersion: 1, status: 'valid' }]),
    deleteRange: (id) => setRanges((prev) => prev.filter((r) => r.id !== id)),
    renameRange: (id, label) => setRanges((prev) => prev.map((r) => (r.id === id ? { ...r, label } : r))),
    editRange: (id, start, end) => setRanges((prev) => prev.map((r) => (r.id === id ? { ...r, start, end } : r))),

    saveCheckpoint: (c) => setCheckpoints((prev) => [...prev, { ...c, id: uid(), createdAt: new Date().toISOString(), completedAt: null, snapshotVersion: 1, status: 'valid' }]),
    deleteCheckpoint: (id) => setCheckpoints((prev) => prev.filter((c) => c.id !== id)),
    renameCheckpoint: (id, label) => setCheckpoints((prev) => prev.map((c) => (c.id === id ? { ...c, label } : c))),
    editCheckpoint: (id, start, end) => setCheckpoints((prev) => prev.map((c) => (c.id === id ? { ...c, start, end, completedAt: null } : c))),

    saveModule: (m, id) => setModules((prev) => (id ? prev.map((x) => (x.id === id ? { ...m, id } : x)) : [...prev, { ...m, id: uid() }])),
    deleteModule: (id) => setModules((prev) => prev.filter((m) => m.id !== id)),
    moveModule: (id, dir) => setModules((prev) => {
      const i = prev.findIndex((m) => m.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    }),

    addSession: (s) => {
      const now = new Date();
      const dateKey = dateKeyInTimezone(now, prefs.timezone);
      const full: StudySession = { ...s, id: uid(), dateKey };
      setSessions((prev) => [...prev, full]);
      awardXp('focus', xpForFocusSession(s.activeSec), `focus:${full.id}`);
      // study-day XP (one per day)
      const daySet = new Set([...sessions.map((x) => x.dateKey), dateKey]);
      void daySet;
      awardXp('studyDay', XP_RULES.studyDay, `day:${dateKey}`);
    },
    deleteSession: (id) => setSessions((prev) => prev.filter((s) => s.id !== id)),
    setGoal: (g) => setGoals((prev) => ({ ...prev, [g.dateKey]: g })),
    setPrefs: (p) => setPrefsState((prev) => ({ ...prev, ...p })),
    awardXp,
    clearCelebration: () => setCelebration(null),
    addSegments: (segs) => setSegments((prev) => {
      const ids = new Set(prev.map((s) => s.id));
      const fresh = segs.filter((s) => !ids.has(s.id));
      return fresh.length ? [...prev, ...fresh] : prev;
    }),
    addPlaySession: (s) => setPlaySessions((prev) => [...prev, { ...s, id: uid() }]),
    addManualPlaySession: (s) => setPlaySessions((prev) => [...prev, { ...s, id: uid(), source: 'manual' as const }]),
    setQueue: (playlistId, positions) => setQueueState((prev) => ({ ...prev, [playlistId]: positions })),
    saveFlexGoal: (g) => setFlexGoals((prev) => [...prev, { ...g, id: uid(), createdAt: new Date().toISOString(), achievedAt: null, achievedValue: null }]),
    updateFlexGoal: (id, patch) => setFlexGoals((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g))),
    deleteFlexGoal: (id) => setFlexGoals((prev) => prev.filter((g) => g.id !== id)),
    setChallenge: (patch) => setChallengeState((prev) => ({ ...prev, ...patch })),
    setChallengeEnabled: (on) => setChallengeEnabledState(on),
    // NEVER clears real learning data — sim snapshots/history only.
    resetChallenge: () => { setRankHistory([]); },
    pushRank: (r) => setRankHistory((prev) => [...prev.slice(-100), r]),
    setSettings: (patch) => setSettingsState((prev) => ({ ...prev, ...patch })),

    exportBackup: async () => {
      const dump = await kvDump();
      const payload = { version: 2, exportedAt: new Date().toISOString(), data: dump };
      return JSON.stringify(payload, null, 2);
    },
    importBackup: async (json) => {
      const parsed = JSON.parse(json);
      const data = parsed?.data ?? parsed;
      const get = (k: string) => data?.[k] ?? data?.data?.[k];
      if (get('playlists')) setPlaylists(get('playlists'));
      if (get('progress')) setProgress(get('progress'));
      if (get('ranges')) setRanges(get('ranges'));
      if (get('checkpoints')) setCheckpoints(get('checkpoints'));
      if (get('modules')) setModules(get('modules'));
      if (get('sessions')) setSessions(get('sessions'));
      if (get('goals')) setGoals(get('goals'));
      if (get('xp')) setXp(get('xp'));
      if (get('achievements')) setAchievements(get('achievements'));
      if (get('prefs')) setPrefsState({ ...DEFAULT_PREFS, ...get('prefs') });
      if (get('meta')) setMeta(get('meta'));
      if (get('activeId')) setActiveId(get('activeId'));
      // v2 keys (absent in v1 backups — safely skipped)
      if (get('segments')) setSegments(get('segments'));
      if (get('playSessions')) setPlaySessions(get('playSessions'));
      if (get('queue')) setQueueState(get('queue'));
      if (get('flexGoals')) setFlexGoals(get('flexGoals'));
      if (get('challenge')) setChallengeState({ ...DEFAULT_CHALLENGE, ...get('challenge') });
      if (typeof get('challengeEnabled') === 'boolean') setChallengeEnabledState(get('challengeEnabled'));
      if (get('rankHistory')) setRankHistory(get('rankHistory'));
      if (get('settings')) setSettingsState({ ...DEFAULT_SETTINGS, ...get('settings') });
    },
    clearAllData: async () => {
      await kvClearAll();
      setPlaylists({}); setMeta({}); setActiveId(null); setProgress({}); setRanges([]);
      setCheckpoints([]); setModules([]); setSessions([]); setGoals({}); setXp([]); setAchievements({});
      setSegments([]); setPlaySessions([]); setQueueState({}); setFlexGoals([]);
      setChallengeState(DEFAULT_CHALLENGE); setChallengeEnabledState(false); setRankHistory([]);
      setSettingsState(DEFAULT_SETTINGS);
    },
    clearCacheOnly: async () => {
      // keep progress, drop playlist metadata snapshots only (user re-adds)
      setPlaylists({}); setActiveId(null);
      await kvSet('playlists', {});
      await kvSet('activeId', null);
    },
    setLastDiff: (s) => setLastDiff(s),
  }), [ready, playlists, meta, activeId, progress, ranges, checkpoints, modules, sessions, goals, xp, achievements, prefs, lastDiff, celebration, segments, playSessions, queue, flexGoals, challenge, challengeEnabled, rankHistory, settings]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { computePlaylistProgress, computeRangeProgress, rangeDuration, snapshotCompleteness, sumEntries, formatSecondsHHMMSS, computeStreak, summarizeSegments, completionFromCoverage };
