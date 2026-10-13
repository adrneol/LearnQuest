// Backend-local contract types. The backend returns NORMALIZED metadata with
// the ORIGINAL ISO 8601 durations — the frontend's domain engine is the single
// authority that parses durations and computes totals/percentages.

export type UnresolvedReason =
  | 'deleted'
  | 'private'
  | 'notFound'
  | 'regionRestricted'
  | 'missingDuration'
  | 'unknown';

export interface NormalizedEntry {
  position: number;
  videoId: string;
  title: string;
  thumbnail?: string;
  /** Original ISO 8601 duration (e.g. PT1H2M3S), or null when unresolvable */
  durationIso: string | null;
  unresolvedReason?: UnresolvedReason;
  publishedAt?: string;
}

export interface NormalizedSnapshot {
  playlistId: string;
  title: string;
  channelTitle?: string;
  thumbnail?: string;
  reportedCount: number | null;
  entries: NormalizedEntry[];
  source: 'api';
  fetchedAt: string;
  snapshotVersion: number;
}
