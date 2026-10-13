import { CalendarDays, Flame, Trophy, CheckCircle2, Play } from 'lucide-react';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from 'recharts';
import {
  formatSecondsHHMMSS, formatHuman, computePlaylistProgress, computeRangeProgress,
  snapshotCompleteness, sumEntries, rangeDuration, computeStreak,
  activeFocusDayKeys, attributeFocusByDay, calendarWindowDates, ACHIEVEMENTS,
} from '../../domain/index.js';
import { useStore } from '../../app/store.js';
import { useDayTick } from '../../app/dayTick.js';
import { Card, ProgressBar, Empty } from '../../components/ui/ui.js';
import { CumulativeChart } from '../../components/charts/CumulativeChart.js';
import { TICK, GRID_STROKE, TOOLTIP_STYLE } from '../../components/charts/theme.js';

export function Dashboard() {
  const s = useStore();
  const snap = s.activeId ? s.playlists[s.activeId] : undefined;
  if (!snap) return <Empty title="No active playlist" hint="Add a playlist to see your learning journey." />;
  const prog = computePlaylistProgress(snap, s.progress);
  const comp = snapshotCompleteness(snap);
  const todayKey = useDayTick(s.prefs.timezone);
  const goal = s.goals[todayKey];
  // Interval-attributed focus: cross-midnight sessions split at tz boundaries
  // (stored dateKey labels alone would strand the after-midnight share).
  const focusByDay = attributeFocusByDay(s.sessions, s.prefs.timezone);
  const todaySec = focusByDay.get(todayKey) ?? 0;
  const streak = computeStreak(activeFocusDayKeys(s.sessions, s.prefs.timezone), todayKey);
  const nextCp = s.checkpoints
    .filter((c) => c.playlistId === snap.playlistId && !c.completedAt && c.status !== 'needsReview')
    .sort((a, b) => a.end - b.end)[0];
  const recent = Object.values(s.progress)
    .filter((p) => p.playlistId === snap.playlistId && p.completedAt)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
    .slice(0, 5);
  const titleOf = (pos: number) => snap.entries.find((e) => e.position === pos)?.title ?? `#${pos}`;

  // weekly trend (last 7 calendar days in tz, DST-safe)
  const weekKeys = calendarWindowDates(7, s.prefs.timezone);
  const days: { day: string; min: number }[] = weekKeys.map((k) => ({
    day: k.slice(5),
    min: Math.round((focusByDay.get(k) ?? 0) / 60),
  }));
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
    <div className="min-w-0 space-y-4">
      <div className="grid min-w-0 gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2 border-violet-500/20">
          <div className="flex flex-wrap items-center gap-3">
            {snap.thumbnail && <img src={snap.thumbnail} alt="" className="h-16 w-28 rounded-xl object-cover" />}
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-bold">{s.meta[snap.playlistId]?.customTitle ?? snap.title}</h2>
              <p className="text-xs text-slate-400">
                {snap.entries.length} entries · {comp.resolved} resolved · {comp.unresolved} unresolved · {snap.source} · {comp.isComplete ? 'complete total' : 'INCOMPLETE total'}
              </p>
            </div>
            {resumeUrl ? (
              <a href={resumeUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg">
                <Play size={15} /> Resume #{prog.nextPosition}
              </a>
            ) : (
              <span className="rounded-xl bg-emerald-500/15 px-4 py-2.5 text-sm font-semibold text-emerald-300">Course complete</span>
            )}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
            <Stat label="Videos done" value={`${prog.completedCount}/${prog.n}`} />
            <Stat label="Content done" value={prog.completedSec !== null ? formatSecondsHHMMSS(prog.completedSec) : '— incomplete'} />
            <Stat label="Remaining" value={prog.remainingSec !== null ? formatSecondsHHMMSS(prog.remainingSec) : `${prog.remainingCount} videos`} />
            <Stat label="Count %" value={`${prog.countPct.toFixed(1)}%`} />
          </div>
          <div className="mt-3 space-y-2">
            <ProgressBar pct={prog.countPct} tone="violet" />
            {prog.durationPct !== null ? (
              <>
                <ProgressBar pct={prog.durationPct} tone="cyan" />
                <p className="text-xs text-slate-400">Duration-based: {prog.durationPct.toFixed(1)}% of verified content.</p>
              </>
            ) : (
              <p className="text-xs text-amber-300">Duration totals incomplete ({comp.unresolved} unresolved at {comp.unresolvedPositions.slice(0, 8).join(', ')}) — duration % withheld to avoid a false exact figure.</p>
            )}
          </div>
          <div className="mt-3">
            <CumulativeChart data={cum} heightClass="h-48" complete={comp.isComplete} />
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <h3 className="flex items-center gap-1.5 text-sm font-bold"><CalendarDays size={15} /> Today's goal</h3>
            {goal ? (
              <>
                <p className="mt-1 text-2xl font-bold">{formatHuman(todaySec)} <span className="text-sm font-normal text-slate-400">/ {formatHuman(goal.targetFocusSec)}</span></p>
                <ProgressBar pct={goal.targetFocusSec ? (todaySec / goal.targetFocusSec) * 100 : 0} tone="emerald" />
                <p className="mt-1 text-xs text-slate-400">
                  {todaySec >= goal.targetFocusSec ? 'Goal met — well done.' : `${formatHuman(Math.max(0, goal.targetFocusSec - todaySec))} to go.`}
                  {goal.targetCount ? ` · ${prog.completedCount} videos done` : ''} Minimum viable: {formatHuman(goal.minViableSec)}.
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-slate-400">No goal set for today. Open Focus to plan one (a 10-minute minimum counts).</p>
            )}
            <div className="mt-2 flex items-center gap-2 text-sm">
              <Flame size={15} className="text-orange-400" />
              <span><b>{streak}</b> day streak · {days.reduce((a, d) => a + d.min, 0)} min this week</span>
            </div>
            <div className="mt-2 h-24 min-w-0">
              <p className="mb-1 text-[11px] text-slate-500">Focused minutes per day, last 7 days</p>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={days} margin={{ top: 4, right: 8, bottom: 4, left: -12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                  <XAxis dataKey="day" tick={TICK} interval={1} />
                  <YAxis tick={TICK} label={{ value: 'min', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#64748b' }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [`${v} min`, 'focus']} />
                  <Line type="monotone" dataKey="min" stroke="#22d3ee" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card>
            <h3 className="text-sm font-bold">Next milestone</h3>
            {nextCp ? (
              <NextCheckpoint id={nextCp.id} />
            ) : (
              <p className="mt-1 text-sm text-slate-400">No open checkpoint. Create one in Checkpoints — e.g. your next 8 videos.</p>
            )}
          </Card>
        </div>
      </div>

      <div className="grid min-w-0 gap-4 md:grid-cols-3">
        <Card>
          <h3 className="text-sm font-bold">Complete playlist</h3>
          <SummaryList
            rows={[
              ['Entries (N)', String(snap.entries.length)],
              ['Resolved', String(comp.resolved)],
              ['Unresolved', String(comp.unresolved)],
              ['Total', comp.isComplete ? formatSecondsHHMMSS(sumEntries(snap.entries).totalSec) : 'INCOMPLETE'],
            ]}
          />
        </Card>
        <Card>
          <h3 className="text-sm font-bold">Custom ranges ({s.ranges.filter((r) => r.playlistId === snap.playlistId).length})</h3>
          {s.ranges.filter((r) => r.playlistId === snap.playlistId).slice(0, 4).map((r) => (
            <RangeLine key={r.id} playlistId={snap.playlistId} start={r.start} end={r.end} label={r.label} />
          ))}
          {s.ranges.filter((r) => r.playlistId === snap.playlistId).length === 0 && <p className="text-xs text-slate-500">Save ranges in Library.</p>}
        </Card>
        <Card>
          <h3 className="flex items-center gap-1.5 text-sm font-bold"><Trophy size={15} /> Achievements & XP</h3>
          <p className="text-2xl font-bold">{s.xp.reduce((a, e) => a + e.points, 0)} <span className="text-xs font-normal text-slate-400">XP</span></p>
          <div className="mt-1 flex flex-wrap gap-1">
            {ACHIEVEMENTS.map((a) => (
              <span key={a.key} title={a.description} className={`rounded-full px-2 py-0.5 text-[11px] ${s.achievements[a.key] ? 'bg-violet-600/30 text-violet-200' : 'bg-white/5 text-slate-500'}`}>
                {s.achievements[a.key] ? '★ ' : ''}{a.label}
              </span>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <h3 className="text-sm font-bold">Recent accomplishments</h3>
        {recent.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">Nothing completed yet — your first finished video will appear here. No fabricated history.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {recent.map((p) => (
              <li key={`${p.playlistId}::${p.position}`} className="flex items-center gap-2">
                <CheckCircle2 size={14} className="text-emerald-400" />
                <span className="text-slate-400">#{p.position}</span>
                <span className="truncate">{titleOf(p.position)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/5 p-2">
      <p className="truncate text-sm font-bold">{value}</p>
      <p className="text-[11px] text-slate-400">{label}</p>
    </div>
  );
}

function SummaryList({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="mt-2 space-y-1 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2">
          <dt className="text-slate-400">{k}</dt>
          <dd className="font-mono">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function RangeLine({ playlistId, start, end, label }: { playlistId: string; start: number; end: number; label: string }) {
  const s = useStore();
  const snap = s.playlists[playlistId];
  if (!snap) return null;
  try {
    const r = rangeDuration(snap, start, end);
    return (
      <p className="mt-1 truncate text-xs text-slate-300">
        {label} <span className="text-slate-500">({start}–{end})</span> · <span className="font-mono">{r.isComplete ? formatSecondsHHMMSS(r.totalSec) : `${formatSecondsHHMMSS(r.totalSec)} +?`}</span>
      </p>
    );
  } catch {
    return <p className="mt-1 text-xs text-amber-300">{label} — needs review (playlist changed).</p>;
  }
}

function NextCheckpoint({ id }: { id: string }) {
  const s = useStore();
  const c = s.checkpoints.find((x) => x.id === id);
  const snap = c ? s.playlists[c.playlistId] : undefined;
  if (!c || !snap) return null;
  const rp = computeRangeProgress(snap, c.start, c.end, s.progress);
  return (
    <div className="mt-1 text-sm">
      <p className="font-semibold">{c.label} <span className="font-normal text-slate-400">({c.start}–{c.end})</span></p>
      <p className="text-xs text-slate-400">{rp.remaining} videos left{rp.totalSec !== null ? ` · ${formatHuman(rp.totalSec - (rp.doneSec ?? 0))} remaining` : ''}.</p>
      <div className="mt-1"><ProgressBar pct={rp.count ? (rp.done / rp.count) * 100 : 0} tone="cyan" /></div>
    </div>
  );
}

/* ---------------- Library: table + range explorer ---------------- */
