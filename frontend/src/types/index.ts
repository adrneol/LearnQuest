// Shared LearnQuest types. Playlist positions are 1-indexed in UI,
// 0-indexed internally only where explicitly noted.

export type EntryStatus = 'todo' | 'in-progress' | 'done' | 'unavailable';

export interface PlaylistEntry {
  /** 1-indexed playlist position */
  position: number;
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

export interface ProgressRecord {
  playlistId: string;
  /** 1-indexed */
  position: number;
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
}

export interface StudySession {
  id: string;
  playlistId: string | null;
  startedAt: string;
  finishedAt: string | null;
  /** active focused seconds (excludes paused/break time) */
  activeSec: number;
  elapsedSec: number;
  note?: string;
  dateKey: string; // YYYY-MM-DD in user timezone
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

