import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Plus, Search, X } from 'lucide-react';
import { useStore } from '../../app/store.js';
import { useDayTick } from '../../app/dayTick.js';
import {
  revisionFilterStatus, findProgressForEntry, identityKey, hasRevisionSignal,
  lastReviewIso, supportedZone, XP_RULES, dateKeyInTimezone,
} from '../../domain/index.js';
import type { PlaylistEntry, ProgressRecord } from '../../domain/index.js';
import {
  AnnotationFields, annotationValuesFrom, isValidRevisionDate, type AnnotationValues,
} from '../../components/ui/AnnotationFields.js';
import { Card, Btn, Field, inputCls, Empty } from '../../components/ui/ui.js';

type Filter = 'all' | 'low' | 'todo-ex' | 'questions' | 'overdue' | 'reviewed';
type Mode = 'queue' | 'all';
const FILTER_LABEL: Record<Filter, string> = {
  all: 'All queued',
  low: 'Low confidence',
  'todo-ex': 'Open exercise',
  questions: 'Questions',
  overdue: 'Overdue',
  reviewed: 'Reviewed',
};

function filterLabel(filter: Filter, mode: Mode): string {
  if (filter === 'all') return mode === 'queue' ? 'All queued' : 'Any status';
  return FILTER_LABEL[filter];
}

function matchesFilter(
  r: ProgressRecord | undefined,
  filter: Filter,
  todayKey: string,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'reviewed') return Boolean(lastReviewIso(r));
  return revisionFilterStatus(r, filter, todayKey);
}

function reviewDateLabel(iso: string, timeZone: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      timeZone: supportedZone(timeZone),
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export function Revision() {
  const s = useStore();
  const snap = s.activeId ? s.playlists[s.activeId] : undefined;
  const [mode, setMode] = useState<Mode>('queue');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [flagPos, setFlagPos] = useState('');
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string; position?: number } | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [matches, setMatches] = useState<number[]>([]);
  const [visibleLimit, setVisibleLimit] = useState(40);
  const today = useDayTick(s.prefs.timezone);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<number, HTMLDivElement>());
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
  }, []);
  useEffect(() => {
    setVisibleLimit(40);
  }, [mode, filter, query]);

  const allItems = useMemo(() => {
    if (!snap) return [];
    return snap.entries.map((e) => ({
      e,
      r: findProgressForEntry(s.progress, snap.playlistId, e),
    }));
  }, [snap, s.progress]);

  const queueItems = useMemo(
    () => allItems.filter(({ r }) => Boolean(r && !r.orphaned && hasRevisionSignal(r))),
    [allItems],
  );
  const scopedItems = mode === 'queue' ? queueItems : allItems;

  const filtered = useMemo(
    () => scopedItems.filter(({ r }) => matchesFilter(r, filter, today)),
    [scopedItems, filter, today],
  );
  const queuePositions = useMemo(() => new Set(queueItems.map(({ e }) => e.position)), [queueItems]);

  if (!snap) return <Empty title="No active playlist" hint="Add one to track learning quality." />;

  const flash = (position: number) => {
    setHighlight(position);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlight(null), 2200);
  };

  const focusCard = (position: number) => {
    requestAnimationFrame(() => {
      const card = cardRefs.current.get(position);
      if (!card) return;
      const toolbarH = toolbarRef.current?.getBoundingClientRect().height ?? 0;
      const mobileHeader = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--lq-mobile-header-h') || '0',
      ) || 0;
      const top = card.getBoundingClientRect().top + window.scrollY - toolbarH - mobileHeader - 16;
      try {
        window.scrollTo({ top: Math.max(0, top), behavior: s.prefs.reducedMotion ? 'auto' : 'smooth' });
      } catch {
        /* jsdom / reduced environments */
      }
      try {
        card.focus({ preventScroll: true });
      } catch {
        card.focus();
      }
      flash(position);
    });
  };

  const revealInAll = (position: number, reason: string) => {
    setMode('all');
    setFilter('all');
    const index = allItems.findIndex(({ e }) => e.position === position);
    if (index >= 0) setVisibleLimit((n) => Math.max(n, index + 1));
    setMessage({ kind: 'info', text: reason, position });
    setTimeout(() => focusCard(position), 30);
  };

  const jumpTo = (position: number, fromFilter = filter) => {
    const item = allItems.find(({ e }) => e.position === position);
    if (!item) {
      setMessage({ kind: 'error', text: `Position ${position} does not exist in this playlist (1–${snap.entries.length}).` });
      return;
    }
    if (mode === 'queue' && !queuePositions.has(position)) {
      const reviewed = Boolean(lastReviewIso(item.r));
      revealInAll(
        position,
        `Lesson #${position} is not in the revision queue yet or has already been reviewed${reviewed ? ' on a previous date' : ''}. Showing All lessons so its notes stay editable.`,
      );
      return;
    }
    if (fromFilter !== 'all' && !matchesFilter(item.r, fromFilter, today)) {
      setFilter('all');
      setMessage({ kind: 'info', text: `Filter "${FILTER_LABEL[fromFilter]}" hid lesson #${position}; filter cleared to show it.` });
      setTimeout(() => focusCard(position), 30);
      return;
    }
    const index = filtered.findIndex(({ e }) => e.position === position);
    if (index >= 0) setVisibleLimit((n) => Math.max(n, index + 1));
    setMessage({ kind: 'info', text: `Jumped to lesson #${position}.` });
    focusCard(position);
  };

  const runSearch = () => {
    const q = query.trim();
    setMatches([]);
    if (!q) {
      setMessage({ kind: 'error', text: 'Enter a playlist position (for example 50) or part of a lesson title.' });
      return;
    }
    if (/^\d+$/.test(q)) {
      jumpTo(Number(q));
      return;
    }
    const hits = allItems
      .filter(({ e }) => e.title.toLowerCase().includes(q.toLowerCase()))
      .map(({ e }) => e.position);
    if (hits.length === 0) {
      setMessage({ kind: 'error', text: `No lesson title matches “${q}”.` });
      return;
    }
    if (hits.length === 1) {
      jumpTo(hits[0]);
      return;
    }
    setMatches(hits.slice(0, 12));
    setMessage({ kind: 'info', text: `${hits.length} matching lessons — choose one to jump.` });
  };

  const flagByPosition = () => {
    const p = Number(flagPos);
    if (!Number.isInteger(p) || p < 1 || p > snap.entries.length) {
      setMessage({ kind: 'error', text: `Position must be an integer from 1 to ${snap.entries.length}.` });
      return;
    }
    const entry = snap.entries.find((e) => e.position === p);
    if (!entry) return;
    flagEntry(entry);
    setFlagPos('');
    setMessage({ kind: 'info', text: `Lesson #${p} flagged for revision.` });
  };

  const flagEntry = (entry: PlaylistEntry) => {
    const key = identityKey(snap.playlistId, entry.entryId!);
    s.updateRecord(key, {
      playlistId: snap.playlistId,
      position: entry.position,
      entryId: entry.entryId,
      videoId: entry.videoId,
      needsRevision: true,
    });
  };

  const noQueue = queueItems.length === 0;
  const filterEntries = mode === 'queue'
    ? (['all', 'low', 'todo-ex', 'questions', 'overdue'] as Filter[])
    : (['all', 'reviewed', 'low', 'todo-ex', 'questions', 'overdue'] as Filter[]);
  const shown = filtered.slice(0, visibleLimit);
  const orphaned = mode === 'all'
    ? Object.entries(s.progress).filter(([, rec]) => rec.playlistId === snap.playlistId && rec.orphaned)
    : [];

  return (
    <div className="space-y-4">
      {/* Sticky controls: stays under the mobile header / app top while the
          lesson list scrolls, without creating a nested scroll container. */}
      <div
        ref={toolbarRef}
        style={{ top: 'var(--lq-mobile-header-h, 0px)' }}
        className="sticky z-20 -mx-1 rounded-2xl border border-white/10 bg-[#0d1122]/95 p-2.5 shadow-xl backdrop-blur md:-mx-0 lg:top-2"
      >
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <label className="block text-[11px] font-medium text-slate-400" htmlFor="rev-find">Find lesson by position or title</label>
            <div className="relative mt-0.5">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-slate-500" />
              <input
                id="rev-find"
                className={`${inputCls} pl-8`}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setMatches([]); setMessage(null); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    runSearch();
                  }
                }}
                placeholder="e.g. 50 or Variables"
                aria-describedby="rev-find-hint"
              />
            </div>
            <p id="rev-find-hint" className="mt-0.5 text-[10px] text-slate-500">
              Pure number = playlist position; text = title search across the selected scope. Enter jumps.
            </p>
          </div>
          <Btn variant="primary" onClick={runSearch}><Search size={14} /> Jump</Btn>
          <div className="w-36">
            <Field label="Flag position">
              <input
                className={inputCls}
                value={flagPos}
                onChange={(e) => setFlagPos(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); flagByPosition(); } }}
                inputMode="numeric"
                placeholder={`1–${snap.entries.length}`}
                aria-label="Position to flag for revision"
              />
            </Field>
          </div>
          <Btn onClick={flagByPosition}><Plus size={14} /> Flag</Btn>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <div className="mr-1 inline-flex rounded-full border border-white/10 bg-black/20 p-0.5" role="group" aria-label="Revision scope">
            <button
              onClick={() => { setMode('queue'); setFilter('all'); setMessage(null); }}
              aria-pressed={mode === 'queue'}
              className={`rounded-full px-2.5 py-1 text-[11px] ${mode === 'queue' ? 'bg-violet-600 text-white' : 'text-slate-300 hover:bg-white/10'}`}
            >
              Revision queue ({queueItems.length})
            </button>
            <button
              onClick={() => { setMode('all'); setFilter('all'); setMessage(null); }}
              aria-pressed={mode === 'all'}
              className={`rounded-full px-2.5 py-1 text-[11px] ${mode === 'all' ? 'bg-violet-600 text-white' : 'text-slate-300 hover:bg-white/10'}`}
            >
              All lessons ({snap.entries.length})
            </button>
          </div>
          {filterEntries.map((v) => {
            const count = scopedItems.filter(({ r }) => matchesFilter(r, v, today)).length;
            return (
              <button
                key={v}
                onClick={() => { setFilter(v); setMessage(null); setMatches([]); }}
                aria-pressed={filter === v}
                className={`rounded-full px-2.5 py-1 text-[11px] ${filter === v ? 'bg-cyan-600 text-white' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}
              >
                {filterLabel(v, mode)} <span className="opacity-70">({count})</span>
              </button>
            );
          })}
          <span className="ml-auto text-[11px] text-slate-400" role="status">
            {mode === 'queue'
              ? `${filtered.length} of ${queueItems.length} queued lesson${queueItems.length === 1 ? '' : 's'}`
              : `${filtered.length} of ${allItems.length} lesson${allItems.length === 1 ? '' : 's'} in playlist`}
          </span>
        </div>
        {message && (
          <div className={`mt-1.5 flex flex-wrap items-center gap-2 rounded-xl p-1.5 text-xs ${message.kind === 'error' ? 'bg-red-500/10 text-red-200' : 'bg-cyan-500/10 text-cyan-100'}`} role="status">
            <span className="min-w-0 flex-1">{message.text}</span>
            {message.position !== undefined && (
              <button
                className="underline"
                onClick={() => {
                  const entry = snap.entries.find((e) => e.position === message.position);
                  if (entry) {
                    flagEntry(entry);
                    setMessage({ kind: 'info', text: `Lesson #${entry.position} flagged — it is now in the revision queue.` });
                  }
                }}
              >
                Flag it now
              </button>
            )}
            {filter !== 'all' && <button className="underline" onClick={() => setFilter('all')}>Clear filter</button>}
            <button aria-label="Dismiss message" onClick={() => setMessage(null)}><X size={13} /></button>
          </div>
        )}
        {matches.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {matches.map((p) => (
              <button key={p} onClick={() => jumpTo(p)} className="rounded-lg bg-white/10 px-2 py-1 text-[11px] text-slate-200 hover:bg-white/20">#{p}</button>
            ))}
          </div>
        )}
      </div>

      <Card>
        <details>
          <summary className="cursor-pointer text-sm font-semibold">How the revision queue works <span className="font-normal text-slate-400">(completion ≠ mastery)</span></summary>
          <p className="mt-1 text-sm text-slate-400">
            Lessons land here only when they carry a current review signal: flagged <b>needs revision</b>
            (Player, Library, or the flag box), rated confidence 1–2, given a revision date, left with open
            questions, or explicitly marked with unfinished code/exercise/example. Historical notes and key
            concepts are searchable but do not keep a lesson in the queue. Marking a lesson reviewed clears its
            flag and date, records the review, and preserves every annotation.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Filters: <b>All queued</b> = every active review signal; <b>Reviewed</b> (All lessons) = at least one
            dated review; <b>Low confidence</b> = rating 1–2; <b>Open exercise</b> = flagged or explicitly marked
            unfinished (a missing field is not unfinished); <b>Questions</b> = non-empty question text;
            <b>Overdue</b> = revision date before today in {s.prefs.timezone}. “Reviewed on …” and “Needs revision”
            can both be true — the first is history, the second is current work.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Use <b>All lessons</b> to browse or search lessons that already left the queue. Search always covers
            the whole playlist, and a reviewed lesson opens there with its notes intact.
          </p>
        </details>
      </Card>

      {noQueue && mode === 'queue' && (
        <Card>
          <h3 className="text-sm font-bold">Queue clear — nothing needs revision right now</h3>
          <p className="mt-1 text-sm text-slate-400">
            A blank queue means no lesson currently carries a review signal — not that your notes disappeared.
            Open <b>All lessons</b> to browse every lesson, including previously reviewed ones.
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-300">
            <li>Flag a lesson with <b>Needs revision</b> in the Player, the Library table, or the flag box above.</li>
            <li>Rate <b>confidence 1–5</b>, add notes / key concepts / open questions, and optionally set a <b>revision date</b>.</li>
            <li>Filter by low confidence, open exercises, questions, or overdue dates to prioritize.</li>
            <li>Press <b>Mark revised</b> — the flag clears, the review is recorded, and annotations remain.</li>
          </ol>
          <div className="mt-2"><Btn onClick={() => { setMode('all'); setFilter('all'); }}><BookOpen size={14} /> Browse all lessons</Btn></div>
          <p className="mt-1 text-xs text-slate-500">Only your actions create queue entries. No sample history is ever fabricated.</p>
        </Card>
      )}

      {!noQueue && filtered.length === 0 && (
        <Card>
          <h3 className="text-sm font-bold">No lessons match “{filterLabel(filter, mode)}”</h3>
          <p className="mt-1 text-sm text-slate-400">
            {mode === 'queue' ? `The queue has ${queueItems.length} lesson${queueItems.length === 1 ? '' : 's'}` : `The playlist has ${allItems.length} lesson${allItems.length === 1 ? '' : 's'}`},
            {' '}but none meet this filter. Clear it to browse the current scope.
          </p>
          <div className="mt-2"><Btn onClick={() => setFilter('all')}>Clear filter</Btn></div>
        </Card>
      )}

      {shown.map(({ e, r }) => (
        <RevisionCard
          key={identityKey(snap.playlistId, e.entryId!)}
          entry={e}
          record={r}
          highlighted={highlight === e.position}
          cardRef={(el) => {
            if (el) cardRefs.current.set(e.position, el);
            else cardRefs.current.delete(e.position);
          }}
          onFlag={() => flagEntry(e)}
        />
      ))}

      {filtered.length > shown.length && (
        <div className="flex justify-center">
          <Btn onClick={() => setVisibleLimit((n) => n + 40)}>Show {Math.min(40, filtered.length - shown.length)} more</Btn>
        </div>
      )}

      {orphaned.length > 0 && (
        <Card className="border-amber-500/30">
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-amber-200">
              Preserved records removed from this playlist ({orphaned.length})
            </summary>
            <p className="mt-1 text-xs text-slate-400">
              Review history and annotations are kept even though the occurrence no longer exists. They are never
              counted as completion for a current video. Manage deletion in Reports → Playlist changes need review.
            </p>
            <ul className="mt-2 space-y-1 text-xs text-slate-300">
              {orphaned.slice(0, 20).map(([key, rec]) => (
                <li key={key} className="rounded-xl bg-white/5 p-2">
                  <span className="font-mono text-slate-400">#{rec.position} {rec.videoId}</span>
                  {rec.notes ? <span> · {rec.notes}</span> : null}
                  {lastReviewIso(rec) ? <span> · reviewed {reviewDateLabel(lastReviewIso(rec)!, s.prefs.timezone)}</span> : null}
                </li>
              ))}
            </ul>
          </details>
        </Card>
      )}

      {mode === 'queue' && !noQueue && (
        <p className="text-[11px] text-slate-600">
          Tip: use All lessons to find a reviewed lesson by title, even after it leaves this queue.
        </p>
      )}
    </div>
  );
}

function RevisionCard({
  entry,
  record,
  highlighted,
  cardRef,
  onFlag,
}: {
  entry: PlaylistEntry;
  record: ProgressRecord | undefined;
  highlighted: boolean;
  cardRef: (el: HTMLDivElement | null) => void;
  onFlag: () => void;
}) {
  const s = useStore();
  const key = identityKey(s.activeId!, entry.entryId!);
  const [values, setValues] = useState<AnnotationValues>(() => annotationValuesFrom(record));
  const [error, setError] = useState<string | null>(null);
  const lastIso = lastReviewIso(record);
  const lastToday = lastIso
    ? dateKeyInTimezone(new Date(lastIso), s.prefs.timezone) === dateKeyInTimezone(new Date(), s.prefs.timezone)
    : false;
  const activeFlag = record?.needsRevision === true || !!record?.revisionDate;

  // External review/flag actions must be reflected without discarding a
  // half-typed field in this card.
  useEffect(() => {
    setValues(annotationValuesFrom(record));
  }, [record]);

  const change = (next: AnnotationValues, patch: Partial<ProgressRecord>) => {
    if (!isValidRevisionDate(next.revisionDate)) {
      setValues(next);
      setError('Choose a valid revision date or clear it.');
      return;
    }
    setError(null);
    setValues(next);
    s.updateRecord(key, {
      playlistId: s.activeId!,
      position: entry.position,
      entryId: entry.entryId,
      videoId: entry.videoId,
      ...patch,
    });
    if (patch.codeReproduced === true && record?.codeReproduced !== true) {
      s.awardXp('code', XP_RULES.codeReproduced, `code:${s.activeId}:${entry.entryId}`);
    }
    if (patch.exerciseDone === true && record?.exerciseDone !== true) {
      s.awardXp('ex', XP_RULES.exerciseDone, `ex:${s.activeId}:${entry.entryId}`);
    }
    if (patch.builtExample === true && record?.builtExample !== true) {
      s.awardXp('built', XP_RULES.builtExample, `built:${s.activeId}:${entry.entryId}`);
    }
  };

  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      aria-label={`Revision lesson ${entry.position}: ${entry.title}`}
      style={{ scrollMarginTop: 'calc(var(--lq-mobile-header-h, 0px) + 7rem)' }}
      className={`rounded-2xl transition ${highlighted ? 'ring-2 ring-cyan-400 ring-offset-2 ring-offset-[#0b0e1a]' : ''}`}
    >
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-sm font-semibold">#{entry.position} {entry.title}</p>
          {record?.source === 'verified' && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">verified history</span>}
          {record?.source === 'manual' && <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-[10px] text-cyan-300">manual</span>}
          {lastIso && (
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">
              revised {reviewDateLabel(lastIso, s.prefs.timezone)}
            </span>
          )}
          {record?.needsRevision && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-200">needs revision</span>
          )}
          {!record && <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">no record yet</span>}
        </div>
        {record?.needsRevision && lastIso && (
          <p className="mt-1 text-[11px] text-amber-200">
            Reviewed on {reviewDateLabel(lastIso, s.prefs.timezone)} and flagged again for a new pass. The earlier
            review is history; the current flag is active.
          </p>
        )}

        <div className="mt-2">
          <AnnotationFields
            values={values}
            onChange={change}
            idPrefix={`revision-${entry.entryId ?? entry.position}`}
          />
        </div>
        {error && <p className="mt-1 text-xs text-red-300" role="alert">{error}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Btn
            onClick={() => s.markReviewed(s.activeId!, entry.position, 'revision')}
            disabled={lastToday && !activeFlag}
            title={lastToday && !activeFlag ? 'Already reviewed today; flag it again to record a new review' : 'Clear the current flag and append a dated review'}
          >
            Mark revised
          </Btn>
          <Btn onClick={onFlag} aria-pressed={!!record?.needsRevision}>
            {record?.needsRevision ? 'Keep flagged' : 'Needs revision'}
          </Btn>
          {lastIso && (
            <span className="text-[11px] text-slate-500">Last reviewed {reviewDateLabel(lastIso, s.prefs.timezone)}</span>
          )}
        </div>
        {record?.reviewHistory && record.reviewHistory.length > 0 && (
          <details className="mt-2 text-[11px] text-slate-400">
            <summary className="cursor-pointer">Review history ({record.reviewHistory.length})</summary>
            <ul className="mt-1 space-y-0.5">
              {[...record.reviewHistory].reverse().slice(0, 8).map((h) => (
                <li key={h.id}>
                  {reviewDateLabel(h.reviewedAt, s.prefs.timezone)} · {h.source === 'player' ? 'Player' : 'Revision'}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>
    </div>
  );
}
