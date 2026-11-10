import { EvidenceChart } from '../../components/charts/EvidenceChart.js';
import { useMemo } from 'react';
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
import { DurationBars } from '../../components/charts/DurationBars.js';
import { playlistPoints } from '../../components/charts/playlistSeries.js';

export function Analytics() {
  const s = useStore();
  const snap = s.activeId ? s.playlists[s.activeId] : undefined;
  const pid = snap?.playlistId;
  const today = useDayTick(s.prefs.timezone);

  const data = useMemo(() => {
    if (!snap || !pid) return null;
    const prog = computePlaylistProgress(snap, pid ? s.progress : {});
    const comp = snapshotCompleteness(snap);
    const index = buildEntryProgressIndex(snap, s.progress);
    const points = playlistPoints(pid, snap.entries, index);
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
    return { prog, comp, points, verified, manual, insights, hist, avgConf, confs: confs.length, revOpen, mods };
  }, [snap, pid, s.progress, s.segments, s.sessions, s.playSessions, s.modules, s.prefs, today]);

  if (!snap || !data) return <Empty title="No active playlist" hint="Analytics respond to the active playlist and real activity." />;

  return (
    <div className="lq-workflow">
      <section className="lq-workflow-columns" data-layout="balanced" aria-label="Playlist duration">
        <Card className="min-w-0">
          <h3 className="lq-section-title">Cumulative content</h3>
          <CumulativeChart key={`${snap.playlistId}:${snap.fetchedAt}`} data={data.points} heightClass="h-52" complete={data.comp.isComplete} />
        </Card>
        <Card className="min-w-0">
          <h3 className="lq-section-title">Duration distribution</h3>
          <DurationBars key={`${snap.playlistId}:${snap.fetchedAt}`} data={data.points} heightClass="h-52" ariaLabel="Minutes per resolved video" />
        </Card>
      </section>

      <section className="lq-workflow-section grid min-w-0 gap-4 md:grid-cols-3" aria-label="Learning activity and completion">
        <Card className="lq-workflow-band">
          <h3 className="lq-section-title">Completed vs remaining</h3>
          <ProgressDonut done={data.prog.completedCount} total={data.prog.n} heightClass="h-44" />
          <p className="text-xs text-[var(--text-muted)]">{data.prog.completedCount}/{data.prog.n} videos · {data.prog.isDurationComplete && data.prog.completedSec !== null ? `${formatSecondsHHMMSS(data.prog.completedSec)} content done` : 'duration total incomplete — count shown'}.</p>
        </Card>
        <Card>
          <h3 className="lq-section-title">Verified vs manual</h3>
          <p className="mt-2 text-2xl font-bold">{data.verified} <span className="text-xs font-normal text-[var(--text-muted)]">verified</span> · {data.manual} <span className="text-xs font-normal text-[var(--text-muted)]">manual</span></p>
          <div className="mt-2"><ProgressBar label="Verified completions" pct={data.verified + data.manual ? (data.verified / (data.verified + data.manual)) * 100 : 0} tone="emerald" /></div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Checkboxes are manual by design; only player-observed coverage ≥ threshold counts as verified.</p>
        </Card>
        <Card>
          <h3 className="lq-section-title">Session lengths</h3>
          <p className="text-[11px] text-[var(--text-faint)]">Number of recorded sessions per duration bucket (minutes)</p>
          <EvidenceChart title="Recorded session count by duration bucket" unit="Sessions" kind="bar"
            data={data.hist.map((bucket) => ({ label: bucket.range, value: bucket.n }))} />
        </Card>
      </section>

      <div className="lq-workflow-columns" data-layout="balanced">
        <Card className="lq-workflow-section">
          <h3 className="lq-section-title">Modules & learning quality</h3>
          {data.mods.length === 0 && <p className="text-xs text-[var(--text-faint)]">No modules yet — group playlist positions into chapters on the Modules tab (e.g. “Basics 1–8”). Analytics will summarize remaining work per module here.</p>}
          {data.mods.map((m) => (
            <p key={m.name} className="mt-1 text-xs text-[var(--text)]">{m.name} · {m.remainingCount} left{m.remainingSec !== null ? ` · ${formatHuman(m.remainingSec)}` : ''}</p>
          ))}
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            Confidence rated on {data.confs} videos{data.avgConf !== null ? ` (avg ${data.avgConf.toFixed(1)}/5)` : ''} · {data.revOpen} with a current review signal (same queue rules as Revision). Mastery is evidence, not a single score.
          </p>
        </Card>
        <Card className="lq-workflow-section">
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
