import { useMemo } from 'react';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid } from 'recharts';
import {
  computePlaylistProgress, snapshotCompleteness, sumEntries, formatSecondsHHMMSS, formatHuman,
  buildInsights, dateKeyInTimezone, splitIntervalByDay,
} from '../../domain/index.js';
import { useStore } from '../../app/store.js';
import { Card, ProgressBar, Empty } from '../../components/ui/ui.js';
import { CumulativeChart } from '../../components/charts/CumulativeChart.js';
import { ProgressDonut } from '../../components/charts/ProgressDonut.js';
import { TICK, GRID_STROKE, TOOLTIP_STYLE, SERIES, positionTicks } from '../../components/charts/theme.js';

export function Analytics() {
  const s = useStore();
  const snap = s.activeId ? s.playlists[s.activeId] : undefined;
  const pid = snap?.playlistId;
  const today = dateKeyInTimezone(new Date(), s.prefs.timezone);
  const dayMs = 86400000;

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
    const verified = Object.values(s.progress).filter((p) => p.playlistId === pid && p.source === 'verified' && p.completedAt).length;
    const manual = Object.values(s.progress).filter((p) => p.playlistId === pid && p.source !== 'verified' && p.completedAt).length;
    // week windows in tz
    const keyOf = (t: number) => dateKeyInTimezone(new Date(t), s.prefs.timezone);
    const wk = (agoDays: number, len: number) => {
      const out: string[] = [];
      for (let i = agoDays + len - 1; i >= agoDays; i--) out.push(keyOf(Date.now() - i * dayMs));
      return new Set(out);
    };
    const thisWk = wk(0, 7);
    const lastWk = wk(7, 7);
    const inWk = (iso: string, set: Set<string>) => set.has(dateKeyInTimezone(new Date(iso), s.prefs.timezone));
    const segIn = (ms: number, set: Set<string>) => set.has(dateKeyInTimezone(new Date(ms), s.prefs.timezone));
    const twContent = s.segments.filter((x) => x.playlistId === pid && segIn(x.wallStartMs, thisWk)).reduce((a, x) => a + Math.max(0, x.timelineEndSec - x.timelineStartSec), 0);
    const lwContent = s.segments.filter((x) => x.playlistId === pid && segIn(x.wallStartMs, lastWk)).reduce((a, x) => a + Math.max(0, x.timelineEndSec - x.timelineStartSec), 0);
    const twFocus = s.sessions.filter((x) => x.playlistId === pid && inWk(x.startedAt, thisWk)).reduce((a, x) => a + x.activeSec, 0);
    const lwFocus = s.sessions.filter((x) => x.playlistId === pid && inWk(x.startedAt, lastWk)).reduce((a, x) => a + x.activeSec, 0);
    const sessWk = s.sessions.filter((x) => x.playlistId === pid && inWk(x.startedAt, thisWk)).length
      + s.playSessions.filter((x) => x.playlistId === pid && segIn(new Date(x.startedAt).getTime(), thisWk)).length;
    const allSess = [
      ...s.sessions.filter((x) => x.playlistId === pid).map((x) => x.activeSec / 60),
      ...s.playSessions.filter((x) => x.playlistId === pid).map((x) => x.activePlaybackSec / 60),
    ];
    const avgSess = allSess.length ? allSess.reduce((a, b) => a + b, 0) / allSess.length : null;
    // largest remaining module
    const mods = s.modules.filter((m) => m.playlistId === pid).map((m) => {
      const entries = snap.entries.filter((e) => m.positions.includes(e.position));
      const left = m.positions.filter((p) => !s.progress[`${pid}::${p}`]?.completedAt);
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
    const confs = Object.values(s.progress).filter((p) => p.playlistId === pid && p.confidence);
    const avgConf = confs.length ? confs.reduce((a, p) => a + (p.confidence ?? 0), 0) / confs.length : null;
    const revOpen = Object.values(s.progress).filter((p) => p.playlistId === pid && p.needsRevision).length;
    return { prog, comp, cum, dist, verified, manual, insights, hist, avgConf, confs: confs.length, revOpen, mods };
  }, [snap, pid, s.progress, s.segments, s.sessions, s.playSessions, s.modules, s.prefs, today]);

  if (!snap || !data) return <Empty title="No active playlist" hint="Analytics respond to the active playlist and real activity." />;

  return (
    <div className="min-w-0 space-y-4">
      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <Card className="min-w-0">
          <h3 className="text-sm font-bold">Cumulative content</h3>
          <CumulativeChart data={data.cum} heightClass="h-52" complete={data.comp.isComplete} />
        </Card>
        <Card className="min-w-0">
          <h3 className="text-sm font-bold">Duration distribution</h3>
          <p className="text-[11px] text-slate-500">Minutes per video across the playlist (every resolved entry)</p>
          <div className="h-52 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.dist} margin={{ top: 8, right: 8, bottom: 20, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                <XAxis dataKey="pos" tick={TICK} ticks={data.dist.length ? positionTicks(data.dist[0].pos, data.dist[data.dist.length - 1].pos) : []} minTickGap={8} label={{ value: 'playlist position', position: 'insideBottom', offset: -14, fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={TICK} width={44} label={{ value: 'min / video', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#64748b' }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [`${v} min`, 'length']} labelFormatter={(l) => `Video #${l}`} />
                <Bar dataKey="min" fill={SERIES.cyan} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid min-w-0 gap-4 md:grid-cols-3">
        <Card>
          <h3 className="text-sm font-bold">Completed vs remaining</h3>
          <ProgressDonut done={data.prog.completedCount} total={data.prog.n} heightClass="h-44" />
          <p className="text-xs text-slate-400">{data.prog.completedCount}/{data.prog.n} videos · {data.prog.isDurationComplete && data.prog.completedSec !== null ? `${formatSecondsHHMMSS(data.prog.completedSec)} content done` : 'duration total incomplete — count shown'}.</p>
        </Card>
        <Card>
          <h3 className="text-sm font-bold">Verified vs manual</h3>
          <p className="mt-2 text-2xl font-bold">{data.verified} <span className="text-xs font-normal text-slate-400">verified</span> · {data.manual} <span className="text-xs font-normal text-slate-400">manual</span></p>
          <div className="mt-2"><ProgressBar pct={data.verified + data.manual ? (data.verified / (data.verified + data.manual)) * 100 : 0} tone="emerald" /></div>
          <p className="mt-1 text-xs text-slate-400">Checkboxes are manual by design; only player-observed coverage ≥ threshold counts as verified.</p>
        </Card>
        <Card>
          <h3 className="text-sm font-bold">Session lengths</h3>
          <p className="text-[11px] text-slate-500">Number of recorded sessions per duration bucket (minutes)</p>
          <div className="h-44 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.hist} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                <XAxis dataKey="range" tick={TICK} label={{ value: 'minutes', position: 'insideBottom', offset: 0, fontSize: 11, fill: '#64748b' }} />
                <YAxis tick={TICK} allowDecimals={false} label={{ value: 'sessions', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#64748b' }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="n" fill={SERIES.violet} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <Card>
          <h3 className="text-sm font-bold">Modules & learning quality</h3>
          {data.mods.length === 0 && <p className="text-xs text-slate-500">No modules yet — group playlist positions into chapters on the Modules tab (e.g. “Basics 1–8”). Analytics will summarize remaining work per module here.</p>}
          {data.mods.map((m) => (
            <p key={m.name} className="mt-1 text-xs text-slate-300">{m.name} · {m.remainingCount} left{m.remainingSec !== null ? ` · ${formatHuman(m.remainingSec)}` : ''}</p>
          ))}
          <p className="mt-2 text-xs text-slate-400">
            Confidence rated on {data.confs} videos{data.avgConf !== null ? ` (avg ${data.avgConf.toFixed(1)}/5)` : ''} · {data.revOpen} flagged for revision. Mastery is evidence, not a single score.
          </p>
        </Card>
        <Card>
          <h3 className="text-sm font-bold">Insights (from recorded values)</h3>
          <ul className="mt-1 space-y-1.5 text-sm">
            {data.insights.map((i, k) => (
              <li key={k} className={`rounded-xl p-2 text-xs ${i.kind === 'good' ? 'bg-emerald-500/10 text-emerald-200' : i.kind === 'warn' ? 'bg-amber-500/10 text-amber-200' : 'bg-white/5 text-slate-300'}`}>{i.text}</li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
