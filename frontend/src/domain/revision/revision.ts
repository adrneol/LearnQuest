// Revision scheduling: pure date logic for the review queue.
// Dates are YYYY-MM-DD calendar days in the *display* timezone; comparison is
// lexicographic, which is chronological for ISO keys. Malformed or missing
// dates are never overdue (fail-closed, not silently due).

/** True only for a well-formed past date strictly before today. */
export function isRevisionOverdue(revisionDate: string | null | undefined, todayKey: string): boolean {
  if (typeof revisionDate !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(revisionDate)) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(todayKey)) return false;
  return revisionDate < todayKey;
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
      return !!r.needsRevision || !r.exerciseDone;
    case 'questions':
      return !!(r.questions && r.questions.trim());
    case 'overdue':
      return isRevisionOverdue(r.revisionDate, todayKey);
    default:
      return true;
  }
}
