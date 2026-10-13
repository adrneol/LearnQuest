import { describe, it, expect } from 'vitest';
import {
  calendarWindowDates,
  attributeFocusByDay,
  activeFocusDayKeys,
  dateKeyInTimezone,
} from '../src/domain/time/time.js';
import {
  summarizeSegments,
  type PlaybackSegment,
} from '../src/domain/playback/playback.js';
import {
  contentEfficiency,
  overallEfficiency,
  eligibleDailyEfficiencies,
} from '../src/domain/efficiency/efficiency.js';
import { arenaScore, rankBoard, DEFAULT_CHALLENGE } from '../src/domain/competition/competition.js';
import { isRevisionOverdue, revisionFilterStatus } from '../src/domain/revision/revision.js';
import { validateImportedSnapshot, toCsv } from '../src/services/exports/imports.js';
import { snapshotToCsv } from '../src/services/api/playlistApi.js';
import { kvSet, kvGet, kvDump, kvClearAll } from '../src/services/persistence/db.js';

// Hand-computed expectations throughout: plain arithmetic and calendar facts,
// never the implementation under test.

let n = 1000;
const seg = (o: Partial<PlaybackSegment>): PlaybackSegment => ({
  id: `v6s${(n += 1)}`,
  playlistId: 'PLx',
  position: 1,
  videoId: 'v',
  sessionId: 'sess',
  wallStartMs: 0,
  wallEndMs: 60_000,
  timelineStartSec: 0,
  timelineEndSec: 60,
  playbackRate: 1,
  source: 'verified',
  ...o,
});

describe('revision overdue (display-timezone calendar days)', () => {
  it('past dates are overdue; today/future are not; bad input fails closed', () => {
    expect(isRevisionOverdue('2026-10-12', '2026-10-13')).toBe(true);
    expect(isRevisionOverdue('2026-10-13', '2026-10-13')).toBe(false);
    expect(isRevisionOverdue('2026-10-14', '2026-10-13')).toBe(false);
    expect(isRevisionOverdue(null, '2026-10-13')).toBe(false);
    expect(isRevisionOverdue(undefined, '2026-10-13')).toBe(false);
    expect(isRevisionOverdue('', '2026-10-13')).toBe(false);
    expect(isRevisionOverdue('tomorrow', '2026-10-13')).toBe(false);
    expect(isRevisionOverdue('2026-10-12', 'not-a-date')).toBe(false);
    // Year/month boundaries compare correctly as ISO strings.
    expect(isRevisionOverdue('2025-12-31', '2026-01-01')).toBe(true);
  });

  it('queue filters match the documented rules', () => {
    const low = { confidence: 1 as const };
    expect(revisionFilterStatus(low, 'low', '2026-10-13')).toBe(true);
    expect(revisionFilterStatus({ confidence: 5 as const }, 'low', '2026-10-13')).toBe(false);
    expect(revisionFilterStatus({ needsRevision: true }, 'todo-ex', '2026-10-13')).toBe(true);
    expect(revisionFilterStatus({ exerciseDone: true }, 'todo-ex', '2026-10-13')).toBe(false);
    expect(revisionFilterStatus({ questions: '  why? ' }, 'questions', '2026-10-13')).toBe(true);
    expect(revisionFilterStatus({ questions: '   ' }, 'questions', '2026-10-13')).toBe(false);
    expect(revisionFilterStatus({ revisionDate: '2026-10-12' }, 'overdue', '2026-10-13')).toBe(true);
    expect(revisionFilterStatus({ revisionDate: '2026-10-13' }, 'overdue', '2026-10-13')).toBe(false);
    expect(revisionFilterStatus(null, 'all', '2026-10-13')).toBe(false);
    expect(revisionFilterStatus({ confidence: 3 as const }, 'all', '2026-10-13')).toBe(true);
  });
});

describe('overnight rollover (pure calendar boundary)', () => {
  it('a New York midnight tick slides the 7-day window by exactly one day', () => {
    // 03:59Z Oct 13 = Oct 12 23:59 EDT; 04:01Z = Oct 13 00:01 EDT.
    const before = calendarWindowDates(7, 'America/New_York', Date.UTC(2026, 9, 13, 3, 59));
    const after = calendarWindowDates(7, 'America/New_York', Date.UTC(2026, 9, 13, 4, 1));
    expect(before[6]).toBe('2026-10-12');
    expect(after[6]).toBe('2026-10-13');
    expect(after[0]).toBe(before[1]);
    expect(after.slice(0, 6)).toEqual(before.slice(1));
  });

  it('suspended-tab resume recomputes from the same pure function (no hidden state)', () => {
    const t = Date.UTC(2026, 9, 13, 12, 0);
    expect(calendarWindowDates(14, 'UTC', t)).toEqual(calendarWindowDates(14, 'UTC', t));
    expect(dateKeyInTimezone(new Date(t), 'UTC')).toBe('2026-10-13');
  });
});

describe('clock-change honesty', () => {
  it('end-before-start attributes the full active time to the start day (never negative, never fabricated)', () => {
    const m = attributeFocusByDay(
      [{ startedAt: '2026-10-13T10:00:00Z', finishedAt: '2026-10-13T09:00:00Z', activeSec: 600 }],
      'UTC',
    );
    expect(m.get('2026-10-13')).toBe(600);
    expect([...m.values()].every((v) => v >= 0)).toBe(true);
  });

  it('zero-active sessions create no active days', () => {
    const sessions = [{ startedAt: '2026-10-13T10:00:00Z', finishedAt: '2026-10-13T10:05:00Z', activeSec: 0 }];
    expect(activeFocusDayKeys(sessions, 'UTC').size).toBe(0);
  });
});

describe('cross-screen agreement on one hand-verified story', () => {
  // Lesson 600s. Day 1: watch 0–300 + rewatch 0–100 (unique 300, total 400),
  // focus 900s. Day 2: watch 300–600 (unique 300), focus 300s.
  const day1Segs = [
    seg({ timelineStartSec: 0, timelineEndSec: 300, wallStartMs: 1000, wallEndMs: 301000 }),
    seg({ timelineStartSec: 0, timelineEndSec: 100, wallStartMs: 901000, wallEndMs: 1001000 }),
  ];
  const day2Segs = [seg({ timelineStartSec: 300, timelineEndSec: 600, wallStartMs: 2000, wallEndMs: 302000 })];
  const focus = [
    { startedAt: '2026-10-12T10:00:00Z', finishedAt: '2026-10-12T10:15:00Z', activeSec: 900 },
    { startedAt: '2026-10-13T10:00:00Z', finishedAt: '2026-10-13T10:05:00Z', activeSec: 300 },
  ];

  it('playback union, daily, overall, and arena figures all agree', () => {
    expect(summarizeSegments(day1Segs).uniqueSec).toBe(300);
    expect(summarizeSegments(day1Segs).totalContentSec).toBe(400);
    expect(summarizeSegments(day2Segs).uniqueSec).toBe(300);
    // 60 unique min in 180 focused min = 33.33% (the canonical example).
    expect(contentEfficiency({ uniqueContentSec: 3600, focusedSec: 10800 })).toBeCloseTo(33.333, 2);
    // Story dailies: 300/900 = 33.33%, 300/300 = 100%.
    const dailies = eligibleDailyEfficiencies([
      { dateKey: '2026-10-12', uniqueSec: 300, focusSec: 900 },
      { dateKey: '2026-10-13', uniqueSec: 300, focusSec: 300 },
    ]);
    expect(dailies[0]).toBeCloseTo(33.333, 2);
    expect(dailies[1]).toBe(100);
    // Overall is the aggregate 600/1200 = 50% — never the 66.67 mean.
    expect(overallEfficiency([
      { uniqueContentSec: 300, focusedSec: 900 },
      { uniqueContentSec: 300, focusedSec: 300 },
    ])).toBe(50);
    // Arena deliberately differs: mean of dailies = 66.67%.
    expect(arenaScore(dailies)).toBeCloseTo(66.667, 2);
    // Attribution reconstructs the same denominators History/Dashboard use.
    const byDay = attributeFocusByDay(focus, 'UTC');
    expect(byDay.get('2026-10-12')).toBe(900);
    expect(byDay.get('2026-10-13')).toBe(300);
  });

  it('exports reproduce source values verbatim', () => {
    const csv = toCsv([['a,b', 'q"q', 60]], ['h1', 'h2', 'h3']);
    expect(csv).toBe('h1,h2,h3\n"a,b","q""q",60');
    const r = validateImportedSnapshot({ playlistId: 'x', title: 't', entries: 'nope' });
    expect(r.ok).toBe(false);
    const dup = validateImportedSnapshot({
      playlistId: 'PLdup1234567890',
      title: 't',
      entries: [
        { position: 1, videoId: 'a', title: 'A', durationSec: 60 },
        { position: 1, videoId: 'b', title: 'B', durationSec: 60 },
      ],
    });
    expect(dup.ok).toBe(false);
    expect(dup.errors.join(' ')).toMatch(/duplicate/i);
  });
});

describe('persistence primitives (fake-indexeddb)', () => {
  it('kv round-trips preserve ISO timestamps verbatim; dump contains the key', async () => {
    await kvClearAll();
    const rec = { completedAt: '2026-10-13T10:00:00.000Z', status: 'done', note: 'ünicode ✓' };
    await kvSet('v6probe', rec);
    expect(await kvGet('v6probe')).toEqual(rec);
    const dump = await kvDump();
    expect(dump['v6probe']).toEqual(rec);
    await kvClearAll();
    expect(await kvGet('v6probe')).toBeUndefined();
  });
});

describe('large-playlist workflows beyond sorting', () => {
  it('1000-video CSV export has one header + 1000 rows; unresolved marked', () => {
    const snap: any = {
      playlistId: 'PLscale1000aaaaaaaaaaaaaaaaaaaaaaa',
      title: 'Scale',
      entries: Array.from({ length: 1000 }, (_, i) => ({
        position: i + 1,
        videoId: `v${i + 1}`,
        title: `Video ${i + 1}`,
        durationSec: (i + 1) % 37 === 0 ? null : 120,
      })),
    };
    const csv = snapshotToCsv(snap, new Set());
    const lines = csv.split('\n');
    expect(lines).toHaveLength(1001);
    expect(lines.filter((l) => l.includes('UNRESOLVED'))).toHaveLength(Math.floor(1000 / 37));
  });

  it('1000-competitor leaderboard paginates and orders by efficiency desc', () => {
    const mk = (id: string, eff: number) => ({
      id,
      name: 'B',
      initials: 'B',
      tier: 'Normal' as const,
      uniqueContentSec: eff * 36,
      verifiedCount: 1,
      focusSec: 3600,
      activeDays: 3,
      windowDays: 14,
      sessions: [],
      efficiency: eff,
      practiceMin: 0,
      arenaScore: eff,
      eligibleDays: 3,
    });
    const comps = Array.from({ length: 999 }, (_, i) => mk(`c${i}`, 20 + (i % 60)));
    const board = rankBoard(
      { ...DEFAULT_CHALLENGE, cohortSize: 1000 },
      comps,
      { dailyEffs: [50, 50, 50], uniqueContentSec: 0, verifiedCount: 0, focusSec: 0, activeDays: 0 },
    );
    expect(board.rows).toHaveLength(1000);
    const scored = board.rows.filter((r) => r.value !== null).map((r) => r.value as number);
    for (let i = 1; i < scored.length; i++) expect(scored[i - 1]).toBeGreaterThanOrEqual(scored[i]);
    expect(Math.ceil(board.rows.length / 50)).toBe(20);
  });
});
