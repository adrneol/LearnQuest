import { Play, Flame, CheckCircle2 } from 'lucide-react';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from 'recharts';
import {
  formatSecondsHHMMSS, formatHuman, computePlaylistProgress, computeRangeProgress,
  snapshotCompleteness, sumEntries, rangeDuration, computeStreak,
  activeFocusDayKeys, attributeFocusByDay, calendarWindowDates, ACHIEVEMENTS,
  dateKeyInTimezone, findProgressForEntry, isProgressComplete,
} from '../../domain/index.js';
import { useStore } from '../../app/store.js';
import { useDayTick } from '../../app/dayTick.js';
import { ProgressBar, Empty } from '../../components/ui/ui.js';
import { CumulativeChart } from '../../components/charts/CumulativeChart.js';
import { useChartTheme } from '../../components/charts/theme.js';
import { PlaylistManager } from './PlaylistManager.js';

export function Dashboard() {
  const s = useStore();
  const snap = s.activeId ? s.playlists[s.activeId] : undefined;
  const { TICK, GRID_STROKE, TOOLTIP_STYLE, SERIES } = useChartTheme();
  const todayKey = useDayTick(s.prefs.timezone);
  if (!snap) return <Empty title="No active playlist" hint="Add a playlist to see your learning journey." />;
  const prog = computePlaylistProgress(snap, s.progress);
  const comp = snapshotCompleteness(snap);
  const goal = s.goals[todayKey];
  // Interval-attributed focus: cross-midnight sessions split at tz boundaries
  // (stored dateKey labels alone would strand the after-midnight share).
  const focusByDay = attributeFocusByDay(s.sessions, s.prefs.timezone);
  const todaySec = focusByDay.get(todayKey) ?? 0;
  const streak = computeStreak(activeFocusDayKeys(s.sessions, s.prefs.timezone), todayKey);
  const nextCp = s.checkpoints
    .filter((c) => c.playlistId === snap.playlistId && !c.completedAt && c.status !== 'needsReview')
    .sort((a, b) => a.end - b.end)[0];
  // Recents follow current occurrence identity, never a stale position.
  const recent = snap.entries
    .map((entry) => ({ entry, rec: findProgressForEntry(s.progress, snap.playlistId, entry) }))
    .filter(({ rec }) => isProgressComplete(rec) && !!rec?.completedAt)
    .sort((a, b) => (b.rec?.completedAt ?? '').localeCompare(a.rec?.completedAt ?? ''))
    .slice(0, 5);
  const todayCompleted = snap.entries.filter((entry) => {
    const rec = findProgressForEntry(s.progress, snap.playlistId, entry);
    return isProgressComplete(rec) && rec?.completedAt
      && dateKeyInTimezone(new Date(rec.completedAt), s.prefs.timezone) === todayKey;
  }).length;
  const wholePlaylistDone = prog.n > 0 && prog.completedCount === prog.n;

  // weekly trend (last 7 calendar days in tz, DST-safe)
  const weekKeys = calendarWindowDates(7, s.prefs.timezone);
  const days: { day: string; min: number }[] = weekKeys.map((k) => ({
    day: k.slice(5),
    min: Math.round((focusByDay.get(k) ?? 0) / 60),
  }));
  const weekMin = days.reduce((a, d) => a + d.min, 0);
  // cumulative content curve — one record per position, resolved durations only
  let acc = 0;
  const cum = snap.entries.map((e) => {
    acc += e.durationSec ?? 0;
    return { pos: e.position, hrs: +(acc / 3600).toFixed(2), cumSec: acc };
  });

  const resumeUrl = prog.nextPosition
    ? (() => {
      const e = snap.entries.find((x) => x.position === prog.nextPosition);
      return e?.videoId ? `https://www.youtube.com/watch?v=${e.videoId}&list=${snap.playlistId}` : undefined;
    })()
    : undefined;

  return (
    <div className="min-w-0">
      {/* ——— Learning focus: playlist + progress ———————————————— */}
      <section className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.9fr)_minmax(17rem,1fr)]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-start gap-3">
            {snap.thumbnail && <img src={snap.thumbnail} alt="" className="h-14 w-24 shrink-0 rounded object-cover" />}
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold tracking-tight text-[var(--text)] text-balance">{s.meta[snap.playlistId]?.customTitle ?? snap.title}</h2>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                {snap.entries.length} videos · {comp.resolved} resolved · {snap.source} · {comp.isComplete ? 'complete total' : 'incomplete total'}
              </p>
            </div>
            {resumeUrl ? (
              <a href={resumeUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3.5 py-2 text-sm font-semibold text-[var(--accent-text)] transition-colors hover:bg-[var(--accent-hover)]">
                <Play size={15} /> Resume #{prog.nextPosition}
              </a>
            ) : wholePlaylistDone ? (
              <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-sm font-semibold text-emerald-800 dark:text-emerald-300">Course complete</span>
            ) : (
              <span className="rounded-md border border-[var(--border)] bg-[var(--surface-soft)] px-3.5 py-2 text-sm font-semibold text-[var(--text-muted)]">In progress</span>
            )}
          </div>

          {/* Progress block: one line of glanceable numbers, one track. */}
          <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-4">
            <figure>
              <dl className="flex items-baseline gap-2">
                <dt className="order-2 text-xs text-[var(--text-muted)]">videos</dt>
                <dd className="order-1 font-mono text-3xl font-semibold tabular-nums text-[var(--text)]">{prog.completedCount}<span className="text-lg text-[var(--text-faint)]">/{prog.n}</span></dd>
              </dl>
            </figure>
            <figure>
              <dl className="flex items-baseline gap-2">
                <dt className="order-2 text-xs text-[var(--text-muted)]">content done</dt>
                <dd className="order-1 font-mono text-3xl font-semibold tabular-nums text-[var(--text)]">{prog.completedSec !== null ? formatSecondsHHMMSS(prog.completedSec) : '—'}</dd>
              </dl>
            </figure>
            <figure className="min-w-[9rem]">
              <dl className="flex items-baseline gap-2">
                <dt className="order-2 text-xs text-[var(--text-muted)]">remaining</dt>
                <dd className="order-1 font-mono text-3xl font-semibold tabular-nums text-[var(--text)]">{prog.remainingSec !== null ? formatSecondsHHMMSS(prog.remainingSec) : `${prog.remainingCount} vid`}</dd>
              </dl>
            </figure>
          </div>
          <div className="mt-2 space-y-1.5">
            <ProgressBar pct={prog.durationPct ?? prog.countPct} tone={prog.durationPct !== null ? 'cyan' : 'neutral'} />
            {prog.durationPct !== null ? (
              <p className="text-xs text-[var(--text-muted)]">{prog.durationPct.toFixed(1)}% of resolved content duration completed ({prog.countPct.toFixed(1)}% by count)</p>
            ) : (
              <p className="text-xs text-amber-800 dark:text-amber-300">Duration totals incomplete ({comp.unresolved} unresolved); {prog.countPct.toFixed(1)}% by video count</p>
            )}
          </div>

          {/* Cumulative progress curve — the chart is the hero, not a widget. */}
          <div className="mt-5">
            <CumulativeChart data={cum} heightClass="h-56" complete={comp.isComplete} />
          </div>
        </div>

        {/* ——— Today: goal, current checkpoint, streak —————— */}
        <aside className="min-w-0 space-y-6 border-t border-[var(--border)] pt-6 lg:border-t-0 lg:border-l lg:pl-6 lg:pt-0">
          <section>
            <h3 className="text-sm font-semibold text-[var(--text)]">Today</h3>
            {goal ? (
              <>
                <p className="mt-2 font-mono text-2xl tabular-nums text-[var(--text)]">
                  {formatHuman(todaySec)}<span className="text-sm font-sans text-[var(--text-muted)]"> / {formatHuman(goal.targetFocusSec)}</span>
                </p>
                <ProgressBar pct={goal.targetFocusSec ? (todaySec / goal.targetFocusSec) * 100 : 0} tone="emerald" className="mt-1.5" />
                <p className="mt-1.5 text-xs text-[var(--text-muted)]">
                  {todaySec >= goal.targetFocusSec ? 'Goal met.' : `${formatHuman(Math.max(0, goal.targetFocusSec - todaySec))} to go.`}
                  {goal.targetCount ? ` ${todayCompleted}/${goal.targetCount} videos today.` : ''} Min viable: {formatHuman(goal.minViableSec)}.
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-[var(--text-muted)]">No goal yet. Set one in Focus (10 minutes minimum counts).</p>
            )}
            <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
              <Flame size={13} className="shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
              <span><b className="text-[var(--text)]">{streak}</b>-day streak · <b className="text-[var(--text)]">{weekMin}</b> min this week</span>
            </p>
            <div className="mt-3 h-24 min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={days} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                  <XAxis dataKey="day" tick={TICK} interval={1} axisLine={false} tickLine={false} />
                  <YAxis tick={TICK} allowDecimals={false} width={40} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ stroke: GRID_STROKE }} contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [`${v} min`, 'focus']} />
                  <Line type="monotone" dataKey="min" stroke={SERIES.primary} strokeWidth={1.75} dot={false} />
                </LineChart>
              </ResponsiveContainer>
              <p className="mt-1 text-[10px] text-[var(--text-faint)]">Focused minutes · last 7 days</p>
            </div>
          </section>

          <section className="border-t border-[var(--border)] pt-5">
            <h3 className="text-sm font-semibold text-[var(--text)]">Next milestone</h3>
            {nextCp ? (
              <NextCheckpoint id={nextCp.id} />
            ) : (
              <p className="mt-2 text-sm text-[var(--text-muted)]">No open checkpoint. Add one in Checkpoints — e.g. your next 8 videos.</p>
            )}
          </section>

          <section className="border-t border-[var(--border)] pt-5">
            <h3 className="text-sm font-semibold text-[var(--text)]">XP &amp; achievements</h3>
            <p className="mt-1.5 font-mono text-2xl tabular-nums text-[var(--text)]">
              {s.xp.reduce((a, e) => a + e.points, 0)}<span className="ml-1 text-xs font-sans text-[var(--text-muted)]">XP</span>
            </p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {ACHIEVEMENTS.map((a) => (
                <li key={a.key}>
                  <span title={a.description} className={`inline-flex rounded border px-2 py-0.5 text-[11px] ${s.achievements[a.key] ? 'border-[var(--border-strong)] text-[var(--text)]' : 'border-transparent text-[var(--text-faint)]'}`}>
                    {a.label}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </section>

      {/* ——— Details below the fold ——————————————— */}
      <section className="mt-6 border-t border-[var(--border)] pt-5">
        <h3 className="text-sm font-semibold text-[var(--text)]">Totals &amp; custom ranges</h3>
        <div className="mt-3 grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <dl>
            <dt className="text-[11px] text-[var(--text-faint)]">Entries</dt>
            <dd className="font-mono font-semibold text-[var(--text)]">{snap.entries.length}</dd>
          </dl>
          <dl>
            <dt className="text-[11px] text-[var(--text-faint)]">Resolved</dt>
            <dd className="font-mono font-semibold text-[var(--text)]">{comp.resolved}</dd>
          </dl>
          <dl>
            <dt className="text-[11px] text-[var(--text-faint)]">Unresolved</dt>
            <dd className="font-mono font-semibold text-[var(--text)]">{comp.unresolved}</dd>
          </dl>
          <dl>
            <dt className="text-[11px] text-[var(--text-faint)]">Total duration</dt>
            <dd className="font-mono font-semibold text-[var(--text)]">{comp.isComplete ? formatSecondsHHMMSS(sumEntries(snap.entries).totalSec) : 'incomplete'}</dd>
          </dl>
        </div>
        {s.ranges.filter((r) => r.playlistId === snap.playlistId).slice(0, 4).length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] text-[var(--text-faint)]">Custom ranges</p>
            <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
              {s.ranges.filter((r) => r.playlistId === snap.playlistId).slice(0, 4).map((r) => (
                <li key={r.id}>
                  <RangeLine playlistId={snap.playlistId} start={r.start} end={r.end} label={r.label} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {recent.length > 0 && (
        <section className="mt-6 border-t border-[var(--border)] pt-5">
          <h3 className="text-sm font-semibold text-[var(--text)]">Recent accomplishments</h3>
          <ul className="mt-2 divide-y divide-[var(--border)] text-sm">
            {recent.map(({ entry }) => (
              <li key={entry.entryId ?? `${entry.position}:${entry.videoId}`} className="flex items-center gap-2 py-1.5">
                <CheckCircle2 size={14} className="shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden />
                <span className="font-mono text-xs text-[var(--text-faint)]">#{entry.position}</span>
                <span className="truncate text-[var(--text)]">{entry.title}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <PlaylistManager />
    </div>
  );
}

function RangeLine({ playlistId, start, end, label }: { playlistId: string; start: number; end: number; label: string }) {
  const s = useStore();
  const snap = s.playlists[playlistId];
  if (!snap) return null;
  try {
    const r = rangeDuration(snap, start, end);
    return (
      <span className="text-xs text-[var(--text-muted)]">
        {label} <span className="font-mono text-[var(--text-faint)]">({start}–{end}) {r.isComplete ? formatSecondsHHMMSS(r.totalSec) : `${formatSecondsHHMMSS(r.totalSec)} +?`}</span>
      </span>
    );
  } catch {
    return <span className="text-xs text-amber-800 dark:text-amber-300">{label} — needs review</span>;
  }
}

function NextCheckpoint({ id }: { id: string }) {
  const s = useStore();
  const c = s.checkpoints.find((x) => x.id === id);
  const snap = c ? s.playlists[c.playlistId] : undefined;
  if (!c || !snap) return null;
  const rp = computeRangeProgress(snap, c.start, c.end, s.progress);
  return (
    <div className="mt-2 text-sm">
      <p className="font-semibold text-[var(--text)]">{c.label} <span className="font-normal text-[var(--text-muted)]">({c.start}–{c.end})</span></p>
      <p className="mt-0.5 text-xs text-[var(--text-muted)]">{rp.remaining} videos left{rp.totalSec !== null ? ` · ${formatHuman(rp.totalSec - (rp.doneSec ?? 0))} remaining` : ''}.</p>
      <div className="mt-1.5"><ProgressBar pct={rp.count ? (rp.done / rp.count) * 100 : 0} tone="cyan" /></div>
    </div>
  );
}
