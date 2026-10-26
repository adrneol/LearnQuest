// Timezone-safe day keys, streaks, and cross-midnight interval splitting.
// All real events are stored as UTC instants; the selected IANA timezone only
// affects presentation/aggregation — never rewrites stored timestamps.

import { supportedZone } from './timezones.js';
import type { FocusInterval } from '../../types/index.js';

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
  intervals?: FocusInterval[];
  estimated?: boolean;
}

export interface DaySeconds {
  dateKey: string;
  sec: number;
}

function addSeconds(map: Map<string, number>, key: string, value: number): void {
  if (!Number.isFinite(value) || value === 0) return;
  map.set(key, (map.get(key) ?? 0) + Math.round(value));
}

/**
 * Per-day slices for one focus session. When real active intervals are
 * stored, only active wall time is attributed (pauses are excluded); legacy
 * sessions fall back to proportional wall-interval attribution. The total is
 * reconciled to `activeSec` so rounding never invents or loses time.
 */
export function focusSessionDaySlices(session: FocusSessionLike, timeZone: string): DaySeconds[] {
  const activeSec = Number.isFinite(session.activeSec) ? Math.max(0, Math.round(session.activeSec)) : 0;
  if (activeSec === 0) return [];
  const start = new Date(session.startedAt).getTime();
  if (!Number.isFinite(start)) return [];
  const end = session.finishedAt ? new Date(session.finishedAt).getTime() : NaN;
  const activeIntervals = (session.intervals ?? [])
    .filter((i) => i && i.kind === 'active' && Number.isFinite(i.startMs) && Number.isFinite(i.endMs) && i.endMs > i.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  const raw = new Map<string, number>();
  if (activeIntervals.length > 0 && !session.estimated) {
    const totalMs = activeIntervals.reduce((a, i) => a + (i.endMs - i.startMs), 0);
    if (totalMs > 0) {
      for (const interval of activeIntervals) {
        for (const slice of splitIntervalByDay(interval.startMs, interval.endMs, timeZone)) {
          addSeconds(raw, slice.dateKey, (activeSec * slice.seconds * 1000) / totalMs);
        }
      }
    }
  }
  if (raw.size === 0) {
    // Legacy / manually corrected session: proportional wall attribution.
    if (!Number.isFinite(end) || end <= start) {
      raw.set(dateKeyInTimezone(new Date(start), timeZone), activeSec);
    } else {
      const wallSec = Math.max(1, Math.round((end - start) / 1000));
      for (const slice of splitIntervalByDay(start, end, timeZone)) {
        addSeconds(raw, slice.dateKey, (activeSec * slice.seconds) / wallSec);
      }
    }
  }
  const slices = [...raw.entries()].map(([dateKey, sec]) => ({ dateKey, sec: Math.round(sec) }));
  const total = slices.reduce((a, s) => a + s.sec, 0);
  const diff = activeSec - total;
  if (diff !== 0) {
    if (slices.length === 0) slices.push({ dateKey: dateKeyInTimezone(new Date(start), timeZone), sec: activeSec });
    else slices[slices.length - 1].sec += diff;
  }
  return slices.filter((s) => s.sec !== 0);
}

/**
 * Attribute focused study seconds to local calendar days. With real active
 * intervals, pauses and cross-midnight gaps are allocated exactly; legacy
 * sessions share activeSec proportionally across wall time. This is the one
 * authoritative focus-day attribution used by streaks, goals, Efficiency,
 * Dashboard, History, and Arena.
 */
export function attributeFocusByDay(
  sessions: FocusSessionLike[],
  timeZone: string,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of sessions) {
    for (const slice of focusSessionDaySlices(s, timeZone)) addSeconds(out, slice.dateKey, slice.sec);
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
 * UTC instant representing local noon on a calendar date in `timeZone`.
 * Used to construct/format date-only values without host-timezone drift.
 */
export function zonedNoonMs(dateKey: string, timeZone: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return NaN;
  const tz = supportedZone(timeZone);
  const [y, m, d] = dateKey.split('-').map(Number);
  let guess = Date.UTC(y, m - 1, d, 12, 0, 0);
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(guess));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const localAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));
    const desired = Date.UTC(y, m - 1, d, 12, 0, 0);
    const delta = desired - localAsUtc;
    if (delta === 0) break;
    guess += delta;
  }
  return guess;
}

/**
 * Split a UTC interval [startMs, endMs) across calendar dates in `timeZone`,
 * so cross-midnight sessions attribute each day only its own elapsed time.
 * Resolution: 1 minute. Pure + testable.
 */
export function splitIntervalByDay(startMs: number, endMs: number, timeZone: string): DaySlice[] {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
  const tz = supportedZone(timeZone);
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

export interface PlaybackSegmentDaySlice<T> {
  dateKey: string;
  segment: T;
}

/**
 * Split one playback segment at local midnight. Timeline coverage is shared
 * proportionally with wall time, so a cross-midnight watch contributes only
 * the observed portion to each day and never invents skipped content.
 */
export function splitPlaybackSegmentByDay<T extends {
  id: string;
  wallStartMs: number;
  wallEndMs: number;
  timelineStartSec: number;
  timelineEndSec: number;
}>(segment: T, timeZone: string): PlaybackSegmentDaySlice<T>[] {
  const { wallStartMs: start, wallEndMs: end, timelineStartSec: ts, timelineEndSec: te } = segment;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  if (!Number.isFinite(ts) || !Number.isFinite(te) || te <= ts) return [];
  const slices = splitIntervalByDay(start, end, timeZone);
  const wallSec = slices.reduce((a, s) => a + s.seconds, 0);
  if (wallSec <= 0) return [];
  let consumed = 0;
  return slices.map((slice, idx) => {
    const isLast = idx === slices.length - 1;
    const shareStart = consumed;
    const shareEnd = isLast ? te - ts : Math.min(te - ts, shareStart + ((te - ts) * slice.seconds) / wallSec);
    consumed = shareEnd;
    const wallShareStart = start + (end - start) * (shareStart / (te - ts));
    const wallShareEnd = start + (end - start) * (shareEnd / (te - ts));
    return {
      dateKey: slice.dateKey,
      segment: {
        ...segment,
        id: `${segment.id}:${slice.dateKey}`,
        wallStartMs: Math.round(wallShareStart),
        wallEndMs: Math.round(wallShareEnd),
        timelineStartSec: ts + shareStart,
        timelineEndSec: ts + shareEnd,
      },
    };
  });
}

/** Group playback evidence by local calendar day, split at midnight. */
export function attributePlaybackByDay<T extends {
  id: string;
  wallStartMs: number;
  wallEndMs: number;
  timelineStartSec: number;
  timelineEndSec: number;
}>(segments: T[], timeZone: string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const segment of segments) {
    for (const slice of splitPlaybackSegmentByDay(segment, timeZone)) {
      const arr = out.get(slice.dateKey) ?? [];
      arr.push(slice.segment);
      out.set(slice.dateKey, arr);
    }
  }
  return out;
}
