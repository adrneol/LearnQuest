import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, ChevronLeft, ChevronRight, ExternalLink, CheckCircle2, Circle, BookmarkPlus } from 'lucide-react';
import { ResponsiveContainer, Tooltip, BarChart, Bar, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ProgressDonut } from '../../components/charts/ProgressDonut.js';
import {
  formatSecondsHHMMSS, formatHuman, validateRange, rangeDuration, selectionDuration,
  computeRangeProgress, computePlaylistProgress, sessionsNeeded, sortEntries,
  type EntrySortKey,
} from '../../domain/index.js';
import { useStore } from '../../app/store.js';
import { Card, Btn, Field, inputCls, Empty } from '../../components/ui/ui.js';
import { Dropdown } from '../../components/ui/Dropdown.js';
import { DurationBars } from '../../components/charts/DurationBars.js';
import { CumulativeLine } from '../../components/charts/CumulativeLine.js';
import type { RangePoint } from '../../components/charts/theme.js';
import { TICK, TOOLTIP_STYLE, positionTicks } from '../../components/charts/theme.js';

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
  const PER = 25;

  useEffect(() => {
    setStart(1);
    setEnd(Math.min(Math.max(N, 1), 8));
    setPage(0);
    setSelected(new Set());
  }, [snap?.playlistId, N]);

  const rows = useMemo(() => {
    if (!snap) return [];
    let list = [...snap.entries];
    if (q) list = list.filter((e) => e.title.toLowerCase().includes(q.toLowerCase()));
    if (filter === 'done') list = list.filter((e) => s.progress[`${snap.playlistId}::${e.position}`]?.completedAt);
    if (filter === 'todo') list = list.filter((e) => !s.progress[`${snap.playlistId}::${e.position}`]?.completedAt && e.durationSec !== null);
    if (filter === 'unresolved') list = list.filter((e) => e.durationSec === null);
    // Single authoritative ordering — filter, then sort, then paginate below.
    return sortEntries(list, sort);
  }, [snap, q, filter, sort, s.progress]);

  if (!snap) return <Empty title="No active playlist" hint="Add one to explore videos and ranges." />;

  const pages = Math.max(1, Math.ceil(rows.length / PER));
  // Clamp (never a blank page after filtering/playlist switch shrinks the list)
  const safePage = Math.min(page, pages - 1);
  const pageRows = rows.slice(safePage * PER, (safePage + 1) * PER);

  let range: ReturnType<typeof rangeDuration> | null = null;
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
  // One record per actual playlist position in the range — never binned,
  // never averaged. Unresolved entries contribute 0 to the running total and
  // are flagged separately (the range is then labelled incomplete).
  let cumSec = 0;
  const chartData: RangePoint[] = range
    ? snap.entries
      .filter((e) => e.position >= start && e.position <= end)
      .map((e) => {
        cumSec += e.durationSec ?? 0;
        const done = !!s.progress[`${snap.playlistId}::${e.position}`]?.completedAt;
        return {
          pos: e.position,
          title: e.title,
          min: e.durationSec !== null ? +(e.durationSec / 60).toFixed(1) : 0,
          cumMin: +(cumSec / 60).toFixed(1),
          durationSec: e.durationSec,
          cumSec,
          done,
          unresolved: e.durationSec === null,
        };
      })
    : [];

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
    <div className="space-y-4">
      <Card>
        <h2 className="text-base font-bold">Range explorer <span className="font-normal text-slate-400">(N={N}, boundaries adapt to this playlist)</span></h2>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:max-w-md sm:grid-cols-4">
          <Field label={`Start (1–${N})`}>
            <input type="number" min={1} max={N} value={start} onChange={(e) => setStart(Number(e.target.value))} className={inputCls} />
          </Field>
          <Field label={`End (${start}–${N})`}>
            <input type="number" min={start} max={N} value={end} onChange={(e) => setEnd(Number(e.target.value))} className={inputCls} />
          </Field>
          <div>
            <Dropdown
              label="Session length — estimate only, never changes content duration"
              value={String(s.prefs.sessionLenMin)}
              options={[10, 15, 25, 45, 60].map((m) => ({ value: String(m), label: `${m} min` }))}
              onChange={(v) => s.setPrefs({ sessionLenMin: Number(v) })}
            />
          </div>
          <div className="flex items-end">
            <Btn variant="primary" onClick={() => s.saveRange({ playlistId: snap.playlistId, label: `Videos ${start}–${end}`, start, end })} disabled={!range}>
              <Plus size={14} /> Save
            </Btn>
          </div>
        </div>
        {rangeErrMsg && <p className="mt-1 text-sm text-red-300">{rangeErrMsg}</p>}
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Range presets">
          {(['full', 'first', 'middle', 'last'] as const).map((p) => (
            <button
              key={p}
              onClick={() => applyPreset(p)}
              className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-300 hover:bg-white/10"
            >
              {p === 'full' ? `Full playlist (1–${N})` : p === 'first' ? 'First videos' : p === 'middle' ? 'Middle segment' : 'Final videos'}
            </button>
          ))}
        </div>
        {range && (
          <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-3">
            <div className="rounded-xl bg-white/5 p-3 text-sm">
              <p className="text-xs text-slate-400">Videos {start}–{end} · {range.count} entries</p>
              <p className="text-2xl font-bold font-mono">{formatSecondsHHMMSS(range.totalSec)}{range.isComplete ? '' : ' +?'}</p>
              <p className="text-xs text-slate-400">{range.resolved} resolved · {range.unresolved} unresolved · ≈{sessionsNeeded(range.totalSec, s.prefs.sessionLenMin * 60)} sessions of {s.prefs.sessionLenMin} min</p>
              {!range.isComplete && <p className="text-xs text-amber-300">Incomplete — positions {range.unresolvedPositions.join(', ')} unresolved. Not a complete total.</p>}
              {(() => {
                const rp = computeRangeProgress(snap, start, end, s.progress);
                return <p className="mt-1 text-xs text-slate-400">{rp.done}/{rp.count} done{rp.doneSec !== null && rp.totalSec !== null ? ` · ${formatHuman(rp.totalSec - rp.doneSec)} left` : ''}.</p>;
              })()}
            </div>
            <div className="min-w-0 md:col-span-2">
              <div className="mb-2 inline-flex rounded-xl border border-white/10 bg-black/30 p-0.5" role="group" aria-label="Chart view">
                {(['bars', 'cumulative'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setChartView(v)}
                    aria-pressed={chartView === v}
                    className={`rounded-[10px] px-3 py-1.5 text-xs font-medium transition ${
                      chartView === v ? 'bg-violet-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {v === 'bars' ? 'Video duration' : 'Cumulative duration'}
                  </button>
                ))}
              </div>
              {chartView === 'bars' ? (
                <DurationBars data={chartData} heightClass="h-64" />
              ) : (
                <CumulativeLine data={chartData} heightClass="h-64" />
              )}
            </div>
          </div>
        )}
        {sel && (
          <p className="mt-2 text-xs text-slate-300">
            Row selection ({selEntries.length}): <span className="font-mono">{formatSecondsHHMMSS(sel.totalSec)}{sel.isComplete ? '' : ' +?'}</span> — non-contiguous selection sum, not a continuous range.
            <button className="ml-2 underline" onClick={() => setSelected(new Set())}>Clear</button>
          </p>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-500" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search titles…" className={`${inputCls} pl-8`} aria-label="Search videos" />
          </div>
          <div className="w-40">
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
          <div className="w-44">
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
          <span className="text-xs text-slate-500">{rows.length} shown</span>
        </div>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400">
                <th className="p-2">Sel</th><th className="p-2">Done</th><th className="p-2">Revise</th><th className="p-2">#</th><th className="p-2">Title</th><th className="p-2 text-right">Duration</th><th className="p-2">Open</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((e) => {
                const pk = `${snap.playlistId}::${e.position}`;
                const done = !!s.progress[pk]?.completedAt;
                const conf = s.progress[pk]?.confidence;
                return (
                  <tr key={e.position} className={`border-t border-white/5 ${done ? 'bg-emerald-500/5' : ''} ${e.durationSec === null ? 'opacity-70' : ''}`}>
                    <td className="p-2"><input type="checkbox" checked={selected.has(e.position)} onChange={() => toggleSel(e.position)} aria-label={`Select video ${e.position}`} /></td>
                    <td className="p-2">
                      <button onClick={() => s.toggleDone(snap.playlistId, e.position, e.videoId)} aria-label={done ? `Mark video ${e.position} incomplete` : `Mark video ${e.position} complete`}>
                        {done ? <CheckCircle2 size={18} className="text-emerald-400" /> : <Circle size={18} className="text-slate-500" />}
                      </button>
                    </td>
                    <td className="p-2">
                      <button
                        onClick={() => {
                          const cur = s.progress[pk];
                          s.updateRecord(pk, {
                            playlistId: snap.playlistId, position: e.position, videoId: e.videoId,
                            status: cur?.status ?? 'in-progress', completedAt: cur?.completedAt ?? null,
                            needsRevision: !cur?.needsRevision,
                          } as any);
                        }}
                        aria-label={s.progress[pk]?.needsRevision ? `Unflag video ${e.position} for revision` : `Flag video ${e.position} for revision`}
                        aria-pressed={!!s.progress[pk]?.needsRevision}
                      >
                        <BookmarkPlus size={17} className={s.progress[pk]?.needsRevision ? 'text-amber-300' : 'text-slate-600'} />
                      </button>
                    </td>
                    <td className="p-2 font-mono text-slate-400">{e.position}</td>
                    <td className="max-w-[320px] truncate p-2" title={e.title}>
                      {e.title} {conf ? <span className="text-[11px] text-cyan-300">· conf {conf}/5</span> : ''} {s.progress[pk]?.needsRevision ? <span className="text-[11px] text-amber-300">· revise</span> : ''}
                    </td>
                    <td className="p-2 text-right font-mono">{e.durationSec !== null ? formatSecondsHHMMSS(e.durationSec) : <span className="text-amber-300">unresolved</span>}</td>
                    <td className="p-2">
                      {e.videoId ? <a href={`https://www.youtube.com/watch?v=${e.videoId}&list=${snap.playlistId}`} target="_blank" rel="noreferrer" aria-label={`Open video ${e.position} on YouTube`}><ExternalLink size={15} className="text-slate-400" /></a> : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex items-center justify-between text-sm">
          <Btn onClick={() => setPage((p) => Math.max(0, Math.min(p, pages - 1) - 1))} disabled={safePage === 0}><ChevronLeft size={14} /> Prev</Btn>
          <span className="text-xs text-slate-400">Page {safePage + 1}/{pages}</span>
          <Btn onClick={() => setPage((p) => Math.min(pages - 1, Math.min(p, pages - 1) + 1))} disabled={safePage >= pages - 1}>Next <ChevronRight size={14} /></Btn>
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-bold">Distribution & composition</h3>
        <p className="text-[11px] text-slate-500">Bars: minutes per video across the whole playlist (every resolved entry) · Pie: completed vs remaining videos</p>
        <div className="grid min-w-0 gap-3 md:grid-cols-2">
          <div className="h-52 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={snap.entries.filter((e) => e.durationSec !== null).map((e) => ({ pos: e.position, min: +((e.durationSec! / 60).toFixed(1)) }))} margin={{ top: 8, right: 8, bottom: 20, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff14" />
                <XAxis dataKey="pos" tick={TICK} ticks={positionTicks(1, snap.entries.length)} minTickGap={8} label={{ value: 'playlist position', position: 'insideBottom', offset: -14, fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={TICK} width={44} label={{ value: 'min / video', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#64748b' }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [`${v} min`, 'length']} labelFormatter={(l) => `Video #${l}`} />
                <Bar dataKey="min" fill="#8b5cf6" maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
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
