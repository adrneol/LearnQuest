import { useMemo, useRef, useState } from 'react';
import { ArrowUp, Flag, Lock, Pause, Play, Plus, Search } from 'lucide-react';
import { useStore } from '../../app/store.js';
import { useDayTick } from '../../app/dayTick.js';
import { confirmDialog } from '../../components/ui/dialog.js';
import { Btn, Card, Field, inputCls, ProgressBar } from '../../components/ui/ui.js';
import { NumberField } from '../../components/ui/NumberField.js';
import { Dropdown } from '../../components/ui/Dropdown.js';
import { formatHuman } from '../../domain/duration/duration.js';
import { isQualifyingArenaDay, type ArenaBoard } from '../../domain/competition/competition.js';
import {
  ARENA_HISTORY_LIMIT, ARENA_RUN_MODEL, ARENA_SAMPLE_LIMIT, EMPTY_ARENA, arenaWindow, freezeArenaBasis, generateArenaRivals,
  makeArenaRun, observeArena, scoreArenaRun, sealArenaResult, validArenaSetup,
  type ArenaBasis, type ArenaResult, type ArenaRun, type ArenaSetup, type Difficulty,
} from '../../domain/competition/arenaRuns.js';
import { isArenaLedger } from '../../domain/competition/arenaValidation.js';

const difficulties = [
  { value: 'relaxed', label: 'Relaxed', hint: 'Fictional rivals study less often and for shorter sessions.' },
  { value: 'balanced', label: 'Balanced', hint: 'A wide mix of fictional study routines.' },
  { value: 'challenging', label: 'Challenging', hint: 'Fictional rivals study more often and for longer sessions.' },
];
const percent = (value: number | null) => value === null ? '—' : value.toFixed(1) + '%';
const dateLabel = (value: string, zone: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }).format(new Date(value));

export function Competition() {
  const s = useStore();
  const playlist = s.activeId ? s.playlists[s.activeId] : undefined;
  const basis = useMemo(() => freezeArenaBasis(playlist), [playlist]);
  const ledger = s.challenge.arena ?? EMPTY_ARENA;
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');
  const newButton = useRef<HTMLButtonElement>(null);
  const active = ledger.active;
  const run = ledger.history.find((item) => item.id === selected) ?? active;
  const canArchive = ledger.history.length < ARENA_HISTORY_LIMIT;
  const legacy = s.challenge.fixed || s.challengeEnabled || s.rankHistory.length > 0;

  const create = async (setup: ArenaSetup, source: ArenaBasis, previous?: ArenaResult) => {
    if (s.migrationReadOnly || (active && (!previous || !canArchive))) return;
    const next = makeArenaRun(crypto.randomUUID(), setup, source, s.prefs.timezone, Date.now());
    if (!isArenaLedger({ version: 1, active: next, history: ledger.history })) {
      setNotice('This playlist snapshot could not be saved safely. Choose another playlist or refresh its metadata.');
      return;
    }
    if (!await s.updateArena({ type: 'create', run: next, expectedId: active?.id, previous })) return;
    setSelected(undefined);
    setCreating(false);
    setNotice('Simulation created.');
  };

  const remove = async (item: ArenaRun) => {
    if (s.migrationReadOnly) return;
    if (await confirmDialog({
      title: 'Delete “' + item.setup.name + '”?',
      body: 'This removes this simulation, its saved ranking samples, and any sealed result. Your playlists, progress, study sessions, and other learning records stay intact.',
      confirmLabel: 'Delete simulation', danger: true,
    })) {
      if (!await s.updateArena({ type: 'delete', id: item.id })) return;
      if (selected === item.id) setSelected(undefined);
      setNotice('Simulation removed from the Arena.');
      requestAnimationFrame(() => newButton.current?.focus());
    }
  };

  return (
    <div className="lq-workflow">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] pb-4">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight">Study Arena</h2>
          <p className="mt-1 max-w-[65ch] text-sm text-[var(--text-muted)]">Compare your recorded learning with a seeded cohort of fictional learners.</p>
        </div>
        <Btn ref={newButton} variant="primary" onClick={() => {
          setCreating(true);
          setSelected(undefined);
          requestAnimationFrame(() => document.getElementById('arena-simulation-name')?.focus());
        }} disabled={s.migrationReadOnly}>
          <Plus size={16} aria-hidden="true" /> New simulation
        </Btn>
      </header>
      {s.migrationReadOnly && <p role="status" className="lq-alert lq-alert--warning">Arena management is read-only while the account is being migrated.</p>}
      {notice && <p role="status" className="text-sm text-[var(--text-muted)]">{notice}</p>}
      {s.syncStatus === 'error' && <p role="status" className="text-sm text-[var(--text-muted)]">Account changes are pending. Retry the save from the workspace header.</p>}
      {!run && <ArenaCreate basis={basis} disabled={s.migrationReadOnly} replacing={false} zone={s.prefs.timezone} onCreate={create} />}
      {run && <ArenaDashboard key={run.id} run={run} readOnly={s.migrationReadOnly} creating={creating}
        basis={basis} canArchive={canArchive} remove={remove} create={create}
        cancelCreate={() => setCreating(false)} onComplete={() => setSelected(run.id)} />}
      {!!ledger.history.length && (
        <section className="lq-workflow-section" aria-labelledby="arena-history-title">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="arena-history-title" className="lq-section-title">Simulation history</h3>
            {selected && active && <Btn variant="quiet" onClick={() => setSelected(undefined)}>Return to active simulation</Btn>}
          </div>
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {ledger.history.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                <Btn variant="quiet" className="max-w-full break-words text-left" aria-current={selected === item.id ? 'true' : undefined}
                  onClick={() => { setSelected(item.id); setCreating(false); }}>{item.setup.name}</Btn>
                <span className="text-xs text-[var(--text-muted)]">{item.state} · {item.result ? dateLabel(item.result.asOf, item.zone) : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {legacy && (
        <details className="lq-workflow-section text-sm">
          <summary className="cursor-pointer font-semibold">Legacy Arena records</summary>
          <p className="mt-2 text-[var(--text-muted)]">These original settings and recorded ranks remain available. The older model did not save the inputs needed for exact replay.</p>
          <p className="mt-1">Model {typeof s.challenge.fixed?.modelVersion === 'string' ? s.challenge.fixed.modelVersion : s.challenge.modelVersion ?? 'arena-v2'} · Seed {Number.isFinite(s.challenge.fixed?.seed) ? s.challenge.fixed?.seed : s.challenge.seed}</p>
          {s.challenge.fixed && <p className="mt-1 break-words">Legacy run {s.challenge.fixed.seasonId} · Recorded start {typeof s.challenge.fixed.startedAt === 'string' ? s.challenge.fixed.startedAt : 'unknown'} · Recorded end {typeof s.challenge.fixed.endsAt === 'string' ? s.challenge.fixed.endsAt : 'unknown'}</p>}
          <ol className="mt-2 max-h-48 space-y-1 overflow-y-auto">
            {s.rankHistory.map((item, i) => <li key={item.at + ':' + i}>{item.at.slice(0, 10)} · Rank #{item.rank} of {item.of} · {item.metric}</li>)}
          </ol>
        </details>
      )}
    </div>
  );
}

function ArenaCreate({ basis, disabled, replacing, zone, onCreate, cancel }: {
  basis: ArenaBasis | null;
  disabled: boolean;
  replacing: boolean;
  zone: string;
  onCreate: (setup: ArenaSetup, basis: ArenaBasis) => void;
  cancel?: () => void;
}) {
  const [setup, setSetup] = useState<ArenaSetup>({ name: '', kind: 'practice', seed: 20261013, opponents: 99, days: 14, difficulty: 'balanced' });
  const change = (patch: Partial<ArenaSetup>) => setSetup((current) => ({ ...current, ...patch }));
  return (
    <Card aria-labelledby="arena-setup-title">
      <div className="grid gap-5 lg:grid-cols-[minmax(13rem,.75fr)_minmax(0,1.4fr)]">
        <div>
          <h3 id="arena-setup-title" className="text-lg font-semibold">Create a simulation</h3>
          <p className="mt-2 max-w-[44ch] text-sm text-[var(--text-muted)]">Your real learning records supply your score. A seed creates the same fictional cohort each time. Managing a simulation affects only Arena records.</p>
          {replacing && <p className="mt-3 text-sm text-[var(--text-muted)]">Creating a new simulation seals and archives the current run.</p>}
        </div>
        <form className="grid min-w-0 gap-3" onSubmit={(event) => {
          event.preventDefault();
          if (basis && validArenaSetup(setup) && !disabled) onCreate(setup, basis);
        }}>
          <Field label="Simulation name">
            <input id="arena-simulation-name" className={inputCls} value={setup.name} maxLength={80} required onChange={(event) => change({ name: event.target.value })} placeholder="e.g. Algorithms study block" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Dropdown label="Mode" value={setup.kind} options={[{ value: 'practice', label: 'Practice' }, { value: 'fixed', label: 'Fixed challenge' }]}
              onChange={(value) => change({ kind: value === 'fixed' ? 'fixed' : 'practice' })} />
            <Dropdown label="Difficulty" value={setup.difficulty} options={difficulties} onChange={(value) => change({ difficulty: value as Difficulty })} />
            <NumberField label="Fictional opponents" value={setup.opponents} min={1} max={2000} onCommit={(value) => change({ opponents: value ?? 0 })} />
            <NumberField label="Calendar days" value={setup.days} min={1} max={90} onCommit={(value) => change({ days: value ?? 0 })} />
          </div>
          <p className="text-sm text-[var(--text-muted)]">{setup.kind === 'fixed'
            ? 'Begins at the next local midnight. Only closed days and learning during the challenge count.'
            : 'Coverage and qualifying days in the most recent closed local days.'} Difficulty changes rival activity only.</p>
          <details>
            <summary className="cursor-pointer text-sm font-semibold">Seed and playlist basis</summary>
            <div className="mt-2 grid gap-2">
              <NumberField label="Simulation seed" value={setup.seed} min={0} max={4294967295} onCommit={(value) => change({ seed: value ?? 0 })} />
              <p className="text-xs text-[var(--text-muted)]">{basis ? basis.title : 'Choose a playlist with all durations resolved.'} · {zone} · {ARENA_RUN_MODEL}</p>
            </div>
          </details>
          {!basis && <p role="status" className="text-sm text-[var(--text-muted)]">Arena needs every video duration and a positive playlist total. Resolve the missing entries or choose another playlist.</p>}
          <div className="flex flex-wrap gap-2">
            <Btn type="submit" variant="primary" disabled={disabled || !basis || !validArenaSetup(setup)}>Create simulation</Btn>
            {cancel && <Btn type="button" variant="quiet" onClick={cancel}>Cancel</Btn>}
          </div>
        </form>
      </div>
    </Card>
  );
}

function ArenaDashboard({ run, readOnly, creating, basis, canArchive, remove, create, cancelCreate, onComplete }: {
  run: ArenaRun; readOnly: boolean; creating: boolean; basis: ArenaBasis | null; canArchive: boolean;
  remove: (run: ArenaRun) => void; create: (setup: ArenaSetup, basis: ArenaBasis, previous?: ArenaResult) => void;
  cancelCreate: () => void; onComplete: () => void;
}) {
  const s = useStore();
  const day = useDayTick(run.zone);
  const window = useMemo(() => {
    // A local day change advances both the user's and cohort's eligible window.
    return arenaWindow(run, Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, day]);
  const live = run.result === null;
  const evidence = useMemo(() => run.result ?? observeArena(run, {
    progress: s.progress, segments: s.segments, sessions: s.sessions,
  }, window), [run, s.progress, s.segments, s.sessions, window]);
  const total = useMemo(() => run.basis.entries.reduce((sum, item) => sum + item[3], 0), [run.basis]);
  const datesKey = evidence.dates.join(',');
  const observedDays = evidence.observedDays;
  const rivals = useMemo(() => generateArenaRivals(run, datesKey.split(','), observedDays, total), [run, datesKey, observedDays, total]);
  const board = useMemo(() => scoreArenaRun(run, evidence, rivals), [run, evidence, rivals]);
  const result = run.result ?? sealArenaResult(evidence, board);
  const sampledWindow = run.samples.some((sample) => sample.at === evidence.asOf);
  const capture = () => {
    if (run.result) return run.result;
    const current = observeArena(run, { progress: s.progress, segments: s.segments, sessions: s.sessions }, arenaWindow(run, Date.now()));
    const sameCohort = current.observedDays === observedDays && current.dates.join(',') === datesKey;
    return sealArenaResult(current, scoreArenaRun(run, current, sameCohort ? rivals : undefined));
  };
  const currentCapture = useRef(capture);
  currentCapture.current = capture;
  const active = run.state === 'active' || run.state === 'paused';
  const stateLabel = run.state !== 'active' ? run.state
    : window.scheduled ? 'scheduled' : window.expired ? 'ready to finalize' : 'active';
  const mismatch = run.result && (board.userScore !== run.result.score || board.userRank !== run.result.rank);
  const [compare, setCompare] = useState('');
  const rival = board.rows.find((item) => item.id === compare && !item.isUser);
  const reset = async () => {
    if (await confirmDialog({
      title: 'Reset “' + run.setup.name + '”?',
      body: 'The current result will be archived. A new practice run starts with the same seed, settings and playlist basis, and an empty rank history.',
      confirmLabel: 'Archive and restart',
    })) create(run.setup, run.basis, currentCapture.current());
  };
  const finish = async () => {
    if (await confirmDialog({
      title: run.setup.kind === 'fixed' ? 'Finalize fixed challenge?' : 'Complete practice simulation?',
      body: 'Save the current score and rank as a replayable result. A fixed challenge includes only closed calendar days.',
      confirmLabel: 'Save final result',
    })) {
      if (await s.updateArena({ type: 'complete', id: run.id, result: currentCapture.current() })) onComplete();
    }
  };
  const archive = () => s.updateArena({ type: 'archive', id: run.id });

  return (
    <div className="lq-workflow">
      {creating && <ArenaCreate basis={basis} replacing={active} disabled={readOnly || (active && !canArchive)}
        zone={s.prefs.timezone} cancel={cancelCreate}
        onCreate={(setup, source) => create(setup, source, active ? capture() : undefined)} />}
      <section className="lq-card" aria-labelledby="arena-run-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[var(--text-muted)]">{run.setup.kind === 'fixed' ? 'Fixed challenge' : 'Practice'} · {stateLabel}</p>
            <h3 id="arena-run-title" className="mt-1 break-words text-2xl font-semibold tracking-tight">{run.setup.name}</h3>
            <p className="mt-1 break-words text-sm text-[var(--text-muted)]">{run.basis.title} · {run.setup.opponents} fictional opponents</p>
          </div>
          {active && run.setup.kind === 'practice' && <Btn disabled={readOnly} onClick={() => s.updateArena(run.state === 'paused'
            ? { type: 'resume', id: run.id } : { type: 'pause', id: run.id, result: capture() })}>
            {run.state === 'paused' ? <><Play size={15} aria-hidden="true" /> Resume</> : <><Pause size={15} aria-hidden="true" /> Pause</>}
          </Btn>}
          {active && run.setup.kind === 'fixed' && window.expired && <Btn variant="primary" disabled={readOnly || !canArchive} onClick={finish}>Finalize challenge</Btn>}
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-4">
          <div><dt className="text-xs text-[var(--text-muted)]">Rank</dt><dd className="text-2xl font-semibold tabular-nums">{result.rank === null ? (active ? 'Calibrating' : 'Unranked') : '#' + result.rank}</dd></div>
          <div><dt className="text-xs text-[var(--text-muted)]">Score{result.rank === null && (active ? ' (provisional)' : ' (unranked)')}</dt><dd className="text-2xl font-semibold tabular-nums">{percent(result.score)}</dd></div>
          <div><dt className="text-xs text-[var(--text-muted)]">Qualifying days</dt><dd className="text-xl tabular-nums">{board.userQualifyingDays} / {run.setup.days}</dd></div>
          <div><dt className="text-xs text-[var(--text-muted)]">Ranked learners</dt><dd className="text-xl tabular-nums">{result.rankedCount}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-[var(--text-muted)]">{run.endsAt
          ? <>{dateLabel(run.startedAt, run.zone)} → {dateLabel(run.endsAt, run.zone)} · {run.zone} · {evidence.observedDays} of {run.setup.days} days closed</>
          : <>{evidence.dates[0]} → {evidence.dates.at(-1)} · {run.zone} · rolling closed days</>}
          {!live && <> · Evidence through {dateLabel(evidence.asOf, run.zone)}</>}
        </p>
        {mismatch && <p role="alert" className="mt-2 text-sm text-[var(--danger)]">Replay did not match the sealed result. The recorded rank and score are preserved.</p>}
        {!canArchive && active && <p role="status" className="mt-2 text-sm">History has reached {ARENA_HISTORY_LIMIT} runs. Delete a selected archived run before saving another.</p>}
      </section>

      <div className="lq-workflow-columns" data-layout="study">
        <div className="lq-workflow min-w-0">
          {!mismatch && <Leaderboard board={board} compare={compare} setCompare={setCompare} />}
          {!mismatch && rival && <section className="lq-workflow-section" aria-label="Rival comparison">
            <h4 className="lq-section-title">You and {rival.name}</h4>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              {result.rank !== null && rival.rank !== null && result.score !== null && rival.value !== null
                ? `Rank #${result.rank} vs #${rival.rank} · ${Math.abs(result.score - rival.value).toFixed(1)} percentage points apart`
                : 'Both learners need a ranked score to compare rank and score.'}
            </p>
            <p className="mt-1 text-sm">Coverage {percent((board.components.progress ?? 0) * 100)} vs {percent((rival.progress ?? 0) * 100)} · Qualifying days {board.userQualifyingDays} vs {rival.qualifyingDays}</p>
          </section>}
        </div>
        <section className="lq-card lq-workflow-band" aria-labelledby="arena-score-title">
          <h3 id="arena-score-title" className="lq-section-title">How you score</h3>
          <div className="mt-3 space-y-4">
            <div><p className="flex justify-between gap-2 text-sm"><span>Playlist coverage</span><b>{((board.components.progress ?? 0) * 75).toFixed(1)} / 75 points</b></p>
              <ProgressBar label="Playlist coverage" pct={(board.components.progress ?? 0) * 100} className="mt-1" /></div>
            <div><p className="flex justify-between gap-2 text-sm"><span>Consistency</span><b>{((board.components.consistency ?? 0) * 25).toFixed(1)} / 25 points</b></p>
              <ProgressBar label="Consistency" pct={(board.components.consistency ?? 0) * 100} className="mt-1" /></div>
          </div>
          <p className="mt-4 text-sm text-[var(--text-muted)]">
            {result.rank === null
              ? active
                ? `To rank, reach ${board.required} qualifying days and ${board.requiredObserved} calendar days. You have ${board.userQualifyingDays} and ${board.userObservedDays}.`
                : `Ranking required ${board.required} qualifying days and ${board.requiredObserved} calendar days. The sealed result recorded ${board.userQualifyingDays} and ${board.userObservedDays}.`
              : `Your score is higher than ${(board.percentile ?? 0).toFixed(0)}% of ranked fictional opponents.`}
          </p>
          <details className="mt-3 border-t border-[var(--border)] pt-3 text-sm">
            <summary className="cursor-pointer font-semibold">Qualifying days</summary>
            <p className="my-2 text-xs text-[var(--text-muted)]">A day needs 5 minutes of new verified coverage or a completed lesson, plus 10 minutes of recorded focus or observed playback. Estimated focus is excluded. Manual completion alone does not qualify a day.</p>
            <ul className="max-h-64 divide-y divide-[var(--border)] overflow-y-auto text-xs">
              {evidence.daily.slice(0, evidence.observedDays).map((item) => <li key={item.dateKey} className="py-2">
                <b>{item.dateKey}</b> · {isQualifyingArenaDay(item) ? 'Qualified' : 'Not qualified'}
                <p className="text-[var(--text-muted)]">{formatHuman(item.contentGainSec)} new coverage · {formatHuman(Math.max(item.focusSec, item.activePlaybackSec))} activity{item.completedVideo && ' · lesson completed'}</p>
              </li>)}
            </ul>
          </details>
          <details className="mt-3 border-t border-[var(--border)] pt-3 text-sm">
            <summary className="cursor-pointer font-semibold">Rank checkpoints</summary>
            {live && <Btn className="mt-2" variant="quiet" disabled={readOnly || sampledWindow || result.rank === null || run.samples.length >= ARENA_SAMPLE_LIMIT}
              onClick={() => {
                const saved = capture();
                if (saved.rank !== null && saved.score !== null) s.updateArena({
                  type: 'sample', id: run.id, sample: { at: saved.asOf, rank: saved.rank, of: saved.rankedCount, score: saved.score },
                });
              }}>{sampledWindow ? 'Rank recorded for this window' : 'Record current rank'}</Btn>}
            {!run.samples.length && <p className="mt-2 text-xs text-[var(--text-muted)]">No recorded checkpoints yet.</p>}
            <ol className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
              {run.samples.map((item) => <li key={item.at}>{dateLabel(item.at, run.zone)} · #{item.rank} of {item.of} · {percent(item.score)}</li>)}
            </ol>
          </details>
        </section>
      </div>

      <details className="lq-workflow-section">
        <summary className="cursor-pointer font-semibold">Simulation details and management</summary>
        <p className="mt-2 max-w-[72ch] text-sm text-[var(--text-muted)]">
          {run.model} · Seed {run.setup.seed} · {run.setup.difficulty}. The playlist basis and timezone are frozen.
          Ranks use full precision. Identical scores share a rank and leave the next place open. Coverage, consistency and rival identity order equal scores for display.
        </p>
        {run.setup.kind === 'practice' && <p className="mt-2 text-xs text-[var(--text-muted)]">Pause freezes the displayed result. Resume catches up with recorded learning.</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {active && run.setup.kind === 'practice' && <Btn disabled={readOnly || !canArchive} onClick={reset}><ArrowUp size={15} aria-hidden="true" /> Reset practice</Btn>}
          {active && <Btn disabled={readOnly || !canArchive} onClick={finish}><Flag size={15} aria-hidden="true" />
            {run.setup.kind === 'fixed' ? 'End fixed challenge' : 'Complete practice'}</Btn>}
          {run.state === 'completed' && <Btn disabled={readOnly} onClick={archive}><Lock size={15} aria-hidden="true" /> Archive result</Btn>}
          <Btn variant="danger" disabled={readOnly} onClick={() => void remove(run)}>Delete simulation</Btn>
        </div>
      </details>
    </div>
  );
}

function Leaderboard({ board, compare, setCompare }: { board: ArenaBoard; compare: string; setCompare: (id: string) => void }) {
  const size = 25;
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? board.rows.filter((item) => item.name.toLowerCase().includes(query)) : board.rows;
  }, [board.rows, search]);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages - 1);
  const start = current * size;
  const distribution = useMemo(() => {
    const counts = [0, 0, 0, 0, 0];
    for (const row of board.rows) {
      if (!row.isUser && row.value !== null) counts[Math.min(4, Math.floor(row.value / 20))]++;
    }
    return counts;
  }, [board.rows]);
  return (
    <section className="lq-card min-w-0" aria-labelledby="arena-board-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id="arena-board-title" className="lq-section-title">Leaderboard</h4>
        <Btn variant="quiet" onClick={() => {
          setSearch('');
          setPage(Math.floor(board.rows.findIndex((item) => item.isUser) / size));
        }}>My row</Btn>
      </div>
      <label className="relative my-2 block">
        <span className="sr-only">Search leaderboard</span>
        <Search aria-hidden="true" size={15} className="absolute left-3 top-3 text-[var(--text-muted)]" />
        <input className={inputCls + ' pl-8'} value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Search rival names…" />
      </label>
      {rows.length === 0 ? <p role="status" className="py-3 text-sm text-[var(--text-muted)]">No learners match that search.</p> : (
        <table className="lq-data-table w-full table-fixed text-left">
          <caption className="sr-only">Fictional Arena ranking. Select a rival to compare.</caption>
          <thead><tr className="border-b border-[var(--border)]">
            <th scope="col" className="w-12 px-2 py-2">Rank</th><th scope="col" className="px-2 py-2">Learner</th>
            <th scope="col" className="hidden w-24 px-2 py-2 text-right sm:table-cell">Coverage</th>
            <th scope="col" className="w-20 px-2 py-2 text-right">Score</th>
          </tr></thead>
          <tbody>{rows.slice(start, start + size).map((item) => (
            <tr key={item.id} className={`border-b border-[var(--border)] ${item.isUser ? 'bg-[var(--selected)] font-semibold' : compare === item.id ? 'bg-[var(--surface-soft)]' : ''}`}>
              <td className="px-2 py-2 tabular-nums">{item.rank ?? '—'}</td>
              <th scope="row" className="!bg-transparent px-2 py-2 !text-[var(--text)]">
                {item.isUser ? 'You' : <button type="button" aria-pressed={compare === item.id} className="w-full break-words text-left hover:underline"
                  onClick={() => setCompare(compare === item.id ? '' : item.id)}>{item.name}</button>}
              </th>
              <td className="hidden px-2 py-2 text-right tabular-nums sm:table-cell">{percent(item.progress === null ? null : item.progress * 100)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{item.value === null ? '—' : percent(item.value)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
        <span role="status">Page {current + 1} of {pages} · {rows.length} learners</span>
        <div className="flex gap-1">
          <Btn variant="quiet" aria-disabled={current === 0} className="aria-disabled:opacity-50" onClick={() => setPage(Math.max(0, current - 1))}>Previous</Btn>
          <Btn variant="quiet" aria-disabled={current + 1 === pages} className="aria-disabled:opacity-50" onClick={() => setPage(Math.min(pages - 1, current + 1))}>Next</Btn>
        </div>
      </div>
      <p className="mt-1 text-xs text-[var(--text-muted)]">A dash indicates an unranked learner. Select a fictional name to compare.</p>
      <details className="mt-3 border-t border-[var(--border)] pt-3">
        <summary className="cursor-pointer text-sm font-semibold">Ranked rival score distribution</summary>
        {distribution.every((value) => value === 0) ? <p className="mt-2 text-xs">No ranked rivals to summarize yet.</p> : (
          <dl className="mt-2 grid gap-2 text-xs">
            {distribution.map((value, index) => <div className="grid grid-cols-[5rem_minmax(0,1fr)_2.5rem] items-center gap-2" key={index}>
              <dt>{index * 20}–{index === 4 ? '100' : '<' + (index + 1) * 20}%</dt>
              <dd aria-hidden="true" className="h-2 rounded-full bg-[var(--surface-soft)]">
                <div className="h-full rounded-full bg-[var(--text-muted)]" style={{ width: 100 * value / Math.max(...distribution) + '%' }} />
              </dd>
              <dd className="text-right tabular-nums">{value}</dd>
            </div>)}
          </dl>
        )}
      </details>
    </section>
  );
}
