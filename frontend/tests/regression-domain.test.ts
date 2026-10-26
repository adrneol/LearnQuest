import { describe, it, expect } from 'vitest';
import {
  rankBoard, requiredEligibleDays, DEFAULT_CHALLENGE, type Competitor,
} from '../src/domain/competition/competition.js';
import { compareWindows } from '../src/domain/efficiency/efficiency.js';
import { playlistRemovalPlan, moveModuleWithinPlaylist } from '../src/domain/playlist/playlistOps.js';
import { toCsv, completionFromCoverage, isProgressComplete, computePlaylistProgress } from '../src/domain/index.js';
import type { PlaylistSnapshot, ProgressRecord } from '../src/domain/index.js';
import { completedEntryKeys } from '../src/domain/index.js';
import { snapshotToCsv } from '../src/services/api/playlistApi.js';

function rival(id: string, score: number | null, eligibleDays: number): Competitor {
  return {
    id, name: id, initials: id.slice(0, 2), tier: 'Good',
    uniqueContentSec: 1000, verifiedCount: 1, focusSec: 1000, activeDays: eligibleDays,
    windowDays: 14, sessions: [], efficiency: score ?? 0, practiceMin: 0,
    arenaScore: score, eligibleDays,
  };
}

describe('Arena percentile and trend eligibility', () => {
  it('excludes provisional rivals from the percentile denominator', () => {
    const board = rankBoard(DEFAULT_CHALLENGE, [
      rival('above', 80, 3),
      rival('below', 60, 5),
      rival('provisional', null, 0),
    ], { dailyEffs: [70, 70, 70], uniqueContentSec: 0, verifiedCount: 0, focusSec: 0, activeDays: 3 });
    expect(board.userScore).toBe(70);
    expect(board.userRank).toBe(2);
    // one of two scored rivals is strictly below 70 — provisional is excluded.
    expect(board.percentile).toBe(50);
    expect(board.required).toBe(requiredEligibleDays(14));
  });

  it('does not declare a trend meaningful from zero-filled calendar days', () => {
    const trend = compareWindows([10, 0, 0, 10, 0, 0, 10], [0, 0, 0, 0, 0, 0, 0]);
    expect(trend.recent).toBe(30);
    expect(trend.previous).toBe(0);
    expect(trend.sampleRecent).toBe(3);
    expect(trend.samplePrevious).toBe(0);
    expect(trend.meaningful).toBe(false);
  });
});

describe('playlist removal and module ordering', () => {
  it('cascades through every playlist-scoped collection and leaves others alone', () => {
    const plan = playlistRemovalPlan({
      progress: {
        p1: { playlistId: 'p1' }, p1orphan: { playlistId: 'p1', orphaned: true },
        p2: { playlistId: 'p2' },
      },
      ranges: [{ playlistId: 'p1' }, { playlistId: 'p2' }],
      checkpoints: [{ id: 'c1', playlistId: 'p1' }, { id: 'c2', playlistId: 'p2' }],
      modules: [{ playlistId: 'p1' }, { playlistId: 'p2' }],
      sessions: [{ playlistId: 'p1' }, { playlistId: 'p2' }, { playlistId: null }],
      segments: [{ playlistId: 'p1' }, { playlistId: 'p2' }],
      playSessions: [{ playlistId: 'p1' }, { playlistId: 'p2' }],
      flexGoals: [
        { playlistId: 'p1' },
        { playlistId: 'p2' },
        { playlistId: null, checkpointId: 'c1' },
        { playlistId: null, checkpointId: 'c2' },
      ],
      queue: { p1: [1], p2: [2] },
    }, 'p1');
    expect(Object.keys(plan.progress)).toEqual(['p2']);
    expect(plan.ranges).toEqual([{ playlistId: 'p2' }]);
    expect(plan.checkpoints).toEqual([{ id: 'c2', playlistId: 'p2' }]);
    expect(plan.modules).toEqual([{ playlistId: 'p2' }]);
    expect(plan.sessions).toEqual([{ playlistId: 'p2' }, { playlistId: null }]);
    expect(plan.segments).toEqual([{ playlistId: 'p2' }]);
    expect(plan.playSessions).toEqual([{ playlistId: 'p2' }]);
    expect(plan.flexGoals).toEqual([{ playlistId: 'p2' }, { playlistId: null, checkpointId: 'c2' }]);
    expect(plan.queue).toEqual({ p2: [2] });
  });

  it('moves modules only within their own playlist', () => {
    const modules = [
      { id: 'a1', playlistId: 'a' }, { id: 'b1', playlistId: 'b' },
      { id: 'a2', playlistId: 'a' }, { id: 'a3', playlistId: 'a' },
    ];
    const next = moveModuleWithinPlaylist(modules, 'a2', -1);
    expect(next.map((m) => m.id)).toEqual(['a2', 'b1', 'a1', 'a3']);
    // At the top of its own playlist: no cross-playlist swap.
    expect(moveModuleWithinPlaylist(modules, 'a1', -1).map((m) => m.id)).toEqual(modules.map((m) => m.id));
  });
});

describe('completion predicate and CSV hardening', () => {
  it('a present key is not completion; empty playlists are not complete', () => {
    const incomplete = { playlistId: 'x', position: 1, videoId: 'v', completedAt: '2026-01-01T00:00:00Z', status: 'in-progress' } as ProgressRecord;
    expect(isProgressComplete(incomplete)).toBe(false);
    expect(isProgressComplete({ ...incomplete, status: 'done' })).toBe(true);
    expect(isProgressComplete({ ...incomplete, status: 'done', orphaned: true })).toBe(false);

    const empty: PlaylistSnapshot = {
      playlistId: 'PLempty000000000000', title: 'Empty', reportedCount: 0, entries: [],
      source: 'imported', fetchedAt: '2026-01-01T00:00:00Z', snapshotVersion: 2,
    };
    const p = computePlaylistProgress(empty, {});
    expect(p.n).toBe(0);
    expect(p.countPct).toBe(0);
    expect(p.durationPct).toBeNull();
    expect(p.completedCount).toBe(0);
  });

  it('prefixes spreadsheet formula sigils and leaves numeric cells numeric', () => {
    const csv = toCsv([
      ['=HYPERLINK("http://evil")', '+1', '-2', '@cmd', '\tlead', '\rlead', 'safe text', 19],
    ], ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    const row = csv.split('\n')[1];
    expect(row).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(row).toContain("'+1");
    expect(row).toContain("'-2");
    expect(row).toContain("'@cmd");
    expect(row).toContain("'\tlead");
    expect(row).toContain("'\rlead");
    expect(row).toContain('safe text');
    expect(row.endsWith(',19')).toBe(true);
  });

  it('videos CSV reports done by occurrence identity, not stale position keys', () => {
    const snap: PlaylistSnapshot = {
      playlistId: 'PLcsv00000000000000', title: 'CSV', reportedCount: 2,
      entries: [
        { position: 1, entryId: 'e1', videoId: 'v1', title: 'One', durationSec: 60 },
        { position: 2, entryId: 'e2', videoId: 'v2', title: 'Two', durationSec: 60 },
      ],
      source: 'api', fetchedAt: '2026-01-01T00:00:00Z', snapshotVersion: 2,
    };
    const progress: Record<string, ProgressRecord> = {
      'PLcsv00000000000000::e1': {
        playlistId: snap.playlistId, position: 1, entryId: 'e1', videoId: 'v1',
        completedAt: '2026-01-01T00:00:00Z', status: 'done',
      },
    };
    const csv = snapshotToCsv(snap, completedEntryKeys(snap, progress));
    const lines = csv.split('\n');
    expect(lines[1].endsWith(',done,https://www.youtube.com/watch?v=v1&list=PLcsv00000000000000')).toBe(true);
    expect(lines[2]).toContain(',todo,');
  });

  it('manual completion is never labelled verified by coverage', () => {
    expect(completionFromCoverage(0, 100, { manualDone: true })).toBe('manual');
    expect(completionFromCoverage(90, 100, { manualDone: true })).toBe('verified');
    expect(completionFromCoverage(50, 100)).toBe('in-progress');
    expect(completionFromCoverage(100, null)).toBe('unavailable');
    expect(completionFromCoverage(100, 100, { needsRevision: true })).toBe('needs-revision');
  });
});
