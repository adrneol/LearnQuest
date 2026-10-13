import { describe, it, expect } from 'vitest';
import {
  dateKeyInTimezone,
  splitIntervalByDay,
  calendarWindowDates,
  addDaysToDateKey,
  attributeFocusByDay,
  activeFocusDayKeys,
  computeStreak,
} from '../src/domain/time/time.js';

// All expectations below are hand-written calendar facts / plain arithmetic,
// never produced by calling the implementation under test.

const T = (s: string) => new Date(s).getTime();

describe('calendar arithmetic (DST-safe)', () => {
  it('steps calendar dates, not 24h chains: leap day and year boundary', () => {
    expect(addDaysToDateKey('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDaysToDateKey('2024-02-29', 1)).toBe('2024-03-01');
    expect(addDaysToDateKey('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDaysToDateKey('2026-10-13', -13)).toBe('2026-09-30');
  });

  it('14-day window ending 2026-03-09 (NY spring-forward week) is 14 consecutive calendar dates', () => {
    // Spring forward Mar 8 2026 in America/New_York (23h local day).
    const end = T('2026-03-09T12:00:00Z');
    const w = calendarWindowDates(14, 'America/New_York', end);
    expect(w).toHaveLength(14);
    expect(w[13]).toBe('2026-03-09');
    expect(w[0]).toBe('2026-02-24'); // Mar 9 minus 13 calendar days
    expect(new Set(w).size).toBe(14); // no duplicates across the transition
    expect(w).toContain('2026-03-08'); // the 23h day is present exactly once
    expect(w).toContain('2026-03-09');
    for (let i = 1; i < w.length; i++) expect(addDaysToDateKey(w[i - 1], 1)).toBe(w[i]);
  });

  it('14-day window spanning the Nov 2026 fall-back (25h day) stays consecutive', () => {
    const end = T('2026-11-02T12:00:00Z');
    const w = calendarWindowDates(14, 'America/New_York', end);
    expect(w).toHaveLength(14);
    expect(w[13]).toBe('2026-11-02');
    expect(w).toContain('2026-11-01'); // the 25h day present exactly once
    expect(new Set(w).size).toBe(14);
  });

  it('Europe/London BST transitions keep calendar windows consecutive', () => {
    const spring = calendarWindowDates(7, 'Europe/London', T('2026-03-30T12:00:00Z'));
    expect(spring).toEqual([
      '2026-03-24', '2026-03-25', '2026-03-26', '2026-03-27',
      '2026-03-28', '2026-03-29', '2026-03-30',
    ]);
    const autumn = calendarWindowDates(7, 'Europe/London', T('2026-10-26T12:00:00Z'));
    expect(autumn[6]).toBe('2026-10-26');
    expect(autumn).toContain('2026-10-25');
  });

  it('23-hour local day totals 82,800s; 25-hour day totals 90,000s', () => {
    // NY Mar 8 2026: midnight EST (05:00Z) → next midnight EDT (next day 04:00Z).
    const spring = splitIntervalByDay(T('2026-03-08T05:00:00Z'), T('2026-03-09T04:00:00Z'), 'America/New_York');
    expect(spring).toHaveLength(1);
    expect(spring[0].dateKey).toBe('2026-03-08');
    expect(spring[0].seconds).toBe(82800);
    // NY Nov 1 2026: midnight EDT (04:00Z) → next midnight EST (next day 05:00Z).
    const fall = splitIntervalByDay(T('2026-11-01T04:00:00Z'), T('2026-11-02T05:00:00Z'), 'America/New_York');
    expect(fall).toHaveLength(1);
    expect(fall[0].dateKey).toBe('2026-11-01');
    expect(fall[0].seconds).toBe(90000);
  });

  it('repeated/skipped clock times still attribute wall time to the right dates', () => {
    // Fall-back ambiguous hour: 01:30 EDT (05:30Z) → 01:30 EST (06:30Z) is one wall hour on Nov 1.
    const s = splitIntervalByDay(T('2026-11-01T05:30:00Z'), T('2026-11-01T06:30:00Z'), 'America/New_York');
    expect(s.reduce((a, x) => a + x.seconds, 0)).toBe(3600);
    expect(s.every((x) => x.dateKey === '2026-11-01')).toBe(true);
  });
});

describe('focus attribution and streaks', () => {
  it('cross-midnight session splits proportionally to both days (UTC)', () => {
    // Wall 23:00→01:00 (7200s), active 3600 → 1800 per day.
    const m = attributeFocusByDay(
      [{ startedAt: '2026-10-12T23:00:00Z', finishedAt: '2026-10-13T01:00:00Z', activeSec: 3600 }],
      'UTC',
    );
    expect(m.get('2026-10-12')).toBe(1800);
    expect(m.get('2026-10-13')).toBe(1800);
  });

  it('cross-month and cross-year sessions attribute to both periods', () => {
    const m = attributeFocusByDay(
      [{ startedAt: '2026-01-31T23:30:00Z', finishedAt: '2026-02-01T00:30:00Z', activeSec: 3600 }],
      'UTC',
    );
    expect(m.get('2026-01-31')).toBe(1800);
    expect(m.get('2026-02-01')).toBe(1800);
    const y = attributeFocusByDay(
      [{ startedAt: '2025-12-31T23:00:00Z', finishedAt: '2026-01-01T01:00:00Z', activeSec: 3600 }],
      'UTC',
    );
    expect(y.get('2025-12-31')).toBe(1800);
    expect(y.get('2026-01-01')).toBe(1800);
  });

  it('timezone change keeps UTC total identical; only attribution moves', () => {
    const sess = [{ startedAt: '2026-10-12T18:00:00Z', finishedAt: '2026-10-12T19:00:00Z', activeSec: 3600 }];
    for (const tz of ['UTC', 'Asia/Kolkata', 'America/New_York', 'Asia/Tokyo', 'Europe/London']) {
      const m = attributeFocusByDay(sess, tz);
      expect([...m.values()].reduce((a, b) => a + b, 0)).toBe(3600);
    }
    // 18:00–19:00Z is one day in New York, two in Kolkata.
    expect(activeFocusDayKeys(sess, 'America/New_York').size).toBe(1);
    expect(activeFocusDayKeys(sess, 'Asia/Kolkata').size).toBe(2);
  });

  it('unfinished/invalid sessions attribute honestly to the start day', () => {
    const m = attributeFocusByDay(
      [{ startedAt: '2026-10-13T10:00:00Z', finishedAt: null, activeSec: 600 }],
      'UTC',
    );
    expect(m.get('2026-10-13')).toBe(600);
    const bad = attributeFocusByDay(
      [{ startedAt: '2026-10-13T10:00:00Z', finishedAt: '2026-10-13T09:00:00Z', activeSec: 600 }],
      'UTC',
    );
    expect(bad.get('2026-10-13')).toBe(600);
  });

  it('streak counts consecutive attributed days; a split session starts a 2-day streak', () => {
    const sessions = [
      { startedAt: '2026-10-12T23:00:00Z', finishedAt: '2026-10-13T01:00:00Z', activeSec: 3600 },
    ];
    const keys = activeFocusDayKeys(sessions, 'UTC');
    expect([...keys].sort()).toEqual(['2026-10-12', '2026-10-13']);
    expect(computeStreak(keys, '2026-10-13')).toBe(2);
    // Gap breaks the streak: only Oct 13 active → streak 1 on Oct 13, 0 lens on Oct 15.
    expect(computeStreak(new Set(['2026-10-13']), '2026-10-13')).toBe(1);
    expect(computeStreak(new Set(['2026-10-13']), '2026-10-15')).toBe(0);
    // Yesterday fallback: active yesterday, quiet today → streak 1.
    expect(computeStreak(new Set(['2026-10-12']), '2026-10-13')).toBe(1);
  });

  it('same instant lands on different dates per zone (no UTC slicing)', () => {
    const d = new Date('2026-03-08T20:00:00Z');
    expect(dateKeyInTimezone(d, 'UTC')).toBe('2026-03-08');
    expect(dateKeyInTimezone(d, 'Asia/Kolkata')).toBe('2026-03-09');
  });
});
