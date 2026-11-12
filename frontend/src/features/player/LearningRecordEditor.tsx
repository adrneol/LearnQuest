import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookmarkCheck, Check, Save, X } from 'lucide-react';
import {
  annotationPatch,
  annotationValuesFrom,
  AnnotationFields,
  isValidRevisionDate,
  type AnnotationValues,
} from '../../components/ui/AnnotationFields.js';
import { Card, Btn } from '../../components/ui/ui.js';
import { useStore } from '../../app/store.js';
import {
  identityKey,
  lastReviewIso,
  supportedZone,
  dateKeyInTimezone,
  XP_RULES,
  findProgressForEntry,
} from '../../domain/index.js';
import type { PlaylistEntry, ProgressRecord } from '../../domain/index.js';

const SAVE_DEBOUNCE_MS = 900;

function reviewDate(iso: string, timeZone: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      timeZone: supportedZone(timeZone),
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return new Date(iso).toISOString().slice(0, 10);
  }
}

interface PendingSave {
  key: string;
  playlistId: string;
  entryId: string;
  position: number;
  videoId: string;
  patch: Partial<ProgressRecord>;
  previous?: ProgressRecord;
}

/**
 * Player learning-record editor. It edits only annotation metadata for the
 * exact selected playlist occurrence. Completion, verified coverage, player
 * telemetry, the pause-note, sessions, and review history are untouched.
 */
export function PlayerLearningRecord({ entry, onClose }: { entry: PlaylistEntry; onClose?: () => void }) {
  const s = useStore();
  const key = useMemo(() => identityKey(s.activeId!, entry.entryId!), [s.activeId, entry.entryId]);
  const record = findProgressForEntry(s.progress, s.activeId!, entry);
  const [values, setValues] = useState<AnnotationValues>(() => annotationValuesFrom(record));
  const [status, setStatus] = useState<'idle' | 'dirty' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const pendingRef = useRef<PendingSave | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storeRef = useRef(s);
  storeRef.current = s;

  const performSave = useCallback((target: PendingSave) => {
    try {
      // The target stores its own immutable identity. A flush triggered by
      // navigation therefore writes to the entry that owned the draft, never
      // to the lesson that happened to render next.
      storeRef.current.updateRecord(target.key, {
        playlistId: target.playlistId,
        position: target.position,
        entryId: target.entryId,
        videoId: target.videoId,
        ...target.patch,
      });
      if (target.patch.codeReproduced === true && target.previous?.codeReproduced !== true) {
        storeRef.current.awardXp('code', XP_RULES.codeReproduced, `code:${target.playlistId}:${target.entryId}`);
      }
      if (target.patch.exerciseDone === true && target.previous?.exerciseDone !== true) {
        storeRef.current.awardXp('ex', XP_RULES.exerciseDone, `ex:${target.playlistId}:${target.entryId}`);
      }
      if (target.patch.builtExample === true && target.previous?.builtExample !== true) {
        storeRef.current.awardXp('built', XP_RULES.builtExample, `built:${target.playlistId}:${target.entryId}`);
      }
      setStatus('saved');
      setError(null);
    } catch (e: any) {
      setStatus('error');
      setError(e?.message ?? 'Could not save the learning record.');
    }
  }, []);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    dirtyRef.current = false;
    performSave(pending);
  }, [performSave]);

  const makeTarget = (patch: Partial<ProgressRecord>): PendingSave | null => {
    if (!s.activeId || !entry.entryId) return null;
    return {
      key,
      playlistId: s.activeId,
      entryId: entry.entryId,
      position: entry.position,
      videoId: entry.videoId,
      patch,
      previous: record,
    };
  };

  // Sync external changes (review action, completion toggle, another tab)
  // without clobbering a dirty draft.
  useEffect(() => {
    if (dirtyRef.current) return;
    setValues(annotationValuesFrom(record));
    setStatus((prev) => (prev === 'saved' || prev === 'error' ? prev : 'idle'));
    setError(null);
  }, [record, key]);

  // Flush pending text when the selected occurrence changes or the screen
  // unmounts. This is the safety net for unfinished input; normal typing is
  // debounced so a field does not write on every keystroke.
  useEffect(() => () => flush(), [key, flush]);

  useEffect(() => {
    // A save confirmation belongs to the previous lesson; do not carry it
    // across a video/playlist switch.
    setStatus('idle');
    setError(null);
  }, [key]);

  useEffect(() => {
    const onHide = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flush();
    };
    const onPageHide = () => flush();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onHide);
    if (typeof window !== 'undefined') window.addEventListener('pagehide', onPageHide);
    return () => {
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onHide);
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', onPageHide);
    };
  }, [flush]);

  const change = (next: AnnotationValues, patch: Partial<ProgressRecord>) => {
    setValues(next);
    if (!isValidRevisionDate(next.revisionDate)) {
      pendingRef.current = null;
      dirtyRef.current = true;
      setStatus('error');
      setError('Fix the revision date before saving; other fields remain in your draft.');
      return;
    }
    pendingRef.current = makeTarget(patch);
    dirtyRef.current = true;
    setStatus('dirty');
    setError(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => flush(), SAVE_DEBOUNCE_MS);
  };

  const saveNow = () => {
    if (!isValidRevisionDate(values.revisionDate)) {
      setStatus('error');
      setError('Choose a valid revision date or leave it empty.');
      return;
    }
    pendingRef.current = makeTarget(annotationPatch(values));
    dirtyRef.current = true;
    flush();
  };

  const lastIso = lastReviewIso(record);
  const history = record?.reviewHistory ?? [];
  const lastReviewToday = lastIso
    ? dateKeyInTimezone(new Date(lastIso), s.prefs.timezone) === dateKeyInTimezone(new Date(), s.prefs.timezone)
    : false;
  const activeReviewFlag = record?.needsRevision === true || !!record?.revisionDate;
  const canReview = !(lastReviewToday && !activeReviewFlag);

  return (
    <Card aria-labelledby="player-learning-record-title">
      <div className="flex flex-wrap items-start gap-2">
        <h2 id="player-learning-record-title" tabIndex={-1} className="lq-section-title mr-auto">Learning record · #{entry.position}</h2>
        <span
          className={`rounded-full px-2 py-1 text-[11px] ${record?.needsRevision ? 'bg-amber-500/15 text-amber-800 dark:text-amber-200' : lastIso ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300' : 'bg-[var(--surface-soft)] text-[var(--text-muted)]'}`}
          role="status"
        >
          {record?.needsRevision
            ? lastIso
              ? `Reviewed ${reviewDate(lastIso, s.prefs.timezone)} · needs revision again`
              : 'Needs revision · not reviewed yet'
            : lastIso
              ? `Reviewed ${reviewDate(lastIso, s.prefs.timezone)}`
              : 'Not reviewed yet'}
        </span>
        {onClose && (
          <Btn variant="quiet" className="!min-h-8 px-2.5 text-xs" onClick={onClose} aria-label="Hide learning record">
            <X size={13} aria-hidden="true" /> Hide
          </Btn>
        )}
      </div>
      <p className="mt-1 max-w-[65ch] text-xs text-[var(--text-muted)]">
        Persistent notes for this exact playlist entry. Saved separately from the pause-note above
        (which is written only when the video ends).
      </p>

      {record?.needsRevision && lastIso && (
        <p className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2 text-[11px] text-amber-800 dark:text-amber-100">
          This lesson keeps a completed review from {reviewDate(lastIso, s.prefs.timezone)} and now has a new
          revision requirement. Both are true: the earlier review is history, the flag is the current work.
        </p>
      )}

      <div className="mt-3">
        <AnnotationFields values={values} onChange={change} timezone={s.prefs.timezone} idPrefix={`player-${entry.entryId ?? entry.position}`} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Btn variant="primary" onClick={saveNow} disabled={!dirtyRef.current && status !== 'dirty'}>
          <Save size={14} /> Save learning record
        </Btn>
        <Btn
          onClick={() => s.markReviewed(s.activeId!, entry.position, 'player')}
          disabled={!canReview}
          title={canReview ? 'Record a review without deleting annotations' : 'Already reviewed today and no new revision flag'}
        >
          <BookmarkCheck size={14} /> Mark reviewed
        </Btn>
        <span className={`text-xs ${status === 'error' ? 'text-red-800 dark:text-red-300' : status === 'dirty' ? 'text-amber-800 dark:text-amber-300' : 'text-[var(--text-muted)]'}`} role="status" aria-live="polite">
          {status === 'dirty' && 'Unsaved changes — saving automatically…'}
          {status === 'saved' && (
            s.mode === 'cloud'
              ? <span className="inline-flex items-center gap-1"><Check size={12} /> Learning record updated. Cloud save status is shown in the header.</span>
              : <span className="inline-flex items-center gap-1"><Check size={12} /> Learning record saved.</span>
          )}
          {status === 'error' && (error ?? 'Could not save.')}
          {status === 'idle' && 'Saved changes never mark the video complete or verified.'}
        </span>
      </div>

      <p className="mt-2 text-[11px] text-[var(--text-faint)]">
        Review status and history are separate from annotations. Marking reviewed clears the current flag and
        revision date, records a dated review, and keeps notes, confidence, concepts, questions, and exercise
        evidence. Repeated clicks on the same day do not duplicate history or XP.
      </p>

      {history.length > 0 && (
        <details className="mt-2 text-[11px] text-[var(--text-muted)]">
          <summary className="cursor-pointer">Review history ({history.length})</summary>
          <ul className="mt-1 space-y-0.5">
            {[...history].reverse().slice(0, 8).map((h) => (
              <li key={h.id}>
                {reviewDate(h.reviewedAt, s.prefs.timezone)} · {h.source === 'player' ? 'Player' : 'Revision'}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
