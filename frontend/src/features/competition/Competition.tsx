import { useEffect, useMemo, useState } from 'react';
import { Swords, RotateCcw, Pause, Play, Search, Crosshair, Dices } from 'lucide-react';
import {
  TIERS, validateChallenge, generateCompetitors, rankBoard, gapToNext,
  challengeWindowDates, windowLabel,
  type Tier,
} from '../../domain/index.js';
import { initialsOf } from '../../domain/competition/aliases.js';
import { summarizeSegments, eligibleDailyEfficiencies, dateKeyInTimezone, splitIntervalByDay } from '../../domain/index.js';
import type { PlaybackSegment } from '../../domain/index.js';
import { useStore } from '../../app/store.js';
import { confirmDialog } from '../../components/ui/dialog.js';
import { Dropdown } from '../../components/ui/Dropdown.js';
import { Card, Btn, Field, inputCls, Empty } from '../../components/ui/ui.js';

/** Ranking is FIXED: average daily content efficiency. No metric selector. */

export function Competition() {
  const s = useStore();
  const snap = s.activeId ? s.playlists[s.activeId] : undefined;
  const [paused, setPaused] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);
  const [view, setView] = useState<'top' | 'near'>('top');
  const [aliasQ, setAliasQ] = useState('');
  const cfg = s.challenge;

  // Challenge-window calendar identities (oldest → newest) in the display
  // timezone. Shared by the user table and the simulator so both sides align;
  // the window slides when the calendar advances and is stable on refresh.
  const windowDates = useMemo(
    () => challengeWindowDates(cfg.windowDays, s.prefs.timezone),
    [cfg.windowDays, s.prefs.timezone],
  );
  const windowDatesKey = windowDates.join(',');
  const windowName = windowLabel(windowDates);

  // User daily efficiencies over the challenge window (tz day boundaries).
  // Same raw records + interval rules as the Efficiency page; only the
  // aggregation (mean of eligible dailies) is Arena-specific.
  const userArena = useMemo(() => {
    const pid = snap?.playlistId;
    if (!pid) return { dailyEffs: [] as number[], table: [] as { dateKey: string; uniqueSec: number; focusSec: number }[], unique: 0, verified: 0, focus: 0, days: 0 };
    const tz = s.prefs.timezone;
    const keys: string[] = windowDatesKey.split(',').filter(Boolean);
    const segs = s.segments.filter((x) => x.playlistId === pid);
    const table = keys.map((dateKey) => {
      const daySegs = segs.filter((x) => dateKeyInTimezone(new Date(x.wallStartMs), tz) === dateKey);
      const byKey = new Map<string, PlaybackSegment[]>();
      for (const x of daySegs) {
        const k = `${x.playlistId}::${x.position}`;
        const arr = byKey.get(k) ?? [];
        arr.push(x);
        byKey.set(k, arr);
      }
      let unique = 0;
      for (const arr of byKey.values()) unique += summarizeSegments(arr).uniqueSec;
      // focus attributed by wall-interval splitting (pauses already excluded at record time)
      let focus = 0;
      for (const sess of s.sessions.filter((x) => x.playlistId === pid && x.finishedAt)) {
        const start = new Date(sess.startedAt).getTime();
        const end = new Date(sess.finishedAt as string).getTime();
        const wall = Math.max(1, Math.round((end - start) / 1000));
        for (const sl of splitIntervalByDay(start, end, tz)) {
          if (sl.dateKey === dateKey) focus += Math.round((sess.activeSec * sl.seconds) / wall);
        }
      }
      return { dateKey, uniqueSec: Math.round(unique), focusSec: focus };
    });
    const dailyEffs = eligibleDailyEfficiencies(table);
    const unique = table.reduce((a, t) => a + t.uniqueSec, 0);
    const focus = table.reduce((a, t) => a + t.focusSec, 0);
    const verified = Object.values(s.progress).filter((p) => p.playlistId === pid && p.source === 'verified' && p.completedAt).length;
    return { dailyEffs, table, unique, verified, focus, days: new Set(table.filter((t) => t.focusSec > 0).map((t) => t.dateKey)).size };
  }, [s.segments, s.sessions, s.progress, snap, s.prefs.timezone, windowDatesKey]);

  const playlistBasis = useMemo(() => {
    if (!snap) return { totalSec: null as number | null, n: 0, avgVideoSec: 600 };
    const resolved = snap.entries.filter((e) => e.durationSec !== null) as { durationSec: number }[];
    const total = resolved.reduce((a, e) => a + (e as any).durationSec, 0);
    return {
      totalSec: resolved.length === snap.entries.length ? total : null,
      n: snap.entries.length,
      avgVideoSec: resolved.length ? Math.round(total / resolved.length) : 600,
    };
  }, [snap]);

  const problems = validateChallenge(cfg);
  const anchorDates = useMemo(() => windowDatesKey.split(',').filter(Boolean), [windowDatesKey]);
  const competitors = useMemo(
    () => (problems.length || paused ? [] : generateCompetitors(cfg, playlistBasis, { anchorDates })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cfg.seed, cfg.cohortSize, JSON.stringify(cfg.tierDist), cfg.windowDays, cfg.dailyCapHours, playlistBasis.n, playlistBasis.totalSec, paused, problems.length, windowDatesKey],
  );
  const board = useMemo(
    () => rankBoard(cfg, competitors, {
      dailyEffs: userArena.dailyEffs,
      uniqueContentSec: userArena.unique,
      verifiedCount: userArena.verified,
      focusSec: userArena.focus,
      activeDays: userArena.days,
    }),
    [cfg, competitors, userArena],
  );
  const me = board.rows.find((r) => r.isUser)!;
  const above = board.rows.filter((r) => !r.isUser && r.value !== null && me.value !== null && r.value > me.value).sort((a, b) => (a.value as number) - (b.value as number))[0] ?? null;
  const gap = gapToNext(me.value, above?.value ?? null);

  const setTier = (t: Tier, v: number) => s.setChallenge({ tierDist: { ...cfg.tierDist, [t]: v } });
  const simById = useMemo(() => new Map(competitors.map((c) => [c.id, c])), [competitors]);

  // Reset paging whenever the ranking basis changes
  useEffect(() => {
    setPage(0);
  }, [cfg.cohortSize, cfg.seed, cfg.windowDays, cfg.dailyCapHours, pageSize, aliasQ, view]);

  const filtered = aliasQ.trim()
    ? board.rows.filter((r) => r.name.toLowerCase().includes(aliasQ.trim().toLowerCase()))
    : view === 'near'
      ? (() => {
        const idx = board.rows.findIndex((r) => r.isUser);
        const half = Math.floor(pageSize / 2);
        return board.rows.slice(Math.max(0, idx - half), Math.max(0, idx - half) + pageSize);
      })()
      : board.rows;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const pageRows = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const jumpToMe = () => {
    setAliasQ('');
    setView('near');
    const idx = board.rows.findIndex((r) => r.isUser);
    setPage(Math.floor(idx / pageSize));
  };

  if (!snap) return <Empty title="No active playlist" hint="Pick a playlist — the simulation uses its real entries and durations as the shared challenge basis." />;

  return (
    <div className="space-y-4">
      <Card>
        <p className="rounded-xl border border-fuchsia-500/40 bg-fuchsia-500/10 p-2 text-center text-xs font-bold tracking-wide text-fuchsia-200">
          FICTIONAL SIMULATION — all {cfg.cohortSize - 1} opponents are generated locally from seed {cfg.seed}. No real people, no real leaderboard.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto flex items-center gap-1.5 text-base font-bold"><Swords size={16} /> Study Arena</h2>
          <Btn variant={s.challengeEnabled ? 'primary' : 'ghost'} onClick={() => s.setChallengeEnabled(!s.challengeEnabled)}>
            {s.challengeEnabled ? 'Enabled' : 'Enable competition'}
          </Btn>
          {!paused ? <Btn onClick={() => setPaused(true)}><Pause size={13} /> Pause sim</Btn> : <Btn onClick={() => setPaused(false)}><Play size={13} /> Resume</Btn>}
          <Btn variant="danger" onClick={async () => { const ok = await confirmDialog({ title: 'Reset fictional challenge?', body: 'Your real study history, goals and achievements are untouched.', confirmLabel: 'Reset sim', danger: true }); if (ok) s.resetChallenge(); }}><RotateCcw size={13} /> Reset sim</Btn>
        </div>
        {!s.challengeEnabled && <p className="mt-1 text-xs text-slate-500">Competition is optional and off by default. Enable it any time; disabling never deletes progress.</p>}
      </Card>

      {s.challengeEnabled && (
        <>
          <Card>
            <p className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-2 text-center text-xs text-violet-200">
              Ranked by <b>average daily content efficiency</b> over {windowName} (last {cfg.windowDays} days, {s.prefs.timezone}) — total hours, videos, XP, and tier never affect rank.
            </p>
            <p className="mt-1 text-center text-[11px] text-slate-500">
              Window: {anchorDates[0]} → {anchorDates[anchorDates.length - 1]} · each eligible day counts once · Efficiency page shows the aggregate ratio instead — same records, different question.
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              <Field label="Cohort size incl. you (10–2000)">
                <input type="number" min={10} max={2000} value={cfg.cohortSize} onChange={(e) => s.setChallenge({ cohortSize: Number(e.target.value) })} className={inputCls} />
              </Field>
              <Field label="Max rival study per day (hours, 1–12)">
                <input
                  type="number" min={1} max={12} step={0.5}
                  value={cfg.dailyCapHours}
                  onChange={(e) => s.setChallenge({ dailyCapHours: Math.min(12, Math.max(1, Number(e.target.value) || 6)) })}
                  className={inputCls}
                />
              </Field>
              <Field label="Seed (stable ranks)">
                <input type="number" value={cfg.seed} onChange={(e) => s.setChallenge({ seed: Number(e.target.value) })} className={inputCls} />
              </Field>
              <Field label="Window (days)">
                <input type="number" min={1} max={90} value={cfg.windowDays} onChange={(e) => s.setChallenge({ windowDays: Number(e.target.value) })} className={inputCls} />
              </Field>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Daily cap = fictional activity ceiling only (default 6 h): an Ultra rival at 110% covers at most 6.6 h of
              unique content per day, bounded by remaining playlist content. <b>Your genuine sessions are never capped.</b>
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Btn onClick={() => s.setChallenge({ seed: Math.floor(Math.random() * 1_000_000_000) })}><Dices size={14} /> Generate new fictional cohort</Btn>
              <p className="min-w-[220px] flex-1 text-[11px] text-slate-500">
                The seed starts the deterministic generator: same seed + settings + window dates = same rivals and ranks across reloads.
                Each rival day is seeded by its calendar date, so refreshing today reproduces today, while tomorrow's rolling window slides to new dates and recomputed ranks.
                A new seed (or bigger cohort) creates different/additional rivals; changing the window re-simulates the period (ranks may move without new study — the window itself changed).
                Nothing here ever touches your real learning records, and the seed measures nothing about you.
              </p>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {TIERS.map((t) => (
                <Field key={t} label={`${t} %`}>
                  <input type="number" min={0} max={100} value={cfg.tierDist[t]} onChange={(e) => setTier(t, Number(e.target.value))} className={inputCls} />
                </Field>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Tier distribution = share of rivals per tier (must sum to 100). Separate from efficiency bands, the plausible
              throughput each tier simulates — Ultra 100–110%, High 85–99.9%, Good 70–84.9%, Normal 55–69.9%,
              Average 40–54.9%, Below Average 20–39.9% (design assumptions, not real-world benchmarks; your 33% can mean deep, careful study).
            </p>
            {problems.map((p) => <p key={p} className="mt-1 text-xs text-red-300">{p}</p>)}
          </Card>

          <div className="grid min-w-0 gap-4 md:grid-cols-3">
            <Card>
              <h3 className="text-sm font-bold">My rank (fictional cohort)</h3>
              <p className="mt-0.5 text-[11px] text-slate-500">Window {windowName} · {s.prefs.timezone}</p>
              {me.provisional ? (
                <div className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                  <p className="font-semibold text-amber-200">
                    Provisional — complete {Math.max(0, board.required - board.userEligible)} more eligible study day{board.required - board.userEligible === 1 ? '' : 's'} to establish your rank.
                  </p>
                  <p className="mt-1 text-xs text-slate-300">
                    {board.userEligible}/{board.required} eligible days
                    {board.userScore !== null ? ` · current average ${board.userScore.toFixed(1)}%` : ' · no measurable efficiency yet'}.
                    An eligible day = focused study with real coverage in the last {cfg.windowDays} days.
                  </p>
                  {userArena.dailyEffs.length > 0 && (
                    <p className="mt-1 font-mono text-[11px] text-slate-400">
                      Recorded: {userArena.dailyEffs.map((e) => `${e.toFixed(0)}%`).join(' · ')}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-slate-400">Next action: run one focused Player or timer session today — it counts as soon as it has real study time.</p>
                </div>
              ) : (
                <>
                  <p className="mt-1 text-3xl font-bold">#{board.userRank} <span className="text-sm font-normal text-slate-400">of {board.rows.length}</span></p>
                  <p className="text-xs text-slate-400">
                    Avg daily efficiency {board.userScore !== null ? `${board.userScore.toFixed(1)}%` : '—'} · {board.userEligible}/{board.required} eligible days
                  </p>
                  <p className="text-xs text-slate-400">
                    {board.percentile !== null ? `Ranked above ${board.percentile.toFixed(1)}% of this simulated cohort` : '—'}
                    {gap && above ? ` · ${gap} behind ${above.name}` : ' · leading the cohort'}
                  </p>
                </>
              )}
              <p className="mt-1 text-[11px] text-slate-500">Rank 1 is best. Ties share a rank (1, 2, 2, 4). Percentile = share of the cohort ranked strictly below you. Totals (hours, videos) are shown for context only and never ranked.</p>
              <Btn
                onClick={() => { if (board.userRank !== null) s.pushRank({ at: new Date().toISOString(), rank: board.userRank, of: board.rows.length, metric: 'efficiency' }); }}
                disabled={board.userRank === null}
              >
                Snapshot my rank
              </Btn>
              {s.rankHistory.length > 0 && (
                <p className="mt-1 font-mono text-[11px] text-slate-500">
                  {s.rankHistory.slice(-6).map((r) => `#${r.rank}`).join(' → ')}
                </p>
              )}
            </Card>
            <Card className="min-w-0 md:col-span-2">
              <h3 className="text-sm font-bold">
                Leaderboard — average daily efficiency · {windowName} · last {cfg.windowDays} days
                {paused && ' (paused)'}
              </h3>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Exact window {anchorDates[0]} → {anchorDates[anchorDates.length - 1]} ({s.prefs.timezone}) · eligible days shown per row · secondary totals labelled with period and unit, context only.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <div className="relative min-w-[150px] flex-1">
                  <Search size={14} className="absolute left-2.5 top-2.5 text-slate-500" />
                  <input
                    value={aliasQ}
                    onChange={(e) => setAliasQ(e.target.value)}
                    placeholder="Search rival alias…"
                    aria-label="Search rival alias"
                    className={`${inputCls} pl-8`}
                  />
                </div>
                <div className="inline-flex rounded-xl border border-white/10 bg-black/30 p-0.5" role="group" aria-label="Leaderboard view">
                  {(['top', 'near'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setView(v)}
                      aria-pressed={view === v}
                      className={`rounded-[10px] px-3 py-1.5 text-xs font-medium ${view === v ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                    >
                      {v === 'top' ? 'Top ranked' : 'Near me'}
                    </button>
                  ))}
                </div>
                <Dropdown
                  label="Page size"
                  value={String(pageSize)}
                  options={['25', '50', '100'].map((n) => ({ value: n, label: `${n} / page` }))}
                  onChange={(v) => setPageSize(Number(v))}
                />
                <Btn onClick={jumpToMe}><Crosshair size={13} /> My rank</Btn>
              </div>
              <ul className="mt-2 space-y-1 text-sm">
                {pageRows.map((r) => (
                  <CompetitorRow key={r.id} r={r} sim={r.isUser ? null : simById.get(r.id)} userDetail={r.isUser ? { unique: userArena.unique, focus: userArena.focus, practice: 0 } : null} />
                ))}
              </ul>
              {pageRows.length === 0 && <p className="mt-2 text-xs text-slate-500">No rivals match “{aliasQ}”. Clear the search to browse the cohort.</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <Btn onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0}>Prev</Btn>
                <span>Page {safePage + 1} of {pages} · {filtered.length} shown (cohort {board.rows.length})</span>
                <Btn onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={safePage >= pages - 1}>Next</Btn>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">Fictional opponents only. Totals below are context — rank uses average daily efficiency alone. Provisional = too few eligible days to rank.</p>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function CompetitorRow({
  r,
  sim,
  userDetail,
}: {
  r: { id: string; name: string; isUser: boolean; tier: string; display: string; provisional: boolean; rank: number | null; eligibleDays: number; windowDays: number };
  sim: { uniqueContentSec: number; focusSec: number; practiceMin: number } | null | undefined;
  userDetail: { unique: number; focus: number; practice: number } | null;
}) {
  const detail = sim
    ? { unique: sim.uniqueContentSec, focus: sim.focusSec, practice: sim.practiceMin }
    : userDetail;
  const ctx = detail
    ? ` · ${fmtHMS(detail.unique)} unique · ${fmtHMS(detail.focus)} study${detail.practice ? ` · ${detail.practice}m practice` : ''}`
    : '';
  const sub = detail
    ? `${fmtHMS(detail.unique)} unique · ${fmtHMS(detail.focus)} study, last ${r.windowDays}d`
    : '';
  return (
    <li
      className={`flex items-center gap-2 rounded-xl px-2 py-1.5 ${r.isUser ? 'bg-violet-600/25 font-bold' : 'bg-white/5'}`}
      title={r.isUser ? `You · ${r.display}${ctx}` : `${r.name} · tier ${r.tier} · ${r.display}${ctx}${r.provisional ? ' · provisional' : ''}`}
    >
      <span className="w-10 shrink-0 font-mono text-slate-400">{r.rank !== null ? `#${r.rank}` : '–'}</span>
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-slate-600 to-slate-800 text-[11px] font-bold">{r.isUser ? 'YOU' : initialsOf(r.name)}</span>
      <span className="min-w-0 flex-1 truncate">
        {r.name} <span className="text-[11px] font-normal text-slate-500">· {r.tier} · {r.eligibleDays}/{r.windowDays} eligible days{r.provisional ? ' · provisional' : ''}</span>
        {sub && <span className="block truncate text-[11px] font-normal text-slate-500">{sub} · context only</span>}
      </span>
      <span className="shrink-0 text-right">
        <span className="block font-mono text-sm font-bold">{r.display}</span>
        <span className="block text-[10px] font-normal text-slate-500">avg daily eff.</span>
      </span>
    </li>
  );
}

function fmtHMS(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
