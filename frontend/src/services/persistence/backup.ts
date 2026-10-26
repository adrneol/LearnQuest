// Versioned, fully validated backup format and restore staging.
//
// Nothing here writes to IndexedDB. `validateBackup` returns a complete staged
// state or a list of human-safe errors; the store commits that state in one
// transaction before touching React state.

import type {
  AppPreferences, AppSettings, DayGoal, Module, PlaySession,
  PlaylistEntry, PlaylistSnapshot, ProgressRecord, RankSnapshot, SavedRange, Checkpoint,
  StudySession, XpEvent,
} from '../../types/index.js';
import type { Goal } from '../../domain/goals/goals.js';
import type { PlaybackSegment } from '../../domain/playback/playback.js';
import { DEFAULT_CHALLENGE, validateChallenge, type ChallengeConfig } from '../../domain/competition/competition.js';
import { validateGoal } from '../../domain/goals/goals.js';
import { PLAYLIST_ID_RE, MAX_ENTRIES } from '../../domain/playlist/playlist.js';
import { normalizeSnapshotIdentity, SNAPSHOT_SCHEMA_VERSION } from '../../domain/progress/identity.js';
import { defaultPreferences, sanitizePreferences, sanitizeSettings, validatePreferencePatch } from '../../domain/settings/preferences.js';
import { isValidTimezone } from '../../domain/time/timezones.js';

export const BACKUP_SCHEMA_VERSION = 3;
export const MAX_BACKUP_PLAYLISTS = 200;
export const MAX_BACKUP_RECORDS = 200_000;

export interface BackupMeta {
  archived: boolean;
  customTitle?: string;
  addedAt: string;
}

export interface BackupState {
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
  prefs: AppPreferences;
  segments: PlaybackSegment[];
  playSessions: PlaySession[];
  queue: Record<string, number[]>;
  flexGoals: Goal[];
  challenge: ChallengeConfig;
  challengeEnabled: boolean;
  rankHistory: RankSnapshot[];
  settings: AppSettings;
}

export interface ValidatedBackup {
  state: BackupState;
  warnings: string[];
  version: number;
}

export type BackupValidation = { ok: true; backup: ValidatedBackup } | { ok: false; errors: string[]; version?: number };

class Problems {
  errors: string[] = [];
  warnings: string[] = [];
  add(message: string): void {
    if (this.errors.length < 40) this.errors.push(message);
  }
  warn(message: string): void {
    if (this.warnings.length < 40) this.warnings.push(message);
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function iso(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 10 && v.length <= 40 && Number.isFinite(Date.parse(v));
}

function int(v: unknown, min: number, max: number): v is number {
  return Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
}

function id(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= 256;
}

function text(v: unknown, max = 100_000): string | undefined {
  return typeof v === 'string' && v.length <= max ? v : undefined;
}

function dateKey(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}

function validatePlaylist(raw: unknown, p: Problems, key: string): PlaylistSnapshot | null {
  if (!isObj(raw)) {
    p.add(`playlists.${key} must be an object.`);
    return null;
  }
  if (typeof raw.playlistId !== 'string' || !PLAYLIST_ID_RE.test(raw.playlistId)) {
    p.add(`playlists.${key}.playlistId invalid.`);
    return null;
  }
  if (raw.playlistId !== key) p.add(`playlists key "${key}" does not match playlistId "${raw.playlistId}".`);
  if (typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 500) {
    p.add(`playlists.${key}.title invalid.`);
    return null;
  }
  if (!Array.isArray(raw.entries)) {
    p.add(`playlists.${key}.entries must be an array.`);
    return null;
  }
  if (raw.entries.length > MAX_ENTRIES) {
    p.add(`playlists.${key} exceeds ${MAX_ENTRIES} entries.`);
    return null;
  }
  if (raw.reportedCount !== undefined && raw.reportedCount !== null && !int(raw.reportedCount, 0, Number.MAX_SAFE_INTEGER)) {
    p.add(`playlists.${key}.reportedCount invalid.`);
  }
  if (raw.fetchedAt !== undefined && !iso(raw.fetchedAt)) p.add(`playlists.${key}.fetchedAt invalid.`);
  const entries: PlaylistEntry[] = [];
  const positions = new Set<number>();
  for (let i = 0; i < raw.entries.length; i++) {
    const e = raw.entries[i];
    if (!isObj(e)) {
      p.add(`playlists.${key}.entries[${i}] invalid.`);
      return null;
    }
    if (!int(e.position, 1, MAX_ENTRIES)) {
      p.add(`playlists.${key}.entries[${i}].position invalid.`);
      return null;
    }
    if (positions.has(e.position)) {
      p.add(`playlists.${key} duplicate position ${e.position}.`);
      return null;
    }
    positions.add(e.position);
    if (typeof e.videoId !== 'string' || e.videoId.length > 128) {
      p.add(`playlists.${key}.entries[${i}].videoId invalid.`);
      return null;
    }
    if (typeof e.title !== 'string' || !e.title.trim() || e.title.length > 500) {
      p.add(`playlists.${key}.entries[${i}].title invalid.`);
      return null;
    }
    if (e.durationSec !== null && !int(e.durationSec, 0, 7 * 24 * 3600)) {
      p.add(`playlists.${key}.entries[${i}].durationSec invalid.`);
      return null;
    }
    entries.push({
      position: e.position,
      entryId: id(e.entryId) ? e.entryId : undefined,
      videoId: e.videoId,
      title: e.title,
      thumbnail: text(e.thumbnail, 2000),
      durationSec: e.durationSec as number | null,
      unresolvedReason: typeof e.unresolvedReason === 'string' ? e.unresolvedReason as PlaylistEntry['unresolvedReason'] : undefined,
      publishedAt: iso(e.publishedAt) ? e.publishedAt : undefined,
    });
  }
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].position !== i + 1) {
      p.add(`playlists.${key} positions must be contiguous from 1.`);
      return null;
    }
  }
  return normalizeSnapshotIdentity({
    playlistId: raw.playlistId,
    title: raw.title.trim(),
    channelTitle: text(raw.channelTitle, 500),
    thumbnail: text(raw.thumbnail, 2000),
    reportedCount: raw.reportedCount === null ? null : Number(raw.reportedCount),
    entries,
    source: raw.source === 'api' ? 'api' : 'imported',
    fetchedAt: iso(raw.fetchedAt) ? raw.fetchedAt : new Date().toISOString(),
    snapshotVersion: int(raw.snapshotVersion, 1, SNAPSHOT_SCHEMA_VERSION) ? raw.snapshotVersion : SNAPSHOT_SCHEMA_VERSION,
  });
}

function validateProgress(raw: unknown, p: Problems, key: string, playlists: Record<string, PlaylistSnapshot>): ProgressRecord | null {
  if (!isObj(raw)) {
    p.add(`progress.${key} must be an object.`);
    return null;
  }
  if (typeof raw.playlistId !== 'string' || !playlists[raw.playlistId]) {
    p.add(`progress.${key}.playlistId does not reference a playlist in this backup.`);
    return null;
  }
  if (!int(raw.position, 1, MAX_ENTRIES)) {
    p.add(`progress.${key}.position invalid.`);
    return null;
  }
  if (typeof raw.videoId !== 'string' || raw.videoId.length > 128) {
    p.add(`progress.${key}.videoId invalid.`);
    return null;
  }
  if (raw.completedAt !== null && !iso(raw.completedAt)) {
    p.add(`progress.${key}.completedAt invalid.`);
    return null;
  }
  if (!['todo', 'in-progress', 'done', 'unavailable'].includes(String(raw.status))) {
    p.add(`progress.${key}.status invalid.`);
    return null;
  }
  if (raw.source !== undefined && raw.source !== 'verified' && raw.source !== 'manual') {
    p.add(`progress.${key}.source invalid.`);
    return null;
  }
  if (raw.verifiedAt !== undefined && raw.verifiedAt !== null && !iso(raw.verifiedAt)) {
    p.add(`progress.${key}.verifiedAt invalid.`);
    return null;
  }
  if (raw.confidence !== undefined && !int(raw.confidence, 1, 5)) {
    p.add(`progress.${key}.confidence invalid.`);
    return null;
  }
  if (raw.revisionDate !== undefined && raw.revisionDate !== null && !dateKey(raw.revisionDate)) {
    p.add(`progress.${key}.revisionDate invalid.`);
    return null;
  }
  if (raw.revisionDoneAt !== undefined && raw.revisionDoneAt !== null && !iso(raw.revisionDoneAt)) {
    p.add(`progress.${key}.revisionDoneAt invalid.`);
    return null;
  }
  let reviewHistory: ProgressRecord['reviewHistory'];
  if (raw.reviewHistory !== undefined) {
    if (!Array.isArray(raw.reviewHistory) || raw.reviewHistory.length > 500) {
      p.add(`progress.${key}.reviewHistory must be an array of at most 500 reviews.`);
      return null;
    }
    const history: NonNullable<ProgressRecord['reviewHistory']> = [];
    for (let i = 0; i < raw.reviewHistory.length; i++) {
      const event = raw.reviewHistory[i];
      if (!isObj(event) || !id(event.id) || !iso(event.reviewedAt) || !dateKey(event.dateKey)
        || (event.source !== undefined && event.source !== 'revision' && event.source !== 'player')) {
        p.add(`progress.${key}.reviewHistory[${i}] invalid.`);
        return null;
      }
      history.push({
        id: event.id,
        reviewedAt: event.reviewedAt,
        dateKey: event.dateKey,
        source: event.source as 'revision' | 'player' | undefined,
      });
    }
    reviewHistory = history;
  }
  return {
    playlistId: raw.playlistId,
    position: raw.position,
    entryId: id(raw.entryId) ? raw.entryId : undefined,
    videoId: raw.videoId,
    completedAt: raw.completedAt as string | null,
    status: raw.status as ProgressRecord['status'],
    source: raw.source as ProgressRecord['source'],
    verifiedAt: raw.verifiedAt as string | null | undefined,
    confidence: raw.confidence as ProgressRecord['confidence'],
    notes: text(raw.notes),
    keyConcepts: text(raw.keyConcepts),
    questions: text(raw.questions),
    codeReproduced: typeof raw.codeReproduced === 'boolean' ? raw.codeReproduced : undefined,
    exerciseDone: typeof raw.exerciseDone === 'boolean' ? raw.exerciseDone : undefined,
    builtExample: typeof raw.builtExample === 'boolean' ? raw.builtExample : undefined,
    needsRevision: typeof raw.needsRevision === 'boolean' ? raw.needsRevision : undefined,
    revisionDate: raw.revisionDate as string | null | undefined,
    revisionDoneAt: raw.revisionDoneAt as string | null | undefined,
    reviewHistory,
    orphaned: typeof raw.orphaned === 'boolean' ? raw.orphaned : undefined,
    reviewReason: ['removed', 'video-mismatch', 'unknown'].includes(String(raw.reviewReason))
      ? raw.reviewReason as ProgressRecord['reviewReason']
      : undefined,
  };
}

function validateRanges(raw: unknown, p: Problems, playlists: Record<string, PlaylistSnapshot>): SavedRange[] {
  if (!Array.isArray(raw)) {
    p.add('ranges must be an array.');
    return [];
  }
  if (raw.length > MAX_BACKUP_RECORDS) p.add('ranges exceeds the collection limit.');
  const out: SavedRange[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    if (!isObj(r) || !id(r.id) || !id(r.playlistId)) {
      p.add(`ranges[${i}] missing id/playlistId.`);
      continue;
    }
    if (ids.has(r.id)) {
      p.add(`ranges[${i}] duplicate id.`);
      continue;
    }
    ids.add(r.id);
    if (!playlists[r.playlistId]) {
      p.add(`ranges[${i}] references a missing playlist.`);
      continue;
    }
    if (!int(r.start, 1, MAX_ENTRIES) || !int(r.end, 1, MAX_ENTRIES) || r.end < r.start) {
      p.add(`ranges[${i}] has an invalid range.`);
      continue;
    }
    if (!iso(r.createdAt)) {
      p.add(`ranges[${i}].createdAt invalid.`);
      continue;
    }
    out.push({
      id: r.id,
      playlistId: r.playlistId,
      label: text(r.label, 500) ?? `Videos ${r.start}–${r.end}`,
      start: r.start,
      end: r.end,
      createdAt: r.createdAt,
      snapshotVersion: int(r.snapshotVersion, 1, SNAPSHOT_SCHEMA_VERSION) ? r.snapshotVersion : 1,
      status: r.status === 'needsReview' ? 'needsReview' : 'valid',
    });
  }
  return out;
}

function validateCheckpoints(raw: unknown, p: Problems, playlists: Record<string, PlaylistSnapshot>): Checkpoint[] {
  if (!Array.isArray(raw)) {
    p.add('checkpoints must be an array.');
    return [];
  }
  const out: Checkpoint[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (!isObj(c) || !id(c.id) || !id(c.playlistId)) {
      p.add(`checkpoints[${i}] missing id/playlistId.`);
      continue;
    }
    if (ids.has(c.id)) {
      p.add(`checkpoints[${i}] duplicate id.`);
      continue;
    }
    ids.add(c.id);
    if (!playlists[c.playlistId]) {
      p.add(`checkpoints[${i}] references a missing playlist.`);
      continue;
    }
    if (!int(c.start, 1, MAX_ENTRIES) || !int(c.end, 1, MAX_ENTRIES) || c.end < c.start) {
      p.add(`checkpoints[${i}] has an invalid range.`);
      continue;
    }
    if (!iso(c.createdAt) || (c.completedAt !== null && !iso(c.completedAt))) {
      p.add(`checkpoints[${i}] has an invalid timestamp.`);
      continue;
    }
    out.push({
      id: c.id,
      playlistId: c.playlistId,
      label: text(c.label, 500) ?? `Videos ${c.start}–${c.end}`,
      start: c.start,
      end: c.end,
      createdAt: c.createdAt,
      completedAt: c.completedAt as string | null,
      snapshotVersion: int(c.snapshotVersion, 1, SNAPSHOT_SCHEMA_VERSION) ? c.snapshotVersion : 1,
      status: c.status === 'needsReview' ? 'needsReview' : 'valid',
    });
  }
  return out;
}

function validateModules(raw: unknown, p: Problems, playlists: Record<string, PlaylistSnapshot>): Module[] {
  if (!Array.isArray(raw)) {
    p.add('modules must be an array.');
    return [];
  }
  const out: Module[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const m = raw[i];
    if (!isObj(m) || !id(m.id) || !id(m.playlistId)) {
      p.add(`modules[${i}] missing id/playlistId.`);
      continue;
    }
    if (ids.has(m.id)) {
      p.add(`modules[${i}] duplicate id.`);
      continue;
    }
    ids.add(m.id);
    if (!playlists[m.playlistId]) {
      p.add(`modules[${i}] references a missing playlist.`);
      continue;
    }
    if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 200) {
      p.add(`modules[${i}].name invalid.`);
      continue;
    }
    if (!Array.isArray(m.positions) || m.positions.length > MAX_ENTRIES
      || !m.positions.every((v) => int(v, 1, MAX_ENTRIES))) {
      p.add(`modules[${i}].positions invalid.`);
      continue;
    }
    out.push({
      id: m.id,
      playlistId: m.playlistId,
      name: m.name.trim(),
      positions: [...new Set(m.positions as number[])].sort((a, b) => a - b),
      goalSec: int(m.goalSec, 0, 7 * 24 * 3600) ? m.goalSec : undefined,
    });
  }
  return out;
}

function validateSessions(raw: unknown, p: Problems, playlists: Record<string, PlaylistSnapshot>): StudySession[] {
  if (!Array.isArray(raw)) {
    p.add('sessions must be an array.');
    return [];
  }
  const out: StudySession[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    if (!isObj(s) || !id(s.id)) {
      p.add(`sessions[${i}] missing id.`);
      continue;
    }
    if (ids.has(s.id)) {
      p.add(`sessions[${i}] duplicate id.`);
      continue;
    }
    ids.add(s.id);
    if (s.playlistId !== null && (typeof s.playlistId !== 'string' || !playlists[s.playlistId])) {
      p.add(`sessions[${i}] references a missing playlist.`);
      continue;
    }
    if (!iso(s.startedAt) || (s.finishedAt !== null && !iso(s.finishedAt))) {
      p.add(`sessions[${i}] has an invalid timestamp.`);
      continue;
    }
    if (!int(s.activeSec, 0, 7 * 24 * 3600) || !int(s.elapsedSec, 0, 7 * 24 * 3600)) {
      p.add(`sessions[${i}] has invalid durations.`);
      continue;
    }
    if (!dateKey(s.dateKey)) {
      p.add(`sessions[${i}].dateKey invalid.`);
      continue;
    }
    let intervals: StudySession['intervals'];
    if (s.intervals !== undefined) {
      if (!Array.isArray(s.intervals) || s.intervals.length > 5000
        || !s.intervals.every((iv) => isObj(iv) && Number.isFinite(iv.startMs) && Number.isFinite(iv.endMs)
          && (iv.kind === 'active' || iv.kind === 'paused') && (iv.endMs as number) >= (iv.startMs as number))) {
        p.add(`sessions[${i}].intervals invalid.`);
        continue;
      }
      intervals = s.intervals as StudySession['intervals'];
    }
    out.push({
      id: s.id,
      clientId: id(s.clientId) ? s.clientId : undefined,
      playlistId: s.playlistId as string | null,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt as string | null,
      activeSec: s.activeSec,
      elapsedSec: Math.max(s.activeSec, s.elapsedSec),
      pausedSec: int(s.pausedSec, 0, 7 * 24 * 3600) ? s.pausedSec : undefined,
      intervals,
      estimated: typeof s.estimated === 'boolean' ? s.estimated : undefined,
      note: text(s.note, 5000),
      dateKey: s.dateKey,
    });
  }
  return out;
}

function validateGoals(raw: unknown, p: Problems): Record<string, DayGoal> {
  if (!isObj(raw)) {
    p.add('goals must be an object.');
    return {};
  }
  const out: Record<string, DayGoal> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!dateKey(key) || !isObj(value)) {
      p.add(`goals.${key} invalid.`);
      continue;
    }
    if (!int(value.targetFocusSec, 0, 16 * 3600) || !int(value.minViableSec, 0, 16 * 3600)) {
      p.add(`goals.${key} targets invalid.`);
      continue;
    }
    out[key] = {
      dateKey: key,
      targetFocusSec: value.targetFocusSec,
      targetCount: int(value.targetCount, 0, 10_000) ? value.targetCount : undefined,
      targetContentSec: int(value.targetContentSec, 0, 16 * 3600) ? value.targetContentSec : undefined,
      minViableSec: value.minViableSec,
    };
  }
  return out;
}

function validateXp(raw: unknown, p: Problems): XpEvent[] {
  if (!Array.isArray(raw)) {
    p.add('xp must be an array.');
    return [];
  }
  const out: XpEvent[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const x = raw[i];
    if (!isObj(x) || !id(x.id) || !id(x.dedupKey) || !iso(x.at) || !Number.isFinite(x.points)) {
      p.add(`xp[${i}] invalid.`);
      continue;
    }
    if (ids.has(x.id)) {
      p.add(`xp[${i}] duplicate id.`);
      continue;
    }
    ids.add(x.id);
    out.push({
      id: x.id,
      reason: text(x.reason, 500) ?? 'event',
      points: Math.trunc(x.points as number),
      dedupKey: x.dedupKey,
      at: x.at,
    });
  }
  return out;
}

function validateSegments(raw: unknown, p: Problems, playlists: Record<string, PlaylistSnapshot>): PlaybackSegment[] {
  if (!Array.isArray(raw)) {
    p.add('segments must be an array.');
    return [];
  }
  const out: PlaybackSegment[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    if (!isObj(s) || !id(s.id) || !id(s.playlistId) || !id(s.videoId) || !id(s.sessionId)) {
      p.add(`segments[${i}] missing identifiers.`);
      continue;
    }
    if (ids.has(s.id)) {
      p.add(`segments[${i}] duplicate id.`);
      continue;
    }
    ids.add(s.id);
    if (!playlists[s.playlistId]) {
      p.add(`segments[${i}] references a missing playlist.`);
      continue;
    }
    if (!int(s.position, 1, MAX_ENTRIES)
      || !Number.isFinite(s.wallStartMs) || !Number.isFinite(s.wallEndMs) || (s.wallEndMs as number) < (s.wallStartMs as number)
      || !Number.isFinite(s.timelineStartSec) || !Number.isFinite(s.timelineEndSec) || (s.timelineEndSec as number) < (s.timelineStartSec as number)
      || !Number.isFinite(s.playbackRate) || (s.playbackRate as number) <= 0
      || (s.source !== 'verified' && s.source !== 'manual')) {
      p.add(`segments[${i}] has invalid evidence fields.`);
      continue;
    }
    out.push({
      id: s.id,
      playlistId: s.playlistId,
      position: s.position,
      entryId: id(s.entryId) ? s.entryId : undefined,
      videoId: s.videoId,
      sessionId: s.sessionId,
      wallStartMs: s.wallStartMs as number,
      wallEndMs: s.wallEndMs as number,
      timelineStartSec: s.timelineStartSec as number,
      timelineEndSec: s.timelineEndSec as number,
      playbackRate: s.playbackRate as number,
      source: s.source,
    });
  }
  return out;
}

function validatePlaySessions(raw: unknown, p: Problems, playlists: Record<string, PlaylistSnapshot>): PlaySession[] {
  if (!Array.isArray(raw)) {
    p.add('playSessions must be an array.');
    return [];
  }
  const out: PlaySession[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    if (!isObj(s) || !id(s.id) || !id(s.playlistId) || !id(s.videoId)) {
      p.add(`playSessions[${i}] missing identifiers.`);
      continue;
    }
    if (ids.has(s.id)) {
      p.add(`playSessions[${i}] duplicate id.`);
      continue;
    }
    ids.add(s.id);
    if (!playlists[s.playlistId]) {
      p.add(`playSessions[${i}] references a missing playlist.`);
      continue;
    }
    if (!int(s.position, 1, MAX_ENTRIES) || !iso(s.startedAt) || (s.finishedAt !== null && !iso(s.finishedAt))
      || !int(s.activePlaybackSec, 0, 7 * 24 * 3600) || !int(s.contentSec, 0, 7 * 24 * 3600)
      || !int(s.uniqueGainSec, 0, 7 * 24 * 3600) || !int(s.pauseSec, 0, 7 * 24 * 3600)
      || (s.source !== 'verified' && s.source !== 'manual')) {
      p.add(`playSessions[${i}] has invalid session fields.`);
      continue;
    }
    out.push({
      id: s.id,
      playlistId: s.playlistId,
      position: s.position,
      videoId: s.videoId,
      entryId: id(s.entryId) ? s.entryId : undefined,
      moduleId: typeof s.moduleId === 'string' ? s.moduleId : null,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt as string | null,
      activePlaybackSec: s.activePlaybackSec,
      contentSec: s.contentSec,
      uniqueGainSec: s.uniqueGainSec,
      pauseSec: s.pauseSec,
      note: text(s.note, 5000),
      source: s.source,
    });
  }
  return out;
}

function validateQueue(raw: unknown, p: Problems, playlists: Record<string, PlaylistSnapshot>): Record<string, number[]> {
  if (!isObj(raw)) {
    p.add('queue must be an object.');
    return {};
  }
  const out: Record<string, number[]> = {};
  for (const [pid, value] of Object.entries(raw)) {
    if (!playlists[pid] || !Array.isArray(value) || value.length > MAX_ENTRIES || !value.every((v) => int(v, 1, MAX_ENTRIES))) {
      p.add(`queue.${pid} invalid.`);
      continue;
    }
    out[pid] = [...new Set(value as number[])];
  }
  return out;
}

function validateFlexGoals(raw: unknown, p: Problems, playlists: Record<string, PlaylistSnapshot>, checkpoints: Checkpoint[]): Goal[] {
  if (!Array.isArray(raw)) {
    p.add('flexGoals must be an array.');
    return [];
  }
  const out: Goal[] = [];
  const ids = new Set<string>();
  const checkpointIds = new Set(checkpoints.map((c) => c.id));
  for (let i = 0; i < raw.length; i++) {
    const g = raw[i];
    if (!isObj(g) || !id(g.id) || !id(g.label)) {
      p.add(`flexGoals[${i}] missing id/label.`);
      continue;
    }
    if (ids.has(g.id)) {
      p.add(`flexGoals[${i}] duplicate id.`);
      continue;
    }
    ids.add(g.id);
    if (g.playlistId !== null && (typeof g.playlistId !== 'string' || !playlists[g.playlistId])) {
      p.add(`flexGoals[${i}] references a missing playlist.`);
      continue;
    }
    if (g.checkpointId !== undefined && !checkpointIds.has(String(g.checkpointId))) {
      p.add(`flexGoals[${i}] references a missing checkpoint.`);
      continue;
    }
    if (!['video-count', 'unique-content', 'focus-time', 'playback-time', 'checkpoint'].includes(String(g.metric))) {
      p.add(`flexGoals[${i}].metric invalid.`);
      continue;
    }
    const problems = validateGoal({ metric: g.metric as Goal['metric'], target: Number(g.target) });
    if (problems.length) {
      p.add(`flexGoals[${i}]: ${problems.join(' ')}`);
      continue;
    }
    if (g.dateKey !== null && !dateKey(g.dateKey)) {
      p.add(`flexGoals[${i}].dateKey invalid.`);
      continue;
    }
    if (!iso(g.createdAt) || (g.achievedAt !== null && !iso(g.achievedAt))) {
      p.add(`flexGoals[${i}] has an invalid timestamp.`);
      continue;
    }
    out.push({
      id: g.id,
      label: g.label.trim(),
      metric: g.metric as Goal['metric'],
      target: Number(g.target),
      playlistId: g.playlistId as string | null,
      checkpointId: typeof g.checkpointId === 'string' ? g.checkpointId : undefined,
      dateKey: g.dateKey as string | null,
      createdAt: g.createdAt,
      paused: Boolean(g.paused),
      achievedAt: g.achievedAt as string | null,
      achievedValue: Number.isFinite(g.achievedValue) ? Number(g.achievedValue) : null,
    });
  }
  return out;
}

function validateBackupChallenge(raw: unknown, p: Problems): ChallengeConfig {
  if (!isObj(raw)) {
    p.add('challenge must be an object.');
    return DEFAULT_CHALLENGE;
  }
  const candidate: ChallengeConfig = {
    seed: Number(raw.seed),
    cohortSize: Number(raw.cohortSize),
    tierDist: raw.tierDist as ChallengeConfig['tierDist'],
    windowDays: Number(raw.windowDays),
    dailyCapHours: Number(raw.dailyCapHours),
  };
  if (!isObj(raw.tierDist)) {
    p.add('challenge.tierDist invalid.');
    return DEFAULT_CHALLENGE;
  }
  const problems = validateChallenge(candidate);
  if (problems.length) p.add(`challenge: ${problems.join(' ')}`);
  if (!int(candidate.windowDays, 1, 90)) p.add('challenge.windowDays must be 1–90.');
  return candidate;
}

function validateRankHistory(raw: unknown, p: Problems): RankSnapshot[] {
  if (!Array.isArray(raw)) {
    p.add('rankHistory must be an array.');
    return [];
  }
  if (raw.length > 500) p.add('rankHistory exceeds the collection limit.');
  const out: RankSnapshot[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    if (!isObj(r) || !iso(r.at) || !int(r.rank, 1, 1_000_000) || !int(r.of, 1, 1_000_000)
      || typeof r.metric !== 'string' || !r.metric) {
      p.add(`rankHistory[${i}] invalid.`);
      continue;
    }
    out.push({ at: r.at, rank: r.rank, of: r.of, metric: r.metric.slice(0, 100) });
  }
  return out;
}

function fullDefaults(): BackupState {
  return {
    playlists: {},
    meta: {},
    activeId: null,
    progress: {},
    ranges: [],
    checkpoints: [],
    modules: [],
    sessions: [],
    goals: {},
    xp: [],
    achievements: {},
    prefs: defaultPreferences(),
    segments: [],
    playSessions: [],
    queue: {},
    flexGoals: [],
    challenge: DEFAULT_CHALLENGE,
    challengeEnabled: false,
    rankHistory: [],
    settings: { verifiedThreshold: 0.9 },
  };
}

/**
 * Validate a complete backup before any state change. Missing collections are
 * restored as empty/default values (full restore semantics), never merged with
 * the current database. Version 1/2 data is accepted through compatible
 * defaults; future versions are rejected.
 */
export function validateBackup(input: string | unknown): BackupValidation {
  let parsed: unknown = input;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input);
    } catch {
      return { ok: false, errors: ['Backup is not valid JSON.'] };
    }
  }
  if (!isObj(parsed)) return { ok: false, errors: ['Backup must be a JSON object.'] };
  const version = parsed.version === undefined ? 1 : Number(parsed.version);
  if (!Number.isSafeInteger(version) || version < 1 || version > BACKUP_SCHEMA_VERSION) {
    return { ok: false, errors: [`Unsupported backup version ${String(parsed.version)}. This app supports versions 1–${BACKUP_SCHEMA_VERSION}.`], version };
  }
  if (version >= 3 && !iso(parsed.exportedAt)) {
    return { ok: false, errors: ['Version 3 backups require a valid exportedAt timestamp.'], version };
  }
  const data = isObj(parsed.data) ? parsed.data : version <= 2 ? parsed : null;
  if (!data) return { ok: false, errors: ['Backup data object is missing.'], version };
  const p = new Problems();
  const defaults = fullDefaults();
  const rawPlaylists = data.playlists ?? {};
  if (!isObj(rawPlaylists)) {
    return { ok: false, errors: ['playlists must be an object.'], version };
  }
  const playlistKeys = Object.keys(rawPlaylists);
  if (playlistKeys.length > MAX_BACKUP_PLAYLISTS) {
    return { ok: false, errors: [`Backup exceeds ${MAX_BACKUP_PLAYLISTS} playlists.`], version };
  }
  const playlists: Record<string, PlaylistSnapshot> = {};
  for (const key of playlistKeys) {
    const snap = validatePlaylist(rawPlaylists[key], p, key);
    if (snap) playlists[key] = snap;
  }
  const meta: Record<string, BackupMeta> = {};
  if (data.meta !== undefined) {
    if (!isObj(data.meta)) p.add('meta must be an object.');
    else {
      for (const [key, value] of Object.entries(data.meta)) {
        if (!playlists[key] || !isObj(value)) {
          p.add(`meta.${key} invalid.`);
          continue;
        }
        if (!iso(value.addedAt)) {
          p.add(`meta.${key}.addedAt invalid.`);
          continue;
        }
        meta[key] = {
          archived: Boolean(value.archived),
          customTitle: text(value.customTitle, 500),
          addedAt: value.addedAt,
        };
      }
    }
  }
  for (const key of Object.keys(playlists)) {
    if (!meta[key]) meta[key] = { archived: false, addedAt: new Date().toISOString() };
  }
  const activeId = data.activeId === null || data.activeId === undefined
    ? null
    : typeof data.activeId === 'string' && playlists[data.activeId]
      ? data.activeId
      : null;
  if (data.activeId !== undefined && data.activeId !== null && activeId === null) p.warn('activeId did not reference a restored playlist; it was cleared.');

  const progress: Record<string, ProgressRecord> = {};
  if (data.progress !== undefined) {
    if (!isObj(data.progress)) p.add('progress must be an object.');
    else {
      for (const [key, value] of Object.entries(data.progress)) {
        const rec = validateProgress(value, p, key, playlists);
        if (rec) progress[key] = rec;
      }
    }
  }
  const ranges = validateRanges(data.ranges ?? [], p, playlists);
  const checkpoints = validateCheckpoints(data.checkpoints ?? [], p, playlists);
  const modules = validateModules(data.modules ?? [], p, playlists);
  const sessions = validateSessions(data.sessions ?? [], p, playlists);
  const goals = validateGoals(data.goals ?? {}, p);
  const xp = validateXp(data.xp ?? [], p);
  const achievements: Record<string, string> = {};
  if (data.achievements !== undefined) {
    if (!isObj(data.achievements)) p.add('achievements must be an object.');
    else {
      for (const [key, value] of Object.entries(data.achievements)) {
        if (id(key) && iso(value)) achievements[key] = value;
        else p.add(`achievements.${key} invalid.`);
      }
    }
  }
  let prefs = defaults.prefs;
  if (data.prefs !== undefined) {
    if (!isObj(data.prefs)) p.add('prefs must be an object.');
    else {
      const candidate = sanitizePreferences({ ...defaults.prefs, ...data.prefs }, defaults.prefs);
      const check = validatePreferencePatch(defaults.prefs, candidate);
      if (check.errors.length) p.add(`prefs: ${check.errors.join(' ')}`);
      else prefs = check.value;
      if (typeof data.prefs.timezone === 'string' && data.prefs.timezone !== 'local' && !isValidTimezone(data.prefs.timezone)) {
        p.add('prefs.timezone is not a supported IANA zone.');
      }
    }
  }
  const segments = validateSegments(data.segments ?? [], p, playlists);
  const playSessions = validatePlaySessions(data.playSessions ?? [], p, playlists);
  const queue = validateQueue(data.queue ?? {}, p, playlists);
  const flexGoals = validateFlexGoals(data.flexGoals ?? [], p, playlists, checkpoints);
  const challenge = validateBackupChallenge(data.challenge ?? DEFAULT_CHALLENGE, p);
  const settings = sanitizeSettings(data.settings ?? defaults.settings);
  const challengeEnabled = typeof data.challengeEnabled === 'boolean' ? data.challengeEnabled : false;
  const rankHistory = validateRankHistory(data.rankHistory ?? [], p);
  if (p.errors.length) return { ok: false, errors: p.errors, version };
  return {
    ok: true,
    backup: {
      version,
      warnings: p.warnings,
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
        challengeEnabled,
        rankHistory,
        settings,
      },
    },
  };
}

/** Build a version-3 export from the in-memory state (never a stale debounce). */
export function buildBackup(state: BackupState, exportedAt = new Date().toISOString()): string {
  return JSON.stringify(
    {
      version: BACKUP_SCHEMA_VERSION,
      exportedAt,
      schema: 'learnquest-backup',
      data: state,
    },
    null,
    2,
  );
}
