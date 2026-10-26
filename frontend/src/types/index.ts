// Shared LearnQuest types. Playlist positions are 1-indexed in UI,
// 0-indexed internally only where explicitly noted.

export type EntryStatus = 'todo' | 'in-progress' | 'done' | 'unavailable';

export interface PlaylistEntry {
  /** 1-indexed playlist position */
  position: number;
  /**
   * Stable identity for this playlist occurrence. API imports use the
   * playlist-item id; imported/legacy snapshots derive `videoId#occurrence`.
   * Reordering does not change it, and duplicate occurrences of one video
   * remain distinct.
   */
  entryId?: string;
  videoId: string;
  title: string;
  thumbnail?: string;
  /** integer seconds, or null when unresolved */
  durationSec: number | null;
  unresolvedReason?: 'deleted' | 'private' | 'notFound' | 'regionRestricted' | 'missingDuration' | 'unknown';
  publishedAt?: string;
}

export interface PlaylistSnapshot {
  playlistId: string;
  title: string;
  channelTitle?: string;
  thumbnail?: string;
  /** Provider-reported count (may differ from fetched entries) */
  reportedCount: number | null;
  entries: PlaylistEntry[];
  source: 'api' | 'imported';
  fetchedAt: string; // ISO timestamp
  snapshotVersion: number;
}

export interface SnapshotCompleteness {
  n: number;
  resolved: number;
  unresolved: number;
  unresolvedPositions: number[];
  isComplete: boolean;
}

export interface SavedRange {
  id: string;
  playlistId: string;
  label: string;
  start: number;
  end: number;
  createdAt: string;
  snapshotVersion: number;
  status?: 'valid' | 'needsReview';
}

export interface Checkpoint {
  id: string;
  playlistId: string;
  label: string;
  start: number;
  end: number;
  createdAt: string;
  completedAt: string | null;
  snapshotVersion: number;
  status?: 'valid' | 'needsReview';
}

export interface ReviewEvent {
  id: string;
  /** Real UTC instant of the review. */
  reviewedAt: string;
  /** Calendar day used for review/XP idempotency in the display timezone. */
  dateKey: string;
  /** Screen that recorded the review. */
  source?: 'revision' | 'player';
}

export interface ProgressRecord {
  playlistId: string;
  /** 1-indexed position at the time of the last known snapshot */
  position: number;
  /** Stable occurrence identity; mirrors PlaylistEntry.entryId. */
  entryId?: string;
  videoId: string;
  completedAt: string | null;
  status: EntryStatus;
  /** verified = observed player coverage; manual = checkbox/override (v2 addition, optional) */
  source?: 'verified' | 'manual';
  verifiedAt?: string | null;
  confidence?: 1 | 2 | 3 | 4 | 5;
  notes?: string;
  keyConcepts?: string;
  questions?: string;
  codeReproduced?: boolean;
  exerciseDone?: boolean;
  builtExample?: boolean;
  needsRevision?: boolean;
  revisionDate?: string | null;
  revisionDoneAt?: string | null;
  /**
   * Append-only review log. `revisionDoneAt` remains the fast latest-review
   * mirror; history is preserved when a lesson is flagged again.
   */
  reviewHistory?: ReviewEvent[];
  /**
   * True when a playlist refresh removed/replaced the occurrence. The record
   * (including notes and review history) is preserved for review but never
   * counted as completion for another video.
   */
  orphaned?: boolean;
  reviewReason?: 'removed' | 'video-mismatch' | 'unknown';
}

export interface FocusInterval {
  /** UTC epoch milliseconds */
  startMs: number;
  endMs: number;
  kind: 'active' | 'paused';
}

export interface StudySession {
  id: string;
  /** Client-generated idempotency key (timer instance). */
  clientId?: string;
  playlistId: string | null;
  /** Real wall-clock start (UTC ISO). */
  startedAt: string;
  /** Real wall-clock finish (UTC ISO). */
  finishedAt: string | null;
  /** active focused seconds (excludes paused/break time) */
  activeSec: number;
  elapsedSec: number;
  pausedSec?: number;
  /** Actual active/paused wall intervals for cross-midnight attribution. */
  intervals?: FocusInterval[];
  /** True when the user supplied a manual active-time correction. */
  estimated?: boolean;
  note?: string;
  dateKey: string; // start-day label (legacy/display only; attribution derives from intervals)
}

export interface XpEvent {
  id: string;
  reason: string;
  points: number;
  dedupKey: string;
  at: string;
}

export interface DayGoal {
  dateKey: string;
  targetFocusSec: number;
  targetCount?: number;
  targetContentSec?: number;
  minViableSec: number;
}

/** Observed player session on one playlist entry (UTC instants; tz is presentation-only). */
export interface PlaySession {
  id: string;
  playlistId: string;
  position: number;
  videoId: string;
  entryId?: string;
  moduleId?: string | null;
  startedAt: string;
  finishedAt: string | null;
  /** wall-clock seconds while state==playing (excl. pause/buffer) */
  activePlaybackSec: number;
  /** timeline seconds covered incl. repeats */
  contentSec: number;
  /** new unique timeline seconds gained this session */
  uniqueGainSec: number;
  pauseSec: number;
  note?: string;
  source: 'verified' | 'manual';
}

export interface AppSettings {
  /** unique-coverage ratio required for verified completion (0.5–1) */
  verifiedThreshold: number;
}

export interface Module {
  id: string;
  playlistId: string;
  name: string;
  positions: number[];
  goalSec?: number;
}

export interface RankSnapshot {
  at: string;
  rank: number;
  of: number;
  metric: string;
}

export interface AppPreferences {
  /** IANA zone or the `local` sentinel. */
  timezone: string;
  sessionLenMin: number;
  breakMin: number;
  reducedMotion: boolean;
  minViableMin: number;
}

