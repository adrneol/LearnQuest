import { EvidenceChart } from '../../components/charts/EvidenceChart.js';
import { useMemo, useState } from 'react';
import {
  contentEfficiency, playbackUtilization, compareWindows,
  formatHuman, summarizeSegments, calendarWindowDates,
  attributeFocusByDay, splitPlaybackSegmentByDay, segmentIdentityKey,
  filterFocusByEvidence, type EvidenceFilter,
} from '../../domain/index.js';
import type { PlaybackSegment } from '../../domain/index.js';
import { useStore } from '../../app/store.js';
import { useDayTick } from '../../app/dayTick.js';
import { Dropdown } from '../../components/ui/Dropdown.js';
import { Card, Empty } from '../../components/ui/ui.js';

export function Efficiency() {
  const s = useStore();
  const snap = s.activeId ? s.playlists[s.activeId] : undefined;
  const [scope, setScope] = useState<string>('all');
  const [src, setSrc] = useState<EvidenceFilter>('all');
  const tz = s.prefs.timezone;
  const todayTick = useDayTick(tz);

  const model = useMemo(() => {
    // One consistent definition everywhere on this screen: unique coverage is
    // the interval union over the selected evidence; overall efficiency is the
    // aggregate ratio over the same selection (never the mean of dailies).
    const segs = s.segments.filter(
      (x) => (scope === 'all' || x.playlistId === scope) && (src === 'all' || x.source === src),
    );
    const byEntry = new Map<string, PlaybackSegment[]>();
    for (const x of segs) {
      const k = segmentIdentityKey(x);
      const arr = byEntry.get(k) ?? [];
      arr.push(x);
      byEntry.set(k, arr);
    }
    let unique = 0;
    let content = 0;
    let active = 0;
    for (const arr of byEntry.values()) {
      const r = summarizeSegments(arr);
      unique += r.uniqueSec;
      content += r.totalContentSec;
      active += r.activeSec;
    }
    const scopedSessions = s.sessions.filter((x) => scope === 'all' || x.playlistId === scope);
    // Evidence applies to both sides of the ratio: a "Verified playback" view
    // must not divide observed coverage by a manually corrected focus session.
    const evidenceSessions = filterFocusByEvidence(scopedSessions, src);
    const focus = evidenceSessions.reduce((a, x) => a + x.activeSec, 0);
    const allScopedFocus = scopedSessions.reduce((a, x) => a + x.activeSec, 0);
    const eff = contentEfficiency({ uniqueContentSec: Math.round(unique), focusedSec: focus });
    const util = playbackUtilization(Math.round(active), focus);
    // daily series (last 14 calendar days) in tz — per-day unions for the trend view.
    // Focus uses interval attribution (cross-midnight split), so timezone
    // changes recompute history from UTC instead of trusting stored labels.
    const focusByDay = attributeFocusByDay(evidenceSessions, tz);
    // Split playback evidence at local midnight; each day gets only its share.
    const playbackByDay = new Map<string, PlaybackSegment[]>();
    for (const seg of segs) {
      for (const slice of splitPlaybackSegmentByDay(seg, tz)) {
        const arr = playbackByDay.get(slice.dateKey) ?? [];
        arr.push(slice.segment);
        playbackByDay.set(slice.dateKey, arr);
      }
    }
    const days: { day: string; eff: number | null; uniqueMin: number; focusMin: number }[] = [];
    for (const dk of calendarWindowDates(14, tz)) {
      const uBy = new Map<string, PlaybackSegment[]>();
      for (const x of playbackByDay.get(dk) ?? []) {
        const k = segmentIdentityKey(x);
        const arr = uBy.get(k) ?? [];
        arr.push(x);
        uBy.set(k, arr);
      }
      let du = 0;
      for (const arr of uBy.values()) du += summarizeSegments(arr).uniqueSec;
      const df = focusByDay.get(dk) ?? 0;
      const de = contentEfficiency({ uniqueContentSec: Math.round(du), focusedSec: df });
      days.push({ day: dk.slice(5), eff: de, uniqueMin: Math.round(du / 60), focusMin: Math.round(df / 60) });
    }
    const overall = contentEfficiency({ uniqueContentSec: Math.round(unique), focusedSec: focus });
    // trend: last 7 vs previous 7 daily unique minutes
    const dailyU = days.map((d) => d.uniqueMin * 60);
    const trend = compareWindows(dailyU.slice(7), dailyU.slice(0, 7), 3);
    // by playlist
    const perPl = Object.keys(s.playlists).map((id) => {
      const ps = s.segments.filter((x) => x.playlistId === id && (src === 'all' || x.source === src));
      const b = new Map<string, PlaybackSegment[]>();
      for (const x of ps) {
        const k = segmentIdentityKey(x);
        const arr = b.get(k) ?? [];
        arr.push(x);
        b.set(k, arr);
      }
      let u = 0;
      for (const arr of b.values()) u += summarizeSegments(arr).uniqueSec;
      const f = filterFocusByEvidence(
        s.sessions.filter((x) => x.playlistId === id),
        src,
      ).reduce((a, x) => a + x.activeSec, 0);
      return { id, title: s.playlists[id].title.slice(0, 28), eff: contentEfficiency({ uniqueContentSec: Math.round(u), focusedSec: f }) };
    });
    return {
      unique: Math.round(unique), content: Math.round(content), active: Math.round(active),
      focus, allScopedFocus, eff, util, days, overall, trend, perPl,
      contentOnlyDays: days.filter((d) => d.focusMin === 0 && d.uniqueMin > 0).length,
      hasRecordedSegments: segs.length > 0,
      hasScopedFocusSessions: scopedSessions.length > 0,
      estimatedFocusInScope: scopedSessions.filter((x) => x.estimated).reduce((a, x) => a + x.activeSec, 0),
    };
  }, [s.segments, s.sessions, s.playlists, scope, src, tz, todayTick]);

  if (!snap && scope !== 'all') return <Empty title="No active playlist" hint="Learning throughput needs recorded playback and focus sessions." />;

  return (
    <div className="lq-workflow">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-base font-bold">Learning throughput</h2>
          <div className="w-52">
            <Dropdown
              label="Scope"
              value={scope}
              options={[
                { value: 'all', label: 'All playlists' },
                ...Object.keys(s.playlists).map((id) => ({ value: id, label: s.playlists[id].title.slice(0, 30) })),
              ]}
              onChange={setScope}
            />
          </div>
          <div className="w-52">
            <Dropdown
              label="Evidence"
              value={src}
              options={[
                { value: 'all', label: 'All evidence' },
                { value: 'verified', label: 'Verified only', hint: 'Player segments + timer-observed focus' },
                { value: 'manual', label: 'Self-reported only', hint: 'manual segments + estimated focus' },
              ]}
              onChange={(v) => setSrc(v as any)}
            />
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
          <EffStat
            label="Learning throughput"
            value={model.eff !== null ? `${model.eff.toFixed(1)}%` : 'n/a'}
            title={model.eff === null
              ? model.focus === 0
                ? 'Undefined: timer-active study is zero in this selection.'
                : 'Undefined: the inputs are invalid or negative.'
              : 'Unique content ÷ timer-active study × 100'}
          />
          <EffStat
            label="Playback utilization"
            value={model.util !== null ? `${model.util.toFixed(1)}%` : 'n/a'}
            title={model.util === null ? 'Undefined: focused study is zero in this selection.' : 'Active playback (pauses/buffers excluded) ÷ focused study × 100; above 100% means playback exceeded tracked focus.'}
          />
          <EffStat label="Unique content / focused study" value={`${formatHuman(model.unique)} / ${formatHuman(model.focus)}`} title="Aggregate eligible seconds in the current scope and evidence selection" />
          <EffStat
            label="Period throughput"
            value={model.overall !== null ? `${model.overall.toFixed(1)}%` : 'n/a'}
            title="Aggregate unique content ÷ aggregate timer-active study — never the mean of daily percentages"
          />
        </div>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          <b>Learning throughput</b> = unique content ÷ timer-active study × 100. <b>Playback utilization</b> = active playback
          (playing time only; pauses and buffering excluded) ÷ timer-active study × 100. <b>Period throughput</b> uses the
          aggregate ratio over this exact scope and evidence selection, never the average of daily percentages. Over 100% is
          normal above 1× speed; lower is not worse — notes, coding and practice take real time. <b>n/a means undefined</b>
          (usually a zero denominator), not a fabricated zero.
        </p>
        {model.focus === 0 && (
          <div className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-100" role="status">
            {model.unique > 0 ? (
              <>
                {formatHuman(model.unique)} of unique content is recorded, but there is no matching timer-active study in this
                selection, so throughput has no denominator and is shown as <b>n/a</b>. The content measurement itself is
                still valid; record a Focus session (or change the Evidence filter) to calculate a ratio.
              </>
            ) : (
              <>No timer-active study and no unique content are recorded for this selection, so throughput is unavailable. This is an empty result, not a 0% performance score.</>
            )}
            {model.allScopedFocus > 0 && src !== 'all' && (
              <> There are {formatHuman(model.allScopedFocus)} of focus time under other evidence; choose <b>All evidence</b> to include it.</>
            )}
            {model.estimatedFocusInScope > 0 && src === 'verified' && (
              <> {formatHuman(model.estimatedFocusInScope)} of focus time is marked as a manual correction and is excluded by the verified-only filter.</>
            )}
          </div>
        )}
        {model.focus > 0 && model.unique === 0 && (
          <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] p-2 text-xs text-[var(--text)]" role="status">
            Timer-active time exists but no eligible unique content is recorded in this selection. Learning throughput is a
            real <b>0%</b>: there is a denominator, but no coverage numerator. Playback utilization may still be meaningful
            if active playback exists.
          </div>
        )}
        <p className="mt-2 text-[11px] text-[var(--text-faint)]">
          Evidence: <b>Verified playback</b> uses Player-observed segments and timer-observed focus; <b>Self-reported</b>
          uses manual timeline entries and estimated focus corrections. The selector applies to both the numerator and the
          denominator, so a verified figure never silently mixes in hand-entered time.
          Daily playback and focus derive from UTC timestamps split at {tz} day boundaries; cross-midnight time counts on
          both days and changing the timezone recomputes from stored instants.
        </p>
        <details className="mt-2 rounded-lg bg-[var(--surface-soft)] p-3 text-xs text-[var(--text)]">
          <summary className="cursor-pointer font-semibold text-[var(--text)]">What exactly am I looking at?</summary>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li><b>Numerator — unique content:</b> video-timeline seconds covered at least once (interval union). Rewatching the same 5 minutes never adds new content; seeking over unseen minutes never credits them.</li>
            <li><b>Denominator — timer-active study:</b> active seconds from focus sessions (pauses/breaks excluded) plus genuine note-taking, coding, and practice time inside active study. Your real measurements are never clamped — 110%+ is possible and stays exact.</li>
            <li><b>Playback utilization:</b> active playback wall time ÷ timer-active study × 100. Active playback excludes pauses and buffering. Above 100% means playback was observed without an equal amount of tracked focus; the value is shown rather than clamped, so the mismatch stays visible.</li>
            <li><b>Worked examples:</b> 3 h study → 1 h unique content = 33.33% (deep study, not bad learning) · 90 min → 60 min = 66.67% · 90 min → 99 min = 110% (faster-than-realtime coverage) · 10 min focused + 12 min active playback = 120% utilization.</li>
            <li><b>Evidence filter:</b> verified = Player-observed playback plus timer-observed focus; self-reported = hand-logged timeline entries plus estimated focus corrections. The filter applies to both sides of the ratio. Throughput describes coverage speed — not intelligence, mastery, or comprehension.</li>
            <li><b>Arena v2 uses a different question on purpose:</b> it scores <i>75% playlist progress + 25% qualifying-day consistency</i>. This page shows the <i>aggregate content/focus ratio</i>. They use the same records but answer different questions; neither number replaces the other.</li>
          </ul>
        </details>
        {model.unique > 0 && model.focus === 0 && (
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
            {formatHuman(model.unique)} of unique content exists without a timer denominator. Content coverage is not invalid;
            throughput simply cannot be calculated until timer-active study is recorded.
          </p>
        )}
      </Card>

      <div className="lq-workflow-columns" data-layout="companion">
      <Card>
        <h3 className="lq-section-title">Daily throughput (14 days, {tz})</h3>
        <p className="text-[11px] text-[var(--text-faint)]">Learning throughput in percent per day; gaps mean no measurable ratio that day (never zero-filled)</p>
        <EvidenceChart title="Daily throughput" unit="Percent" heightClass="h-52"
          data={model.days.map((day) => ({ label: day.day, value: day.eff }))} />
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Last 7 days vs previous 7 days, unique content: {formatHuman(model.trend.recent)} vs {formatHuman(model.trend.previous)}
          ({model.trend.meaningful
            ? '3+ active days in each window — comparable'
            : `only ${model.trend.sampleRecent}/${model.trend.samplePrevious} active days with content — not enough to claim a meaningful change`}).
          {model.contentOnlyDays > 0 && ` ${model.contentOnlyDays} day${model.contentOnlyDays === 1 ? '' : 's'} have content but no timer focus, so those days have no throughput ratio.`}
        </p>
      </Card>

      <Card className="lq-workflow-band">
        <h3 className="lq-section-title">By playlist</h3>
        {model.perPl.map((p) => (
          <p key={p.id} className="mt-1 text-xs text-[var(--text)]">
            {p.title} · <span className="font-mono">{p.eff !== null ? `${p.eff.toFixed(1)}%` : 'n/a (no focused study in this evidence scope)'}</span>
          </p>
        ))}
      </Card>
      </div>
    </div>
  );
}

function EffStat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="rounded-lg bg-[var(--surface-soft)] p-2" title={title}>
      <p className="truncate font-mono text-sm font-bold">{value}</p>
      <p className="text-[11px] text-[var(--text-muted)]">{label}</p>
    </div>
  );
}
