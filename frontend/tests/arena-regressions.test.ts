import { expect, it } from 'vitest';
import { challengeWindowDates, computeArenaUserEvidence, createFixedChallenge, DEFAULT_CHALLENGE } from '../src/domain/competition/competition.js';
import type { PlaylistSnapshot, ProgressRecord } from '../src/types/index.js';

const now = new Date('2026-11-10T12:00:00Z');
const playlistId = 'PLregression00000001';
const entry = { position: 1, entryId: 'e1', videoId: 'fixture0001', title: 'Lesson one', durationSec: 2_000 };
const snapshot: PlaylistSnapshot = {
  playlistId, title: 'Synthetic course', entries: [entry], reportedCount: 1,
  source: 'imported', fetchedAt: now.toISOString(), snapshotVersion: 2,
};

it('ARENA-1: completing a lesson later preserves its earlier qualifying playback day', () => {
  const dayOne = Date.parse('2026-11-01T12:00:00Z');
  const evidence: Parameters<typeof computeArenaUserEvidence>[0] = {
    snapshot, progress: {}, sessions: [], timeZone: 'UTC',
    windowDates: ['2026-11-01', '2026-11-02'],
    segments: [{
      id: 'segment-one', playlistId, entryId: entry.entryId, videoId: entry.videoId,
      position: 1, source: 'verified', wallStartMs: dayOne, wallEndMs: dayOne + 600_000,
      timelineStartSec: 0, timelineEndSec: 600, playbackRate: 1, sessionId: 'play-one',
    }],
  };
  expect(computeArenaUserEvidence(evidence).qualifyingDays).toBe(1);
  const completed: ProgressRecord = {
    playlistId, position: 1, videoId: entry.videoId, entryId: entry.entryId,
    status: 'done', source: 'manual', completedAt: '2026-11-02T12:00:00Z',
  };
  const after = computeArenaUserEvidence({
    ...evidence, progress: { [`${playlistId}::${entry.entryId}`]: completed },
  });
  expect(after.qualifyingDays).toBe(1);
});

it('ARENA-2: fixed-run dates agree with its advertised start and end', () => {
  const fixed = createFixedChallenge(DEFAULT_CHALLENGE, {
    playlistId, playlistSnapshotVersion: snapshot.snapshotVersion,
    playlistDurationSec: entry.durationSec,
    windowDates: challengeWindowDates(DEFAULT_CHALLENGE.windowDays, 'UTC', now.getTime()),
    now,
  }).fixed;
  expect(fixed).toBeTruthy();
  if (!fixed) throw new Error('Fixture did not start a fixed challenge');
  expect(fixed.windowDates).toHaveLength(DEFAULT_CHALLENGE.windowDays);
  expect(fixed.windowDates.filter((date) =>
    date < fixed.startedAt.slice(0, 10) || date > fixed.endsAt.slice(0, 10),
  )).toEqual([]);
});

