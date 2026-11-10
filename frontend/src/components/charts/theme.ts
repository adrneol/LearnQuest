// Shared chart language: one place for tick styles, grid, tooltip chrome, and
// adaptive tick thinning. Units always live in captions/axis titles — never
// concatenated into tick values.
//
// Colors come from the active theme via CSS-ish lookup. Components call
// `useChartTheme()` so charts switch with dark/light without a reload.

import { useTheme } from '../../app/theme.js';

export interface ChartTheme {
  TICK: { fontSize: number; fill: string };
  AXIS_LABEL: { fontSize: number; fill: string };
  GRID_STROKE: string;
  /** Axis baseline stroke — visible but restrained. */
  AXIS_LINE: string;
  TOOLTIP_STYLE: React.CSSProperties;
  TOOLTIP_LABEL_STYLE: React.CSSProperties;
  SERIES: { primary: string; steel: string; emerald: string; amber: string; slate: string };
}

const DARK: ChartTheme = {
  TICK: { fontSize: 11, fill: '#a8adb5' },
  AXIS_LABEL: { fontSize: 11, fill: '#8b909a' },
  GRID_STROKE: 'rgba(176,186,198,0.16)',
  AXIS_LINE: 'rgba(176,186,198,0.32)',
  TOOLTIP_STYLE: {
    backgroundColor: '#1a1b20',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: 10,
    fontSize: 12,
    color: '#e6e7e9',
    padding: '8px 10px',
  },
  TOOLTIP_LABEL_STYLE: { color: '#e6e7e9', fontWeight: 600 },
  SERIES: {
    primary: '#6ba8b8', // muted teal — primary data series
    steel: '#5d84a3',   // desaturated steel blue — duration bars
    emerald: '#4fc08d', // genuine success
    amber: '#c9a24a',   // genuine warning
    slate: '#52525b',   // neutral connector
  },
};

const LIGHT: ChartTheme = {
  TICK: { fontSize: 11, fill: '#52525b' },
  AXIS_LABEL: { fontSize: 11, fill: '#71717a' },
  GRID_STROKE: 'rgba(24,24,27,0.14)',
  AXIS_LINE: 'rgba(24,24,27,0.30)',
  TOOLTIP_STYLE: {
    backgroundColor: '#ffffff',
    border: '1px solid rgba(24,24,27,0.16)',
    borderRadius: 10,
    fontSize: 12,
    color: '#18181b',
    padding: '8px 10px',
    boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
  },
  TOOLTIP_LABEL_STYLE: { color: '#3f3f46', fontWeight: 600 },
  SERIES: {
    primary: '#3f8093', // deep muted teal on light ground
    steel: '#456b87',   // desaturated steel blue
    emerald: '#0d8a5a', // genuine success
    amber: '#b4530a',   // genuine warning
    slate: '#a1a1aa',   // neutral connector
  },
};

export function getChartTheme(resolved: 'dark' | 'light'): ChartTheme {
  return resolved === 'light' ? LIGHT : DARK;
}

/** Recharts needs concrete colors; this hook returns the active palette. */
export function useChartTheme(): ChartTheme {
  const { resolved } = useTheme();
  return getChartTheme(resolved);
}

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
  if (maxLabels <= 0 || count <= maxLabels) return Array.from({ length: count }, (_, i) => start + i);
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
export interface CumPoint {
  pos: number;
  hrs: number;
  cumSec: number;
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
