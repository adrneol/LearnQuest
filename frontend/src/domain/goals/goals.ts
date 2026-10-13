// Flexible goal engine. A goal is achieved ONLY when its defined condition is
// met by eligible events — never by elapsed timers. Duplicate completion events
// are suppressed via achievedId dedup in the store layer.

export type GoalMetric =
  | 'video-count'
  | 'unique-content'
  | 'focus-time'
  | 'playback-time'
  | 'checkpoint';

export type GoalStatus = 'in-progress' | 'achieved' | 'exceeded' | 'missed' | 'paused';

export interface Goal {
  id: string;
  label: string;
  metric: GoalMetric;
  /** target in metric units: count | seconds | seconds | seconds | (checkpoint covers range) */
  target: number;
  playlistId: string | null;
  /** for checkpoint goals */
  checkpointId?: string;
  /** YYYY-MM-DD deadline in selected tz, or null for open-ended */
  dateKey: string | null;
  createdAt: string;
  paused: boolean;
  achievedAt: string | null;
  achievedValue: number | null;
}

export interface GoalProgress {
  current: number;
  target: number;
  remaining: number;
  pct: number;
  status: GoalStatus;
}

/** Eligible current value per metric from real records (caller supplies aggregates). */
export function goalProgress(
  goal: Goal,
  current: number,
  opts: { todayKey: string } = { todayKey: '' },
): GoalProgress {
  const remaining = Math.max(0, goal.target - current);
  const pct = goal.target > 0 ? (current / goal.target) * 100 : 0;
  let status: GoalStatus = 'in-progress';
  if (goal.paused) status = 'paused';
  else if (goal.achievedAt) status = current > goal.target ? 'exceeded' : 'achieved';
  else if (goal.dateKey && opts.todayKey && opts.todayKey > goal.dateKey && current < goal.target) status = 'missed';
  else if (current >= goal.target) status = 'achieved';
  return { current, target: goal.target, remaining, pct, status };
}

export function validateGoal(input: { metric: GoalMetric; target: number }): string[] {
  const errs: string[] = [];
  if (!['video-count', 'unique-content', 'focus-time', 'playback-time', 'checkpoint'].includes(input.metric)) {
    errs.push('Unknown goal metric.');
  }
  if (!Number.isFinite(input.target) || input.target <= 0) errs.push('Target must be a positive number.');
  if (input.metric === 'video-count' && input.target > 2000) errs.push('Video-count target looks unrealistic (>2000).');
  if ((input.metric === 'unique-content' || input.metric === 'focus-time' || input.metric === 'playback-time') && input.target > 16 * 3600) {
    errs.push('Time target exceeds 16h — split it into smaller goals.');
  }
  return errs;
}

export function formatGoalTarget(metric: GoalMetric, target: number): string {
  if (metric === 'video-count') return `${target} videos`;
  const h = Math.floor(target / 3600);
  const m = Math.round((target % 3600) / 60);
  if (metric === 'checkpoint') return 'checkpoint range';
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
