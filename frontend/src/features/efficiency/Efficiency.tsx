import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
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
      days.push({ day: dk.slice(5), eff: de !== null ? +de.toFixed(1) : null, uniqueMin: Math.round(du / 60), focusMin: Math.round(df / 60) });
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
      hasRecordedSegments: segs.length > 0,
      hasScopedFocusSessions: scopedSessions.length > 0,
      estimatedFocusInScope: scopedSessions.filter((x) => x.estimated).reduce((a, x) => a + x.activeSec, 0),
    };
  }, [s.segments, s.sessions, s.playlists, scope, src, tz, todayTick]);

  if (!snap && scope !== 'all') return <Empty title="No active playlist" hint="Efficiency needs recorded playback and focus sessions." />;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-base font-bold">Learning efficiency</h2>
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
            label="Content efficiency"
            value={model.eff !== null ? `${model.eff.toFixed(1)}%` : 'n/a'}
            title={model.eff === null
              ? model.focus === 0
                ? 'Undefined: focused study is zero in this selection.'
                : 'Undefined: the inputs are invalid or negative.'
              : 'Unique content ÷ focused study × 100'}
          />
          <EffStat
            label="Playback utilization"
            value={model.util !== null ? `${model.util.toFixed(1)}%` : 'n/a'}
            title={model.util === null ? 'Undefined: focused study is zero in this selection.' : 'Active playback (pauses/buffers excluded) ÷ focused study × 100; above 100% means playback exceeded tracked focus.'}
          />
          <EffStat label="Unique content / focused study" value={`${formatHuman(model.unique)} / ${formatHuman(model.focus)}`} title="Aggregate eligible seconds in the current scope and evidence selection" />
          <EffStat
            label="Overall aggregate ratio"
            value={model.overall !== null ? `${model.overall.toFixed(1)}%` : 'n/a'}
            title="Aggregate unique content ÷ aggregate focused study — never the mean of daily percentages"
          />
        </div>
        <p className="mt-2 text-xs text-slate-400">
          <b>Content efficiency</b> = unique content ÷ focused study × 100. <b>Playback utilization</b> = active playback
          (playing time only; pauses and buffering excluded) ÷ focused study × 100. <b>Overall</b> uses the aggregate ratio
          over this exact scope and evidence selection, never the average of daily percentages. Over 100% is normal above
          1× speed; lower is not worse — notes, coding and practice take real time. <b>n/a means undefined</b> (usually a
          zero denominator), not a fabricated zero.
        </p>
        {model.focus === 0 && (
          <div className="mt-2 rounded-xl border border-amber-500/25 bg-amber-500/10 p-2 text-xs text-amber-100" role="status">
            {model.unique > 0 ? (
              <>
                {formatHuman(model.unique)} of unique content is recorded, but there is no matching focused study in this
                selection, so efficiency has no denominator and is shown as <b>n/a</b>. The content measurement itself is
                still valid; record a Focus session (or change the Evidence filter) to calculate a ratio.
              </>
            ) : (
              <>No focused study and no unique content are recorded for this selection, so efficiency is unavailable. This is an empty result, not a 0% performance score.</>
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
          <div className="mt-2 rounded-xl border border-white/10 bg-white/5 p-2 text-xs text-slate-300" role="status">
            Focused time exists but no eligible unique content is recorded in this selection. Content efficiency is a real
            <b> 0%</b>: there is a denominator, but no coverage numerator. Playback utilization may still be meaningful if
            active playback exists.
          </div>
        )}
        <p className="mt-2 text-[11px] text-slate-500">
          Evidence: <b>Verified playback</b> uses Player-observed segments and timer-observed focus; <b>Self-reported</b>
          uses manual timeline entries and estimated focus corrections. The selector applies to both the numerator and the
          denominator, so a verified figure never silently mixes in hand-entered time.
          Daily playback and focus derive from UTC timestamps split at {tz} day boundaries; cross-midnight time counts on
          both days and changing the timezone recomputes from stored instants.
        </p>
        <details className="mt-2 rounded-xl bg-white/5 p-3 text-xs text-slate-300">
          <summary className="cursor-pointer font-semibold text-slate-200">What exactly am I looking at?</summary>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li><b>Numerator — unique content:</b> video-timeline seconds covered at least once (interval union). Rewatching the same 5 minutes never adds new content; seeking over unseen minutes never credits them.</li>
            <li><b>Denominator — focused study:</b> active seconds from focus sessions (pauses/breaks excluded) plus genuine note-taking, coding, and practice time inside active study. Your real measurements are never clamped — 110%+ is possible and stays exact.</li>
            <li><b>Playback utilization:</b> active playback wall time ÷ focused study × 100. Active playback excludes pauses and buffering. Above 100% means playback was observed without an equal amount of tracked focus; the value is shown rather than clamped, so the mismatch stays visible.</li>
            <li><b>Worked examples:</b> 3 h study → 1 h unique content = 33.33% (deep study, not bad learning) · 90 min → 60 min = 66.67% · 90 min → 99 min = 110% (faster-than-realtime coverage) · 10 min focused + 12 min active playback = 120% utilization.</li>
            <li><b>Evidence filter:</b> verified = Player-observed playback plus timer-observed focus; self-reported = hand-logged timeline entries plus estimated focus corrections. The filter applies to both sides of the ratio. Throughput describes coverage speed — not intelligence, mastery, or comprehension.</li>
            <li><b>Arena uses a different aggregation on purpose:</b> the Arena ranks the <i>mean of eligible daily percentages</i> (equal weight per day), while this page shows the <i>aggregate ratio</i>. Same records, different question — so the two numbers will differ, and both are correct.</li>
          </ul>
        </details>
        {model.unique > 0 && model.focus === 0 && (
          <p className="mt-1 text-xs text-amber-300">
            {formatHuman(model.unique)} of unique content exists without a Focus denominator. Content coverage is not invalid;
            efficiency simply cannot be calculated until focused study is recorded.
          </p>
        )}
      </Card>

      <Card>
        <h3 className="text-sm font-bold">Daily efficiency (14 days, {tz})</h3>
        <p className="text-[11px] text-slate-500">Content efficiency in percent per day; gaps mean no measurable efficiency that day (never zero-filled)</p>
        <div className="h-52 min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={model.days} margin={{ top: 8, right: 12, bottom: 20, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff14" />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#94a3b8' }} interval={1} label={{ value: 'day (MM-DD)', position: 'insideBottom', offset: -14, fontSize: 11, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} width={48} label={{ value: '%', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#64748b' }} />
              <Tooltip contentStyle={{ backgroundColor: '#141830', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 12, fontSize: 12, color: '#e8ecf6' }} formatter={(v: any) => [v === null ? 'n/a' : `${v}%`, 'efficiency']} />
              <Line type="monotone" dataKey="eff" stroke="#22d3ee" strokeWidth={2} dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Last 7 days vs previous 7 days, unique content: {formatHuman(model.trend.recent)} vs {formatHuman(model.trend.previous)}
          ({model.trend.meaningful
            ? '3+ active days in each window — comparable'
            : `only ${model.trend.sampleRecent}/${model.trend.samplePrevious} active days with content — not enough to claim a meaningful change`}).
        </p>
      </Card>

      <Card>
        <h3 className="text-sm font-bold">By playlist</h3>
        {model.perPl.map((p) => (
          <p key={p.id} className="mt-1 text-xs text-slate-300">
            {p.title} · <span className="font-mono">{p.eff !== null ? `${p.eff.toFixed(1)}%` : 'n/a (no focused study in this evidence scope)'}</span>
          </p>
        ))}
      </Card>
    </div>
  );
}

function EffStat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="rounded-xl bg-white/5 p-2" title={title}>
      <p className="truncate font-mono text-sm font-bold">{value}</p>
      <p className="text-[11px] text-slate-400">{label}</p>
    </div>
  );
}
