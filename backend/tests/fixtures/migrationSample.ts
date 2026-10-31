import type { UserCollectionName } from '../../src/store.js';

/**
 * Synthetic 20-domain fixture shared by the isolated MongoDB migration and
 * backup/restore rehearsals. Values are deliberately fake and contain no real
 * account, email, or learning data.
 */
export const MIGRATION_FIXTURE_NOW = '2026-10-31T00:00:00.000Z';
export const MIGRATION_FIXTURE_PLAYLIST_ID = 'PLphase24rehearsal0001';

export const MIGRATION_FIXTURE_SAMPLE = {
  playlists: {
    playlistId: MIGRATION_FIXTURE_PLAYLIST_ID,
    title: 'Phase 24 rehearsal playlist',
    reportedCount: 2,
    entries: [
      { position: 1, videoId: 'v1', title: 'Video one', durationSec: 120 },
      { position: 2, videoId: 'v2', title: 'Video two', durationSec: 180 },
    ],
    source: 'imported',
    fetchedAt: MIGRATION_FIXTURE_NOW,
    snapshotVersion: 1,
  },
  meta: { archived: false, addedAt: MIGRATION_FIXTURE_NOW },
  progress: {
    playlistId: MIGRATION_FIXTURE_PLAYLIST_ID,
    position: 1,
    videoId: 'v1',
    status: 'done',
    completedAt: MIGRATION_FIXTURE_NOW,
    notes: 'rehearsal note',
  },
  ranges: {
    playlistId: MIGRATION_FIXTURE_PLAYLIST_ID,
    id: 'range-1',
    label: 'Range one',
    start: 1,
    end: 2,
    createdAt: MIGRATION_FIXTURE_NOW,
    completedAt: null,
  },
  checkpoints: {
    playlistId: MIGRATION_FIXTURE_PLAYLIST_ID,
    id: 'checkpoint-1',
    label: 'Checkpoint one',
    start: 1,
    end: 2,
    createdAt: MIGRATION_FIXTURE_NOW,
  },
  modules: {
    playlistId: MIGRATION_FIXTURE_PLAYLIST_ID,
    id: 'module-1',
    name: 'Module one',
    positions: [1, 2],
  },
  sessions: {
    id: 'session-1',
    playlistId: MIGRATION_FIXTURE_PLAYLIST_ID,
    startedAt: MIGRATION_FIXTURE_NOW,
    finishedAt: null,
    activeSec: 120,
    elapsedSec: 150,
    intervals: [],
    note: '',
  },
  goals: { dateKey: '2026-10-31', targetFocusSec: 3600, minViableSec: 600 },
  xp: {
    id: 'xp-1',
    dedupKey: `done:${MIGRATION_FIXTURE_PLAYLIST_ID}:1`,
    reason: 'completed-video',
    points: 10,
    at: MIGRATION_FIXTURE_NOW,
  },
  achievements: MIGRATION_FIXTURE_NOW,
  segments: { playlistId: MIGRATION_FIXTURE_PLAYLIST_ID, id: 'segment-1' },
  playSessions: { playlistId: MIGRATION_FIXTURE_PLAYLIST_ID, id: 'play-session-1' },
  queue: [1, 2],
  flexGoals: {
    id: 'flex-goal-1',
    metric: 'focusMin',
    target: 30,
    createdAt: MIGRATION_FIXTURE_NOW,
    playlistId: MIGRATION_FIXTURE_PLAYLIST_ID,
  },
  challenge: { seed: 20261013, cohortSize: 100 },
  challengeEnabled: false,
  rankHistory: { id: 'rank-1', at: MIGRATION_FIXTURE_NOW, rank: 1, of: 10 },
  settings: { verifiedThreshold: 0.9 },
  prefs: {
    timezone: 'UTC',
    sessionLenMin: 25,
    breakMin: 5,
    reducedMotion: false,
    minViableMin: 10,
  },
  activeId: MIGRATION_FIXTURE_PLAYLIST_ID,
} satisfies Partial<Record<UserCollectionName, unknown>>;

export const MIGRATION_FIXTURE_KEYS: Record<keyof typeof MIGRATION_FIXTURE_SAMPLE, string> = {
  playlists: MIGRATION_FIXTURE_PLAYLIST_ID,
  meta: MIGRATION_FIXTURE_PLAYLIST_ID,
  progress: 'v1',
  ranges: 'range-1',
  checkpoints: 'checkpoint-1',
  modules: 'module-1',
  sessions: 'session-1',
  goals: '2026-10-31',
  xp: 'xp-1',
  achievements: 'achievement-1',
  segments: 'segment-1',
  playSessions: 'play-session-1',
  queue: MIGRATION_FIXTURE_PLAYLIST_ID,
  flexGoals: 'flex-goal-1',
  challenge: 'singleton',
  challengeEnabled: 'singleton',
  rankHistory: 'rank-1',
  settings: 'singleton',
  prefs: 'singleton',
  activeId: 'singleton',
};

export const MIGRATION_FIXTURE_DOMAINS = Object.keys(
  MIGRATION_FIXTURE_SAMPLE,
) as Array<keyof typeof MIGRATION_FIXTURE_SAMPLE>;
