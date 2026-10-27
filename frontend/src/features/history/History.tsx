import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  dateKeyInTimezone, splitIntervalByDay, formatHuman, summarizeSegments,
  addDaysToDateKey, focusSessionDaySlices, splitPlaybackSegmentByDay, segmentIdentityKey,
  isProgressComplete, supportedZone, zonedNoonMs,
} from '../../domain/index.js';
import type { PlaybackSegment } from '../../domain/index.js';
import { useStore } from '../../app/store.js';
import { useDayTick } from '../../app/dayTick.js';
import { Dropdown } from '../../components/ui/Dropdown.js';
import { NumberField } from '../../components/ui/NumberField.js';
import { Card, Btn, Field, inputCls } from '../../components/ui/ui.js';

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'all' | 'custom';

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}

function uniqueSeconds(segments: PlaybackSegment[]): number {
  const byKey = new Map<string, PlaybackSegment[]>();
  for (const segment of segments) {
    const key = segmentIdentityKey(segment);
    const arr = byKey.get(key) ?? [];
    arr.push(segment);
    byKey.set(key, arr);
  }
  let total = 0;
  for (const arr of byKey.values()) total += summarizeSegments(arr).uniqueSec;
  return Math.round(total);
}

export function HistoryView() {
  const s = useStore();
  const tz = supportedZone(s.prefs.timezone);
  const today = useDayTick(s.prefs.timezone);
  const [preset, setPreset] = useState<Preset>('week');
  const [customA, setCustomA] = useState(today);
  const [customB, setCustomB] = useState(today);
  const [playlist, setPlaylist] = useState<string>('all');
  const [videoPos, setVideoPos] = useState<number | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const range = useMemo(() => {
    if (preset === 'today') return { from: today, to: today };
    if (preset === 'yesterday') {
      const y = addDaysToDateKey(today, -1);
      return { from: y, to: y };
    }
    if (preset === 'week') return { from: addDaysToDateKey(today, -6), to: today };
    if (preset === 'month') return { from: today.slice(0, 7) + '-01', to: today };
    if (preset === 'custom') {
      const validA = /^\d{4}-\d{2}-\d{2}$/.test(customA);
      const validB = /^\d{4}-\d{2}-\d{2}$/.test(customB);
      if (!validA || !validB) return { from: '9999-99-99', to: '0000-00-00' };
      return { from: customA <= customB ? customA : customB, to: customA <= customB ? customB : customA };
    }
    return { from: '0000-00-00', to: '9999-99-99' };
  }, [preset, today, customA, customB]);

  const inRange = useCallback((k: string) => k >= range.from && k <= range.to, [range]);
  const inPlaylist = useCallback((pid: string | null) => playlist === 'all' || pid === playlist, [playlist]);
  const rangeLabel = preset === 'all' ? 'all time' : preset === 'custom' ? `${range.from} → ${range.to}` : preset;

  // Focus rows split by real active intervals (or proportionally for legacy).
  const focusRows = useMemo(() => {
    const rows: { id: string; dateKey: string; sec: number; kind: 'focus'; ref: any }[] = [];
    for (const x of s.sessions) {
      if (!inPlaylist(x.playlistId)) continue;
      for (const slice of focusSessionDaySlices(x, tz)) {
        if (!inRange(slice.dateKey)) continue;
        rows.push({ id: `${x.id}:${slice.dateKey}`, dateKey: slice.dateKey, sec: slice.sec, kind: 'focus', ref: x });
      }
    }
    return rows;
  }, [s.sessions, inPlaylist, inRange, tz]);

  const playRows = useMemo(() => {
    const rows: { id: string; dateKey: string; sec: number; kind: 'play'; ref: any }[] = [];
    for (const x of s.playSessions) {
      if (!inPlaylist(x.playlistId)) continue;
      const start = new Date(x.startedAt).getTime();
      const end = x.finishedAt ? new Date(x.finishedAt).getTime() : start + x.activePlaybackSec * 1000;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      const wall = Math.max(1, Math.round((end - start) / 1000));
      for (const sl of splitIntervalByDay(start, end, tz)) {
        if (!inRange(sl.dateKey)) continue;
        rows.push({ id: `${x.id}:${sl.dateKey}`, dateKey: sl.dateKey, sec: Math.round((x.activePlaybackSec * sl.seconds) / wall), kind: 'play', ref: x });
      }
    }
    return rows;
  }, [s.playSessions, inPlaylist, inRange, tz]);

  const focusTotal = focusRows.reduce((a, r) => a + r.sec, 0);

  // Split every segment at local midnight, then retain only selected-range
  // days. The union is computed across the whole selection so a video watched
  // on two selected days still counts as unique coverage once.
  const rangeSegments = useMemo(() => {
    const out: PlaybackSegment[] = [];
    for (const sg of s.segments) {
      if (playlist !== 'all' && sg.playlistId !== playlist) continue;
      for (const slice of splitPlaybackSegmentByDay(sg, tz)) {
        if (inRange(slice.dateKey)) out.push(slice.segment);
      }
    }
    return out;
  }, [s.segments, playlist, inRange, tz]);

  const uniqTotal = useMemo(() => uniqueSeconds(rangeSegments), [rangeSegments]);
  const verifiedSegments = useMemo(
    () => rangeSegments.filter((x) => x.source === 'verified'),
    [rangeSegments],
  );
  const manualSegments = useMemo(
    () => rangeSegments.filter((x) => x.source === 'manual'),
    [rangeSegments],
  );
  const uniqVerified = useMemo(() => uniqueSeconds(verifiedSegments), [verifiedSegments]);
  const uniqManual = useMemo(() => uniqueSeconds(manualSegments), [manualSegments]);
  const vidsVerified = new Set(verifiedSegments.map((x) => segmentIdentityKey(x))).size;
  const vidsManual = new Set(manualSegments.map((x) => segmentIdentityKey(x))).size;
  const playVerifiedTotal = playRows
    .filter((r) => r.ref.source === 'verified')
    .reduce((a, r) => a + r.sec, 0);
  const playManualTotal = playRows
    .filter((r) => r.ref.source !== 'verified')
    .reduce((a, r) => a + r.sec, 0);
  const focusEstimatedTotal = focusRows
    .filter((r) => r.ref.estimated === true)
    .reduce((a, r) => a + r.sec, 0);
  const focusObservedTotal = focusTotal - focusEstimatedTotal;
  const completedInRange = Object.values(s.progress).filter((p) => {
    if (!inPlaylist(p.playlistId) || !isProgressComplete(p) || !p.completedAt) return false;
    return inRange(dateKeyInTimezone(new Date(p.completedAt), tz));
  });
  const verified = completedInRange.filter((p) => p.source === 'verified').length;
  const manual = completedInRange.filter((p) => p.source !== 'verified').length;
  const nothingRecordedInRange = focusRows.length === 0 && playRows.length === 0 && rangeSegments.length === 0;

  const allRows = useMemo(() => {
    // Session rows show only the seconds attributed to the selected range, not
    // the whole cross-midnight session, so every visible number obeys the range.
    const focusSecById = new Map<string, number>();
    for (const r of focusRows) focusSecById.set(r.ref.id, (focusSecById.get(r.ref.id) ?? 0) + r.sec);
    const playSecById = new Map<string, number>();
    for (const r of playRows) playSecById.set(r.ref.id, (playSecById.get(r.ref.id) ?? 0) + r.sec);
    const rows: { id: string; at: string; label: string; detail: string; kind: 'focus' | 'play'; ref: any }[] = [
      ...s.sessions.filter((x) => inPlaylist(x.playlistId) && (focusSecById.get(x.id) ?? 0) > 0).map((x) => ({
        id: x.id, at: x.startedAt, kind: 'focus' as const,
        label: `Focus · ${formatHuman(focusSecById.get(x.id) ?? 0)} in range${x.estimated ? ' · estimated correction' : ' · timer-observed'}`,
        detail: x.note ?? '', ref: x,
      })),
      ...s.playSessions.filter((x) => inPlaylist(x.playlistId) && (playSecById.get(x.id) ?? 0) > 0).map((x) => ({
        id: x.id, at: x.startedAt, kind: 'play' as const,
        label: `${x.source === 'verified' ? 'Verified' : 'Self-reported'} playback · #${x.position} · active ${formatHuman(playSecById.get(x.id) ?? 0)} in range · +${formatHuman(x.uniqueGainSec)} unique`,
        detail: x.note ?? '', ref: x,
      })),
    ].sort((a, b) => b.at.localeCompare(a.at));
    return rows;
  }, [s.sessions, s.playSessions, inPlaylist, focusRows, playRows]);

  const selectedSnap = playlist !== 'all' ? s.playlists[playlist] : undefined;
  const selectedEntry = selectedSnap && videoPos !== null
    ? selectedSnap.entries.find((e) => e.position === videoPos)
    : undefined;
  const videoSegs = selectedEntry
    ? rangeSegments.filter((x) => x.playlistId === selectedSnap?.playlistId
      && (x.entryId ? x.entryId === selectedEntry.entryId : x.position === selectedEntry.position && x.videoId === selectedEntry.videoId))
    : [];
  const videoCov = videoSegs.length ? summarizeSegments(videoSegs) : null;

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-base font-bold">Study history <span className="font-normal text-slate-400">({tz})</span></h2>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {(['today', 'yesterday', 'week', 'month', 'all', 'custom'] as Preset[]).map((p) => (
            <button key={p} onClick={() => setPreset(p)} className={`rounded-full px-3 py-1 text-xs ${preset === p ? 'bg-violet-600 text-white' : 'bg-white/5 text-slate-300'}`}>{p}</button>
          ))}
          {preset === 'custom' && (
            <>
              <input type="date" className={inputCls} value={customA} onChange={(e) => setCustomA(e.target.value)} aria-label="From date" />
              <input type="date" className={inputCls} value={customB} onChange={(e) => setCustomB(e.target.value)} aria-label="To date" />
            </>
          )}
          <div className="w-48">
            <Dropdown
              label="Playlist"
              value={playlist}
              options={[
                { value: 'all', label: 'All playlists' },
                ...Object.keys(s.playlists).map((id) => ({ value: id, label: s.playlists[id].title.slice(0, 30) })),
              ]}
              onChange={setPlaylist}
            />
          </div>
        </div>
        {preset === 'custom' && range.from > range.to && (
          <p className="mt-1 text-xs text-red-300" role="alert">Choose a valid custom date range.</p>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-3 lg:grid-cols-6">
          <MiniStat
            label="Focused (timer-observed)"
            value={formatHuman(focusObservedTotal)}
            hint={focusEstimatedTotal > 0 ? `+ ${formatHuman(focusEstimatedTotal)} estimated correction` : undefined}
          />
          <MiniStat label="Verified playback active" value={formatHuman(playVerifiedTotal)} />
          <MiniStat label="Self-reported playback active" value={formatHuman(playManualTotal)} />
          <MiniStat
            label="Unique content · verified / self-reported"
            value={`${formatHuman(uniqVerified)} / ${formatHuman(uniqManual)}`}
            hint={`Combined union ${formatHuman(uniqTotal)}`}
          />
          <MiniStat
            label="Videos with playback · verified / self-reported"
            value={`${vidsVerified} / ${vidsManual}`}
          />
          <MiniStat
            label="Completed videos · verified / manual"
            value={`${verified} / ${manual}`}
            hint="completion date in range"
          />
        </div>
        <p className="mt-1 text-[11px] text-slate-500">
          Every statistic, the session list, and per-video detail use the selected range: <b>{rangeLabel}</b>.
          {preset === 'all' ? ' All-time totals are labelled explicitly.' : ' Use All for all-time totals.'} Cross-midnight intervals are split at {tz} date boundaries.
          Zero values mean no matching record in this range; they are not placeholders. “Verified” means observed Player telemetry, while “self-reported” and “estimated” stay separate.
        </p>
        {nothingRecordedInRange && (
          <p className="mt-2 rounded-xl border border-white/10 bg-white/5 p-2 text-xs text-slate-300" role="status">
            No focus, playback, or coverage records were found in {rangeLabel}. That is a true empty result for this
            range, not missing data. Choose a wider range or All for all-time totals; if you studied before tracking
            existed, add a self-reported entry below.
          </p>
        )}
      </Card>

      <Card>
        <h3 className="text-sm font-bold">Sessions in {rangeLabel} ({allRows.length}) — click for detail</h3>
        {allRows.length === 0 ? (
          <p className="text-xs text-slate-500">
            No sessions have been recorded in {rangeLabel}. Zero is the real total for this period. History before
            tracking existed is never fabricated — add a self-reported entry below if needed.
          </p>
        ) : (
          <>
            {allRows.length > 100 && (
              <p className="text-[11px] text-slate-500">Showing the newest 100 of {allRows.length} sessions. Narrow the range or choose a playlist to see older ones.</p>
            )}
            <ul className="mt-1 max-h-72 space-y-1 overflow-auto text-sm">
              {allRows.slice(0, 100).map((r) => (
                <li key={r.id} className="rounded-xl bg-white/5 p-2">
                  <button className="w-full text-left" onClick={() => setOpenId(openId === r.id ? null : r.id)} aria-expanded={openId === r.id}>
                    <span className="text-xs text-slate-400">{new Date(r.at).toLocaleString('en-US', { timeZone: tz })}</span>
                    <span className="ml-2">{r.label}</span>
                  </button>
                  {openId === r.id && <SessionDetail row={r} tz={tz} />}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h3 className="text-sm font-bold">Per-video history ({rangeLabel})</h3>
          <div className="mt-1 flex gap-2">
            <NumberField
              label="Video position"
              value={videoPos}
              onCommit={setVideoPos}
              min={1}
              max={selectedSnap?.entries.length ?? 1000000}
              allowEmpty
              placeholder={playlist === 'all' ? 'Select a playlist first' : 'e.g. 12'}
              ariaLabel="Video position"
              className="flex-1"
            />
          </div>
          {playlist === 'all' && videoPos !== null && <p className="mt-1 text-xs text-amber-300">Select a specific playlist to inspect one video.</p>}
          {selectedEntry && !videoCov && <p className="mt-1 text-xs text-slate-500">No verified or self-reported playback segments for #{selectedEntry.position} in {rangeLabel}.</p>}
          {videoCov && (
            <div className="mt-2 text-xs text-slate-300">
              <p>
                Combined unique {formatHuman(Math.round(videoCov.uniqueSec))} ·
                {' '}verified {formatHuman(uniqueSeconds(videoSegs.filter((x) => x.source === 'verified')))} ·
                {' '}self-reported {formatHuman(uniqueSeconds(videoSegs.filter((x) => x.source === 'manual')))} ·
                {' '}playback content {formatHuman(Math.round(videoCov.totalContentSec))} ·
                {' '}rewatched {formatHuman(Math.round(videoCov.rewatchedSec))} · {videoSegs.length} segments.
              </p>
              <ul className="mt-1 max-h-40 space-y-1 overflow-auto font-mono text-[11px]">
                {videoSegs.map((x) => (
                  <li key={x.id}>
                    {new Date(x.wallStartMs).toLocaleString('en-US', { timeZone: tz })} · tl {Math.round(x.timelineStartSec)}–{Math.round(x.timelineEndSec)}s · {x.playbackRate}x · {x.source === 'verified' ? 'verified' : 'self-reported'}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
        <ManualEntry onSaved={(dateKey) => {
          if (!inRange(dateKey)) {
            setCustomA(dateKey);
            setCustomB(dateKey);
            setPreset('custom');
            return `Saved for ${dateKey}, which is outside ${rangeLabel}; the view switched to that date so the entry is visible.`;
          }
          return `Saved in the selected range (${dateKey}).`;
        }} />
      </div>
    </div>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-white/5 p-2">
      <p className="truncate text-sm font-bold" title={value}>{value}</p>
      <p className="text-[11px] text-slate-400">{label}</p>
      {hint && <p className="mt-0.5 text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
}

/** Human-readable session detail (no raw JSON in the primary UI). */
function SessionDetail({ row, tz }: { row: { kind: 'focus' | 'play'; ref: any }; tz: string }) {
  const ref = row.ref;
  const start = ref.startedAt ? new Date(ref.startedAt) : null;
  const finish = ref.finishedAt ? new Date(ref.finishedAt) : null;
  return (
    <dl className="mt-1 grid gap-x-4 gap-y-0.5 rounded-lg bg-black/30 p-2 text-[11px] text-slate-300 sm:grid-cols-2">
      <div className="flex gap-1"><dt className="text-slate-500">Start</dt><dd>{start && Number.isFinite(start.getTime()) ? start.toLocaleString('en-US', { timeZone: tz }) : 'unknown'}</dd></div>
      <div className="flex gap-1"><dt className="text-slate-500">Finish</dt><dd>{finish && Number.isFinite(finish.getTime()) ? finish.toLocaleString('en-US', { timeZone: tz }) : 'not recorded'}</dd></div>
      {row.kind === 'focus' ? (
        <>
          <div className="flex gap-1"><dt className="text-slate-500">Focused</dt><dd>{formatHuman(ref.activeSec ?? 0)}</dd></div>
          <div className="flex gap-1"><dt className="text-slate-500">Wall clock</dt><dd>{formatHuman(ref.elapsedSec ?? ref.activeSec ?? 0)}</dd></div>
          <div className="flex gap-1"><dt className="text-slate-500">Paused</dt><dd>{formatHuman(ref.pausedSec ?? 0)}</dd></div>
          <div className="flex gap-1"><dt className="text-slate-500">Evidence</dt><dd>{ref.estimated ? 'estimated (manual correction)' : 'observed timer'}</dd></div>
        </>
      ) : (
        <>
          <div className="flex gap-1"><dt className="text-slate-500">Video</dt><dd>#{ref.position} · {ref.videoId}</dd></div>
          <div className="flex gap-1"><dt className="text-slate-500">Active playback</dt><dd>{formatHuman(ref.activePlaybackSec ?? 0)}</dd></div>
          <div className="flex gap-1"><dt className="text-slate-500">Unique gain</dt><dd>{formatHuman(ref.uniqueGainSec ?? 0)}</dd></div>
          <div className="flex gap-1"><dt className="text-slate-500">Evidence</dt><dd>{ref.source === 'verified' ? 'verified Player telemetry' : 'self-reported'}</dd></div>
        </>
      )}
      {ref.note && <div className="flex gap-1 sm:col-span-2"><dt className="text-slate-500">Note</dt><dd>{ref.note}</dd></div>}
    </dl>
  );
}

function ManualEntry({ onSaved }: { onSaved?: (dateKey: string) => string }) {
  const s = useStore();
  const tz = supportedZone(s.prefs.timezone);
  const ids = Object.keys(s.playlists);
  const idsKey = ids.join('|');
  const [pid, setPid] = useState(ids[0] ?? '');
  const [pos, setPos] = useState<number | null>(1);
  const [date, setDate] = useState(dateKeyInTimezone(new Date(), tz));
  const [mins, setMins] = useState<number | null>(20);
  const [tl, setTl] = useState('0-600');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const snap = pid ? s.playlists[pid] : undefined;

  // The store hydrates asynchronously. Without this the form can stay on the
  // "no playlist" default even though playlists are available.
  useEffect(() => {
    if (ids.length === 0) {
      if (pid) setPid('');
      return;
    }
    if (!pid || !s.playlists[pid]) setPid(ids[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, pid]);

  const save = () => {
    if (!snap) {
      setMsg('Pick a playlist first.');
      return;
    }
    if (pos === null || !Number.isInteger(pos) || pos < 1 || pos > snap.entries.length) {
      setMsg(`Position must be 1–${snap.entries.length}.`);
      return;
    }
    if (mins === null || !Number.isFinite(mins) || mins <= 0 || mins > 960) {
      setMsg('Minutes must be 1–960.');
      return;
    }
    if (!isCalendarDate(date)) {
      setMsg('Choose a valid calendar date.');
      return;
    }
    const tlm = /^(\d+)\s*-\s*(\d+)$/.exec(tl.trim());
    if (!tlm || Number(tlm[2]) <= Number(tlm[1])) {
      setMsg('Timeline must look like 0-600 (start < end, seconds).');
      return;
    }
    const entry = snap.entries.find((e) => e.position === pos);
    if (!entry) {
      setMsg('That position is not in this playlist.');
      return;
    }
    const tlStart = Number(tlm[1]);
    const tlEnd = Number(tlm[2]);
    if (entry.durationSec !== null && tlEnd > entry.durationSec) {
      setMsg(`Timeline end exceeds the video duration (${entry.durationSec}s).`);
      return;
    }
    const start = zonedNoonMs(date, tz);
    if (!Number.isFinite(start)) {
      setMsg('Choose a valid date.');
      return;
    }
    const sid = `manual-${Date.now().toString(36)}`;
    s.addSegments([{
      id: sid + '-seg', playlistId: pid, position: pos, entryId: entry.entryId, videoId: entry.videoId,
      sessionId: sid, wallStartMs: start, wallEndMs: start + Math.round(mins * 60000),
      timelineStartSec: tlStart, timelineEndSec: tlEnd,
      playbackRate: 1, source: 'manual',
    }]);
    s.addManualPlaySession({
      playlistId: pid, position: pos, entryId: entry.entryId, videoId: entry.videoId,
      startedAt: new Date(start).toISOString(), finishedAt: new Date(start + Math.round(mins * 60000)).toISOString(),
      activePlaybackSec: Math.round(mins * 60), contentSec: tlEnd - tlStart,
      uniqueGainSec: 0, pauseSec: 0, note: note || undefined,
    });
    setMsg(`Recorded as self-reported (never shown as verified playback). ${onSaved?.(date) ?? ''}`.trim());
    setNote('');
  };

  return (
    <Card>
      <h3 className="text-sm font-bold">Self-reported entry <span className="font-normal text-slate-400">(pre-tracking history)</span></h3>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Dropdown
          label="Playlist"
          value={pid}
          options={ids.map((id) => ({ value: id, label: s.playlists[id].title.slice(0, 30) }))}
          onChange={setPid}
        />
        <NumberField label="Position" value={pos} onCommit={setPos} min={1} max={snap?.entries.length ?? 1000000} />
        <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
        <NumberField label="Active minutes" value={mins} onCommit={setMins} min={1} max={960} />
        <Field label="Timeline covered (sec)"><input value={tl} onChange={(e) => setTl(e.target.value)} className={inputCls} placeholder="0-600" /></Field>
        <Field label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} /></Field>
      </div>
      <div className="mt-2"><Btn variant="primary" onClick={save}><Plus size={14} /> Save self-reported</Btn></div>
      {msg && <p className="mt-1 text-xs text-slate-300" role="status">{msg}</p>}
    </Card>
  );
}
