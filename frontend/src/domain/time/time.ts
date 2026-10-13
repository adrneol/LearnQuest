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

/**
 * Calendar-day arithmetic on YYYY-MM-DD keys. Keys are calendar dates, not
 * instants, so stepping by whole UTC days is exact — DST never shifts a
 * calendar sequence (a 23h/25h local day is still exactly one calendar date).
 */
export function addDaysToDateKey(dateKey: string, delta: number): string {
  const t = new Date(dateKey + 'T00:00:00Z').getTime();
  if (!Number.isFinite(t)) return dateKey;
  return new Date(t + delta * 86400000).toISOString().slice(0, 10);
}

/**
 * N-day calendar window ending today, oldest → newest, in `timeZone`.
 * DST-safe: derives today's local calendar date first, then steps by calendar
 * days — never by fixed 24h chains from Date.now(). The current partial day
 * is included as the last entry.
 */
export function calendarWindowDates(windowDays: number, timeZone: string, nowMs = Date.now()): string[] {
  if (!Number.isInteger(windowDays) || windowDays <= 0) return [];
  const today = dateKeyInTimezone(new Date(nowMs), timeZone);
  const out: string[] = [];
  for (let i = windowDays - 1; i >= 0; i--) out.push(addDaysToDateKey(today, -i));
  return out;
}

export interface FocusSessionLike {
  startedAt: string;
  finishedAt: string | null;
  activeSec: number;
}

/**
 * Attribute focused study seconds to local calendar days by splitting each
 * session's wall interval at the timezone's day boundaries and sharing
 * activeSec proportionally. Cross-midnight sessions contribute to both days;
 * sessions without a finish timestamp attribute to their start day. This is
 * the single authoritative focus-day attribution (streaks, goals, Efficiency,
 * Dashboard, History, Arena user table) so stored `dateKey` labels can never
 * diverge from interval reality after a timezone change.
 */
export function attributeFocusByDay(
  sessions: FocusSessionLike[],
  timeZone: string,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of sessions) {
    if (!Number.isFinite(s.activeSec) || s.activeSec < 0) continue;
    const start = new Date(s.startedAt).getTime();
    if (!Number.isFinite(start)) continue;
    if (!s.finishedAt) {
      const k = dateKeyInTimezone(new Date(start), timeZone);
      out.set(k, (out.get(k) ?? 0) + Math.round(s.activeSec));
      continue;
    }
    const end = new Date(s.finishedAt).getTime();
    if (!Number.isFinite(end) || end <= start) {
      const k = dateKeyInTimezone(new Date(start), timeZone);
      out.set(k, (out.get(k) ?? 0) + Math.round(s.activeSec));
      continue;
    }
    const wall = Math.max(1, Math.round((end - start) / 1000));
    for (const sl of splitIntervalByDay(start, end, timeZone)) {
      out.set(sl.dateKey, (out.get(sl.dateKey) ?? 0) + Math.round((s.activeSec * sl.seconds) / wall));
    }
  }
  return out;
}

/** Focused seconds recorded on one calendar day (0 when none). */
export function focusOnDay(sessions: FocusSessionLike[], dateKey: string, timeZone: string): number {
  return attributeFocusByDay(sessions, timeZone).get(dateKey) ?? 0;
}

/** Active calendar days (focus > 0) derived from intervals, not stored labels. */
export function activeFocusDayKeys(sessions: FocusSessionLike[], timeZone: string): Set<string> {
  const m = attributeFocusByDay(sessions, timeZone);
  return new Set([...m.entries()].filter(([, v]) => v > 0).map(([k]) => k));
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
  // Walk minute by minute (bounded: cap at 48h to avoid pathological loops
  // while covering 25h fall-back DST days, which a 24h cap would truncate).
  const cappedEnd = Math.min(endMs, startMs + 48 * 3600 * 1000);
  for (let t = startMs; t < cappedEnd; t += 60_000) {
    const k = dateKeyInTimezone(new Date(t), tz);
    out.set(k, (out.get(k) ?? 0) + Math.min(60, Math.round((cappedEnd - t) / 1000)));
  }
  return [...out.entries()].map(([dateKey, seconds]) => ({ dateKey, seconds }));
}
