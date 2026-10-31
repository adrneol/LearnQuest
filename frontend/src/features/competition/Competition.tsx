import { useEffect, useMemo, useState } from 'react';
import { Swords, RotateCcw, Pause, Play, Search, Crosshair, Dices, Lock, Flag, Trophy } from 'lucide-react';
import {
  TIERS, validateChallenge, generateCompetitors, rankBoard, gapToNext,
  challengeWindowDates, windowLabel, createFixedChallenge, computeArenaUserEvidence,
  ARENA_MODEL_VERSION, ARENA_WEIGHTS, DEFAULT_TIER_DIST,
  type Tier, type ChallengeConfig, type ArenaComponents,
} from '../../domain/index.js';
import { initialsOf } from '../../domain/competition/aliases.js';
import { useStore } from '../../app/store.js';
import { useDayTick } from '../../app/dayTick.js';
import { confirmDialog } from '../../components/ui/dialog.js';
import { Dropdown } from '../../components/ui/Dropdown.js';
import { NumberField } from '../../components/ui/NumberField.js';
import { Card, Btn, inputCls, Empty } from '../../components/ui/ui.js';

/**
 * Arena v2 is a FICTIONAL practice simulation. It scores progress and
 * consistency with the same functions for the user and every synthetic rival.
 * No real people, real leaderboard, XP, hours, or tier value affects rank.
 */

const INTENSITY: Record<'relaxed' | 'standard' | 'competitive', { label: string; dist: Record<Tier, number> }> = {
  relaxed: {
    label: 'Relaxed',
    dist: { Ultra: 0, High: 4, Good: 14, Normal: 32, Average: 32, 'Below Average': 18 },
  },
  standard: { label: 'Standard', dist: { ...DEFAULT_TIER_DIST } },
  competitive: {
    label: 'Competitive',
    dist: { Ultra: 5, High: 15, Good: 25, Normal: 30, Average: 17, 'Below Average': 8 },
  },
};

function intensityOf(dist: Record<Tier, number>): 'relaxed' | 'standard' | 'competitive' {
  const match = (Object.keys(INTENSITY) as Array<keyof typeof INTENSITY>)
    .find((k) => TIERS.every((t) => Math.abs((INTENSITY[k].dist[t] ?? 0) - (dist[t] ?? 0)) < 0.001));
  return match ?? 'standard';
}

export function Competition() {
  const s = useStore();
  const snap = s.activeId ? s.playlists[s.activeId] : undefined;
  const [paused, setPaused] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);
  const [view, setView] = useState<'top' | 'near'>('top');
  const [aliasQ, setAliasQ] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const cfg = s.challenge;
  const fixed = cfg.mode === 'fixed' && cfg.fixed ? cfg.fixed : null;
  const effectiveCfg: ChallengeConfig = fixed
    ? {
      ...cfg,
      seed: fixed.seed,
      cohortSize: fixed.cohortSize,
      tierDist: fixed.tierDist,
      windowDays: fixed.windowDays,
      dailyCapHours: fixed.dailyCapHours,
      mode: 'fixed',
      fixed,
    }
    : cfg;

  const todayTick = useDayTick(s.prefs.timezone);
  const windowDates = useMemo(
    () => (fixed
      ? fixed.windowDates
      : challengeWindowDates(effectiveCfg.windowDays, s.prefs.timezone, Date.now())),
    // todayTick forces a refresh after midnight/sleep even though Date.now() is
    // intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fixed, effectiveCfg.windowDays, s.prefs.timezone, todayTick],
  );
  const windowDatesKey = windowDates.join(',');
  const windowName = windowLabel(windowDates);

  const playlistBasis = useMemo(() => {
    if (!snap) return { totalSec: null as number | null, n: 0, avgVideoSec: 600, resolved: 0 };
    const resolved = snap.entries.filter((e) => e.durationSec !== null) as { durationSec: number }[];
    const total = resolved.reduce((a, e) => a + (e.durationSec ?? 0), 0);
    return {
      totalSec: resolved.length === snap.entries.length && total > 0 ? total : null,
      n: snap.entries.length,
      avgVideoSec: resolved.length ? Math.round(total / resolved.length) : 600,
      resolved: resolved.length,
    };
  }, [snap]);

  const userEvidence = useMemo(() => {
    if (!snap) {
      return { playlistDurationSec: null, uniqueContentSec: 0, focusSec: 0, verifiedCompleted: 0, manualCompleted: 0, daily: [], qualifyingDays: 0 };
    }
    return computeArenaUserEvidence({
      snapshot: snap,
      progress: s.progress,
      segments: s.segments,
      sessions: s.sessions,
      timeZone: s.prefs.timezone,
      windowDates,
    });
  }, [snap, s.progress, s.segments, s.sessions, s.prefs.timezone, windowDatesKey]);

  const observedDays = useMemo(() => {
    if (!fixed) return effectiveCfg.windowDays;
    const start = Date.parse(fixed.startedAt);
    if (!Number.isFinite(start)) return effectiveCfg.windowDays;
    return Math.min(effectiveCfg.windowDays, Math.max(0, Math.floor((Date.now() - start) / 86400_000) + 1));
  }, [fixed, effectiveCfg.windowDays, todayTick]);

  const problems = validateChallenge(effectiveCfg);
  const anchorDates = useMemo(() => windowDatesKey.split(',').filter(Boolean), [windowDatesKey]);
  const competitors = useMemo(
    () => (problems.length || paused || !playlistBasis.totalSec
      ? []
      : generateCompetitors(effectiveCfg, playlistBasis, { anchorDates })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveCfg.seed, effectiveCfg.cohortSize, JSON.stringify(effectiveCfg.tierDist), effectiveCfg.windowDays, effectiveCfg.dailyCapHours, playlistBasis.totalSec, paused, problems.length, windowDatesKey],
  );
  const board = useMemo(
    () => rankBoard(effectiveCfg, competitors, {
      uniqueContentSec: userEvidence.uniqueContentSec,
      playlistDurationSec: playlistBasis.totalSec ?? userEvidence.playlistDurationSec,
      qualifyingDays: userEvidence.qualifyingDays,
      observedDays,
      focusSec: userEvidence.focusSec,
      verifiedCount: userEvidence.verifiedCompleted,
      activeDays: userEvidence.daily.filter((d) => d.focusSec > 0 || d.contentGainSec > 0).length,
    }),
    [effectiveCfg, competitors, userEvidence, playlistBasis.totalSec, observedDays],
  );
  const boardScoredCount = board.rows.filter((r) => r.value !== null).length;
  const me = board.rows.find((r) => r.isUser)!;
  const above = board.rows
    .filter((r) => !r.isUser && r.value !== null && me.value !== null && r.value > me.value)
    .sort((a, b) => (a.value as number) - (b.value as number))[0] ?? null;
  const gap = gapToNext(me.value, above?.value ?? null);

  const setTier = (t: Tier, v: number) => s.setChallenge({ tierDist: { ...effectiveCfg.tierDist, [t]: v } });
  const setIntensity = (k: keyof typeof INTENSITY) => s.setChallenge({ tierDist: { ...INTENSITY[k].dist } });

  useEffect(() => {
    setPage(0);
  }, [effectiveCfg.cohortSize, effectiveCfg.seed, effectiveCfg.windowDays, effectiveCfg.dailyCapHours, pageSize, aliasQ, view]);

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

  const startFixed = () => {
    if (!snap || !playlistBasis.totalSec) return;
    const next = createFixedChallenge(cfg, {
      playlistId: snap.playlistId,
      playlistSnapshotVersion: snap.snapshotVersion,
      playlistDurationSec: playlistBasis.totalSec,
      windowDates,
    });
    s.setChallenge(next);
  };

  const endFixed = async () => {
    const ok = await confirmDialog({
      title: 'End fixed challenge?',
      body: 'The completed run stays in rank history. Your real learning records are untouched. Practice settings become editable again.',
      confirmLabel: 'End fixed run',
      danger: true,
    });
    if (ok) s.setChallenge({ mode: 'practice', fixed: null });
  };

  if (!snap) return <Empty title="No active playlist" hint="Pick a playlist — Arena compares your real progress with simulated learners. It is a practice game, not a real leaderboard." />;

  const unavailable = playlistBasis.totalSec === null;

  return (
    <div className="space-y-4">
      <Card>
        <p className="rounded-xl border border-fuchsia-500/40 bg-fuchsia-500/10 p-2 text-center text-xs font-bold tracking-wide text-fuchsia-200">
          FICTIONAL SIMULATION — all {effectiveCfg.cohortSize - 1} opponents are generated locally from seed {effectiveCfg.seed}. No real people, no real leaderboard.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto flex items-center gap-1.5 text-base font-bold"><Swords size={16} /> Study Arena <span className="text-[10px] font-normal text-slate-500">{ARENA_MODEL_VERSION}</span></h2>
          <Btn variant={s.challengeEnabled ? 'primary' : 'ghost'} onClick={() => s.setChallengeEnabled(!s.challengeEnabled)}>
            {s.challengeEnabled ? 'Enabled' : 'Enable competition'}
          </Btn>
          {!paused ? <Btn onClick={() => setPaused(true)}><Pause size={13} /> Pause sim</Btn> : <Btn onClick={() => setPaused(false)}><Play size={13} /> Resume</Btn>}
          <Btn variant="danger" onClick={async () => { const ok = await confirmDialog({ title: 'Reset fictional challenge?', body: 'Your real study history, goals and achievements are untouched. Practice settings and rank history are reset.', confirmLabel: 'Reset sim', danger: true }); if (ok) s.resetChallenge(); }}><RotateCcw size={13} /> Reset sim</Btn>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Arena scores <b>sustainable completion</b>: 75% playlist progress + 25% consistency. It never uses hours, XP, streaks, tier, or a real-person leaderboard.
        </p>
        {!s.challengeEnabled && <p className="mt-1 text-xs text-slate-500">Competition is optional and off by default. Enable it any time; disabling never deletes progress.</p>}
      </Card>

      {s.challengeEnabled && (
        <>
          {unavailable ? (
            <Card>
              <h3 className="text-sm font-bold">Arena unavailable</h3>
              <p className="mt-1 text-xs text-slate-300" role="status">
                Arena needs every video duration. {playlistBasis.resolved}/{playlistBasis.n} entries currently have a resolved duration.
                Refresh the playlist or resolve the flagged entries. No average or estimated duration is substituted.
              </p>
            </Card>
          ) : (
            <>
              <Card>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="mr-auto">
                    <h3 className="text-sm font-bold">{fixed ? 'Fixed challenge run' : 'Practice simulation'}</h3>
                    <p className="text-[11px] text-slate-500">
                      {fixed
                        ? `Started ${fixed.startedAt.slice(0, 10)} · ends ${fixed.endsAt.slice(0, 10)} · settings locked`
                        : 'Change these settings to explore a different fictional cohort. Only the practice simulation changes — never your real learning data.'}
                    </p>
                  </div>
                  {fixed ? (
                    <Btn variant="danger" onClick={endFixed}><Flag size={13} /> End fixed run</Btn>
                  ) : (
                    <Btn variant="primary" onClick={startFixed}><Lock size={13} /> Start fixed challenge</Btn>
                  )}
                </div>
                <p className="mt-2 rounded-xl border border-violet-500/30 bg-violet-500/10 p-2 text-center text-xs text-violet-200">
                  Ranked by <b>75% progress + 25% consistency</b> over {windowName} ({effectiveCfg.windowDays} days, {s.prefs.timezone}).
                  Progress is unique covered playlist content ÷ total playlist duration. Consistency is qualifying days ÷ window days.
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-4">
                  <NumberField
                    label="Opponents + you (10–2000)"
                    value={effectiveCfg.cohortSize}
                    min={10}
                    max={2000}
                    live={false}
                    allowEmpty
                    disabled={Boolean(fixed)}
                    onCommit={(v) => { if (v !== null) s.setChallenge({ cohortSize: v }); }}
                  />
                  <NumberField
                    label="Window (days, 1–90)"
                    value={effectiveCfg.windowDays}
                    min={1}
                    max={90}
                    live={false}
                    allowEmpty
                    disabled={Boolean(fixed)}
                    onCommit={(v) => { if (v !== null) s.setChallenge({ windowDays: v }); }}
                  />
                  <div>
                    <Dropdown
                      label="Intensity"
                      value={intensityOf(effectiveCfg.tierDist)}
                      options={(Object.keys(INTENSITY) as Array<keyof typeof INTENSITY>).map((k) => ({ value: k, label: INTENSITY[k].label }))}
                      onChange={(v) => { if (!fixed) setIntensity(v as keyof typeof INTENSITY); }}
                    />
                  </div>
                  <div className="flex items-end">
                    {fixed ? (
                      <p className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-400">Seed {fixed.seed} · locked</p>
                    ) : (
                      <Btn onClick={() => s.setChallenge({ seed: Math.floor(Math.random() * 1_000_000_000) })}><Dices size={14} /> New cohort</Btn>
                    )}
                  </div>
                </div>
                {!fixed && (
                  <details className="mt-2 rounded-xl bg-white/5 p-2 text-xs text-slate-300" open={advanced} onToggle={(e) => setAdvanced((e.target as HTMLDetailsElement).open)}>
                    <summary className="cursor-pointer font-semibold text-slate-200">Advanced simulation settings</summary>
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      <NumberField
                        label="Max rival study/day (hours, 1–12)"
                        value={effectiveCfg.dailyCapHours}
                        min={1}
                        max={12}
                        integer={false}
                        live={false}
                        onCommit={(v) => { if (v !== null) s.setChallenge({ dailyCapHours: v }); }}
                      />
                      {TIERS.map((t) => (
                        <NumberField
                          key={t}
                          label={`${t} %`}
                          value={effectiveCfg.tierDist[t]}
                          min={0}
                          max={100}
                          integer={false}
                          live={false}
                          onCommit={(v) => { if (v !== null) setTier(t, v); }}
                        />
                      ))}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Tier distribution controls the fictional cohort mix (must sum to 100). It never changes your score.
                      Target progress and consistency bands are design assumptions: Ultra 98–100% progress / 85–95% consistency;
                      High 90–98 / 70–85; Good 75–90 / 55–72; Normal 55–75 / 40–58; Average 35–55 / 25–40; Below Average 15–35 / 15–25.
                    </p>
                  </details>
                )}
                {problems.map((p) => <p key={p} className="mt-1 text-xs text-red-300" role="alert">{p}</p>)}
                <p className="mt-2 text-[11px] text-slate-500">
                  Fixed runs freeze the formula ({ARENA_MODEL_VERSION}), weights ({Math.round(ARENA_WEIGHTS.progress * 100)}/{Math.round(ARENA_WEIGHTS.consistency * 100)}),
                  seed, cohort, window and playlist basis. Replaying the same snapshot reproduces the same score; old runs are not silently rescored.
                </p>
              </Card>

              <div className="grid min-w-0 gap-4 md:grid-cols-3">
                <Card>
                  <h3 className="text-sm font-bold">My Arena score</h3>
                  <p className="mt-0.5 text-[11px] text-slate-500">Window {windowName} · {s.prefs.timezone}</p>
                  {!board.components.available ? (
                    <p className="mt-2 text-xs text-amber-200" role="status">Score unavailable: the playlist duration is unresolved.</p>
                  ) : me.provisional ? (
                    <div className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                      <p className="font-semibold text-amber-200">Calibrating — {board.userQualifyingDays}/{board.required} qualifying days, {board.userObservedDays}/{board.requiredObserved} observed days.</p>
                      <p className="mt-1 text-xs text-slate-300">
                        A qualifying day needs 5+ minutes of new content (or a completed video) and 10+ minutes of focus/active playback.
                        Provisional learners are excluded from ranked percentiles, never shown as last place.
                      </p>
                      {board.userScore !== null && <p className="mt-1 text-xs text-slate-400">Current provisional score {board.userScore.toFixed(1)}% — not an official rank.</p>}
                    </div>
                  ) : (
                    <>
                      <p className="mt-1 flex items-baseline gap-2 text-3xl font-bold">
                        <Trophy size={22} className="text-amber-300" /> #{board.userRank}
                        <span className="text-sm font-normal text-slate-400">of {boardScoredCount} scored</span>
                      </p>
                      <p className="text-xs text-slate-400">
                        {board.userScore !== null ? `${board.userScore.toFixed(1)}%` : '—'} · {board.userQualifyingDays}/{effectiveCfg.windowDays} qualifying days
                      </p>
                      <p className="text-xs text-slate-400">
                        {board.percentile !== null ? `Above ${board.percentile.toFixed(1)}% of scored simulated rivals` : '—'}
                        {gap && above ? ` · ${gap} behind ${above.name}` : ' · leading the scored cohort'}
                      </p>
                    </>
                  )}
                  <ScoreBreakdown components={board.components} />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Ties share a rank (1, 2, 2, 4). Percentile uses scored rivals only. Totals are context and never ranked.
                    Manual completion counts as progress but is labelled self-reported.
                  </p>
                  <Btn
                    className="mt-2"
                    onClick={() => {
                      if (board.userRank !== null) s.pushRank({ at: new Date().toISOString(), rank: board.userRank, of: boardScoredCount, metric: ARENA_MODEL_VERSION });
                    }}
                    disabled={board.userRank === null}
                  >
                    Snapshot my rank
                  </Btn>
                  {s.rankHistory.length > 0 && (
                    <p className="mt-1 font-mono text-[11px] text-slate-500">
                      {s.rankHistory.slice(-6).map((r) => `#${r.rank}/${r.of}`).join(' → ')}
                    </p>
                  )}
                </Card>

                <Card className="min-w-0 md:col-span-2">
                  <h3 className="text-sm font-bold">
                    Leaderboard — Arena v2 · {windowName}{paused && ' (paused)'}
                  </h3>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    Exact window {anchorDates[0]} → {anchorDates[anchorDates.length - 1]} ({s.prefs.timezone}) · scored rivals ranked; calibrating rows follow.
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
                          type="button"
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
                      <CompetitorRow key={r.id} r={r} />
                    ))}
                  </ul>
                  {pageRows.length === 0 && <p className="mt-2 text-xs text-slate-500">No rivals match “{aliasQ}”. Clear the search to browse the cohort.</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <Btn onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0}>Prev</Btn>
                    <span>Page {safePage + 1} of {pages} · {filtered.length} shown (cohort {board.rows.length})</span>
                    <Btn onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={safePage >= pages - 1}>Next</Btn>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Fictional opponents only. Each rival uses the same 75/25 formula, qualifying-day rule and bounded playlist content.
                    “Calibrating” means fewer than 3 qualifying days or 7 observed days — not zero performance.
                  </p>
                </Card>
              </div>

              <Card>
                <details className="text-xs text-slate-300">
                  <summary className="cursor-pointer font-semibold text-slate-200">How ranking works</summary>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <div>
                      <p><b>Progress P = U / L.</b> U is unique completed/covered content for current playlist occurrences; L is the total resolved playlist duration. A completed entry credits its full duration once; otherwise only verified timeline coverage counts, capped per entry. The sum is capped at L.</p>
                      <p className="mt-1"><b>Consistency C = Q / W.</b> Q counts qualifying days; W is the fixed or practice window. A qualifying day requires at least 5 minutes of new content or a completed video, plus at least 10 minutes of focus or active playback evidence. A running timer without content gain does not qualify.</p>
                      <p className="mt-1"><b>Score = 100 × (0.75 P + 0.25 C).</b> It is bounded 0–100. Weights are a product policy choice, not a scientific constant.</p>
                    </div>
                    <div>
                      <p><b>Provisional:</b> fewer than 3 qualifying days or fewer than 7 observed calendar days. Provisional rows get no rank and are excluded from percentile denominators.</p>
                      <p className="mt-1"><b>What it does not measure:</b> comprehension, retention, intelligence, real-world rank, or attention. Timer/playback evidence proves recorded activity, not understanding.</p>
                      <p className="mt-1"><b>Anti-exploit:</b> timer-only days do not qualify; rewatches add no unique content; XP, streak, tier and hours are not inputs; manual completion is labelled and does not become verified evidence.</p>
                    </div>
                  </div>
                </details>
                <p className="mt-2 text-[11px] text-slate-500">
                  Evidence in this window: {userEvidence.verifiedCompleted} verified completed · {userEvidence.manualCompleted} manual/self-reported completed ·
                  {' '}{userEvidence.daily.filter((d) => d.focusSec === 0 && d.contentGainSec > 0).length} content-only day(s) excluded by the activity floor.
                </p>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

function ScoreBreakdown({ components }: { components: ArenaComponents }) {
  const p = components.progress;
  const c = components.consistency;
  if (p === null || c === null || components.score === null) {
    return <p className="mt-2 text-xs text-slate-500">No score until the playlist duration is known and a window exists.</p>;
  }
  return (
    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
      <div className="rounded-xl bg-white/5 p-2">
        <p className="font-mono text-sm font-bold">{(p * 100).toFixed(1)}%</p>
        <p className="text-[11px] text-slate-400">Progress · contributes {(p * components.progressWeight * 100).toFixed(1)} pts</p>
      </div>
      <div className="rounded-xl bg-white/5 p-2">
        <p className="font-mono text-sm font-bold">{(c * 100).toFixed(1)}%</p>
        <p className="text-[11px] text-slate-400">Consistency · contributes {(c * components.consistencyWeight * 100).toFixed(1)} pts</p>
      </div>
      <div className="col-span-2 rounded-xl bg-white/5 p-2">
        <p className="font-mono text-sm font-bold">{components.score.toFixed(1)}% Arena score</p>
        <p className="text-[11px] text-slate-400">
          {formatHMS(components.uniqueContentSec)} of {formatHMS(components.playlistDurationSec ?? 0)} content · {components.qualifyingDays}/{components.windowDays} qualifying days
        </p>
      </div>
    </div>
  );
}

function CompetitorRow({ r }: {
  r: {
    id: string; name: string; isUser: boolean; tier: string; display: string; provisional: boolean;
    rank: number | null; qualifyingDays: number; observedDays: number; windowDays: number;
    progress: number | null; consistency: number | null;
  };
}) {
  return (
    <li
      className={`flex items-center gap-2 rounded-xl px-2 py-1.5 ${r.isUser ? 'bg-violet-600/25 font-bold' : 'bg-white/5'}`}
      title={`${r.name}${r.isUser ? ' (you)' : ` · tier ${r.tier}`} · ${r.display}${r.provisional ? ' · calibrating' : ''}`}
    >
      <span className="w-10 shrink-0 font-mono text-slate-400">{r.rank !== null ? `#${r.rank}` : '–'}</span>
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-slate-600 to-slate-800 text-[11px] font-bold">{r.isUser ? 'YOU' : initialsOf(r.name)}</span>
      <span className="min-w-0 flex-1 truncate">
        {r.name} <span className="text-[11px] font-normal text-slate-500">· {r.tier} · {r.qualifyingDays}/{r.observedDays} qualifying / observed</span>
        <span className="block truncate text-[11px] font-normal text-slate-500">
          {r.progress !== null ? `P ${(r.progress * 100).toFixed(0)}%` : 'P —'} · {r.consistency !== null ? `C ${(r.consistency * 100).toFixed(0)}%` : 'C —'} · context only
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block font-mono text-sm font-bold">{r.display}</span>
        <span className="block text-[10px] font-normal text-slate-500">Arena v2</span>
      </span>
    </li>
  );
}

function formatHMS(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
