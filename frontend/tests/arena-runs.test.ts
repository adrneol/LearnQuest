import { expect, it } from 'vitest';
import {
  arenaWindow, EMPTY_ARENA, freezeArenaBasis, generateArenaRivals, makeArenaRun, observeArena,
  scoreArenaRun, sealArenaResult, transitionArena, type ArenaSetup,
} from '../src/domain/competition/arenaRuns';
import { isArenaLedger } from '../src/domain/competition/arenaValidation';
import { isArenaLedger as isServerArenaLedger } from '../../backend/src/services/arenaValidation';
import { buildBackup, validateBackup, type BackupState } from '../src/services/persistence/backup';
import { createFixedChallenge, DEFAULT_CHALLENGE } from '../src/domain/competition/competition';
import type { PlaybackSegment } from '../src/domain/playback/playback';
import type { PlaylistSnapshot } from '../src/types';

const now = Date.parse('2026-03-07T16:00:00Z');
const playlist: PlaylistSnapshot = {
  playlistId: 'PLarenaFixture', title: 'Frozen playlist', source: 'imported', fetchedAt: new Date(now).toISOString(),
  reportedCount: 2, snapshotVersion: 2,
  entries: [
    { position: 1, entryId: 'first', videoId: 'same', durationSec: 2000, title: 'First' },
    { position: 2, entryId: 'second', videoId: 'same', durationSec: 2000, title: 'Second' },
  ],
};
const basis = freezeArenaBasis(playlist)!;
const setup: ArenaSetup = { name: 'A measured run', kind: 'practice', seed: 37, opponents: 15, days: 14, difficulty: 'balanced' };
const empty = { progress: {}, segments: [], sessions: [] };

it('schedules at local midnight and seals only closed dates across spring DST', () => {
  const run = makeArenaRun('fixed', { ...setup, kind: 'fixed', days: 1 }, basis, 'America/New_York', now);
  expect(run.startedAt).toBe('2026-03-08T05:00:00.000Z');
  expect(run.endsAt).toBe('2026-03-09T04:00:00.000Z');
  expect(run.dates).toEqual(['2026-03-08']);
  expect(arenaWindow(run, now)).toMatchObject({ scheduled: true, observedDays: 0 });
  const start = Date.parse(run.startedAt);
  const end = Date.parse(run.endsAt!);
  expect(arenaWindow(run, start + 3600_000)).toMatchObject({ scheduled: false, observedDays: 0 });
  expect(arenaWindow(run, end)).toMatchObject({ expired: true, observedDays: 1 });
  const segment: PlaybackSegment = {
    id: 'clip', playlistId: playlist.playlistId, position: 1, entryId: 'first', videoId: 'same', sessionId: 's',
    wallStartMs: start - 60_000, wallEndMs: start + 600_000, timelineStartSec: 0, timelineEndSec: 660,
    playbackRate: 1, source: 'verified',
  };
  const evidence = observeArena(run, { ...empty, segments: [segment, { ...segment, id: 'repeated' }] }, arenaWindow(run, end + 1000));
  expect(evidence.uniqueContentSec).toBe(600);
  expect(evidence.daily).toEqual([{ dateKey: '2026-03-08', contentGainSec: 600, activePlaybackSec: 600, completedVideo: false, focusSec: 0 }]);
  const sealed = sealArenaResult(evidence, scoreArenaRun(run, evidence));
  const restored = JSON.parse(JSON.stringify({ ...run, state: 'completed', result: sealed }));
  expect(scoreArenaRun(restored, restored.result)).toEqual(scoreArenaRun(run, evidence));
});

it('keeps removed frozen occurrences distinct without pairing a new duplicate', () => {
  const run = makeArenaRun('practice', setup, basis, 'UTC', now);
  const progress = {
    removed: { playlistId: playlist.playlistId, position: 1, entryId: 'first', videoId: 'same',
      status: 'done' as const, source: 'manual' as const, completedAt: new Date(now - 86400_000).toISOString(),
      orphaned: true, reviewReason: 'removed' as const },
    unrelated: { playlistId: playlist.playlistId, position: 2, entryId: 'new-copy', videoId: 'same',
      status: 'done' as const, source: 'manual' as const, completedAt: new Date(now - 86400_000).toISOString() },
  };
  const evidence = observeArena(run, { ...empty, progress }, arenaWindow(run, now));
  expect(evidence.uniqueContentSec).toBe(2000);
  expect(evidence.daily.at(-1)?.completedVideo).toBe(true);
  expect(scoreArenaRun(run, evidence).userQualifyingDays).toBe(0);
});

it('limits practice coverage and qualification to the same closed days as rivals', () => {
  const run = makeArenaRun('window', { ...setup, days: 1 }, basis, 'UTC', now);
  const window = arenaWindow(run, now);
  expect(window.dates).toEqual(['2026-03-06']);
  const segment = (id: string, wallStartMs: number, timelineStartSec: number): PlaybackSegment => ({
    id, playlistId: playlist.playlistId, position: 1, entryId: 'first', videoId: 'same', sessionId: 's',
    wallStartMs, wallEndMs: wallStartMs + 600_000, timelineStartSec, timelineEndSec: timelineStartSec + 600,
    playbackRate: 1, source: 'verified',
  });
  const evidence = observeArena(run, { ...empty, segments: [
    segment('before', now - 2 * 86400_000, 0),
    segment('inside', now - 86400_000, 600),
    segment('outside frozen duration', now - 86400_000, 2500),
    segment('today', now - 3600_000, 1200),
  ] }, window);
  expect(evidence.uniqueContentSec).toBe(600);
  expect(evidence.daily).toEqual([{ dateKey: '2026-03-06', contentGainSec: 600, activePlaybackSec: 600, completedVideo: false, focusSec: 0 }]);
});

it('coordinates pause, resume, reset, seal, archive and idempotent delete without replacing unrelated runs', () => {
  const run = makeArenaRun('one', setup, basis, 'UTC', now);
  const next = makeArenaRun('two', setup, basis, 'UTC', now + 10);
  const evidence = observeArena(run, empty, arenaWindow(run, now));
  const result = sealArenaResult(evidence, scoreArenaRun(run, evidence));
  const created = transitionArena(EMPTY_ARENA, { type: 'create', run });
  const paused = transitionArena(created, { type: 'pause', id: 'one', result });
  expect(paused.active).toMatchObject({ state: 'paused', result });
  const resumed = transitionArena(paused, { type: 'resume', id: 'one' });
  expect(resumed.active).toMatchObject({ state: 'active', result: null });
  expect(transitionArena(resumed, { type: 'create', run: next, expectedId: 'stale', previous: result })).toBe(resumed);
  const reset = transitionArena(resumed, { type: 'create', run: next, expectedId: 'one', previous: result });
  expect(reset.active?.id).toBe('two');
  expect(reset.history[0]).toMatchObject({ id: 'one', state: 'archived', result });
  const completed = transitionArena(reset, { type: 'complete', id: 'two', result });
  expect(completed.active).toBeNull();
  const archived = transitionArena(completed, { type: 'archive', id: 'two' });
  expect(archived.history[0]).toMatchObject({ id: 'two', state: 'archived' });
  const deleted = transitionArena(archived, { type: 'delete', id: 'one' });
  expect(transitionArena(deleted, { type: 'delete', id: 'one' })).toBe(deleted);
  expect(deleted.history.map((item) => item.id)).toEqual(['two']);
  expect(isArenaLedger(JSON.parse(JSON.stringify(deleted)))).toBe(true);
  expect(isServerArenaLedger(deleted)).toBe(true);
  const invalid = { ...deleted, history: [...deleted.history, ...deleted.history] };
  expect(isArenaLedger(invalid)).toBe(false);
  expect(isServerArenaLedger(invalid)).toBe(false);
});

it('generates a deterministic and bounded 2,000-opponent board from daily evidence', () => {
  const run = makeArenaRun('scale', { ...setup, opponents: 2000, days: 90 }, basis, 'UTC', now);
  const evidence = observeArena(run, empty, arenaWindow(run, now));
  const start = performance.now();
  const rivals = generateArenaRivals(run, evidence.dates, evidence.observedDays, 4000);
  const board = scoreArenaRun(run, evidence, rivals);
  console.info('Arena v3, 2,000 opponents × 90 dates, generation and ranking ms:', Math.round(performance.now() - start));
  expect(board.rows).toHaveLength(2001);
  expect(board.userRank).toBeNull();
  expect(rivals.slice(0, 3)).toEqual(generateArenaRivals({ ...run, setup: { ...run.setup, opponents: 3 } }, evidence.dates, 90, 4000));
  for (const rival of rivals) {
    expect(rival.sessions.reduce((sum, session) => sum + session.contentSec, 0)).toBe(rival.uniqueContentSec);
    expect(rival.uniqueContentSec).toBeLessThanOrEqual(4000);
  }
  const scored = board.rows.filter((row) => row.rank !== null);
  expect(scored.every((row, i) => i === 0 || (row.value === scored[i - 1].value ? row.rank === scored[i - 1].rank : row.rank === i + 1))).toBe(true);
});

it('round-trips a replayable Arena archive and original legacy fixed metadata in backup v3', () => {
  const run = makeArenaRun('sealed', setup, basis, 'UTC', now);
  const evidence = observeArena(run, empty, arenaWindow(run, now));
  const result = sealArenaResult(evidence, scoreArenaRun(run, evidence));
  const arena = transitionArena({ ...EMPTY_ARENA, active: run }, { type: 'complete', id: run.id, result });
  const legacy = createFixedChallenge(DEFAULT_CHALLENGE, {
    playlistId: playlist.playlistId, playlistSnapshotVersion: 2, playlistDurationSec: 4000, windowDates: [], now: new Date(now),
  });
  const state: BackupState = {
    playlists: { [playlist.playlistId]: playlist }, meta: {}, activeId: playlist.playlistId, progress: {},
    ranges: [], checkpoints: [], modules: [], sessions: [], goals: {}, xp: [], achievements: {},
    prefs: { timezone: 'UTC', sessionLenMin: 25, breakMin: 5, reducedMotion: true, minViableMin: 10 },
    segments: [], playSessions: [], queue: {}, flexGoals: [], settings: { verifiedThreshold: 0.9 },
    challenge: { ...legacy, arena }, challengeEnabled: true, rankHistory: [],
  };
  const restored = validateBackup(buildBackup(state));
  expect(restored.ok).toBe(true);
  if (restored.ok) {
    expect(restored.backup.state.challenge.arena).toEqual(arena);
    expect(restored.backup.state.challenge.fixed).toEqual(legacy.fixed);
  }
});
