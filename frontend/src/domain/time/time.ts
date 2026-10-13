// Timezone-safe day keys, streaks, and cross-midnight interval splitting.
// All real events are stored as UTC instants; the selected IANA timezone only
// affects presentation/aggregation — never rewrites stored timestamps.

import { supportedZone } from './timezones.js';

export interface StudySessionLike {
  dateKey: string;
}

/** YYYY-MM-DD key in the given IANA timezone. Falls back to UTC on invalid tz. */
export function dateKeyInTimezone(date: Date, timeZone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: supportedZone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit' });
    return fmt.format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function distinctDayKeys(sessions: StudySessionLike[]): Set<string> {
  return new Set(sessions.map((s) => s.dateKey));
}

/** Consecutive-day streak ending today (or yesterday if today has no activity yet). */
export function computeStreak(dayKeys: Set<string>, todayKey: string): number {
  if (dayKeys.size === 0) return 0;
  const has = (k: string) => dayKeys.has(k);
  const parseDay = (k: string) => new Date(k + 'T00:00:00Z').getTime();
  const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);
  let cursor = todayKey;
  if (!has(cursor)) {
    cursor = fmt(parseDay(cursor) - 86400000);
    if (!has(cursor)) return 0;
  }
  let streak = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (has(cursor)) {
      streak += 1;
      cursor = fmt(parseDay(cursor) - 86400000);
    } else break;
    if (streak > 3660) break;
  }
  return streak;
}

/** Searchable timezone list: UTC + all runtime-supported IANA names. */
export function listTimezones(): string[] {
  const base: string[] =
    typeof (Intl as any).supportedValuesOf === 'function'
      ? (Intl as any).supportedValuesOf('timeZone')
      : ['UTC', 'Asia/Kolkata', 'America/New_York', 'Europe/London', 'Europe/Berlin', 'Australia/Sydney'];
  return ['local', 'UTC', ...base.filter((z: string) => z !== 'UTC')];
}

export interface DaySlice {
  dateKey: string;
  seconds: number;
}

/**
 * Split a UTC interval [startMs, endMs) across calendar dates in `timeZone`,
 * so cross-midnight sessions attribute each day only its own elapsed time.
 * Resolution: 1 minute. Pure + testable.
 */
export function splitIntervalByDay(startMs: number, endMs: number, timeZone: string): DaySlice[] {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
  const tz = timeZone === 'local' ? Intl.DateTimeFormat().resolvedOptions().timeZone : timeZone;
  const out = new Map<string, number>();
  // Walk minute by minute (bounded: cap at 24h to avoid pathological loops)
  const cappedEnd = Math.min(endMs, startMs + 24 * 3600 * 1000);
  for (let t = startMs; t < cappedEnd; t += 60_000) {
    const k = dateKeyInTimezone(new Date(t), tz);
    out.set(k, (out.get(k) ?? 0) + Math.min(60, Math.round((cappedEnd - t) / 1000)));
  }
  return [...out.entries()].map(([dateKey, seconds]) => ({ dateKey, seconds }));
}
