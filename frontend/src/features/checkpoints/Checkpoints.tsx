import React, { useState } from 'react';
import { Plus, Pencil, Trash2, Settings2 } from 'lucide-react';
import { validateRange, computeRangeProgress, rangeDuration, formatSecondsHHMMSS } from '../../domain/index.js';
import { useStore } from '../../app/store.js';
import { promptDialog } from '../../components/ui/dialog.js';
import { notify } from '../../services/notifications/notify.js';
import { Card, Btn, Field, inputCls, ProgressBar, Empty } from '../../components/ui/ui.js';
import { NumberField } from '../../components/ui/NumberField.js';

export function Checkpoints() {
  const s = useStore();
  const snap = s.activeId ? s.playlists[s.activeId] : undefined;
  const [label, setLabel] = useState('');
  const [a, setA] = useState(1);
  const [b, setB] = useState(8);
  const [err, setErr] = useState<string | null>(null);
  if (!snap) return <Empty title="No active playlist" hint="Add one to create checkpoints." />;
  const N = snap.entries.length;
  const list = s.checkpoints.filter((c) => c.playlistId === snap.playlistId);
  const ranges = s.ranges.filter((r) => r.playlistId === snap.playlistId);

  const create = () => {
    try {
      validateRange(a, b, N);
      setErr(null);
      s.saveCheckpoint({ playlistId: snap.playlistId, label: label.trim() || `Videos ${a}–${b}`, start: a, end: b });
      setLabel('');
    } catch (e: any) {
      setErr(e?.message);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-base font-bold">New checkpoint <span className="font-normal text-slate-400">(any valid range in 1–{N})</span></h2>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Field label="Label"><input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={`Videos ${a}–${b}`} /></Field>
          <NumberField label="Start" value={a} min={1} max={N} live={false} onCommit={(v) => { if (v !== null) setA(v); }} />
          <NumberField label="End" value={b} min={1} max={N} live={false} onCommit={(v) => { if (v !== null) setB(v); }} />
          <div className="flex items-end"><Btn variant="primary" onClick={create}><Plus size={14} /> Add</Btn></div>
        </div>
        {err && <p className="mt-1 text-sm text-red-300">{err}</p>}
      </Card>

      {list.length === 0 && (
        <Card>
          <h3 className="text-sm font-bold">What is a checkpoint?</h3>
          <p className="mt-1 text-sm text-slate-400">A milestone defined by an inclusive video range — finishing it triggers a celebration with your exact numbers.</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-300">
            <li>Label it (e.g. <span className="font-mono">Videos 1–8</span>).</li>
            <li>Pick start/end positions within 1–{N}.</li>
            <li>Press <b>Add</b> — progress bars, remaining work, and completion appear here automatically.</li>
          </ol>
          <p className="mt-1 text-xs text-slate-500">Only completing the range's videos completes a checkpoint. Nothing is pre-created.</p>
        </Card>
      )}
      {list.map((c) => {
        let body: React.ReactNode;
        try {
          validateRange(c.start, c.end, N);
          const rp = computeRangeProgress(snap, c.start, c.end, s.progress);
          const r = rangeDuration(snap, c.start, c.end);
          body = (
            <>
              <p className="text-xs text-slate-400">{rp.done}/{rp.count} videos · {r.isComplete ? `${formatSecondsHHMMSS(r.totalSec)} total` : 'duration incomplete'} {c.completedAt ? '· ✓ complete' : ''}</p>
              <div className="mt-1"><ProgressBar pct={rp.count ? (rp.done / rp.count) * 100 : 0} tone={c.completedAt ? 'emerald' : 'violet'} /></div>
            </>
          );
        } catch {
          body = <p className="text-xs text-amber-300">Needs review — playlist length changed (now N={N}). Edit or delete; original {c.start}–{c.end} preserved.</p>;
        }
        return (
          <Card key={c.id}>
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-auto font-semibold">{c.label} <span className="text-xs font-normal text-slate-400">({c.start}–{c.end})</span></p>
              <Btn onClick={async () => { const l = await promptDialog({ title: 'Rename checkpoint', initial: c.label }); if (l) s.renameCheckpoint(c.id, l); }}><Pencil size={14} /></Btn>
              <Btn onClick={async () => {
                const ns = await promptDialog({ title: 'Edit checkpoint range', body: `Playlist length N=${N}. Start first.`, initial: String(c.start) });
                if (ns === null) return;
                const ne = await promptDialog({ title: 'Edit checkpoint range', body: `End position (${ns}–${N}).`, initial: String(c.end) });
                if (ne === null) return;
                try {
                  validateRange(Number(ns), Number(ne), N);
                  s.editCheckpoint(c.id, Number(ns), Number(ne));
                } catch (e: any) {
                  notify(e?.message ?? 'Invalid range.');
                }
              }}><Settings2 size={14} /></Btn>
              <Btn variant="danger" onClick={() => s.deleteCheckpoint(c.id)}><Trash2 size={14} /></Btn>
            </div>
            <div className="mt-1">{body}</div>
          </Card>
        );
      })}

      <Card>
        <h3 className="text-sm font-bold">Saved ranges ({ranges.length})</h3>
        {ranges.map((r) => (
          <div key={r.id} className="flex items-center gap-2 border-t border-white/5 py-1.5 text-sm">
            <span className="mr-auto truncate">{r.label} <span className="text-slate-500">({r.start}–{r.end})</span></span>
            <Btn onClick={async () => { const l = await promptDialog({ title: 'Rename range', initial: r.label }); if (l) s.renameRange(r.id, l); }}><Pencil size={13} /></Btn>
            <Btn variant="danger" onClick={() => s.deleteRange(r.id)}><Trash2 size={13} /></Btn>
          </div>
        ))}
        {ranges.length === 0 && <p className="text-xs text-slate-500">Save explorations from Library for one-click totals.</p>}
      </Card>
    </div>
  );
}

/* ---------------- Focus: planner + timer ---------------- */
