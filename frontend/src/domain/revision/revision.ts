// Revision scheduling: pure date logic for the review queue.
// Dates are YYYY-MM-DD calendar days in the *display* timezone; comparison is
// lexicographic, which is chronological for ISO keys. Malformed or missing
// dates are never overdue (fail-closed, not silently due).

import type { ProgressRecord, ReviewEvent } from '../../types/index.js';

/** True only for a well-formed past date strictly before today. */
export function isRevisionOverdue(revisionDate: string | null | undefined, todayKey: string): boolean {
  if (typeof revisionDate !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(revisionDate)) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(todayKey)) return false;
  return revisionDate < todayKey;
}

/**
 * A lesson belongs in the active review queue only when it carries a real
 * current signal. Historical annotations (notes/key concepts) and a previous
 * review date are deliberately *not* signals: otherwise every reviewed lesson
 * would stay queued forever and "Mark revised" would appear broken.
 */
export function hasRevisionSignal(r: Pick<ProgressRecord,
  'confidence' | 'needsRevision' | 'exerciseDone' | 'codeReproduced' | 'builtExample' | 'questions' | 'revisionDate'
> | null | undefined): boolean {
  if (!r) return false;
  return r.needsRevision === true
    || (typeof r.confidence === 'number' && r.confidence <= 2)
    || !!r.questions?.trim()
    || r.exerciseDone === false
    || r.codeReproduced === false
    || r.builtExample === false
    || !!r.revisionDate;
}

export interface ReviewPatchResult {
  patch: Pick<ProgressRecord, 'needsRevision' | 'revisionDate' | 'revisionDoneAt' | 'reviewHistory'>;
  /** True when a new review-history entry was appended. */
  recorded: boolean;
  alreadyReviewedToday: boolean;
}

/**
 * Mark a review without touching completion, playback evidence, notes,
 * concepts, questions, confidence, or exercise flags. Idempotent per
 * calendar day: repeated clicks update the current flag but cannot append a
 * second history entry or earn duplicate revision XP.
 */
export function buildReviewPatch(
  existing: ProgressRecord | null | undefined,
  reviewedAt: string,
  todayKey: string,
  source: ReviewEvent['source'] = 'revision',
): ReviewPatchResult {
  const history = Array.isArray(existing?.reviewHistory) ? [...existing.reviewHistory] : [];
  // Backfill one legacy review date so upgrading users do not start with an
  // empty history while showing "Reviewed on …".
  if (history.length === 0 && typeof existing?.revisionDoneAt === 'string'
    && Number.isFinite(Date.parse(existing.revisionDoneAt))) {
    history.push({
      id: `legacy-review-${existing.revisionDoneAt}`,
      reviewedAt: existing.revisionDoneAt,
      dateKey: existing.revisionDoneAt.slice(0, 10),
      source: 'revision',
    });
  }
  const alreadyReviewedToday = history.some((entry) => entry.dateKey === todayKey)
    || (typeof existing?.revisionDoneAt === 'string'
      && existing.revisionDoneAt.slice(0, 10) === todayKey);
  if (alreadyReviewedToday) {
    return {
      patch: {
        needsRevision: false,
        revisionDate: null,
        reviewHistory: history.length ? history : undefined,
      },
      recorded: false,
      alreadyReviewedToday: true,
    };
  }
  const event: ReviewEvent = {
    id: `review-${Date.parse(reviewedAt) || Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    reviewedAt,
    dateKey: todayKey,
    source,
  };
  const nextHistory = [...history, event].slice(-500);
  return {
    patch: {
      needsRevision: false,
      revisionDate: null,
      revisionDoneAt: reviewedAt,
      reviewHistory: nextHistory,
    },
    recorded: true,
    alreadyReviewedToday: false,
  };
}

/** Human-readable last-review instant, or null when never reviewed. */
export function lastReviewIso(r: Pick<ProgressRecord, 'revisionDoneAt' | 'reviewHistory'> | null | undefined): string | null {
  if (!r) return null;
  if (r.revisionDoneAt) return r.revisionDoneAt;
  const history = r.reviewHistory;
  return history && history.length ? history[history.length - 1].reviewedAt : null;
}

/** Queue filter status for one progress record. */
export function revisionFilterStatus(
  r: { confidence?: number; needsRevision?: boolean; exerciseDone?: boolean; questions?: string; revisionDate?: string | null } | null | undefined,
  filter: 'all' | 'low' | 'todo-ex' | 'questions' | 'overdue',
  todayKey: string,
): boolean {
  if (!r) return false;
  switch (filter) {
    case 'low':
      return (r.confidence ?? 5) <= 2;
    case 'todo-ex':
      // An absent exerciseDone field means "not recorded", not "explicitly
      // unfinished". Only a real flag or an explicit false qualifies.
      return r.needsRevision === true || r.exerciseDone === false;
    case 'questions':
      return !!(r.questions && r.questions.trim());
    case 'overdue':
      return isRevisionOverdue(r.revisionDate, todayKey);
    default:
      return true;
  }
}
