import { useState } from 'react';
import { Plus, Pause, Play, Trash2, Trophy } from 'lucide-react';
import { goalProgress, validateGoal, formatGoalTarget, attributeFocusByDay, formatHuman } from '../../domain/index.js';
import type { GoalMetric } from '../../domain/index.js';
import { useStore, goalCurrentValue } from '../../app/store.js';
import { useDayTick } from '../../app/dayTick.js';
import { Card, Btn, ProgressBar, Empty } from '../../components/ui/ui.js';
import { Dropdown } from '../../components/ui/Dropdown.js';
import { NumberField } from '../../components/ui/NumberField.js';

const METRICS: { id: GoalMetric; label: string; unit: string }[] = [
  { id: 'video-count', label: 'Videos completed', unit: 'videos' },
  { id: 'unique-content', label: 'Unique content covered', unit: 'minutes' },
  { id: 'focus-time', label: 'Focused study time', unit: 'minutes' },
  { id: 'playback-time', label: 'Active playback time', unit: 'minutes' },
  { id: 'checkpoint', label: 'Checkpoint reached', unit: '' },
];

export function Goals() {
  const s = useStore();
  const today = useDayTick(s.prefs.timezone);
  const [metric, setMetric] = useState<GoalMetric>('video-count');
  const [amount, setAmount] = useState<number | null>(5);
  const [pid, setPid] = useState<string>('');
  const [cpId, setCpId] = useState('');
  const [dated, setDated] = useState(true);
  const [errs, setErrs] = useState<string[]>([]);
  const ids = Object.keys(s.playlists);
  const dailyGoal = s.goals[today];
  const focusByDay = attributeFocusByDay(s.sessions, s.prefs.timezone);
  const todaySec = focusByDay.get(today) ?? 0;

  const focusCreate = () => {
    const form = document.getElementById('flex-goal-create');
    form?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
    form?.querySelector<HTMLElement>('button, input, select')?.focus({ preventScroll: true });
  };

  const toSeconds = (m: GoalMetric, v: number) =>
    m === 'video-count' ? v : Math.round(v * 60);

  const create = () => {
    const v = amount ?? NaN;
    const target = metric === 'checkpoint'
      ? (() => {
        const c = s.checkpoints.find((x) => x.id === cpId);
        return c ? c.end - c.start + 1 : NaN;
      })()
      : toSeconds(metric, v);
    const problems = validateGoal({ metric, target });
    if (metric === 'checkpoint' && !cpId) problems.push('Choose a checkpoint.');
    setErrs(problems);
    if (problems.length) return;
    const c = s.checkpoints.find((x) => x.id === cpId);
    s.saveFlexGoal({
      label: metric === 'checkpoint' && c ? `Reach: ${c.label}` : `${METRICS.find((m) => m.id === metric)?.label} — ${metric === 'video-count' ? target : `${amount ?? '?'}m`}${pid ? ` (${s.playlists[pid]?.title.slice(0, 24)})` : ' (all)'}${dated ? ` · ${today}` : ''}`,
      metric,
      target,
      playlistId: pid || null,
      checkpointId: metric === 'checkpoint' ? cpId : undefined,
      dateKey: dated ? today : null,
      paused: false,
    });
    setAmount(5);
  };

  return (
    <div className="lq-workflow">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="lq-section-title">Today's focus goal</h2>
          <a href="#/focus" className="text-xs text-[var(--text-muted)] underline hover:text-[var(--text)]">Manage in Focus →</a>
        </div>
        <p className="mt-1 text-xs text-[var(--text-muted)]">A calendar-day commitment to focused minutes, separate from the flexible goals below. Both are stored independently; neither rewrites the other.</p>
        {dailyGoal ? (
          <>
            <p className="mt-2 font-mono text-2xl tabular-nums text-[var(--text)]">
              {formatHuman(todaySec)}<span className="text-sm font-sans text-[var(--text-muted)]"> / {formatHuman(dailyGoal.targetFocusSec)}</span>
            </p>
            <ProgressBar label="Today's focus goal" pct={dailyGoal.targetFocusSec ? (todaySec / dailyGoal.targetFocusSec) * 100 : 0} tone="emerald" className="mt-1.5" />
            <p className="mt-1.5 text-xs text-[var(--text-muted)]">
              {todaySec >= dailyGoal.targetFocusSec ? 'Goal met.' : `${formatHuman(Math.max(0, dailyGoal.targetFocusSec - todaySec))} to go.`}
              {' '}Min viable: {formatHuman(dailyGoal.minViableSec)}.
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-[var(--text-muted)]">No focus goal set for today. <a className="underline hover:text-[var(--text)]" href="#/focus">Set one in Focus</a> — it drives your streak.</p>
        )}
      </Card>

      <Card id="flex-goal-create" tabIndex={-1} className="outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]">
        <h2 className="lq-section-title">Flexible goals</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Standalone targets with their own metric, scope and deadline. Progress comes from recorded learning activity.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Dropdown
            label="Metric"
            value={metric}
            options={METRICS.map((m) => ({ value: m.id, label: m.label }))}
            onChange={(v) => setMetric(v as GoalMetric)}
          />
          {metric === 'checkpoint' ? (
            <Dropdown
              label="Checkpoint"
              value={cpId}
              options={[
                { value: '', label: '— choose —' },
                ...s.checkpoints.map((c) => ({ value: c.id, label: c.label, hint: `${c.start}–${c.end}` })),
              ]}
              onChange={setCpId}
            />
          ) : (
            <NumberField
              label={`Target (${metric === 'video-count' ? 'videos' : 'minutes'})`}
              value={amount}
              min={1}
              allowEmpty
              live={false}
              onCommit={setAmount}
            />
          )}
          <Dropdown
            label="Scope"
            value={pid}
            options={[
              { value: '', label: 'All playlists' },
              ...ids.map((id) => ({ value: id, label: s.playlists[id].title.slice(0, 30) })),
            ]}
            onChange={setPid}
          />
        </div>
        <div className="lq-workflow-tools mt-3 justify-between">
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" checked={dated} onChange={(e) => setDated(e.target.checked)} /> Due today ({today}); uncheck for open-ended
          </label>
          <Btn variant="primary" onClick={create}><Plus size={14} /> Create goal</Btn>
        </div>
        {errs.map((e) => <p key={e} className="mt-1 text-xs text-red-800 dark:text-red-300">{e}</p>)}
      </Card>

      {s.flexGoals.length === 0 && <Empty title="No flexible goals" hint="Video count, unique content, focus time, playback time, or a checkpoint — scoped per playlist or day." action={<Btn variant="primary" onClick={focusCreate}><Plus size={14} /> Create your first goal</Btn>} />}
      {[...s.flexGoals].reverse().map((g) => {
        const current = goalCurrentValue(g, {
          progress: s.progress, segments: s.segments, sessions: s.sessions,
          playSessions: s.playSessions, checkpoints: s.checkpoints, playlists: s.playlists, prefs: s.prefs,
        });
        const p = goalProgress(g, current, { todayKey: today });
        return (
          <Card key={g.id} className="lq-workflow-section">
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-auto font-semibold">{g.label}</p>
              <StatusBadge status={p.status} />
              {!g.achievedAt && !g.paused && <Btn onClick={() => s.updateFlexGoal(g.id, { paused: true })}><Pause size={13} /> Pause</Btn>}
              {g.paused && <Btn onClick={() => s.updateFlexGoal(g.id, { paused: false })}><Play size={13} /> Resume</Btn>}
              <Btn variant="quiet" className="lq-icon-button lq-delete-trigger" aria-label={'Delete goal ' + g.label} onClick={() => s.deleteFlexGoal(g.id)}><Trash2 size={16} aria-hidden="true" /></Btn>
            </div>
            <p className="mt-1 font-mono text-sm">{displayCurrent(g.metric, current)} / {formatGoalTarget(g.metric, g.target)} · {p.remaining > 0 ? `${displayCurrent(g.metric, p.remaining)} to go` : 'done'}</p>
            <div className="mt-1"><ProgressBar label="Goal progress" pct={Math.min(100, p.pct)} tone={p.status === 'achieved' || p.status === 'exceeded' ? 'emerald' : 'neutral'} /></div>
            {g.achievedAt && <p className="mt-1 flex items-center gap-1 text-xs text-emerald-800 dark:text-emerald-300"><Trophy size={12} /> Achieved {new Date(g.achievedAt).toLocaleString()} — exact earning activity above. No duplicate completion events.</p>}
            {p.status === 'missed' && <p className="mt-1 text-xs text-[var(--text-muted)]">Missed — adjust the target or set a fresh goal. Past progress is kept.</p>}
          </Card>
        );
      })}
    </div>
  );
}

function displayCurrent(metric: GoalMetric, v: number): string {
  if (metric === 'video-count' || metric === 'checkpoint') return `${v} videos`;
  const h = Math.floor(v / 3600);
  const m = Math.round((v % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function StatusBadge({ status }: { status: string }) {
  const color = status === 'achieved' || status === 'exceeded'
    ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
    : status === 'missed' ? 'bg-red-500/15 text-red-800 dark:text-red-300'
      : status === 'paused' ? 'bg-[var(--surface-hover)] text-[var(--text)]'
        : 'bg-[var(--surface-soft)] text-[var(--text)]';
  return <span className={`rounded-full px-2 py-0.5 text-[11px] ${color}`}>{status}</span>;
}
