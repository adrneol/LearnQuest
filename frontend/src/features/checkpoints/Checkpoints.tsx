import React, { useState } from 'react';
import { CheckCircle2, Library, Pencil, Plus, Settings2, Target, Trash2 } from 'lucide-react';
import {
  validateRange, computeRangeProgress, rangeDuration, formatSecondsHHMMSS,
  parseCheckpointRange, checkpointName, autoCheckpointLabel, labelForEditedRange,
} from '../../domain/index.js';
import { useStore } from '../../app/store.js';
import { promptDialog } from '../../components/ui/dialog.js';
import { notify } from '../../services/notifications/notify.js';
import { Card, Btn, Field, inputCls, ProgressBar, Empty } from '../../components/ui/ui.js';

export function Checkpoints() {
  const s = useStore();
  const snap = s.activeId ? s.playlists[s.activeId] : undefined;
  const [rangeText, setRangeText] = useState('');
  const [customName, setCustomName] = useState('');
  const [touched, setTouched] = useState(false);
  if (!snap) return <Empty title="No active playlist" hint="Add one to create checkpoints." />;
  const N = snap.entries.length;
  const list = s.checkpoints.filter((c) => c.playlistId === snap.playlistId);
  const ranges = s.ranges.filter((r) => r.playlistId === snap.playlistId);
  const parsed = parseCheckpointRange(rangeText, N);
  const previewName = parsed.ok ? checkpointName(parsed.range, customName) : null;

  const create = () => {
    setTouched(true);
    if (!parsed.ok) return;
    s.saveCheckpoint({
      playlistId: snap.playlistId,
      label: checkpointName(parsed.range, customName),
      start: parsed.range.start,
      end: parsed.range.end,
    });
    setRangeText('');
    setCustomName('');
    setTouched(false);
  };

  const editRange = async (c: typeof list[number]) => {
    const raw = await promptDialog({
      title: 'Edit checkpoint range',
      body: `Enter one inclusive range within 1–${N}, for example 1-8 or 103.`,
      initial: `${c.start}-${c.end}`,
    });
    if (raw === null) return;
    const next = parseCheckpointRange(raw, N);
    if (!next.ok) {
      notify(next.error);
      return;
    }
    const nextLabel = labelForEditedRange(c.label, c.start, c.end, next.range.start, next.range.end);
    s.editCheckpoint(c.id, next.range.start, next.range.end);
    if (nextLabel !== c.label) s.renameCheckpoint(c.id, nextLabel);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <h2 className="flex items-center gap-1.5 text-sm font-bold"><Target size={16} /> Checkpoint</h2>
          <p className="mt-1 text-xs text-slate-400">
            A learning milestone over an inclusive video range. Progress is tracked, completion is recognized when the full eligible range is done, and the established milestone/XP behavior applies.
          </p>
        </Card>
        <Card>
          <h2 className="flex items-center gap-1.5 text-sm font-bold"><Library size={16} /> Saved range</h2>
          <p className="mt-1 text-xs text-slate-400">
            A reusable duration/range calculation saved from Library. It does not independently represent completion or award milestone XP.
          </p>
        </Card>
      </div>

      <Card>
        <h2 className="text-base font-bold">New checkpoint <span className="font-normal text-slate-400">(one range within 1–{N})</span></h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:items-end">
          <Field label="Video range">
            <input
              className={inputCls}
              value={rangeText}
              onChange={(e) => { setRangeText(e.target.value); setTouched(true); }}
              placeholder="1-8"
              aria-label="Video range"
              inputMode="text"
            />
          </Field>
          <Field label="Custom name (optional)">
            <input
              className={inputCls}
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="e.g. JavaScript fundamentals"
              aria-label="Custom checkpoint name (optional)"
              maxLength={200}
            />
          </Field>
          <Btn variant="primary" onClick={create} disabled={!parsed.ok}>
            <Plus size={14} /> Add checkpoint
          </Btn>
        </div>
        <div className="mt-2 rounded-xl border border-white/10 bg-black/20 p-2.5 text-sm">
          {parsed.ok ? (
            <>
              <p className="text-slate-200">This will create <b>{previewName}</b> for videos <b>{parsed.range.start}–{parsed.range.end}</b> inclusive ({parsed.range.end - parsed.range.start + 1} video{parsed.range.end - parsed.range.start === 0 ? '' : 's'}).</p>
              <p className="mt-0.5 text-[11px] text-slate-500">Saved name: {previewName}. A custom name replaces the generated label; the range is not entered twice.</p>
            </>
          ) : (
            <p className={`text-xs ${touched ? 'text-amber-200' : 'text-slate-500'}`}>
              {touched ? parsed.error : 'Type a range such as 1-8, 9–16, or one position such as 103. The display name is generated automatically.'}
            </p>
          )}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Accepted: <span className="font-mono">1-8</span>, <span className="font-mono">1 – 8</span>, <span className="font-mono">1–8</span>, <span className="font-mono">103</span>.
          Reversed, fractional, negative, malformed, or out-of-bounds ranges are rejected without clamping.
        </p>
      </Card>

      {list.length === 0 && (
        <Card>
          <h3 className="flex items-center gap-1.5 text-sm font-bold"><CheckCircle2 size={15} /> No checkpoints yet</h3>
          <p className="mt-1 text-sm text-slate-400">
            Enter one video range above, for example <span className="font-mono text-slate-200">1-8</span>. The name <b>Videos 1–8</b> appears automatically; use the optional custom name only when you want a descriptive milestone.
          </p>
          <p className="mt-1 text-xs text-slate-500">Only completing the range's videos completes a checkpoint. Nothing is pre-created.</p>
        </Card>
      )}

      {list.map((c) => {
        let body: React.ReactNode;
        try {
          validateRange(c.start, c.end, N);
          const rp = computeRangeProgress(snap, c.start, c.end, s.progress);
          const r = rangeDuration(snap, c.start, c.end);
          const auto = c.label === autoCheckpointLabel(c.start, c.end);
          body = (
            <>
              <p className="text-xs text-slate-400">
                {rp.done}/{rp.count} videos · {r.isComplete ? `${formatSecondsHHMMSS(r.totalSec)} total` : 'duration incomplete'} {c.completedAt ? '· ✓ complete' : ''}
                {!auto ? <span className="ml-1 text-slate-500">· custom name</span> : null}
              </p>
              <div className="mt-1"><ProgressBar pct={rp.count ? (rp.done / rp.count) * 100 : 0} tone={c.completedAt ? 'emerald' : 'violet'} /></div>
            </>
          );
        } catch {
          body = <p className="text-xs text-amber-300">Needs review — playlist length changed (now N={N}). Edit or delete; original {c.start}–{c.end} preserved.</p>;
        }
        return (
          <Card key={c.id}>
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-auto min-w-0 truncate font-semibold">{c.label} <span className="text-xs font-normal text-slate-400">({c.start}–{c.end})</span></p>
              <Btn title="Rename checkpoint" onClick={async () => { const l = await promptDialog({ title: 'Rename checkpoint', initial: c.label }); if (l && l.trim()) s.renameCheckpoint(c.id, l.trim()); }}><Pencil size={14} /></Btn>
              <Btn title="Edit checkpoint range" onClick={() => { void editRange(c); }}><Settings2 size={14} /></Btn>
              <Btn variant="danger" title="Delete checkpoint" onClick={() => s.deleteCheckpoint(c.id)}><Trash2 size={14} /></Btn>
            </div>
            <div className="mt-1">{body}</div>
          </Card>
        );
      })}

      <Card>
        <h3 className="flex items-center gap-1.5 text-sm font-bold"><Library size={15} /> Saved ranges ({ranges.length})</h3>
        <p className="mt-1 text-xs text-slate-500">
          These are duration calculations saved from Library. They are not checkpoints, do not track completion here, and do not award milestone XP.
        </p>
        {ranges.map((r) => (
          <div key={r.id} className="flex items-center gap-2 border-t border-white/5 py-1.5 text-sm">
            <span className="mr-auto truncate">{r.label} <span className="text-slate-500">({r.start}–{r.end})</span></span>
            <Btn onClick={async () => { const l = await promptDialog({ title: 'Rename saved range', initial: r.label }); if (l) s.renameRange(r.id, l); }}><Pencil size={13} /></Btn>
            <Btn variant="danger" onClick={() => s.deleteRange(r.id)}><Trash2 size={13} /></Btn>
          </div>
        ))}
        {ranges.length === 0 && <p className="mt-2 text-xs text-slate-500">No saved ranges yet. Open Library, choose a range, and save it as a reusable duration calculation.</p>}
      </Card>
    </div>
  );
}
