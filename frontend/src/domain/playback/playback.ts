// Playback telemetry: interval-union coverage, verified-vs-manual completion.
// Precision is limited by IFrame telemetry sampling (position polled ~2Hz) and
// browser throttling — documented in the UI, never claimed as perfect.

export interface PlaybackSegment {
  id: string;
  playlistId: string;
  /** 1-indexed playlist position (duplicates stay distinct) */
  position: number;
  videoId: string;
  sessionId: string;
  /** UTC epoch ms wall clock */
  wallStartMs: number;
  wallEndMs: number;
  /** video timeline seconds covered (end exclusive, playback-rate normalized) */
  timelineStartSec: number;
  timelineEndSec: number;
  playbackRate: number;
  /** 'verified' = observed player events; 'manual' = self-reported */
  source: 'verified' | 'manual';
}

export interface CoverageSummary {
  /** timeline seconds covered at least once */
  uniqueSec: number;
  /** all recorded content seconds incl. repeats */
  totalContentSec: number;
  /** wall-clock seconds while playing (excl. pause/buffer) */
  activeSec: number;
  rewatchedSec: number;
}

export type CompletionState =
  | 'todo'
  | 'in-progress'
  | 'verified'
  | 'manual'
  | 'needs-revision'
  | 'unavailable';

/** Merge overlapping/adjacent [start,end) timeline intervals. */
export function mergeIntervals(intervals: [number, number][]): [number, number][] {
  const clean = intervals
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a && a >= 0)
    .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out: [number, number][] = [];
  for (const [a, b] of clean) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 0.5) {
      last[1] = Math.max(last[1], b);
    } else {
      out.push([a, b]);
    }
  }
  return out;
}

/** Summarize segments for one (playlist, position). Dedupes by segment id. */
export function summarizeSegments(segments: PlaybackSegment[]): CoverageSummary {
  const seen = new Set<string>();
  const iv: [number, number][] = [];
  let totalContentSec = 0;
  let activeSec = 0;
  for (const s of segments) {
    if (seen.has(s.id)) continue; // accidental duplicate events never double-count
    seen.add(s.id);
    const wall = Math.max(0, Math.round((s.wallEndMs - s.wallStartMs) / 1000));
    const content = Math.max(0, s.timelineEndSec - s.timelineStartSec);
    if (content <= 0 || wall < 0) continue; // inconsistent measurement reported, not forced
    iv.push([s.timelineStartSec, s.timelineEndSec]);
    totalContentSec += content;
    activeSec += wall;
  }
  const merged = mergeIntervals(iv);
  const uniqueSec = merged.reduce((a, [x, y]) => a + (y - x), 0);
  return { uniqueSec, totalContentSec, activeSec, rewatchedSec: Math.max(0, totalContentSec - uniqueSec) };
}

/**
 * Completion from coverage. `threshold` 0.5–1 (default 0.9): uniqueSec/durationSec.
 * Manual override always wins when present but is labelled manual, never verified.
 */
export function completionFromCoverage(
  uniqueSec: number,
  durationSec: number | null,
  opts: { threshold?: number; manualDone?: boolean; needsRevision?: boolean; unavailable?: boolean } = {},
): CompletionState {
  if (opts.unavailable || durationSec === null) return 'unavailable';
  if (opts.manualDone) return opts.needsRevision ? 'needs-revision' : 'manual';
  const t = Math.min(1, Math.max(0.5, opts.threshold ?? 0.9));
  if (durationSec <= 0) return 'todo';
  const ratio = uniqueSec / durationSec;
  if (ratio >= t) return 'verified';
  if (uniqueSec > 0) return 'in-progress';
  return 'todo';
}
