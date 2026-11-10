import { expect, it } from 'vitest';
import { buildAccountExport } from '../../src/services/exports/accountExport.js';
import { DEFAULT_CHALLENGE } from '../../src/domain/competition/competition.js';
import type { BackupState } from '../../src/services/persistence/backup.js';
import type { PlaylistSnapshot } from '../../src/types/index.js';
import { listZip } from '../browser/helpers/zip-verify.mjs';

const now = new Date('2026-11-10T12:00:00Z');
const playlistId = 'PLregression00000001';
const entry = { position: 1, entryId: 'e1', videoId: 'fixture0001', title: 'Lesson one', durationSec: 2_000 };
const snapshot: PlaylistSnapshot = {
  playlistId, title: 'Synthetic course', entries: [entry], reportedCount: 1,
  source: 'imported', fetchedAt: now.toISOString(), snapshotVersion: 2,
};

it('EXPORT-1: the archive manifest names exactly the files it inventories', () => {
  const state: BackupState = {
    playlists: { [playlistId]: snapshot }, activeId: playlistId, meta: {},
    progress: {}, ranges: [], checkpoints: [], modules: [], sessions: [], goals: {},
    xp: [], achievements: {}, segments: [], playSessions: [], queue: {}, flexGoals: [],
    challenge: DEFAULT_CHALLENGE, challengeEnabled: false, rankHistory: [],
    prefs: { timezone: 'UTC', sessionLenMin: 25, breakMin: 5, reducedMotion: false, minViableMin: 10 },
    settings: { verifiedThreshold: 0.9 },
  };
  const { zip, manifest } = buildAccountExport(state, {
    username: 'fixture', displayName: 'Fixture', email: 'fixture@example.invalid',
    timezone: 'UTC', hasPassword: false, googleLinked: false, memberSince: now.toISOString(),
  }, now);
  const inventory = listZip(zip).map((name: string) => name.replace(/^LearnQuest-Account-Export\//, ''))
    .filter((name: string) => name !== 'README.md' && name !== 'manifest.json');
  expect(Object.keys(manifest.domains as Record<string, number>).sort()).toEqual(inventory.sort());
});
