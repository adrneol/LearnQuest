import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { dateKeyInTimezone, splitIntervalByDay, formatSecondsHHMMSS, formatHuman, summarizeSegments, addDaysToDateKey } from '../../domain/index.js';
import type { PlaybackSegment } from '../../domain/index.js';
import { useStore } from '../../app/store.js';
import { useDayTick } from '../../app/dayTick.js';
import { Dropdown } from '../../components/ui/Dropdown.js';
import { Card, Btn, Field, inputCls, Empty } from '../../components/ui/ui.js';

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'all' | 'custom';

export function HistoryView() {
  const s = useStore();
  const tz = s.prefs.timezone === 'local' ? Intl.DateTimeFormat().resolvedOptions().timeZone : s.prefs.timezone;
  const today = useDayTick(s.prefs.timezone);
  const [preset, setPreset] = useState<Preset>('week');
  const [customA, setCustomA] = useState(today);
  const [customB, setCustomB] = useState(today);
  const [playlist, setPlaylist] = useState<string>('all');
  const [videoPos, setVideoPos] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const range = useMemo(() => {
    if (preset === 'today') return { from: today, to: today };
    if (preset === 'yesterday') {
      const y = addDaysToDateKey(today, -1);
      return { from: y, to: y };
    }
    if (preset === 'week') return { from: addDaysToDateKey(today, -6), to: today };
    if (preset === 'month') return { from: today.slice(0, 7) + '-01', to: today };
    if (preset === 'custom') return { from: customA <= customB ? customA : customB, to: customA <= customB ? customB : customA };
    return { from: '0000-00-00', to: '9999-99-99' };
  }, [preset, today, customA, customB]);

  const inRange = (k: string) => k >= range.from && k <= range.to;
  const inPlaylist = (pid: string | null) => playlist === 'all' || pid === playlist;

  // Focus sessions split across midnight in tz (each day gets its own elapsed time)
  const focusRows = useMemo(() => {
    const rows: { id: string; dateKey: string; sec: number; kind: 'focus'; ref: any }[] = [];
    for (const x of s.sessions) {
      if (!inPlaylist(x.playlistId)) continue;
      const start = new Date(x.startedAt).getTime();
      const end = x.finishedAt ? new Date(x.finishedAt).getTime() : start + x.activeSec * 1000;
      const wall = Math.max(1, Math.round((end - start) / 1000));
      const slices = splitIntervalByDay(start, end, s.prefs.timezone);
      for (const sl of slices) {
        if (!inRange(sl.dateKey)) continue;
        rows.push({ id: `${x.id}:${sl.dateKey}`, dateKey: sl.dateKey, sec: Math.round((x.activeSec * sl.seconds) / wall), kind: 'focus', ref: x });
      }
    }
    return rows;
  }, [s.sessions, playlist, range.from, range.to, s.prefs.timezone]);

  const playRows = useMemo(() => {
    const rows: { id: string; dateKey: string; sec: number; kind: 'play'; ref: any }[] = [];
    for (const x of s.playSessions) {
      if (!inPlaylist(x.playlistId)) continue;
      const start = new Date(x.startedAt).getTime();
      const end = x.finishedAt ? new Date(x.finishedAt).getTime() : start + x.activePlaybackSec * 1000;
      const wall = Math.max(1, Math.round((end - start) / 1000));
      for (const sl of splitIntervalByDay(start, end, s.prefs.timezone)) {
        if (!inRange(sl.dateKey)) continue;
        rows.push({ id: `${x.id}:${sl.dateKey}`, dateKey: sl.dateKey, sec: Math.round((x.activePlaybackSec * sl.seconds) / wall), kind: 'play', ref: x });
      }
    }
    return rows;
  }, [s.playSessions, playlist, range.from, range.to, s.prefs.timezone]);

  const focusTotal = focusRows.reduce((a, r) => a + r.sec, 0);
  const playTotal = playRows.reduce((a, r) => a + r.sec, 0);
  const uniqTotal = useMemo(() => {
    const byKey = new Map<string, PlaybackSegment[]>();
    for (const sg of s.segments) {
      if (playlist !== 'all' && sg.playlistId !== playlist) continue;
      const k = `${sg.playlistId}::${sg.position}`;
      const arr = byKey.get(k) ?? [];
      arr.push(sg);
      byKey.set(k, arr);
    }
    let t = 0;
    for (const arr of byKey.values()) t += summarizeSegments(arr).uniqueSec;
    return Math.round(t);
  }, [s.segments, playlist]);

  const vidsStarted = new Set(s.segments.filter((x) => playlist === 'all' || x.playlistId === playlist).map((x) => `${x.playlistId}::${x.position}`)).size;
  const verified = Object.values(s.progress).filter((p) => (playlist === 'all' || p.playlistId === playlist) && p.source === 'verified' && p.completedAt).length;
  const manual = Object.values(s.progress).filter((p) => (playlist === 'all' || p.playlistId === playlist) && p.source !== 'verified' && p.completedAt).length;

  const allRows = useMemo(() => {
    const rows: { id: string; at: string; label: string; detail: string; ref: any }[] = [
      ...s.sessions.filter((x) => inPlaylist(x.playlistId)).map((x) => ({
        id: x.id, at: x.startedAt, label: `Focus · ${formatHuman(x.activeSec)}`, detail: x.note ?? '', ref: x,
      })),
      ...s.playSessions.filter((x) => inPlaylist(x.playlistId)).map((x) => ({
        id: x.id, at: x.startedAt,
        label: `${x.source === 'verified' ? 'Verified' : 'Self-reported'} playback · #${x.position} · active ${formatHuman(x.activePlaybackSec)} · +${formatHuman(x.uniqueGainSec)} unique`,
        detail: x.note ?? '', ref: x,
      })),
    ].sort((a, b) => b.at.localeCompare(a.at));
    return rows;
  }, [s.sessions, s.playSessions, playlist]);

  const posNum = Number(videoPos);
  const videoSegs = Number.isInteger(posNum) && posNum > 0 && playlist !== 'all'
    ? s.segments.filter((x) => x.playlistId === playlist && x.position === posNum)
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
        <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
          <MiniStat label="Focused" value={formatHuman(focusTotal)} />
          <MiniStat label="Playback active" value={formatHuman(playTotal)} />
          <MiniStat label="Unique covered" value={formatSecondsHHMMSS(uniqTotal)} />
          <MiniStat label="Verified / manual" value={`${verified} / ${manual}`} />
          <MiniStat label="Videos w/ playback" value={String(vidsStarted)} />
        </div>
        <p className="mt-1 text-[11px] text-slate-500">Cross-midnight intervals are split at {tz} date boundaries. Completed-video counts and watched-video counts are reported separately.</p>
      </Card>

      <Card>
        <h3 className="text-sm font-bold">Sessions ({allRows.length}) — click for detail</h3>
        {allRows.length === 0 && <p className="text-xs text-slate-500">No sessions in this range. History before tracking existed is never fabricated — add a self-reported entry below if needed.</p>}
        <ul className="mt-1 max-h-72 space-y-1 overflow-auto text-sm">
          {allRows.slice(0, 100).map((r) => (
            <li key={r.id} className="rounded-xl bg-white/5 p-2">
              <button className="w-full text-left" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                <span className="text-xs text-slate-400">{new Date(r.at).toLocaleString()}</span>
                <span className="ml-2">{r.label}</span>
              </button>
              {openId === r.id && (
                <pre className="mt-1 overflow-auto rounded-lg bg-black/40 p-2 font-mono text-[11px] text-slate-300">{JSON.stringify(r.ref, null, 2)}</pre>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h3 className="text-sm font-bold">Per-video history</h3>
          <div className="mt-1 flex gap-2">
            <input value={videoPos} onChange={(e) => setVideoPos(e.target.value)} placeholder={playlist === 'all' ? 'Select a playlist first' : 'Position, e.g. 12'} className={inputCls} inputMode="numeric" aria-label="Video position" />
          </div>
          {videoCov && (
            <div className="mt-2 text-xs text-slate-300">
              <p>Unique {formatHuman(Math.round(videoCov.uniqueSec))} · playback content {formatHuman(Math.round(videoCov.totalContentSec))} · rewatched {formatHuman(Math.round(videoCov.rewatchedSec))} · {videoSegs.length} segments.</p>
              <ul className="mt-1 max-h-40 space-y-1 overflow-auto font-mono text-[11px]">
                {videoSegs.map((x) => <li key={x.id}>{new Date(x.wallStartMs).toLocaleString()} · tl {Math.round(x.timelineStartSec)}–{Math.round(x.timelineEndSec)}s · {x.playbackRate}x · {x.source}</li>)}
              </ul>
            </div>
          )}
        </Card>
        <ManualEntry />
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/5 p-2">
      <p className="truncate text-sm font-bold">{value}</p>
      <p className="text-[11px] text-slate-400">{label}</p>
    </div>
  );
}

function ManualEntry() {
  const s = useStore();
  const ids = Object.keys(s.playlists);
  const [pid, setPid] = useState(ids[0] ?? '');
  const [pos, setPos] = useState('1');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [mins, setMins] = useState('20');
  const [tl, setTl] = useState('0-600');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const snap = pid ? s.playlists[pid] : undefined;

  const save = () => {
    if (!snap) {
      setMsg('Pick a playlist first.');
      return;
    }
    const p = Number(pos);
    const m = Number(mins);
    const tlm = /^(\d+)\s*-\s*(\d+)$/.exec(tl.trim());
    if (!Number.isInteger(p) || p < 1 || p > snap.entries.length) {
      setMsg(`Position must be 1–${snap.entries.length}.`);
      return;
    }
    if (!Number.isFinite(m) || m <= 0 || m > 960) {
      setMsg('Minutes must be 1–960.');
      return;
    }
    if (!tlm || Number(tlm[2]) <= Number(tlm[1])) {
      setMsg('Timeline must look like 0-600 (start < end, seconds).');
      return;
    }
    const start = new Date(date + 'T12:00:00Z').getTime();
    const sid = `manual-${Date.now().toString(36)}`;
    const entry = snap.entries.find((e) => e.position === p);
    s.addSegments([{
      id: sid + '-seg', playlistId: pid, position: p, videoId: entry?.videoId ?? '',
      sessionId: sid, wallStartMs: start, wallEndMs: start + Math.round(m * 60000),
      timelineStartSec: Number(tlm[1]), timelineEndSec: Number(tlm[2]),
      playbackRate: 1, source: 'manual',
    }]);
    s.addManualPlaySession({
      playlistId: pid, position: p, videoId: entry?.videoId ?? '',
      startedAt: new Date(start).toISOString(), finishedAt: new Date(start + Math.round(m * 60000)).toISOString(),
      activePlaybackSec: Math.round(m * 60), contentSec: Number(tlm[2]) - Number(tlm[1]),
      uniqueGainSec: 0, pauseSec: 0, note: note || undefined,
    });
    setMsg('Saved as self-reported (never shown as verified playback).');
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
        <Field label="Position"><input value={pos} onChange={(e) => setPos(e.target.value)} className={inputCls} inputMode="numeric" /></Field>
        <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
        <Field label="Active minutes"><input value={mins} onChange={(e) => setMins(e.target.value)} className={inputCls} inputMode="numeric" /></Field>
        <Field label="Timeline covered (sec)"><input value={tl} onChange={(e) => setTl(e.target.value)} className={inputCls} placeholder="0-600" /></Field>
        <Field label="Note"><input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} /></Field>
      </div>
      <div className="mt-2"><Btn variant="primary" onClick={save}><Plus size={14} /> Save self-reported</Btn></div>
      {msg && <p className="mt-1 text-xs text-slate-300">{msg}</p>}
    </Card>
  );
}
