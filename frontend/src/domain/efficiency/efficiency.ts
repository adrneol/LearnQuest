// Learning efficiency engine. Definitions:
//
// contentEfficiency% = uniqueContentSec / focusedStudySec * 100
//   (>100% possible at >1x speed; lower is NOT worse — notes/practice take time)
//
// playbackUtilization% = activePlaybackWallSec / eligibleFocusedSec * 100
//
// Overall efficiency is ALWAYS the aggregate ratio, NEVER the mean of daily
// percentages (a 5-min day must not weigh equal to a 3-h day).

export interface EfficiencyInput {
  uniqueContentSec: number;
  focusedSec: number;
}

export function contentEfficiency(input: EfficiencyInput): number | null {
  const { uniqueContentSec, focusedSec } = input;
  if (!Number.isFinite(uniqueContentSec) || !Number.isFinite(focusedSec)) return null;
  if (uniqueContentSec < 0 || focusedSec < 0) return null;
  if (focusedSec === 0) return null; // unavailable — never NaN/Infinity/0-performance
  return (uniqueContentSec / focusedSec) * 100;
}

export function playbackUtilization(activePlaybackSec: number, eligibleFocusedSec: number): number | null {
  if (!Number.isFinite(activePlaybackSec) || !Number.isFinite(eligibleFocusedSec)) return null;
  if (activePlaybackSec < 0 || eligibleFocusedSec <= 0) return null;
  if (activePlaybackSec > eligibleFocusedSec * 1.5) return null; // inconsistent measurement
  return Math.min(100, (activePlaybackSec / eligibleFocusedSec) * 100);
}

/** Aggregate ratio over many days/sessions — the only valid "overall" figure. */
export function overallEfficiency(inputs: EfficiencyInput[]): number | null {
  let u = 0;
  let f = 0;
  for (const i of inputs) {
    if (!Number.isFinite(i.uniqueContentSec) || !Number.isFinite(i.focusedSec)) return null;
    if (i.uniqueContentSec < 0 || i.focusedSec < 0) return null;
    u += i.uniqueContentSec;
    f += i.focusedSec;
  }
  if (f === 0) return null;
  return (u / f) * 100;
}

/** One calendar day's attributed totals (timezone boundaries applied by caller). */
export interface DayAttribution {
  dateKey: string;
  uniqueSec: number;
  focusSec: number;
}

/**
 * Eligible daily efficiencies: one percentage per day WITH a valid
 * study-time denominator. Zero-focus days are excluded (never 0%, never NaN).
 * Shared by the Efficiency screen, History, and Arena user scoring.
 */
export function eligibleDailyEfficiencies(days: DayAttribution[]): number[] {
  const out: number[] = [];
  for (const d of days) {
    if (!Number.isFinite(d.uniqueSec) || !Number.isFinite(d.focusSec)) continue;
    if (d.uniqueSec < 0 || d.focusSec < 0) continue;
    if (d.focusSec === 0) continue;
    out.push((d.uniqueSec / d.focusSec) * 100);
  }
  return out;
}

export interface TrendComparison {
  recent: number;
  previous: number;
  delta: number;
  sampleRecent: number;
  samplePrevious: number;
  /** true when both windows meet the minimum-observation rule */
  meaningful: boolean;
}

/** Compare two windows of per-session unique-content seconds. */
export function compareWindows(recent: number[], previous: number[], minObs = 3): TrendComparison {
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const r = sum(recent);
  const p = sum(previous);
  return {
    recent: r,
    previous: p,
    delta: r - p,
    sampleRecent: recent.length,
    samplePrevious: previous.length,
    meaningful: recent.length >= minObs && previous.length >= minObs,
  };
}
