// Exact ISO 8601 duration parsing → integer seconds.
// YouTube Data API v3 contentDetails.duration uses ISO 8601, e.g. PT1H2M3S.
// Supports days/weeks (P1DT2H, P1W) though the API overwhelmingly returns PT*.

const ISO_RE =
  /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

export function assertSafeNonNegativeInt(n: number, label = 'value'): void {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(`${label} must be a non-negative safe integer, got ${n}`);
  }
}

export function parseISO8601ToSeconds(input: string): number {
  if (typeof input !== 'string' || input.length === 0 || input.length > 64) {
    throw new Error(`Invalid ISO 8601 duration: ${String(input)}`);
  }
  const m = ISO_RE.exec(input.trim());
  if (!m) throw new Error(`Invalid ISO 8601 duration: ${input}`);
  const [, years, months, weeks, days, hours, minutes, seconds] = m;
  if (years !== undefined || months !== undefined) {
    // YouTube never returns Y/M date components for video durations.
    throw new Error(`Unsupported year/month component in duration: ${input}`);
  }
  // Must contain at least one component and start with P
  if (
    weeks === undefined &&
    days === undefined &&
    hours === undefined &&
    minutes === undefined &&
    seconds === undefined
  ) {
    throw new Error(`Invalid ISO 8601 duration (empty): ${input}`);
  }
  const w = weeks ? Number.parseInt(weeks, 10) : 0;
  const d = days ? Number.parseInt(days, 10) : 0;
  const h = hours ? Number.parseInt(hours, 10) : 0;
  const min = minutes ? Number.parseInt(minutes, 10) : 0;
  const s = seconds ? Math.floor(Number.parseFloat(seconds)) : 0;
  for (const [v, l] of [[w, 'weeks'], [d, 'days'], [h, 'hours'], [min, 'minutes'], [s, 'seconds']] as const) {
    if (!Number.isSafeInteger(v) || v < 0) throw new Error(`Invalid ${l} in duration: ${input}`);
  }
  const total = w * 7 * 86400 + d * 86400 + h * 3600 + min * 60 + s;
  assertSafeNonNegativeInt(total, 'duration seconds');
  return total;
}

/** Exact HH:MM:SS, hours NOT wrapped at 24. */
export function formatSecondsHHMMSS(totalSec: number): string {
  assertSafeNonNegativeInt(totalSec, 'totalSec');
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return `${h}:${mm}:${ss}`;
}

/**
 * One human-readable duration convention for aggregate UI (never the raw
 * "0s" placeholder that made empty History cards look technical). Zero is a
 * real value and stays explicit; sub-minute values keep seconds; whole
 * minutes/hours drop trailing zero units. `formatSecondsHHMMSS` remains the
 * exact clock convention for per-video timelines.
 */
export function formatDuration(totalSec: number): string {
  assertSafeNonNegativeInt(totalSec, 'totalSec');
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return s === 0 ? '0m' : `${s}s`;
}

/** Backwards-compatible name used throughout the existing UI. */
export function formatHuman(totalSec: number): string {
  return formatDuration(totalSec);
}

/** Sessions needed to cover totalSec with sessionLenSec chunks. */
export function sessionsNeeded(totalSec: number, sessionLenSec: number): number {
  assertSafeNonNegativeInt(totalSec, 'totalSec');
  if (!Number.isSafeInteger(sessionLenSec) || sessionLenSec <= 0) {
    throw new Error('sessionLenSec must be a positive safe integer');
  }
  if (totalSec === 0) return 0;
  return Math.ceil(totalSec / sessionLenSec);
}
