import type { StudySession } from '../../types/index.js';

// Transparent deterministic scoring. Documented in README + UI.
export const XP_RULES: Record<string, number> = {
  videoDone: 10,
  exerciseDone: 5,
  codeReproduced: 5,
  builtExample: 8,
  revisionDone: 4,
  checkpointDone: 50,
  focusSession30min: 15, // per 30 focused minutes, pro-rated down (floor)
  studyDay: 20,
};

export interface AchievementDef {
  key: string;
  label: string;
  description: string;
}

/** All generic — percentages derive from actual N/duration at evaluation time. */
export const ACHIEVEMENTS: AchievementDef[] = [
  { key: 'first-video', label: 'First lesson', description: 'Complete your first video.' },
  { key: 'first-session', label: 'First focus', description: 'Record your first focus session.' },
  { key: 'first-checkpoint', label: 'First checkpoint', description: 'Complete your first checkpoint.' },
  { key: 'days-5', label: '5 study days', description: 'Study on 5 distinct days.' },
  { key: 'hours-10', label: '10 focused hours', description: 'Accumulate 10h of focused study.' },
  { key: 'halfway', label: 'Halfway', description: 'Reach 50% of the active playlist (count or duration).' },
  { key: 'course-done', label: 'Course complete', description: 'Complete every entry of a playlist.' },
  { key: 'revision-5', label: 'Reviser', description: 'Complete 5 revision tasks.' },
];

export function xpForFocusSession(activeSec: number): number {
  if (!Number.isSafeInteger(activeSec) || activeSec < 0) return 0;
  return Math.floor(activeSec / 1800) * XP_RULES.focusSession30min;
}

/** Evaluate generic achievements from real records. Returns newly unlocked keys. */
export function evaluateAchievements(input: {
  completedVideos: number;
  totalVideos: number;
  completedSec: number | null;
  totalSec: number | null;
  focusSessions: number;
  focusedSec: number;
  distinctDays: number;
  checkpointsDone: number;
  revisionsDone: number;
  already: Set<string>;
}): string[] {
  const out: string[] = [];
  const has = (k: string) => !input.already.has(k);
  if (input.completedVideos >= 1 && has('first-video')) out.push('first-video');
  if (input.focusSessions >= 1 && has('first-session')) out.push('first-session');
  if (input.checkpointsDone >= 1 && has('first-checkpoint')) out.push('first-checkpoint');
  if (input.distinctDays >= 5 && has('days-5')) out.push('days-5');
  if (input.focusedSec >= 10 * 3600 && has('hours-10')) out.push('hours-10');
  const halfByCount = input.totalVideos > 0 && input.completedVideos >= input.totalVideos / 2;
  const halfByDur =
    input.totalSec !== null && input.totalSec > 0 && input.completedSec !== null && input.completedSec >= input.totalSec / 2;
  if ((halfByCount || halfByDur) && has('halfway')) out.push('halfway');
  if (input.totalVideos > 0 && input.completedVideos >= input.totalVideos && has('course-done')) out.push('course-done');
  if (input.revisionsDone >= 5 && has('revision-5')) out.push('revision-5');
  return out;
}

// Time helpers (streaks, day keys, midnight-split attribution) live in
// domain/time/time.ts and are re-exported through the domain barrel.
export {};
