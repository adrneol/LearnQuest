import { useMemo } from 'react';
import { EvidenceChart } from '../../components/charts/EvidenceChart.js';
import { Play, Flame, CheckCircle2, Plus } from 'lucide-react';
import {
  formatSecondsHHMMSS, formatHuman, computePlaylistProgress, computeRangeProgress,
  snapshotCompleteness, sumEntries, rangeDuration, computeStreak,
  activeFocusDayKeys, attributeFocusByDay, calendarWindowDates, ACHIEVEMENTS,
  dateKeyInTimezone, findProgressForEntry, isProgressComplete,
} from '../../domain/index.js';
import { OrphanNotice } from '../../components/learning/OrphanNotice.js';
import { useStore } from '../../app/store.js';
import { useDayTick } from '../../app/dayTick.js';
import { ProgressBar, Empty } from '../../components/ui/ui.js';
import { CumulativeChart } from '../../components/charts/CumulativeChart.js';
import { playlistPoints } from '../../components/charts/playlistSeries.js';
import { PlaylistManager } from './PlaylistManager.js';

export function Dashboard() {
  const s = useStore();
  const snap = s.activeId ? s.playlists[s.activeId] : undefined;
  const todayKey = useDayTick(s.prefs.timezone);
  const cum = useMemo(() => snap ? playlistPoints(snap.playlistId, snap.entries) : [], [snap]);
  if (!snap) return <Empty title="No active playlist" hint="Add a public YouTube playlist or import a snapshot to see your learning journey." action={<a className="lq-button lq-button--primary" href="#/learn"><Plus size={15} aria-hidden="true" /> Add your first playlist</a>} />;
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
  const days = weekKeys.map((key) => ({ label: key.slice(5), value: (focusByDay.get(key) ?? 0) / 60 }));
  const weekMin = days.reduce((sum, item) => sum + Math.round(item.value), 0);

  const nextEntry = prog.nextPosition
    ? snap.entries.find((x) => x.position === prog.nextPosition)
    : undefined;
  // External YouTube link kept as an explicitly untracked secondary action.
  const youtubeUrl = nextEntry?.videoId
    ? `https://www.youtube.com/watch?v=${nextEntry.videoId}&list=${snap.playlistId}`
    : undefined;

  return (
    <div className="min-w-0">
      <div className="lq-workflow-columns" data-layout="companion">
        <section className="lq-dashboard-course" aria-labelledby="dashboard-course-title">
          <p className="lq-dashboard-kicker mb-2">Active course</p>
          <div className="flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap">
            {snap.thumbnail && <img src={snap.thumbnail} alt="" className="h-14 w-24 shrink-0 rounded-lg object-cover" />}
            <div className="min-w-0 flex-1">
              <h2 id="dashboard-course-title" className="text-xl font-bold tracking-tight text-balance lg:text-2xl">{s.meta[snap.playlistId]?.customTitle ?? snap.title}</h2>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                {snap.entries.length} videos · {comp.resolved} resolved · {snap.source} · {comp.isComplete ? 'complete total' : 'incomplete total'}
              </p>
            </div>
            {!wholePlaylistDone && prog.nextPosition ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <a href="#/player" className="lq-button lq-button--primary">
                  <Play size={15} aria-hidden="true" /> Resume lesson #{prog.nextPosition}
                </a>
                {youtubeUrl && (
                  <a href={youtubeUrl} target="_blank" rel="noreferrer"
                    className="text-xs text-[var(--text-muted)] underline hover:text-[var(--text)]"
                    title="External playback is not tracked — no verified evidence is recorded">
                    Open on YouTube (untracked)
                  </a>
                )}
              </div>
            ) : wholePlaylistDone ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-sm font-semibold text-emerald-800 dark:text-emerald-300">Course complete</span>
                <a href="#/player" className="lq-button lq-button--ghost">
                  <Play size={15} aria-hidden="true" /> Review from lesson #1
                </a>
              </div>
            ) : (
              <span className="rounded-md border border-[var(--border)] bg-[var(--surface-soft)] px-3.5 py-2 text-sm font-semibold text-[var(--text-muted)]">In progress</span>
            )}
          </div>

          <dl className="lq-dashboard-stats">
            <div>
              <dt>Videos complete</dt>
              <dd>{prog.completedCount}<span className="text-[var(--text-muted)]">/{prog.n}</span></dd>
            </div>
            <div>
              <dt>Content done</dt>
              <dd>{prog.completedSec !== null ? formatSecondsHHMMSS(prog.completedSec) : '—'}</dd>
            </div>
            <div>
              <dt>Remaining</dt>
              <dd>{prog.remainingSec !== null ? formatSecondsHHMMSS(prog.remainingSec) : `${prog.remainingCount} vid`}</dd>
            </div>
          </dl>
          <div className="mt-2 space-y-1.5">
            <ProgressBar label="Course progress" pct={prog.durationPct ?? prog.countPct} tone={prog.durationPct !== null ? 'cyan' : 'neutral'} />
            {prog.durationPct !== null ? (
              <p className="text-xs text-[var(--text-muted)]">{prog.durationPct.toFixed(1)}% of resolved content duration completed ({prog.countPct.toFixed(1)}% by count)</p>
            ) : (
              <p className="text-xs text-amber-800 dark:text-amber-300">Duration totals incomplete ({comp.unresolved} unresolved); {prog.countPct.toFixed(1)}% by video count</p>
            )}
          </div>

          <div className="mt-5 border-t border-[var(--border)] pt-4">
            <CumulativeChart key={`${snap.playlistId}:${snap.fetchedAt}`} data={cum} heightClass="h-56 xl:h-72" complete={comp.isComplete} />
          </div>
        </section>

        <aside className="lq-dashboard-activity space-y-4" aria-labelledby="dashboard-activity-title">
          <h2 id="dashboard-activity-title" className="lq-dashboard-kicker">Learning activity</h2>
          <section>
            <h3 className="text-sm font-semibold text-[var(--text)]">Today</h3>
            {goal ? (
              <>
                <p className="mt-2 font-mono text-2xl tabular-nums text-[var(--text)]">
                  {formatHuman(todaySec)}<span className="text-sm font-sans text-[var(--text-muted)]"> / {formatHuman(goal.targetFocusSec)}</span>
                </p>
                <ProgressBar label="Daily focus goal" pct={goal.targetFocusSec ? (todaySec / goal.targetFocusSec) * 100 : 0} tone="emerald" className="mt-1.5" />
                <p className="mt-1.5 text-xs text-[var(--text-muted)]">
                  {todaySec >= goal.targetFocusSec ? 'Goal met.' : `${formatHuman(Math.max(0, goal.targetFocusSec - todaySec))} to go.`}
                  {goal.targetCount ? ` ${todayCompleted}/${goal.targetCount} videos today.` : ''} Min viable: {formatHuman(goal.minViableSec)}.
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-[var(--text-muted)]">No goal yet. <a className="underline hover:text-[var(--text)]" href="#/focus">Set one in Focus</a> — it counts toward your streak.</p>
            )}
            <p className="mt-2"><a href="#/goals" className="text-xs text-[var(--text-muted)] underline hover:text-[var(--text)]">All goals →</a></p>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
              <Flame size={13} className="shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
              <span><b className="text-[var(--text)]">{streak}</b>-day streak · <b className="text-[var(--text)]">{weekMin}</b> min this week</span>
            </p>
            <div className="mt-3">
              <EvidenceChart title="Focused study in the last 7 days" unit="Focused minutes" data={days} heightClass="h-28"
                describe={(value) => formatSecondsHHMMSS(Math.round(value * 60))} />
            </div>
          </section>

          <section className="border-t border-[var(--border)] pt-3">
            <h3 className="text-sm font-semibold text-[var(--text)]">Next milestone</h3>
            {nextCp ? (
              <NextCheckpoint id={nextCp.id} />
            ) : (
              <p className="mt-2 text-sm text-[var(--text-muted)]">No open checkpoint. Add one in Checkpoints — e.g. your next 8 videos.</p>
            )}
          </section>

          <section className="border-t border-[var(--border)] pt-3">
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
      </div>

      <OrphanNotice />

      <div className="lq-dashboard-secondary">
      <section className="lq-workflow-section">
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
        <section className="lq-workflow-section">
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
      </div>

      <div className="mt-6"><PlaylistManager /></div>
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
      <div className="mt-1.5"><ProgressBar label="Next checkpoint progress" pct={rp.count ? (rp.done / rp.count) * 100 : 0} tone="cyan" /></div>
    </div>
  );
}
