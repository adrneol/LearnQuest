import { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipForward, SkipBack, CheckCircle2, ExternalLink, ListPlus, TriangleAlert, BookmarkPlus } from 'lucide-react';
import { summarizeSegments, completionFromCoverage, formatSecondsHHMMSS } from '../../domain/index.js';
import type { PlaybackSegment } from '../../domain/index.js';
import { useStore } from '../../app/store.js';
import { notify } from '../../services/notifications/notify.js';
import { Card, Btn, Field, inputCls, ProgressBar, Empty } from '../../components/ui/ui.js';

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<void> | null = null;
function loadIframeApi(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window.'));
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    window.onYouTubeIframeAPIReady = () => resolve();
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.onerror = () => reject(new Error('Could not load the YouTube player library.'));
    document.head.appendChild(tag);
    setTimeout(() => reject(new Error('YouTube player library timed out.')), 15000);
  });
  return apiPromise;
}

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function Player() {
  const s = useStore();
  const snap = s.activeId ? s.playlists[s.activeId] : undefined;
  if (!snap) return <Empty title="No active playlist" hint="Add a playlist to play lessons with tracked coverage." />;
  return <PlayerInner key={snap.playlistId} />;
}

function PlayerInner() {
  const s = useStore();
  const snap = s.activeId ? s.playlists[s.activeId]! : undefined!;
  const N = snap.entries.length;
  const queue = s.queue[snap.playlistId] ?? [];
  const nextTodo = snap.entries.find((e) => {
    const r = s.progress[`${snap.playlistId}::${e.position}`];
    return !r?.completedAt;
  })?.position;
  const [pos, setPos] = useState(queue[0] ?? nextTodo ?? 1);
  const entry = snap.entries.find((e) => e.position === pos);
  const [state, setState] = useState<'idle' | 'ready' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error'>('idle');
  const [cur, setCur] = useState(0);
  const [rate, setRate] = useState(1);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [sessionNote] = useState('');
  void sessionNote;

  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const openSeg = useRef<{ wallStart: number; tlStart: number; rate: number } | null>(null);
  const lastT = useRef(0);
  const sessSegs = useRef<PlaybackSegment[]>([]);
  const sessWallStart = useRef<number>(Date.now());
  const prevUnique = useRef(0);
  const sessionId = useRef(uid());
  const allSegsRef = useRef<PlaybackSegment[]>(s.segments);
  allSegsRef.current = s.segments;

  const pk = `${snap.playlistId}::${pos}`;
  const rec = s.progress[pk];
  const entrySegs = s.segments.filter((x) => x.playlistId === snap.playlistId && x.position === pos);
  const cov = summarizeSegments(entrySegs);
  const completion = completionFromCoverage(cov.uniqueSec, entry?.durationSec ?? null, {
    threshold: s.settings.verifiedThreshold,
    manualDone: rec?.status === 'done',
    needsRevision: rec?.needsRevision,
    unavailable: (entry?.durationSec ?? null) === null,
  });

  // reset per-video session tracking
  useEffect(() => {
    sessSegs.current = [];
    sessionId.current = uid();
    sessWallStart.current = Date.now();
    openSeg.current = null;
    lastT.current = 0;
    setCur(0);
    setState('idle');
    setErr(null);
    prevUnique.current = summarizeSegments(
      allSegsRef.current.filter((x) => x.playlistId === snap.playlistId && x.position === pos),
    ).uniqueSec;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, snap.playlistId]);

  const closeSeg = (tlNow: number) => {
    const o = openSeg.current;
    openSeg.current = null;
    if (!o || !entry) return;
    const tlEnd = Math.max(0, tlNow);
    if (tlEnd <= o.tlStart + 0.15) return; // ignore empty/no-progress flushes
    const seg: PlaybackSegment = {
      id: uid(),
      playlistId: snap.playlistId,
      position: pos,
      videoId: entry.videoId,
      sessionId: sessionId.current,
      wallStartMs: o.wallStart,
      wallEndMs: Date.now(),
      timelineStartSec: o.tlStart,
      timelineEndSec: tlEnd,
      playbackRate: o.rate,
      source: 'verified',
    };
    sessSegs.current.push(seg);
    s.addSegments([seg]);
  };

  // create / load player
  useEffect(() => {
    if (!entry?.videoId) {
      setErr('This entry has no playable video ID.');
      return;
    }
    let dead = false;
    let player: any = null;
    loadIframeApi()
      .then(() => {
        if (dead || !mountRef.current) return;
        if (playerRef.current?.destroy) {
          try {
            playerRef.current.destroy();
          } catch {
            /* noop */
          }
          playerRef.current = null;
        }
        player = new window.YT.Player(mountRef.current, {
          height: '100%',
          width: '100%',
          videoId: entry.videoId,
          playerVars: { rel: 0, modestbranding: 1 },
          events: {
            onReady: (e: any) => {
              if (dead) return;
              setState('ready');
              try {
                setRate(e.target.getPlaybackRate?.() ?? 1);
              } catch {
                /* noop */
              }
            },
            onStateChange: (e: any) => {
              if (dead) return;
              const YTNS = window.YT?.PlayerState;
              const st = e.data;
              const now = Date.now();
              if (st === YTNS?.PLAYING) {
                let tl = lastT.current;
                try {
                  tl = e.target.getCurrentTime?.() ?? lastT.current;
                } catch {
                  /* noop */
                }
                openSeg.current = { wallStart: now, tlStart: tl, rate: lastRate.current };
                lastT.current = tl;
                setState('playing');
              } else if (st === YTNS?.PAUSED) {
                try {
                  closeSeg(e.target.getCurrentTime?.() ?? lastT.current);
                } catch {
                  closeSeg(lastT.current);
                }
                setState('paused');
              } else if (st === YTNS?.BUFFERING) {
                try {
                  closeSeg(e.target.getCurrentTime?.() ?? lastT.current);
                } catch {
                  closeSeg(lastT.current);
                }
                setState((prev) => (prev === 'playing' ? 'buffering' : prev));
              } else if (st === YTNS?.ENDED) {
                try {
                  closeSeg(e.target.getDuration?.() ?? lastT.current);
                } catch {
                  closeSeg(lastT.current);
                }
                setState('ended');
                finalize();
              }
            },
            onPlaybackRateChange: (e: any) => {
              const r = e.data ?? 1;
              setRate(r);
              lastRate.current = r;
              if (openSeg.current && playerRef.current) {
                try {
                  const tl = playerRef.current.getCurrentTime?.() ?? lastT.current;
                  closeSeg(tl);
                  openSeg.current = { wallStart: Date.now(), tlStart: tl, rate: r };
                } catch {
                  /* noop */
                }
              }
            },
            onError: (e: any) => {
              const code = e?.data;
              if (code === 101 || code === 150) {
                setErr('Embedding is disabled for this video. Open it on YouTube instead — that watch cannot be verified here.');
              } else {
                setErr(`Player error (${code ?? 'unknown'}). Try reopening or use Open on YouTube.`);
              }
              setState('error');
            },
          },
        });
        playerRef.current = player;
      })
      .catch((e: any) => {
        if (!dead) {
          setErr(e?.message ?? 'Player failed to load.');
          setState('error');
        }
      });
    return () => {
      dead = true;
      if (openSeg.current && playerRef.current) {
        try {
          closeSeg(playerRef.current.getCurrentTime?.() ?? lastT.current);
        } catch {
          /* noop */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.videoId, snap.playlistId]);

  const lastRate = useRef(1);

  // 2 Hz telemetry poll while playing (documented resolution limit)
  useEffect(() => {
    if (state !== 'playing') return;
    const t = setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      let tl = lastT.current;
      try {
        tl = p.getCurrentTime?.() ?? tl;
      } catch {
        return;
      }
      // seek detection: expected advance ≈ 0.5s * rate; jump > 2.5s => seek, never credit skipped span
      const expected = lastT.current + 0.5 * lastRate.current;
      if (Math.abs(tl - expected) > 2.5 && openSeg.current) {
        closeSeg(lastT.current);
        openSeg.current = { wallStart: Date.now(), tlStart: tl, rate: lastRate.current };
      }
      lastT.current = tl;
      setCur(tl);
    }, 500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const finalize = () => {
    const allForEntry = [
      ...allSegsRef.current.filter((x) => x.playlistId === snap.playlistId && x.position === pos),
      ...sessSegs.current,
    ];
    const sum = summarizeSegments(allForEntry);
    const gain = Math.max(0, Math.round(sum.uniqueSec - prevUnique.current));
    const activePlaybackSec = Math.round(sessSegs.current.reduce((a, x) => a + Math.max(0, (x.wallEndMs - x.wallStartMs) / 1000), 0));
    const contentSec = Math.round(sessSegs.current.reduce((a, x) => a + Math.max(0, x.timelineEndSec - x.timelineStartSec), 0));
    const totalWall = Math.round((Date.now() - sessWallStart.current) / 1000);
    s.addPlaySession({
      playlistId: snap.playlistId,
      position: pos,
      videoId: entry?.videoId ?? '',
      startedAt: new Date(sessWallStart.current).toISOString(),
      finishedAt: new Date().toISOString(),
      activePlaybackSec,
      contentSec,
      uniqueGainSec: gain,
      pauseSec: Math.max(0, totalWall - activePlaybackSec),
      note: note || undefined,
      source: 'verified',
    });
    const c = completionFromCoverage(sum.uniqueSec, entry?.durationSec ?? null, { threshold: s.settings.verifiedThreshold });
    if (c === 'verified') {
      s.markVerified(snap.playlistId, pos, entry?.videoId ?? '');
      notify(`Video #${pos} verified complete.`);
    } else {
      notify(`Playback saved: +${formatSecondsHHMMSS(gain)} unique coverage.`);
    }
    prevUnique.current = Math.round(sum.uniqueSec);
  };

  const play = () => {
    try {
      playerRef.current?.playVideo?.();
    } catch {
      /* noop */
    }
  };
  const pause = () => {
    try {
      playerRef.current?.pauseVideo?.();
    } catch {
      /* noop */
    }
  };

  const go = (p: number) => {
    if (p < 1 || p > N) return;
    if (openSeg.current && playerRef.current) {
      try {
        closeSeg(playerRef.current.getCurrentTime?.() ?? lastT.current);
      } catch {
        /* noop */
      }
    }
    setPos(p);
  };

  const enqueue = () => {
    const q = queue.includes(pos) ? queue : [...queue, pos];
    s.setQueue(snap.playlistId, q);
  };

  const dur = entry?.durationSec ?? null;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h2 className="text-base font-bold">Now playing #{pos}</h2>
            <p className="max-w-xl truncate text-sm text-slate-400" title={entry?.title}>{entry?.title}</p>
          </div>
          <span className={`rounded-full px-2 py-1 text-[11px] ${completion === 'verified' ? 'bg-emerald-500/15 text-emerald-300' : completion === 'manual' ? 'bg-cyan-500/15 text-cyan-300' : completion === 'in-progress' ? 'bg-violet-500/20 text-violet-200' : completion === 'unavailable' ? 'bg-red-500/15 text-red-300' : 'bg-white/5 text-slate-400'}`}>
            {completion === 'verified' ? '✓ verified' : completion === 'manual' ? 'manual complete' : completion === 'in-progress' ? 'in progress' : completion === 'needs-revision' ? 'needs revision' : completion === 'unavailable' ? 'unavailable' : 'not started'}
          </span>
        </div>
        <div className="mt-3 aspect-video w-full overflow-hidden rounded-xl bg-black">
          <div ref={mountRef} className="h-full w-full" />
        </div>
        {err && (
          <p className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2 text-sm text-amber-200">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" />
            <span>
              {err}{' '}
              {entry?.videoId && (
                <a className="underline" target="_blank" rel="noreferrer" href={`https://www.youtube.com/watch?v=${entry.videoId}&list=${snap.playlistId}`}>
                  Open on YouTube
                </a>
              )}
            </span>
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Btn variant="primary" onClick={play} disabled={state === 'error' || !entry?.videoId}><Play size={14} /> Play</Btn>
          <Btn onClick={pause}><Pause size={14} /> Pause</Btn>
          <Btn onClick={() => go(pos - 1)} disabled={pos <= 1}><SkipBack size={14} /> Prev</Btn>
          <Btn onClick={() => go(pos + 1)} disabled={pos >= N}>Next <SkipForward size={14} /></Btn>
          <Btn onClick={enqueue}><ListPlus size={14} /> Queue</Btn>
          <span className="ml-auto font-mono text-xs text-slate-400">
            {formatSecondsHHMMSS(Math.floor(cur))} / {dur !== null ? formatSecondsHHMMSS(dur) : '?'} · {rate}x · unique {formatSecondsHHMMSS(Math.floor(cov.uniqueSec))}
          </span>
        </div>
        {dur !== null && dur > 0 && (
          <div className="mt-2"><ProgressBar pct={(cur / dur) * 100} tone="cyan" /></div>
        )}
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Field label={`Jump to position (1–${N})`}>
            <input type="number" min={1} max={N} value={pos} onChange={(e) => go(Number(e.target.value))} className={inputCls} />
          </Field>
          <Field label="Pause-note (saved when the video ends)">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What to remember…" className={inputCls} />
          </Field>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Btn onClick={() => entry && s.toggleDone(snap.playlistId, pos, entry.videoId)}>
            <CheckCircle2 size={14} /> {rec?.completedAt ? 'Unmark complete' : 'Mark complete (manual — not verified)'}
          </Btn>
          <Btn
            onClick={() => {
              if (!entry) return;
              const pk = `${snap.playlistId}::${pos}`;
              const cur = s.progress[pk];
              s.updateRecord(pk, {
                playlistId: snap.playlistId, position: pos, videoId: entry.videoId,
                status: cur?.status ?? 'in-progress', completedAt: cur?.completedAt ?? null,
                needsRevision: !cur?.needsRevision,
              } as any);
            }}
            aria-pressed={!!rec?.needsRevision}
          >
            <BookmarkPlus size={14} /> {rec?.needsRevision ? 'Unflag revision' : 'Needs revision'}
          </Btn>
          {entry?.videoId && (
            <a className="inline-flex items-center gap-1.5 rounded-xl bg-white/5 px-3 py-2 text-sm" target="_blank" rel="noreferrer" href={`https://www.youtube.com/watch?v=${entry.videoId}&list=${snap.playlistId}`}>
              <ExternalLink size={14} /> YouTube
            </a>
          )}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Verified completion at ≥{Math.round(s.settings.verifiedThreshold * 100)}% unique coverage (Settings). Telemetry samples position ~2×/s; seeks never credit skipped spans; buffering never counts. Watching on YouTube directly cannot be verified here.
        </p>
      </Card>

      <Card>
        <h3 className="text-sm font-bold">Learning queue ({queue.length})</h3>
        {queue.length === 0 ? (
          <p className="text-xs text-slate-500">Queue videos to build tonight's session order. Queue is per-playlist.</p>
        ) : (
          <div className="mt-1 flex flex-wrap gap-1">
            {queue.map((p) => (
              <button key={p} onClick={() => go(p)} className={`rounded-lg px-2 py-1 font-mono text-xs ${p === pos ? 'bg-violet-600 text-white' : 'bg-white/5 text-slate-300'}`}>#{p}</button>
            ))}
            <button onClick={() => s.setQueue(snap.playlistId, [])} className="rounded-lg px-2 py-1 text-xs text-slate-500 underline">Clear</button>
          </div>
        )}
      </Card>
    </div>
  );
}
