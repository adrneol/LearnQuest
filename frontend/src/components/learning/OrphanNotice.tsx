import { AlertTriangle } from 'lucide-react';
import { useStore } from '../../app/store.js';
import { setPendingIntent } from '../../app/pendingIntent.js';
import { countOrphanedRecords } from '../../domain/index.js';

/**
 * Discoverability affordance for records orphaned by a playlist change.
 * The underlying review workflow lives in Reports; this links to it and asks
 * Reports to bring the review section into view. Uses the store-derived
 * record state — never a parallel count.
 */
export function OrphanNotice() {
  const s = useStore();
  const count = countOrphanedRecords(s.progress);
  if (count === 0) return null;
  return (
    <div className="lq-alert lq-alert--warning flex flex-wrap items-center gap-2" role="status">
      <p className="flex min-w-0 items-center gap-2 text-sm">
        <AlertTriangle size={15} className="shrink-0" aria-hidden="true" />
        <span>
          <b>{count}</b> record{count === 1 ? '' : 's'} need{count === 1 ? 's' : ''} review after playlist changes.
        </span>
      </p>
      <a
        className="lq-button lq-button--ghost ml-auto"
        href="#/reports"
        onClick={() => setPendingIntent({ kind: 'focus-orphan-review' })}
      >
        Review playlist changes
      </a>
    </div>
  );
}
