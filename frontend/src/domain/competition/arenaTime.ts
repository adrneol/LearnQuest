import { addDaysToDateKey, dateKeyInTimezone, zonedNoonMs } from '../time/time.js';
import { supportedZone } from '../time/timezones.js';
import { mergeIntervals, type PlaybackSegment } from '../playback/playback.js';
import type { StudySession } from '../../types/index.js';

export interface ArenaInterval { start: number; end: number }

export function arenaTimezone(zone: string): string {
  try { return new Intl.DateTimeFormat('en', { timeZone: supportedZone(zone) }).resolvedOptions().timeZone; }
  catch { return 'UTC'; }
}

/** First instant of a local date (or the following date if this one was skipped). */
export function arenaDayStart(date: string, zone: string): number {
  const noon = zonedNoonMs(date, zone);
  let low = noon - 36 * 3600_000;
  let high = noon + 36 * 3600_000;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (dateKeyInTimezone(new Date(mid), zone) < date) low = mid;
    else high = mid;
  }
  return high;
}

export function forwardArenaWindow(days: number, zone: string, now: number) {
  const first = dateKeyInTimezone(new Date(now), zone);
  const dates = Array.from({ length: days }, (_, index) => addDaysToDateKey(first, index));
  return { dates, end: arenaDayStart(addDaysToDateKey(first, days), zone) };
}

export function clipArenaPlayback(segment: PlaybackSegment, bounds?: ArenaInterval): PlaybackSegment | null {
  const { wallStartMs, wallEndMs, timelineStartSec, timelineEndSec } = segment;
  if (wallEndMs <= wallStartMs || timelineEndSec <= timelineStartSec) return null;
  if (!bounds) return segment;
  const start = Math.max(wallStartMs, bounds.start);
  const end = Math.min(wallEndMs, bounds.end);
  if (end <= start) return null;
  const speed = (timelineEndSec - timelineStartSec) / (wallEndMs - wallStartMs);
  return { ...segment, wallStartMs: start, wallEndMs: end,
    timelineStartSec: timelineStartSec + (start - wallStartMs) * speed,
    timelineEndSec: timelineStartSec + (end - wallStartMs) * speed };
}

export function arenaCalendar(zone: string) {
  const boundaries = new Map<string, number>();
  const day = (ms: number) => dateKeyInTimezone(new Date(ms), zone);
  function slices(start: number, end: number) {
    const out: { dateKey: string; start: number; end: number }[] = [];
    while (start < end) {
      const dateKey = day(start);
      let next = end;
      if (day(end - 1) !== dateKey) {
        const tomorrow = addDaysToDateKey(dateKey, 1);
        next = boundaries.get(tomorrow) ?? arenaDayStart(tomorrow, zone);
        boundaries.set(tomorrow, next);
      }
      if (next <= start) break;
      out.push({ dateKey, start, end: Math.min(end, next) });
      start = next;
    }
    return out;
  }
  return {
    day,
    playback(segment: PlaybackSegment) {
      return slices(segment.wallStartMs, segment.wallEndMs).flatMap(({ dateKey, start, end }) => {
        const part = clipArenaPlayback(segment, { start, end });
        return part ? [{ dateKey, segment: part }] : [];
      });
    },
    focus(sessions: StudySession[], bounds?: ArenaInterval) {
      const daily = new Map<string, number>();
      for (const session of sessions) {
        if (session.estimated || session.saveState === 'draft' || session.activeSec <= 0) continue;
        const intervals = mergeIntervals((session.intervals ?? []).filter((item) => item.kind === 'active')
          .map((item) => [item.startMs, item.endMs]));
        const start = Date.parse(session.startedAt);
        const end = session.finishedAt ? Date.parse(session.finishedAt) : NaN;
        const spans = intervals.length ? intervals : Number.isFinite(start) && end > start ? [[start, end]] : [];
        const total = spans.reduce((sum, [a, b]) => sum + b - a, 0);
        if (total <= 0) continue;
        const rate = Math.min(1 / 1000, session.activeSec / total);
        for (const [a, b] of spans) {
          for (const part of slices(Math.max(a, bounds?.start ?? a), Math.min(b, bounds?.end ?? b))) {
            daily.set(part.dateKey, (daily.get(part.dateKey) ?? 0) + rate * (part.end - part.start));
          }
        }
      }
      return daily;
    },
  };
}
