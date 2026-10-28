import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { kvGet, kvSet, kvClearAll, kvReplaceAll, kvDump } from '../services/persistence/db.js';
import { buildBackup, validateBackup, type BackupState, type BackupMeta } from '../services/persistence/backup.js';
import { notify } from '../services/notifications/notify.js';
import { setCsrfToken } from '../services/api/http.js';
import { broadcastAuthSignOut, subscribeAuthSignOut, type AuthSyncReason } from './authSync.js';
import {
  type AuthConfig, type AuthUser, type AccountSession,
  archivePlaylistApi, changePassword as changePasswordApi, completeOnboarding as completeOnboardingApi,
  deleteAccount as deleteAccountApi, deletePlaylistApi, downloadAccountExport, fetchAccountData,
  fetchSession, importAccountBackup, listAccountSessions, logout as logoutApi,
  logoutAll as logoutAllApi, migrateLocalData, passwordLogin, putAccountCollection,
  requestEmailChange as requestEmailChangeApi,
  restorePlaylistApi, revokeAccountSession, startGoogleAuth, updateAccountPreferences as updateAccountPreferencesApi,
  updateProfile as updateProfileApi,
} from '../services/api/authApi.js';
import {
  AuthScreens, OnboardingScreen, SetupRequiredScreen, AccountErrorScreen,
  PasswordResetScreen, EmailVerificationScreen,
} from '../features/auth/AuthScreens.js';

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
  renamePlaylist: (id: string, title: string) => void;
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
  // Cloud account mode (local mode keeps the existing IndexedDB test path)
  mode: 'local' | 'cloud';
  authReady: boolean;
  setup: AuthConfig | null;
  authUser: AuthUser | null;
  authError: string | null;
  /** Dismiss a cross-tab session notice when entering a public recovery screen. */
  clearAuthNotice: () => void;
  syncStatus: 'idle' | 'saving' | 'saved' | 'error' | 'conflict';
  syncError: string | null;
  serverVersion: number;
  migrationAvailable: boolean;
  migrationSummary: string | null;
  migrationError: string | null;
  signInWithPassword: (identifier: string, password: string) => Promise<void>;
  signInWithGoogle: (intent: 'login' | 'register') => Promise<void>;
  completeAccountSetup: (input: {
    username: string; displayName: string; password: string; timezone?: string;
    sessionLenMin?: number; breakMin?: number; minViableMin?: number;
  }) => Promise<void>;
  signOut: (allDevices?: boolean) => Promise<void>;
  refreshSession: () => Promise<void>;
  updateProfile: (input: { username?: string; displayName?: string }) => Promise<void>;
  updateAccountPreferences: (input: { timezone?: string; sessionLenMin?: number; breakMin?: number; minViableMin?: number }) => Promise<void>;
  changeAccountPassword: (currentPassword: string | null, newPassword: string) => Promise<void>;
  requestEmailChange: (newEmail: string, password?: string) => Promise<{
    ok: boolean; email: string; expiresInMin: number; message: string;
  }>;
  listAccountSessions: () => Promise<AccountSession[]>;
  revokeAccountSession: (sessionId: string) => Promise<void>;
  deleteAccount: (confirmPhrase: string, password?: string) => Promise<void>;
  exportAccountData: () => Promise<void>;
  archivePlaylistManaged: (playlistId: string) => Promise<void>;
  restorePlaylistManaged: (playlistId: string) => Promise<void>;
  deletePlaylistManaged: (playlistId: string, confirmTitle: string) => Promise<void>;
  migrateLocalDataNow: () => Promise<void>;
  exportLegacyBackup: () => Promise<void>;
  removeLocalLegacyData: () => Promise<void>;
  retryCloudSave: () => void;
  reloadCloudData: () => Promise<void>;
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

const DEFAULT_MODE: 'local' | 'cloud' = import.meta.env.MODE === 'test' ? 'local' : 'cloud';

const REMOTE_SIGN_OUT_COPY: Record<AuthSyncReason, string> = {
  'sign-out': 'You were signed out in another tab. Sign in again to continue.',
  'password-reset': 'Your password was reset in another tab, so every session was signed out. Sign in again with your new password.',
  'email-change': 'Your account email was changed in another tab, so every session was signed out. Sign in again with the new address.',
  'account-deleted': 'This account was deleted in another tab. No LearnQuest data remains for it.',
};

interface EmailActionRoute {
  kind: 'reset' | 'verify';
  token: string | null;
}

/**
 * Email links carry the opaque token in the URL fragment, so it is never sent
 * to Vercel, Render, logs, or analytics. Capture it once and replace the URL
 * immediately to remove it from browser history.
 */
function readEmailActionRoute(): EmailActionRoute | null {
  if (typeof window === 'undefined') return null;
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  if (path !== 'reset-password' && path !== 'verify-email') return null;
  const token = new URLSearchParams(query).get('token');
  return { kind: path === 'reset-password' ? 'reset' : 'verify', token: token || null };
}

function stripEmailActionToken(kind: EmailActionRoute['kind']): void {
  if (typeof window === 'undefined') return;
  const path = kind === 'reset' ? 'reset-password' : 'verify-email';
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/${path}`);
}

const CLOUD_COLLECTIONS = [
  'playlists', 'meta', 'activeId', 'progress', 'ranges', 'checkpoints', 'modules',
  'sessions', 'goals', 'xp', 'achievements', 'segments', 'playSessions', 'queue',
  'flexGoals', 'challenge', 'challengeEnabled', 'rankHistory', 'settings', 'prefs',
] as const;
type CloudCollection = (typeof CLOUD_COLLECTIONS)[number];

function collectionItems(state: LoadedState, name: CloudCollection): unknown {
  return (state as any)[name];
}

function cloudPayload(state: LoadedState): Record<CloudCollection, unknown> {
  const out = {} as Record<CloudCollection, unknown>;
  for (const name of CLOUD_COLLECTIONS) out[name] = collectionItems(state, name);
  return out;
}

function cloudFingerprints(state: LoadedState): Record<string, string> {
  const payload = cloudPayload(state);
  const out: Record<string, string> = {};
  for (const name of CLOUD_COLLECTIONS) out[name] = JSON.stringify(payload[name]);
  return out;
}

function legacyHasData(dump: Record<string, unknown>): boolean {
  const playlists = dump.playlists as Record<string, unknown> | undefined;
  const progress = dump.progress as Record<string, unknown> | undefined;
  const sessions = dump.sessions as unknown[] | undefined;
  const ranges = dump.ranges as unknown[] | undefined;
  return Boolean(
    (playlists && Object.keys(playlists).length > 0)
    || (progress && Object.keys(progress).length > 0)
    || (sessions && sessions.length > 0)
    || (ranges && ranges.length > 0),
  );
}

function downloadJson(name: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function focusKeysForPlaylist(sessions: { playlistId: string | null; clientId?: string; id?: string }[], playlistId: string): Set<string> {
  return new Set(
    sessions
      .filter((s) => s.playlistId === playlistId)
      .map((s) => `focus:${s.clientId || s.id || ''}`),
  );
}

function xpAttributableToPlaylist(
  dedupKey: string,
  playlistId: string,
  checkpointIds: Set<string>,
  goalIds: Set<string>,
  focusKeys: Set<string>,
): boolean {
  if (
    dedupKey.startsWith(`done:${playlistId}:`)
    || dedupKey.startsWith(`rev:${playlistId}:`)
    || dedupKey.startsWith(`ach:${playlistId}:`)
    || dedupKey.startsWith(`code:${playlistId}:`)
    || dedupKey.startsWith(`ex:${playlistId}:`)
    || dedupKey.startsWith(`built:${playlistId}:`)
  ) return true;
  if (dedupKey.startsWith('cp:')) return checkpointIds.has(dedupKey.slice(3).split(':')[0]);
  if (dedupKey.startsWith('goal:')) return goalIds.has(dedupKey.slice(5).split(':')[0]);
  if (dedupKey.startsWith('focus:')) return focusKeys.has(dedupKey);
  return false;
}

export function StoreProvider({ children, mode: modeProp }: { children: React.ReactNode; mode?: 'local' | 'cloud' }) {
  const mode = modeProp ?? DEFAULT_MODE;
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
  const [authReady, setAuthReady] = useState(mode === 'local');
  const [actionRoute, setActionRoute] = useState<EmailActionRoute | null>(() => readEmailActionRoute());
  const [setup, setSetup] = useState<AuthConfig | null>(null);
  const [authUser, setAuthUserState] = useState<AuthUser | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'conflict'>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [serverVersion, setServerVersion] = useState(0);
  const [migrationAvailable, setMigrationAvailable] = useState(false);
  const [migrationSummary, setMigrationSummary] = useState<string | null>(null);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [saveNonce, setSaveNonce] = useState(0);
  const saveT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeChain = useRef<Promise<void>>(Promise.resolve());
  const loadAttempt = useRef(0);
  const serverVersionRef = useRef(0);
  const lastSyncedRef = useRef<Record<string, string>>({});
  const migrationIdRef = useRef<string | null>(null);
  const cloudUserRef = useRef<string | null>(null);
  // The latest authenticated account, available synchronously to the
  // BroadcastChannel/storage listener. A passive effect can miss a sign-out
  // that arrives immediately after the authenticated UI renders.
  const authUserRef = useRef<AuthUser | null>(null);
  // Invalidates an in-flight cloud load after sign-out or an account switch so
  // a late response can never apply the previous account's data.
  const cloudLoadGeneration = useRef(0);
  // Invalidates in-flight session/login/onboarding responses after a local or
  // cross-tab sign-out so a stale response cannot repopulate the account.
  const authEpoch = useRef(0);
  // Client-generated session ids are a second idempotency barrier in memory:
  // two finish clicks in one tick cannot both pass the stale `sessions` closure.
  const sessionKeys = useRef<Set<string>>(new Set());

  useLayoutEffect(() => {
    authUserRef.current = authUser;
  }, [authUser]);

  useEffect(() => {
    if (actionRoute) stripEmailActionToken(actionRoute.kind);
    // A reset/verification link is a public, standalone destination. A stale
    // cross-tab sign-out notice from the workspace must never follow it here.
    if (actionRoute) setSessionNotice(null);
  }, [actionRoute]);

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

  const resetAccountState = useCallback(() => {
    cloudLoadGeneration.current += 1;
    cloudUserRef.current = null;
    applyState(normalizeLoadedState({}, defaultPreferences()).state);
    lastSyncedRef.current = {};
    serverVersionRef.current = 0;
    setServerVersion(0);
    setSyncStatus('idle');
    setSyncError(null);
    setMigrationAvailable(false);
    setMigrationSummary(null);
    setMigrationError(null);
    setLastDiff(null);
    setCelebration(null);
  }, [applyState]);

  /**
   * Leave a standalone reset/verification link. This must be an in-app state
   * transition, not `location.assign('/#/auth')`: that is only a same-document
   * hash change, so the action route stayed mounted and the button appeared
   * dead. Every pending authentication/data response is invalidated, the old
   * session is not restored, and the reset entry is replaced so Back cannot
   * reopen a dead recovery screen.
   */
  const leaveEmailAction = useCallback((destination: 'signin' | 'forgot') => {
    authEpoch.current += 1;
    if (saveT.current) clearTimeout(saveT.current);
    cloudUserRef.current = null;
    cloudLoadGeneration.current += 1;
    setCsrfToken(null);
    resetAccountState();
    setAuthUserState(null);
    setReady(false);
    setAuthReady(true);
    setAuthError(null);
    setSessionNotice(null);
    sessionKeys.current.clear();
    try { localStorage.removeItem('lq-focus-timer-v1'); } catch { /* unavailable */ }
    const hash = destination === 'forgot' ? '#/auth?mode=forgot' : '#/auth';
    if (typeof window !== 'undefined') {
      const target = `${window.location.pathname}${window.location.search}${hash}`;
      try {
        window.history.replaceState(null, '', target);
      } catch {
        // The UI state change below still removes the recovery screen.
        window.location.hash = hash;
      }
    }
    setActionRoute(null);
  }, [resetAccountState]);

  /**
   * Drop every client-side trace of an authenticated account after the server
   * has rejected or revoked the session. In-flight responses are invalidated
   * before state is cleared so a late account load, save, or login cannot
   * resurrect authenticated UI.
   */
  const clearLocalSession = useCallback((notice: string | null) => {
    authEpoch.current += 1;
    if (saveT.current) clearTimeout(saveT.current);
    cloudLoadGeneration.current += 1;
    cloudUserRef.current = null;
    setCsrfToken(null);
    resetAccountState();
    setAuthUserState(null);
    setReady(false);
    setAuthReady(true);
    setSessionNotice(notice);
    setAuthError(null);
    sessionKeys.current.clear();
    try { localStorage.removeItem('lq-focus-timer-v1'); } catch { /* unavailable */ }
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('lq:data-cleared'));
  }, [resetAccountState]);

  const applyRemoteSignOut = useCallback((reason: AuthSyncReason) => {
    // The broadcast is only a UI signal, but no late response may repopulate it.
    // A tab that had an authenticated account has a session to lose. A public
    // recovery screen has no account and must never receive this notice.
    const hadAuthenticatedSession = authUserRef.current !== null || cloudUserRef.current !== null;
    clearLocalSession(hadAuthenticatedSession ? REMOTE_SIGN_OUT_COPY[reason] : null);
  }, [clearLocalSession]);

  const clearAuthNotice = useCallback(() => setSessionNotice(null), []);

  const loadCloud = useCallback(async (user: AuthUser) => {
    const generation = ++cloudLoadGeneration.current;
    setLoadError(null);
    setReady(false);
    try {
      const { state, version } = await fetchAccountData();
      // Signing out or switching accounts while the request was in flight must
      // discard the late response instead of exposing the previous identity's
      // learning data or overwriting the next account's state.
      if (generation !== cloudLoadGeneration.current) return;
      const normalized = normalizeLoadedState(state as Partial<LoadedState>, defaultPreferences());
      applyState(normalized.state);
      serverVersionRef.current = version;
      setServerVersion(version);
      lastSyncedRef.current = cloudFingerprints(normalized.state);
      cloudUserRef.current = user.userId;
      setSyncStatus('idle');
      setSyncError(null);
      setReady(true);
    } catch (e: any) {
      if (generation !== cloudLoadGeneration.current) return;
      setLoadError(e?.message ?? 'LearnQuest could not load your cloud learning data. Nothing was overwritten; retry the load.');
      setReady(false);
    }
  }, [applyState]);

  const bootstrap = useCallback(async () => {
    const epoch = authEpoch.current;
    setAuthReady(false);
    setAuthError(null);
    try {
      const session = await fetchSession();
      if (epoch !== authEpoch.current) return;
      setSetup(session);
      if (session.authenticated && session.user) {
        setAuthUserState(session.user);
        if (session.user.onboardingComplete) {
          await loadCloud(session.user);
        } else {
          // A pending Google registration is not an empty dashboard. Keep
          // account data uninitialized until the onboarding API succeeds.
          resetAccountState();
          setReady(false);
        }
      } else {
        resetAccountState();
        setAuthUserState(null);
        setReady(false);
      }
    } catch (e: any) {
      if (epoch !== authEpoch.current) return;
      setAuthError(e?.message ?? 'The LearnQuest account service is unreachable. Check the connection and retry.');
      setReady(false);
    } finally {
      if (epoch === authEpoch.current) setAuthReady(true);
    }
  }, [loadCloud, resetAccountState]);

  useEffect(() => {
    if (mode === 'local') void load();
    else void bootstrap();
  }, [mode, load, bootstrap]);

  useEffect(() => {
    if (mode !== 'cloud') return;
    // A server-rejected session is an authentication state, not an account
    // data outage. Clear all account state and show the sign-in form with a
    // scoped notice instead of the misleading "account data unavailable" card.
    const expired = () => clearLocalSession('Your session ended or was signed out elsewhere. Sign in again to continue.');
    window.addEventListener('lq:auth-expired', expired);
    return () => window.removeEventListener('lq:auth-expired', expired);
  }, [mode, clearLocalSession]);

  // Same-origin tabs clear their authenticated UI immediately after an
  // ordinary sign-out, password reset, verified email change, or deletion.
  // The event contains no tokens or account data; each tab still relies on the
  // server for its next authenticated request.
  useEffect(() => {
    if (mode !== 'cloud') return;
    return subscribeAuthSignOut((reason) => applyRemoteSignOut(reason));
  }, [mode, applyRemoteSignOut]);

  // Detect unclaimed legacy IndexedDB data only AFTER authentication. The
  // login screen never reads or displays learning records. A claim made by a
  // different account suppresses the offer so data can never be inherited.
  useEffect(() => {
    if (mode !== 'cloud' || !ready || !authUser) return;
    let cancelled = false;
    void (async () => {
      try {
        const rawClaim = localStorage.getItem('lq-legacy-claim-v1');
        if (rawClaim) {
          let claim: { userId?: string } | null = null;
          try { claim = JSON.parse(rawClaim); } catch { claim = null; }
          if (claim?.userId && claim.userId !== authUser.userId) {
            setMigrationAvailable(false);
            return;
          }
          if (claim?.userId === authUser.userId) {
            setMigrationAvailable(false);
            return;
          }
        }
        const dump = await kvDump();
        if (!cancelled) setMigrationAvailable(legacyHasData(dump));
      } catch {
        // A legacy read failure must not affect cloud data.
      }
    })();
    return () => { cancelled = true; };
  }, [mode, ready, authUser]);

  // debounced persist. Writes are best-effort per key: a quota failure on one
  // key must not break the session, and the user gets one actionable notice.
  const persistWarned = useRef(false);
  useEffect(() => {
    if (mode !== 'local') return;
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
  }, [mode, ready, playlists, meta, activeId, progress, ranges, checkpoints, modules, sessions, goals, xp, achievements, prefs, segments, playSessions, queue, flexGoals, challenge, challengeEnabled, rankHistory, settings]);

  // Cloud persistence: only changed collections are sent, sequentially, with
  // the server's optimistic version. Success is shown only after every write
  // has been confirmed. IndexedDB is never written in this mode.
  useEffect(() => {
    if (mode !== 'cloud' || !ready || !authUser) return;
    if (saveT.current) clearTimeout(saveT.current);
    saveT.current = setTimeout(() => {
      const state: LoadedState = {
        playlists, meta, activeId, progress, ranges, checkpoints, modules, sessions, goals,
        xp, achievements, prefs, segments, playSessions, queue, flexGoals, challenge,
        challengeEnabled, rankHistory, settings,
      };
      const payload = cloudPayload(state);
      const userId = authUser.userId;
      const changed = CLOUD_COLLECTIONS.filter((name) => JSON.stringify(payload[name]) !== lastSyncedRef.current[name]);
      if (changed.length === 0) {
        if (cloudUserRef.current === userId) setSyncStatus('saved');
        return;
      }
      const run = (async () => {
        if (cloudUserRef.current !== userId) return;
        setSyncStatus('saving');
        setSyncError(null);
        let version = serverVersionRef.current;
        try {
          for (const name of changed) {
            // A sign-out or account switch must stop queued writes from the
            // previous account. The server still enforces the session owner,
            // but the client must not deliberately send stale data.
            if (cloudUserRef.current !== userId) return;
            const result = await putAccountCollection(name, payload[name], version);
            if (cloudUserRef.current !== userId) return;
            version = result.version;
            serverVersionRef.current = version;
            setServerVersion(version);
            lastSyncedRef.current[name] = JSON.stringify(payload[name]);
          }
          setSyncStatus('saved');
        } catch (e: any) {
          if (cloudUserRef.current !== userId) return;
          setSyncStatus(e?.code === 'VERSION_CONFLICT' ? 'conflict' : 'error');
          setSyncError(
            e?.code === 'VERSION_CONFLICT'
              ? 'Another session changed your account data. Reload account data before making more changes; nothing was silently overwritten.'
              : (e?.message ?? 'Your changes were not saved to the server. Retry the save.'),
          );
        }
      })();
      writeChain.current = run.catch(() => undefined);
    }, 350);
    return () => {
      if (saveT.current) clearTimeout(saveT.current);
    };
  }, [mode, ready, authUser, saveNonce, playlists, meta, activeId, progress, ranges, checkpoints, modules, sessions, goals, xp, achievements, prefs, segments, playSessions, queue, flexGoals, challenge, challengeEnabled, rankHistory, settings]);

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
    ready, loadError, retryLoad: () => {
      if (mode === 'cloud') {
        if (authUser) void loadCloud(authUser);
        else void bootstrap();
      } else {
        void load();
      }
    },
    playlists, meta, activeId, progress, ranges, checkpoints, modules, sessions, goals, xp, achievements, prefs, lastDiff, celebration,
    segments, playSessions, queue, flexGoals, challenge, challengeEnabled, rankHistory, settings,
    mode, authReady, setup, authUser, authError, clearAuthNotice, syncStatus, syncError, serverVersion,
    migrationAvailable, migrationSummary, migrationError,

    signInWithPassword: async (identifier, password) => {
      // The server is the only authentication authority. Do not set an
      // authenticated user or write account data until it confirms both the
      // account and the password. The login response is not a configuration
      // payload and must never overwrite `setup`.
      const epoch = authEpoch.current;
      const res = await passwordLogin(identifier, password);
      if (epoch !== authEpoch.current) {
        throw new Error('A sign-out happened in another tab while this request was in progress. Sign in again.');
      }
      cloudUserRef.current = null;
      setAuthError(null);
      setSessionNotice(null);
      setAuthUserState(res.user);
      await loadCloud(res.user);
    },
    signInWithGoogle: async (intent) => {
      await startGoogleAuth(intent);
    },
    completeAccountSetup: async (input) => {
      const epoch = authEpoch.current;
      const res = await completeOnboardingApi(input);
      if (epoch !== authEpoch.current) {
        throw new Error('A sign-out happened in another tab while setup was completing. Sign in again.');
      }
      cloudUserRef.current = null;
      setAuthUserState(res.user);
      setAuthError(null);
      setSessionNotice(null);
      await loadCloud(res.user);
    },
    signOut: async (allDevices = false) => {
      // Cancel a debounced save and invalidate any in-flight load or login
      // before the session is revoked, so a late response cannot repopulate
      // the UI after sign-out.
      authEpoch.current += 1;
      if (saveT.current) clearTimeout(saveT.current);
      cloudUserRef.current = null;
      cloudLoadGeneration.current += 1;
      let serverError: string | null = null;
      try {
        if (allDevices) await logoutAllApi();
        else await logoutApi();
      } catch (e: any) {
        serverError = e?.message ?? 'The server could not confirm session revocation.';
      } finally {
        resetAccountState();
        setAuthUserState(null);
        setReady(false);
        setAuthReady(true);
        setSessionNotice(null);
        setSetup((prev) => prev);
        cloudUserRef.current = null;
        sessionKeys.current.clear();
        try {
          localStorage.removeItem('lq-focus-timer-v1');
        } catch { /* unavailable */ }
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('lq:data-cleared'));
      }
      if (serverError) {
        notify(`This device view was cleared, but the server could not confirm sign-out. Your session may still be active; reload and sign out again. ${serverError}`);
      } else {
        broadcastAuthSignOut('sign-out');
      }
    },
    refreshSession: async () => {
      const epoch = authEpoch.current;
      const res = await fetchSession();
      if (epoch !== authEpoch.current) return;
      setSetup(res);
      if (res.authenticated && res.user) setAuthUserState(res.user);
      else {
        setAuthUserState(null);
        setReady(false);
      }
    },
    updateProfile: async (input) => {
      const user = await updateProfileApi(input);
      setAuthUserState(user);
      setLastDiff('Profile saved to your account.');
    },
    updateAccountPreferences: async (input) => {
      const user = await updateAccountPreferencesApi(input);
      setAuthUserState(user);
      const check = validatePreferencePatch(prefs, {
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        ...(input.sessionLenMin !== undefined ? { sessionLenMin: input.sessionLenMin } : {}),
        ...(input.breakMin !== undefined ? { breakMin: input.breakMin } : {}),
        ...(input.minViableMin !== undefined ? { minViableMin: input.minViableMin } : {}),
      });
      if (check.errors.length) throw new Error(check.errors[0]);
      setPrefsState(check.value);
      setLastDiff('Learning preferences saved to your account.');
    },
    changeAccountPassword: async (currentPassword, newPassword) => {
      await changePasswordApi(currentPassword, newPassword);
      setLastDiff('Password changed. Other sessions were signed out.');
    },
    requestEmailChange: async (newEmail, password) => requestEmailChangeApi(newEmail, password),
    listAccountSessions: async () => (await listAccountSessions()).sessions,
    revokeAccountSession: async (sessionId) => {
      await revokeAccountSession(sessionId);
      setLastDiff('That session was signed out.');
    },
    deleteAccount: async (confirmPhrase, password) => {
      // Stop a debounced write before the server starts deleting. If a
      // validation step rejects the request, restore the writer for the still
      // active account; after success every queued write must stay cancelled.
      authEpoch.current += 1;
      if (saveT.current) clearTimeout(saveT.current);
      const previousCloudUser = cloudUserRef.current;
      cloudUserRef.current = null;
      try {
        await deleteAccountApi(confirmPhrase, password);
      } catch (e) {
        cloudUserRef.current = previousCloudUser;
        throw e;
      }
      cloudLoadGeneration.current += 1;
      resetAccountState();
      setAuthUserState(null);
      setReady(false);
      setAuthReady(true);
      setSessionNotice(null);
      try { localStorage.removeItem('lq-focus-timer-v1'); } catch { /* ignore */ }
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('lq:data-cleared'));
      broadcastAuthSignOut('account-deleted');
    },
    exportAccountData: async () => {
      await downloadAccountExport();
      setLastDiff('Account export downloaded. It contains your learning data but no passwords or sign-in tokens.');
    },
    archivePlaylistManaged: async (playlistId) => {
      if (mode === 'local') {
        setMeta((prev) => ({ ...prev, [playlistId]: { ...(prev[playlistId] ?? { addedAt: new Date().toISOString() }), archived: true } }));
        setActiveId((current) => {
          if (current !== playlistId) return current;
          return Object.keys(playlists).find((id) => id !== playlistId && !meta[id]?.archived) ?? null;
        });
        setLastDiff('Playlist archived. Its progress, notes, sessions, checkpoints, and XP were preserved.');
        return;
      }
      const result = await archivePlaylistApi(playlistId, serverVersionRef.current);
      serverVersionRef.current = result.version;
      setServerVersion(result.version);
      await loadCloud(authUser!);
      setLastDiff('Playlist removed from your dashboard and archived. All learning data was preserved and can be restored.');
    },
    restorePlaylistManaged: async (playlistId) => {
      if (mode === 'local') {
        setMeta((prev) => ({ ...prev, [playlistId]: { ...(prev[playlistId] ?? { addedAt: new Date().toISOString() }), archived: false } }));
        setLastDiff('Playlist restored with its existing learning records. No XP was recreated.');
        return;
      }
      const result = await restorePlaylistApi(playlistId, serverVersionRef.current);
      serverVersionRef.current = result.version;
      setServerVersion(result.version);
      await loadCloud(authUser!);
      setLastDiff('Playlist restored with its existing learning records. No XP was recreated.');
    },
    deletePlaylistManaged: async (playlistId, confirmTitle) => {
      if (mode === 'local') {
        const snap = playlists[playlistId];
        const effectiveTitle = meta[playlistId]?.customTitle ?? snap?.title;
        if (!snap || effectiveTitle !== confirmTitle) throw new Error('The playlist changed since this dialog opened. Review the current title before deleting.');
        const plan = playlistRemovalPlan({
          progress, ranges, checkpoints, modules, sessions, segments, playSessions, flexGoals, queue,
        }, playlistId);
        const checkpointIds = new Set(checkpoints.filter((c) => c.playlistId === playlistId).map((c) => c.id));
        const goalIds = new Set(
          flexGoals
            .filter((g) => g.playlistId === playlistId || (g.checkpointId ? checkpointIds.has(g.checkpointId) : false))
            .map((g) => g.id),
        );
        const focusKeys = focusKeysForPlaylist(sessions, playlistId);
        setPlaylists((prev) => { const next = { ...prev }; delete next[playlistId]; return next; });
        setMeta((prev) => { const next = { ...prev }; delete next[playlistId]; return next; });
        setProgress(plan.progress as Record<string, ProgressRecord>);
        setRanges(plan.ranges);
        setCheckpoints(plan.checkpoints);
        setModules(plan.modules);
        setSessions(plan.sessions);
        setSegments(plan.segments);
        setPlaySessions(plan.playSessions);
        setFlexGoals(plan.flexGoals as Goal[]);
        setQueueState(plan.queue);
        setXp((prev) => prev.filter((e) => !xpAttributableToPlaylist(e.dedupKey, playlistId, checkpointIds, goalIds, focusKeys)));
        setActiveId((current) => {
          if (current !== playlistId) return current;
          return Object.keys(playlists).find((id) => id !== playlistId && !meta[id]?.archived) ?? null;
        });
        setLastDiff(`Permanently deleted "${confirmTitle}" and its attributable learning records. Other playlists were not changed.`);
        return;
      }
      const result = await deletePlaylistApi(playlistId, serverVersionRef.current, confirmTitle);
      await loadCloud(authUser!);
      setLastDiff(`Permanently deleted "${confirmTitle}" and its attributable learning records. ${result.alreadyDeleted ? 'This deletion had already completed; the retry was safe.' : 'Other playlists were not changed.'}`);
    },
    migrateLocalDataNow: async () => {
      if (!authUser) throw new Error('Sign in before migrating local data.');
      const dump = await kvDump();
      const normalized = normalizeLoadedState(dump as Partial<LoadedState>, defaultPreferences());
      const payload = { version: 3, state: normalized.state };
      if (!migrationIdRef.current) {
        migrationIdRef.current = `mig-${authUser.userId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      }
      setMigrationError(null);
      try {
        const result = await migrateLocalData(migrationIdRef.current, payload, serverVersionRef.current);
        const summaryParts = Object.entries(result.collections ?? {})
          .filter(([, v]) => v.added > 0 || v.skipped > 0)
          .map(([k, v]) => `${k}: ${v.added} added, ${v.skipped} already present`);
        localStorage.setItem('lq-legacy-claim-v1', JSON.stringify({
          userId: authUser.userId,
          migratedAt: new Date().toISOString(),
          cleanup: 'pending',
        }));
        if (result.version !== undefined) {
          serverVersionRef.current = result.version;
          setServerVersion(result.version);
        }
        await loadCloud(authUser);
        setMigrationAvailable(false);
        setMigrationSummary(
          `Local data imported into ${authUser.username ?? authUser.email}. ${summaryParts.join('; ') || 'Everything was already present.'} `
          + 'The local copy was kept. Use Reports or the migration card to remove it after checking the imported data.',
        );
      } catch (e: any) {
        setMigrationError(e?.message ?? 'Local data migration failed. The source data was not deleted; retry is safe.');
        throw e;
      }
    },
    exportLegacyBackup: async () => {
      const dump = await kvDump();
      const normalized = normalizeLoadedState(dump as Partial<LoadedState>, defaultPreferences());
      const json = await buildBackup(normalized.state as BackupState);
      downloadJson(`learnquest-legacy-backup-${Date.now()}.json`, json);
    },
    removeLocalLegacyData: async () => {
      await kvClearAll();
      try {
        localStorage.removeItem('lq-focus-timer-v1');
        if (authUser) {
          localStorage.setItem('lq-legacy-claim-v1', JSON.stringify({
            userId: authUser.userId,
            migratedAt: new Date().toISOString(),
            cleanup: 'removed',
          }));
        }
      } catch { /* ignore */ }
      setMigrationSummary('The verified local backup/import source was removed from this browser. Your cloud learning data is unchanged.');
      setMigrationAvailable(false);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('lq:data-cleared'));
    },
    retryCloudSave: () => setSaveNonce((n) => n + 1),
    reloadCloudData: async () => {
      if (authUser) await loadCloud(authUser);
    },

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
    renamePlaylist: (id, title) => setMeta((p) => ({ ...p, [id]: { ...(p[id] ?? { archived: false, addedAt: new Date().toISOString() }), customTitle: title } })),
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
      if (mode === 'cloud') {
        if (saveT.current) clearTimeout(saveT.current);
        await writeChain.current;
        const result = await importAccountBackup(validated.backup, serverVersionRef.current);
        serverVersionRef.current = result.version;
        setServerVersion(result.version);
        if (authUser) await loadCloud(authUser);
        setLastDiff(
          `Account backup restored (version ${validated.backup.version}) on the server.`
          + (validated.backup.warnings.length ? ` ${validated.backup.warnings.join(' ')}` : ''),
        );
        return { warnings: validated.backup.warnings };
      }
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
      if (mode === 'cloud') {
        const defaults = normalizeLoadedState({}, defaultPreferences()).state;
        const result = await importAccountBackup({ version: 3, state: defaults }, serverVersionRef.current);
        serverVersionRef.current = result.version;
        setServerVersion(result.version);
        if (authUser) await loadCloud(authUser);
        setLastDiff('All learning data was cleared on the server. Your account, profile, and security settings were preserved.');
        setCelebration(null);
        try { localStorage.removeItem('lq-focus-timer-v1'); } catch { /* ignore */ }
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('lq:data-cleared'));
        return;
      }
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
      if (mode === 'local') {
        await kvSet('playlists', {});
        await kvSet('activeId', null);
        await kvSet('queue', {});
      } else {
        setLastDiff('Playlist metadata cache cleared. Learning records were kept; the change will be confirmed by the server save indicator.');
      }
    },
    setLastDiff: (s) => setLastDiff(s),
  }), [ready, loadError, load, mode, authReady, setup, authUser, authError, clearAuthNotice, syncStatus, syncError, serverVersion, migrationAvailable, migrationSummary, migrationError, playlists, meta, activeId, progress, ranges, checkpoints, modules, sessions, goals, xp, achievements, prefs, lastDiff, celebration, segments, playSessions, queue, flexGoals, challenge, challengeEnabled, rankHistory, settings, applyState, awardXp, loadCloud, bootstrap, resetAccountState]);

  if (mode === 'cloud' && actionRoute) {
    const exit = () => leaveEmailAction('signin');
    const requestNew = () => leaveEmailAction('forgot');
    return actionRoute.kind === 'reset'
      ? <PasswordResetScreen token={actionRoute.token} onExit={exit} onRequestNew={requestNew} expiresInMin={setup?.emailActionTtlMin} />
      : <EmailVerificationScreen token={actionRoute.token} onExit={exit} />;
  }

  if (mode === 'cloud') {
    if (!authReady) {
      return (
        <div className="mx-auto max-w-3xl p-8 text-center text-slate-300">
          <p className="text-lg font-semibold">Connecting to your LearnQuest account…</p>
          <p className="mt-1 text-sm text-slate-500">Learning data is loaded from the server; the browser is not used as an authoritative store.</p>
        </div>
      );
    }
    const configured = setup?.configured;
    const coreMissing = !configured?.mongodb || !configured?.session || !configured?.emailLinks;
    if (authError) {
      return <AccountErrorScreen message={authError} onRetry={() => { void bootstrap(); }} onSignOut={() => { void logoutApi().finally(() => setAuthError(null)); }} />;
    }
    if (coreMissing) {
      return <SetupRequiredScreen setup={setup} onRetry={() => { void bootstrap(); }} />;
    }
    if (!authUser) {
      return (
        <AuthScreens
          setup={setup}
          authError={sessionNotice}
          onClearAuthNotice={value.clearAuthNotice}
          onPasswordLogin={value.signInWithPassword}
          onGoogle={value.signInWithGoogle}
        />
      );
    }
    if (!authUser.onboardingComplete) {
      return (
        <OnboardingScreen
          user={authUser}
          onSubmit={value.completeAccountSetup}
          onSignOut={() => { void value.signOut(); }}
        />
      );
    }
    if (loadError) {
      return <AccountErrorScreen message={loadError} onRetry={() => { void loadCloud(authUser); }} onSignOut={() => { void value.signOut(); }} />;
    }
    if (!ready) {
      return (
        <div className="mx-auto max-w-3xl p-8 text-center text-slate-300">
          <p className="text-lg font-semibold">Loading your cloud learning data…</p>
          <p className="mt-1 text-sm text-slate-500">Saved learning data is being loaded from your account.</p>
        </div>
      );
    }
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { computePlaylistProgress, computeRangeProgress, rangeDuration, snapshotCompleteness, sumEntries, formatSecondsHHMMSS, computeStreak, summarizeSegments, completionFromCoverage, buildEntryProgressIndex, isProgressComplete };
