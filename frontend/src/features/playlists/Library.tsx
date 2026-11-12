import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, ChevronLeft, ChevronRight, ExternalLink, CheckCircle2, Circle, BookmarkPlus } from 'lucide-react';
import { ProgressDonut } from '../../components/charts/ProgressDonut.js';
import {
  formatSecondsHHMMSS, formatHuman, validateRange, rangeDuration, selectionDuration,
  computeRangeProgress, computePlaylistProgress, sessionsNeeded, sortEntries,
  buildEntryProgressIndex, isProgressComplete, identityKey,
  type EntrySortKey,
} from '../../domain/index.js';
import { useStore } from '../../app/store.js';
import { Card, Btn, inputCls, Empty } from '../../components/ui/ui.js';
import { Dropdown } from '../../components/ui/Dropdown.js';
import { NumberField } from '../../components/ui/NumberField.js';
import { DurationBars } from '../../components/charts/DurationBars.js';
import { CumulativeLine } from '../../components/charts/CumulativeLine.js';
import { playlistPoints, rangePoints } from '../../components/charts/playlistSeries.js';
import { OrphanNotice } from '../../components/learning/OrphanNotice.js';
import { AddPlaylist } from './AddPlaylist.js';
import { setPendingIntent } from '../../app/pendingIntent.js';

export function Library() {
  const s = useStore();
  const snap = s.activeId ? s.playlists[s.activeId] : undefined;
  const N = snap?.entries.length ?? 0;
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'todo' | 'done' | 'unresolved'>('all');
  const [sort, setSort] = useState<EntrySortKey>('pos');
  const [page, setPage] = useState(0);
  const [start, setStart] = useState(1);
  const [end, setEnd] = useState(8);
  const [chartView, setChartView] = useState<'bars' | 'cumulative'>('bars');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [addOpen, setAddOpen] = useState(() => !snap);
  const PER = 25;

  useEffect(() => {
    setStart(1);
    setEnd(Math.min(Math.max(N, 1), 8));
    setPage(0);
    setSelected(new Set());
  }, [snap?.playlistId, N]);

  const progressIndex = useMemo(
    () => (snap ? buildEntryProgressIndex(snap, s.progress) : new Map()),
    [snap, s.progress],
  );

  const rows = useMemo(() => {
    if (!snap) return [];
    let list = [...snap.entries];
    if (q) list = list.filter((e) => e.title.toLowerCase().includes(q.toLowerCase()));
    if (filter === 'done') list = list.filter((e) => isProgressComplete(progressIndex.get(e.position)));
    if (filter === 'todo') list = list.filter((e) => !isProgressComplete(progressIndex.get(e.position)) && e.durationSec !== null);
    if (filter === 'unresolved') list = list.filter((e) => e.durationSec === null);
    // Single authoritative ordering — filter, then sort, then paginate below.
    return sortEntries(list, sort);
  }, [snap, q, filter, sort, progressIndex]);

  const points = useMemo(() => snap ? playlistPoints(snap.playlistId, snap.entries, progressIndex) : [], [snap, progressIndex]);
  const chartData = useMemo(() => rangePoints(points, start, end), [points, start, end]);

  if (!snap) {
    return (
      <div className="lq-workflow">
        <OrphanNotice />
        <Card>
          <h2 className="lq-section-title">Add a playlist</h2>
          <div className="mt-3"><AddPlaylist inputId="library-add-playlist" autoFocus /></div>
        </Card>
        <Empty title="No active playlist" hint="Any public YouTube playlist works. Durations are fetched per video (never averaged), and every total is computed from real data." />
      </div>
    );
  }

  const pages = Math.max(1, Math.ceil(rows.length / PER));
  // Clamp (never a blank page after filtering/playlist switch shrinks the list)
  const safePage = Math.min(page, pages - 1);
  const pageRows = rows.slice(safePage * PER, (safePage + 1) * PER);

  let range: ReturnType<typeof rangeDuration> | null;
  let rangeErrMsg: string | null = null;
  try {
    validateRange(start, end, N);
    range = rangeDuration(snap, start, end);
  } catch (e: any) {
    range = null;
    rangeErrMsg = e?.message ?? 'Invalid range.';
  }

  const selEntries = snap.entries.filter((e) => selected.has(e.position));
  const sel = selEntries.length ? selectionDuration(selEntries) : null;
  const applyPreset = (which: 'full' | 'first' | 'middle' | 'last') => {
    const width = Math.min(8, N);
    if (which === 'full') {
      setStart(1);
      setEnd(N);
    } else if (which === 'first') {
      setStart(1);
      setEnd(width);
    } else if (which === 'last') {
      setStart(Math.max(1, N - width + 1));
      setEnd(N);
    } else {
      const mid = Math.floor((N + 1) / 2);
      const half = Math.floor(width / 2);
      setStart(Math.max(1, mid - half));
      setEnd(Math.min(N, Math.max(1, mid - half) + width - 1));
    }
  };

  const toggleSel = (pos: number) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(pos)) n.delete(pos);
      else n.add(pos);
      return n;
    });
  };

  return (
    <div className="lq-workflow">
      <OrphanNotice />
      <Card className="lq-card--compact">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="lq-section-title">Range explorer</h2>
          <Btn aria-expanded={addOpen} className="!min-h-8 px-2.5 text-xs" onClick={() => setAddOpen((open) => !open)}>
            <Plus size={13} aria-hidden="true" /> {addOpen ? 'Hide add' : 'Add playlist'}
          </Btn>
        </div>
        {addOpen && (
          <div className="mt-3 border-t border-[var(--border)] pt-3">
            <AddPlaylist inputId="library-add-playlist" />
          </div>
        )}
        <div className="lq-workflow-tools mt-3">
          <div className="grid w-full grid-cols-2 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto]">
          <NumberField
            label={`Start (1–${N})`}
            value={start}
            onCommit={(v) => { if (v !== null) setStart(v); }}
            min={1}
          />
          <NumberField
            label={`End (${start}–${N})`}
            value={end}
            onCommit={(v) => { if (v !== null) setEnd(v); }}
            min={1}
          />
          <div className="min-w-0">
            <Dropdown
              label="Session length"
              value={String(s.prefs.sessionLenMin)}
              options={[10, 15, 25, 45, 60].map((m) => ({ value: String(m), label: `${m} min` }))}
              onChange={(v) => s.setPrefs({ sessionLenMin: Number(v) })}
            />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Btn variant="primary" onClick={() => s.saveRange({ playlistId: snap.playlistId, label: `Videos ${start}–${end}`, start, end })} disabled={!range}>
              <Plus size={14} aria-hidden="true" /> Save range
            </Btn>
            <Btn onClick={() => {
              setPendingIntent({ kind: 'checkpoint-from-range', playlistId: snap.playlistId, start, end, label: `Videos ${start}–${end}` });
              window.location.hash = '#/checks';
            }} disabled={!range}>
              Create checkpoint
            </Btn>
          </div>
        </div>
        <p className="w-full text-xs text-[var(--text-muted)]">Session length only estimates the number of study blocks. Recorded durations stay the same.</p>
        {rangeErrMsg && <p className="mt-1 text-sm text-red-800 dark:text-red-300">{rangeErrMsg}</p>}
        <div className="flex flex-wrap gap-1.5" aria-label="Range presets">
          {(['full', 'first', 'middle', 'last'] as const).map((p) => (
            <button
              key={p}
              onClick={() => applyPreset(p)}
              className="min-h-9 rounded-[var(--radius-control)] bg-[var(--surface)] px-2.5 text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-hover)] pointer-coarse:min-h-11"
            >
              {p === 'full' ? `Full playlist (1–${N})` : p === 'first' ? 'First videos' : p === 'middle' ? 'Middle segment' : 'Final videos'}
            </button>
          ))}
        </div>
        </div>
        {range && (
          <div className="lq-workflow mt-4 gap-3">
            <dl className="lq-library-summary text-sm" aria-label="Selected range summary">
              <div>
                <dt className="text-[11px] text-[var(--text-faint)]">Videos {start}–{end}</dt>
                <dd className="font-mono font-semibold tabular-nums text-[var(--text)]">{range.count}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-[var(--text-faint)]">Total</dt>
                <dd className="font-mono font-semibold tabular-nums text-[var(--text)]">{formatSecondsHHMMSS(range.totalSec)}{range.isComplete ? '' : ' +?'}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-[var(--text-faint)]">Resolved</dt>
                <dd className="font-mono font-semibold tabular-nums text-[var(--text)]">{range.resolved}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-[var(--text-faint)]">Unresolved</dt>
                <dd className="font-mono font-semibold tabular-nums text-[var(--text)]">{range.unresolved}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--text-faint)]">Sessions of {s.prefs.sessionLenMin} min</dt>
                <dd className="text-xs text-[var(--text-muted)]">≈{sessionsNeeded(range.totalSec, s.prefs.sessionLenMin * 60)} needed</dd>
              </div>
              <div>
                <dt>Completed</dt>
                {(() => {
                  const rp = computeRangeProgress(snap, start, end, s.progress);
                  return <dd className="text-xs text-[var(--text-muted)]"><b>{rp.done}/{rp.count}</b> done{rp.doneSec !== null && rp.totalSec !== null ? ` · ${formatHuman(rp.totalSec - rp.doneSec)} left` : ''}.</dd>;
                })()}
              </div>
            </dl>
            {!range.isComplete && (
              <p className="text-xs text-amber-800 dark:text-amber-300">Incomplete — positions {range.unresolvedPositions.join(', ')} unresolved. Not a complete total.</p>
            )}
            <div className="lq-workflow-section pt-3">
              <div className="lq-segmented mb-2" role="group" aria-label="Chart view">
                {(['bars', 'cumulative'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setChartView(v)}
                    aria-pressed={chartView === v}
                  >
                    {v === 'bars' ? 'Video duration' : 'Cumulative duration'}
                  </button>
                ))}
              </div>
              {chartView === 'bars' ? (
                <DurationBars key={`${snap.playlistId}:${snap.fetchedAt}:${start}:${end}`} data={chartData} heightClass="h-52" />
              ) : (
                <CumulativeLine key={`${snap.playlistId}:${snap.fetchedAt}:${start}:${end}`} data={chartData} heightClass="h-52" />
              )}
            </div>
          </div>
        )}
        {sel && (
          <p className="mt-2 text-xs text-[var(--text)]">
            Row selection ({selEntries.length}): <span className="font-mono">{formatSecondsHHMMSS(sel.totalSec)}{sel.isComplete ? '' : ' +?'}</span> — non-contiguous selection sum, not a continuous range.
            <button className="ml-2 underline" onClick={() => setSelected(new Set())}>Clear</button>
          </p>
        )}
      </Card>

      <Card>
        <h2 className="lq-section-title mb-3">Lessons</h2>
        <div className="lq-workflow-tools">
          <div className="relative flex-1 min-w-[180px]">
            <Search aria-hidden="true" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search titles…" className={`${inputCls} pl-8`} aria-label="Search videos" />
          </div>
          <div className="w-[calc(50%-0.25rem)] min-w-0 sm:w-40">
            <Dropdown
              label="Filter"
              value={filter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'todo', label: 'Not started' },
                { value: 'done', label: 'Completed' },
                { value: 'unresolved', label: 'Unresolved' },
              ]}
              onChange={(v) => { setFilter(v as any); setPage(0); }}
            />
          </div>
          <div className="w-[calc(50%-0.25rem)] min-w-0 sm:w-44">
            <Dropdown
              label="Sort"
              value={sort}
              options={[
                { value: 'pos', label: 'Playlist order' },
                { value: 'dur-desc', label: 'Longest first' },
                { value: 'dur-asc', label: 'Shortest first' },
                { value: 'title-asc', label: 'Title A–Z' },
                { value: 'title-desc', label: 'Title Z–A' },
              ]}
              onChange={(v) => { setSort(v as EntrySortKey); setPage(0); }}
            />
          </div>
          <span className="py-2 text-xs tabular-nums text-[var(--text-faint)]">{rows.length} shown</span>
        </div>
        {/*
          Phones get a real card list: no 640px horizontal canvas, no clipped
          titles, and 44px-friendly action targets. The table remains for
          tablet/desktop where its density is useful.
        */}
        <ul className="mt-2 space-y-2 md:hidden" aria-label="Videos">
          {pageRows.map((e) => {
            const pk = identityKey(snap.playlistId, e.entryId!);
            const rec = progressIndex.get(e.position);
            const done = isProgressComplete(rec);
            const conf = rec?.confidence;
            return (
              <li key={e.position} className={`rounded-lg border border-[var(--border)] p-3 ${done ? 'bg-emerald-500/5' : 'bg-white/[0.02]'}`}>
                <div className="flex min-w-0 items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(e.position)}
                    onChange={() => toggleSel(e.position)}
                    aria-label={`Select video ${e.position}`}
                    className="mt-1 h-4 w-4 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium" title={e.title}>{e.title}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-muted)]">
                      <span className="font-mono">#{e.position}</span>
                      <span className="font-mono">{e.durationSec !== null ? formatSecondsHHMMSS(e.durationSec) : 'unresolved'}</span>
                      <span className={done ? 'text-emerald-800 dark:text-emerald-300' : 'text-[var(--text-faint)]'}>{done ? 'done' : 'not done'}</span>
                      {conf ? <span className="text-cyan-800 dark:text-cyan-300">confidence {conf}/5</span> : null}
                      {rec?.needsRevision ? <span className="text-amber-800 dark:text-amber-300">needs revision</span> : null}
                    </p>
                  </div>
                  {e.videoId ? (
                    <a
                      href={`https://www.youtube.com/watch?v=${e.videoId}&list=${snap.playlistId}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open video ${e.position} on YouTube`}
                      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
                    >
                      <ExternalLink size={17} />
                    </a>
                  ) : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => s.toggleDone(snap.playlistId, e.position, e.videoId)}
                    aria-label={done ? `Mark video ${e.position} incomplete` : `Mark video ${e.position} complete`}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-[var(--surface-soft)] px-2.5 text-xs text-[var(--text)]"
                  >
                    {done ? <CheckCircle2 size={16} className="text-emerald-700 dark:text-emerald-400" /> : <Circle size={16} className="text-[var(--text-faint)]" />}
                    {done ? 'Done' : 'Not done'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      s.updateRecord(pk, {
                        playlistId: snap.playlistId, position: e.position, entryId: e.entryId, videoId: e.videoId,
                        status: rec?.status ?? 'in-progress', completedAt: rec?.completedAt ?? null,
                        needsRevision: !rec?.needsRevision,
                      } as any);
                    }}
                    aria-label={rec?.needsRevision ? `Unflag video ${e.position} for revision` : `Flag video ${e.position} for revision`}
                    aria-pressed={!!rec?.needsRevision}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-[var(--surface-soft)] px-2.5 text-xs text-[var(--text)]"
                  >
                    <BookmarkPlus size={16} className={rec?.needsRevision ? 'text-amber-800 dark:text-amber-300' : 'text-[var(--text-faint)]'} />
                    {rec?.needsRevision ? 'Unflag revision' : 'Needs revision'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="mt-2 hidden overflow-x-auto md:block">
          <table className="lq-data-table min-w-[640px]">
            <thead>
              <tr className="text-left text-xs text-[var(--text-muted)]">
                <th className="p-2">Sel</th><th className="p-2">Done</th><th className="p-2">Revise</th><th className="p-2">#</th><th className="p-2">Title</th><th className="p-2 text-right">Duration</th><th className="p-2">Open</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((e) => {
                const pk = identityKey(snap.playlistId, e.entryId!);
                const rec = progressIndex.get(e.position);
                const done = isProgressComplete(rec);
                const conf = rec?.confidence;
                return (
                  <tr key={e.position} className={`border-t border-[var(--border)] ${done ? 'bg-emerald-500/5' : ''} ${e.durationSec === null ? 'opacity-70' : ''}`}>
                    <td className="p-2"><input type="checkbox" checked={selected.has(e.position)} onChange={() => toggleSel(e.position)} aria-label={`Select video ${e.position}`} /></td>
                    <td className="p-2">
                      <button onClick={() => s.toggleDone(snap.playlistId, e.position, e.videoId)} aria-label={done ? `Mark video ${e.position} incomplete` : `Mark video ${e.position} complete`}>
                        {done ? <CheckCircle2 size={18} className="text-emerald-700 dark:text-emerald-400" /> : <Circle size={18} className="text-[var(--text-faint)]" />}
                      </button>
                    </td>
                    <td className="p-2">
                      <button
                        onClick={() => {
                          s.updateRecord(pk, {
                            playlistId: snap.playlistId, position: e.position, entryId: e.entryId, videoId: e.videoId,
                            status: rec?.status ?? 'in-progress', completedAt: rec?.completedAt ?? null,
                            needsRevision: !rec?.needsRevision,
                          } as any);
                        }}
                        aria-label={rec?.needsRevision ? `Unflag video ${e.position} for revision` : `Flag video ${e.position} for revision`}
                        aria-pressed={!!rec?.needsRevision}
                      >
                        <BookmarkPlus size={17} className={rec?.needsRevision ? 'text-amber-800 dark:text-amber-300' : 'text-[var(--text-faint)]'} />
                      </button>
                    </td>
                    <td className="p-2 font-mono text-[var(--text-muted)]">{e.position}</td>
                    <td className="max-w-[320px] truncate p-2" title={e.title}>
                      {e.title} {conf ? <span className="text-[11px] text-cyan-800 dark:text-cyan-300">· conf {conf}/5</span> : ''} {rec?.needsRevision ? <span className="text-[11px] text-amber-800 dark:text-amber-300">· revise</span> : ''}
                    </td>
                    <td className="p-2 text-right font-mono">{e.durationSec !== null ? formatSecondsHHMMSS(e.durationSec) : <span className="text-amber-800 dark:text-amber-300">unresolved</span>}</td>
                    <td className="p-2">
                      {e.videoId ? <a href={`https://www.youtube.com/watch?v=${e.videoId}&list=${snap.playlistId}`} target="_blank" rel="noreferrer" aria-label={`Open video ${e.position} on YouTube`}><ExternalLink size={15} className="text-[var(--text-muted)]" /></a> : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex items-center justify-between text-sm">
          <Btn onClick={() => setPage((p) => Math.max(0, Math.min(p, pages - 1) - 1))} disabled={safePage === 0}><ChevronLeft size={14} /> Prev</Btn>
          <span className="text-xs text-[var(--text-muted)]">Page {safePage + 1}/{pages}</span>
          <Btn onClick={() => setPage((p) => Math.min(pages - 1, Math.min(p, pages - 1) + 1))} disabled={safePage >= pages - 1}>Next <ChevronRight size={14} /></Btn>
        </div>
      </Card>

      <Card className="lq-workflow-section">
        <h2 className="lq-section-title">Distribution & composition</h2>
        <div className="grid min-w-0 items-start gap-3 md:grid-cols-2">
          <DurationBars key={`${snap.playlistId}:${snap.fetchedAt}`} data={points} heightClass="h-52" ariaLabel="Playlist duration distribution" />
          <DonePie />
        </div>
      </Card>
    </div>
  );
}

function DonePie() {
  const s = useStore();
  const snap = s.activeId ? s.playlists[s.activeId] : undefined;
  if (!snap) return null;
  const prog = computePlaylistProgress(snap, s.progress);
  return <ProgressDonut done={prog.completedCount} total={prog.n} />;
}
