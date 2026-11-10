import { useMemo, useState } from 'react';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid } from 'recharts';
import {
  computePlaylistProgress, snapshotCompleteness, sumEntries, formatSecondsHHMMSS, formatHuman,
  buildInsights, calendarWindowDates, buildEntryProgressIndex, isProgressComplete, hasRevisionSignal,
  attributeFocusByDay, splitIntervalByDay, focusSessionDaySlices, splitPlaybackSegmentByDay,
  summarizeByEntry,
} from '../../domain/index.js';
import { useStore } from '../../app/store.js';
import { useDayTick } from '../../app/dayTick.js';
import { Card, ProgressBar, Empty } from '../../components/ui/ui.js';
import { CumulativeChart } from '../../components/charts/CumulativeChart.js';
import { ProgressDonut } from '../../components/charts/ProgressDonut.js';
import { useChartTheme, positionTicks } from '../../components/charts/theme.js';
import { PanChart, niceTicks } from '../../components/charts/PanChart.js';

export function Analytics() {
  const s = useStore();
  const { TICK, GRID_STROKE, TOOLTIP_STYLE, SERIES, AXIS_LABEL } = useChartTheme();
  const snap = s.activeId ? s.playlists[s.activeId] : undefined;
  const pid = snap?.playlistId;
  const today = useDayTick(s.prefs.timezone);

  const data = useMemo(() => {
    if (!snap || !pid) return null;
    const prog = computePlaylistProgress(snap, pid ? s.progress : {});
    const comp = snapshotCompleteness(snap);
    let acc = 0;
    const cum = snap.entries.map((e) => {
      acc += e.durationSec ?? 0;
      return { pos: e.position, hrs: +(acc / 3600).toFixed(2), cumSec: acc };
    });
    const dist = snap.entries.filter((e) => e.durationSec !== null).map((e) => ({ pos: e.position, min: +((e.durationSec! / 60).toFixed(1)) }));
    const index = buildEntryProgressIndex(snap, s.progress);
    const verified = snap.entries.filter((e) => {
      const rec = index.get(e.position);
      return isProgressComplete(rec) && rec?.source === 'verified';
    }).length;
    const manual = snap.entries.filter((e) => {
      const rec = index.get(e.position);
      return isProgressComplete(rec) && rec?.source !== 'verified';
    }).length;
    // week windows: DST-safe calendar arithmetic in tz (current partial day included)
    const thisWk = new Set(calendarWindowDates(7, s.prefs.timezone));
    const lastWkKeys = calendarWindowDates(14, s.prefs.timezone).slice(0, 7);
    const lastWk = new Set(lastWkKeys);
    // Playback coverage is a timeline union, not a sum of every observed
    // segment. Rewatches, overlapping polls, and cross-midnight slices of the
    // same occurrence must not inflate "content watched" or the weekly change.
    const scopedSegments = s.segments.filter((x) => x.playlistId === pid);
    const focusByDay = attributeFocusByDay(s.sessions.filter((x) => x.playlistId === pid), s.prefs.timezone);
    const contentIn = (set: Set<string>) => summarizeByEntry(
      scopedSegments.flatMap((segment) => splitPlaybackSegmentByDay(segment, s.prefs.timezone))
        .filter((slice) => set.has(slice.dateKey))
        .map((slice) => slice.segment),
    ).uniqueSec;
    const focusIn = (set: Set<string>) => [...set].reduce((a, k) => a + (focusByDay.get(k) ?? 0), 0);
    const twContent = contentIn(thisWk);
    const lwContent = contentIn(lastWk);
    const twFocus = focusIn(thisWk);
    const lwFocus = focusIn(lastWk);
    const sessWk = s.sessions.filter((x) => x.playlistId === pid
      && focusSessionDaySlices(x, s.prefs.timezone).some((slice) => thisWk.has(slice.dateKey))).length
      + s.playSessions.filter((x) => {
        const start = new Date(x.startedAt).getTime();
        if (!Number.isFinite(start)) return false;
        const end = x.finishedAt ? new Date(x.finishedAt).getTime() : start + 1;
        return splitIntervalByDay(start, Math.max(start + 1, end), s.prefs.timezone)
          .some((slice) => thisWk.has(slice.dateKey));
      }).length;
    const allSess = [
      ...s.sessions.filter((x) => x.playlistId === pid).map((x) => x.activeSec / 60),
      ...s.playSessions.filter((x) => x.playlistId === pid).map((x) => x.activePlaybackSec / 60),
    ];
    const avgSess = allSess.length ? allSess.reduce((a, b) => a + b, 0) / allSess.length : null;
    // largest remaining module — completion follows occurrence identity
    const mods = s.modules.filter((m) => m.playlistId === pid).map((m) => {
      const entries = snap.entries.filter((e) => m.positions.includes(e.position));
      const left = m.positions.filter((p) => !isProgressComplete(index.get(p)));
      const sum = sumEntries(entries.filter((e) => left.includes(e.position)));
      return { name: m.name, remainingCount: left.length, remainingSec: sum.isComplete ? sum.totalSec : null };
    }).sort((a, b) => b.remainingCount - a.remainingCount);
    const insights = buildInsights({
      thisWeekContentSec: Math.round(twContent), lastWeekContentSec: Math.round(lwContent),
      thisWeekFocusSec: twFocus, lastWeekFocusSec: lwFocus, sessionsThisWeek: sessWk,
      targetSessionMin: s.prefs.sessionLenMin, avgSessionMin: avgSess,
      largestRemainingModule: mods[0] && mods[0].remainingCount > 0 ? mods[0] : null,
      efficiencySamples: sessWk,
    });
    // session-duration histogram (minutes, buckets)
    const buckets = [0, 10, 20, 30, 45, 60, 90, 1e9];
    const hist = buckets.slice(0, -1).map((b, i) => ({
      range: i === buckets.length - 2 ? `${b}+` : `${b}–${buckets[i + 1]}`,
      n: allSess.filter((v) => v >= b && v < buckets[i + 1]).length,
    }));
    // confidence trend
    const current = [...index.values()];
    const confs = current.filter((p) => p.confidence);
    const avgConf = confs.length ? confs.reduce((a, p) => a + (p.confidence ?? 0), 0) / confs.length : null;
    const revOpen = current.filter((p) => hasRevisionSignal(p)).length;
    return { prog, comp, cum, dist, verified, manual, insights, hist, avgConf, confs: confs.length, revOpen, mods };
  }, [snap, pid, s.progress, s.segments, s.sessions, s.playSessions, s.modules, s.prefs, today]);
  const distMax = data?.dist.length ? Math.max(...data.dist.map((p) => p.min), 1) : 1;
  const distYTicks = niceTicks(distMax);
  const distYTop = niceTicks(distMax, 4).slice(-1)[0];
  const [distMode, setDistMode] = useState<'overview' | 'detail'>('overview');
  const distCount = data?.dist.length ?? 0;
  const distOverviewTicks = distCount <= 25 ? 0 : Math.min(Math.max(Math.floor(distCount / 14), 5), 9);

  if (!snap || !data) return <Empty title="No active playlist" hint="Analytics respond to the active playlist and real activity." />;

  return (
    <div className="min-w-0 space-y-4">
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <Card className="min-w-0">
          <h3 className="lq-section-title">Cumulative content</h3>
          <CumulativeChart data={data.cum} heightClass="h-52" complete={data.comp.isComplete} />
          <details className="mt-2 text-xs text-[var(--text)]">
            <summary className="cursor-pointer font-semibold">View chart data as a table</summary>
            <div className="mt-1 overflow-x-auto">
              <table className="lq-data-table text-left">
                <caption className="sr-only">Cumulative resolved content by playlist position</caption>
                <thead><tr><th className="pr-3 font-semibold">Position</th><th className="font-semibold">Cumulative time</th></tr></thead>
                <tbody>
                  {data.cum.filter((_, i) => i === 0 || i === data.cum.length - 1 || i === Math.floor(data.cum.length / 2)).map((p) => (
                    <tr key={p.pos} className="border-t border-[var(--border)]"><td className="pr-3">{p.pos}</td><td>{formatSecondsHHMMSS(p.cumSec)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </Card>
        <Card className="min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="lq-section-title">Duration distribution</h3>
            <button
              type="button"
              onClick={() => setDistMode((m) => (m === 'overview' ? 'detail' : 'overview'))}
              aria-pressed={distMode === 'detail'}
              className="text-[11px] font-semibold text-[var(--text-muted)] underline underline-offset-2 hover:text-[var(--text)]"
            >
              {distMode === 'overview' ? 'Explore individual videos' : 'Return to full overview'}
            </button>
          </div>
          <p className="text-[11px] text-[var(--text-faint)]">Minutes per video across the playlist</p>
          <div className="h-52 min-w-0">
            <PanChart count={distCount} slotWidth={12} yTicks={[...distYTicks].reverse().map(String)} ariaLabel="Minutes per resolved video" mode={distMode}>
              {(_innerWidth) => (
                <ResponsiveContainer width="100%" height="100%">
                  {distMode === 'overview' ? (
                    <BarChart data={data?.dist ?? []} margin={{ top: 6, right: 8, bottom: 18, left: 0 }} barCategoryGap="22%">
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                      <XAxis dataKey="pos" tick={TICK} ticks={distCount ? positionTicks(data!.dist[0].pos, data!.dist[data!.dist.length - 1].pos, distOverviewTicks) : []} minTickGap={8} axisLine={false} tickLine={false} />
                      <YAxis tick={TICK} width={38} axisLine={false} tickLine={false} domain={[0, distYTop]} ticks={distYTicks} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [`${v} min`, 'length']} labelFormatter={(l) => `Video #${l}`} />
                      <Bar dataKey="min" fill={SERIES.steel} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  ) : (
                    <BarChart data={data?.dist ?? []} margin={{ top: 6, right: 0, bottom: 18, left: 44 }} barCategoryGap="18%">
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                      <XAxis dataKey="pos" tick={TICK} ticks={distCount ? positionTicks(data!.dist[0].pos, data!.dist[data!.dist.length - 1].pos, 0) : []} minTickGap={8} axisLine={false} tickLine={false} />
                      <YAxis hide domain={[0, distYTop]} ticks={distYTicks} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [`${v} min`, 'length']} labelFormatter={(l) => `Video #${l}`} />
                      <Bar dataKey="min" fill={SERIES.steel} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  )}
                </ResponsiveContainer>
              )}
            </PanChart>
          </div>
          <details className="mt-2 text-xs text-[var(--text)]">
            <summary className="cursor-pointer font-semibold">View chart data as a table</summary>
            <div className="mt-1 max-h-40 overflow-auto">
              <table className="lq-data-table text-left">
                <caption className="sr-only">Duration in minutes by playlist position</caption>
                <thead><tr><th className="pr-3 font-semibold">Position</th><th className="font-semibold">Minutes</th></tr></thead>
                <tbody>
                  {data.dist.slice(0, 10).map((p) => (
                    <tr key={p.pos} className="border-t border-[var(--border)]"><td className="pr-3">{p.pos}</td><td>{p.min}</td></tr>
                  ))}
                </tbody>
              </table>
              {data.dist.length > 10 && <p className="mt-1 text-[11px] text-[var(--text-faint)]">Showing the first 10 of {data.dist.length} resolved entries.</p>}
            </div>
          </details>
        </Card>
      </div>

      <div className="grid min-w-0 gap-4 md:grid-cols-3">
        <Card>
          <h3 className="lq-section-title">Completed vs remaining</h3>
          <ProgressDonut done={data.prog.completedCount} total={data.prog.n} heightClass="h-44" />
          <p className="text-xs text-[var(--text-muted)]">{data.prog.completedCount}/{data.prog.n} videos · {data.prog.isDurationComplete && data.prog.completedSec !== null ? `${formatSecondsHHMMSS(data.prog.completedSec)} content done` : 'duration total incomplete — count shown'}.</p>
        </Card>
        <Card>
          <h3 className="lq-section-title">Verified vs manual</h3>
          <p className="mt-2 text-2xl font-bold">{data.verified} <span className="text-xs font-normal text-[var(--text-muted)]">verified</span> · {data.manual} <span className="text-xs font-normal text-[var(--text-muted)]">manual</span></p>
          <div className="mt-2"><ProgressBar pct={data.verified + data.manual ? (data.verified / (data.verified + data.manual)) * 100 : 0} tone="emerald" /></div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Checkboxes are manual by design; only player-observed coverage ≥ threshold counts as verified.</p>
        </Card>
        <Card>
          <h3 className="lq-section-title">Session lengths</h3>
          <p className="text-[11px] text-[var(--text-faint)]">Number of recorded sessions per duration bucket (minutes)</p>
          <div className="h-44 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.hist} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                <XAxis dataKey="range" tick={TICK} label={{ value: 'minutes', position: 'insideBottom', offset: 0, fontSize: 11, fill: AXIS_LABEL.fill }} />
                <YAxis tick={TICK} allowDecimals={false} label={{ value: 'sessions', angle: -90, position: 'insideLeft', fontSize: 11, fill: AXIS_LABEL.fill }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="n" fill={SERIES.primary} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <details className="mt-2 text-xs text-[var(--text)]">
            <summary className="cursor-pointer font-semibold">View chart data as a table</summary>
            <table className="mt-1 lq-data-table text-left">
              <caption className="sr-only">Recorded session count by duration bucket</caption>
              <thead><tr><th className="pr-3 font-semibold">Minutes</th><th className="font-semibold">Sessions</th></tr></thead>
              <tbody>
                {data.hist.map((row) => (
                  <tr key={row.range} className="border-t border-[var(--border)]"><td className="pr-3">{row.range}</td><td>{row.n}</td></tr>
                ))}
              </tbody>
            </table>
          </details>
        </Card>
      </div>

      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <Card>
          <h3 className="lq-section-title">Modules & learning quality</h3>
          {data.mods.length === 0 && <p className="text-xs text-[var(--text-faint)]">No modules yet — group playlist positions into chapters on the Modules tab (e.g. “Basics 1–8”). Analytics will summarize remaining work per module here.</p>}
          {data.mods.map((m) => (
            <p key={m.name} className="mt-1 text-xs text-[var(--text)]">{m.name} · {m.remainingCount} left{m.remainingSec !== null ? ` · ${formatHuman(m.remainingSec)}` : ''}</p>
          ))}
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            Confidence rated on {data.confs} videos{data.avgConf !== null ? ` (avg ${data.avgConf.toFixed(1)}/5)` : ''} · {data.revOpen} with a current review signal (same queue rules as Revision). Mastery is evidence, not a single score.
          </p>
        </Card>
        <Card>
          <h3 className="lq-section-title">Insights (from recorded values)</h3>
          <ul className="mt-1 space-y-1.5 text-sm">
            {data.insights.map((i, k) => (
              <li key={k} className={`rounded-lg p-2 text-xs ${i.kind === 'good' ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200' : i.kind === 'warn' ? 'bg-amber-500/10 text-amber-800 dark:text-amber-200' : 'bg-[var(--surface-soft)] text-[var(--text)]'}`}>{i.text}</li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
