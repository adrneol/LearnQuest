// Shared chart language: one place for tick styles, grid, tooltip chrome, and
// adaptive tick thinning. Units always live in captions/axis titles — never
// concatenated into tick values.

export const TICK = { fontSize: 11, fill: '#94a3b8' } as const;
export const GRID_STROKE = '#ffffff14';
export const TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: '#141830',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 12,
  fontSize: 12,
  color: '#e8ecf6',
};
export const TOOLTIP_LABEL_STYLE: React.CSSProperties = { color: '#c4b5fd', fontWeight: 600 };

export const SERIES = {
  violet: '#8b5cf6',
  cyan: '#22d3ee',
  emerald: '#34d399',
  amber: '#fbbf24',
  slate: '#475569',
} as const;

/**
 * X-axis tick thinning for 1-indexed position axes: every point stays plotted;
 * only printed labels thin out. ~12 labels max on long ranges, every label on
 * short ranges. Recharts `interval` = show every (interval+1)th label.
 */
export function tickInterval(count: number, maxLabels = 12): number {
  if (count <= maxLabels) return 0;
  return Math.ceil(count / maxLabels) - 1;
}

/**
 * Explicit tick positions for an inclusive range start..end: thinned to fit,
 * but ALWAYS including the first and last positions so the axis never ends at
 * 100 when the playlist actually contains 103 entries.
 */
export function positionTicks(start: number, end: number, maxLabels = 12): number[] {
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) return [];
  const count = end - start + 1;
  if (count <= maxLabels) return Array.from({ length: count }, (_, i) => start + i);
  const step = Math.ceil((count - 1) / (maxLabels - 1));
  const out: number[] = [];
  for (let p = start; p < end; p += step) out.push(p);
  out.push(end);
  return out;
}

/** Human minutes with one decimal, no unit attached (unit goes in the axis title). */
export function fmtMin(sec: number | null): number {
  return sec === null ? 0 : +((sec / 60).toFixed(1));
}

/** Hours with two decimals for cumulative axes. */
export function fmtHrs(sec: number): number {
  return +(sec / 3600).toFixed(2);
}

export function fmtHMSLabel(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** One plotted record per actual playlist position (never binned, never averaged). */
export interface RangePoint {
  pos: number;
  title: string;
  /** video duration, minutes (0 when unresolved) */
  min: number;
  /** cumulative minutes through this position */
  cumMin: number;
  durationSec: number | null;
  cumSec: number;
  done: boolean;
  unresolved: boolean;
}
