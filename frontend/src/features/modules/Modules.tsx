import { useState } from 'react';
import { Plus, Trash2, Pencil, ChevronUp, ChevronDown } from 'lucide-react';
import { validateRange, sumEntries, formatSecondsHHMMSS, buildEntryProgressIndex, isProgressComplete } from '../../domain/index.js';
import { useStore } from '../../app/store.js';
import { promptDialog } from '../../components/ui/dialog.js';
import { notify } from '../../services/notifications/notify.js';
import { Card, Btn, inputCls, ProgressBar, Empty } from '../../components/ui/ui.js';

/** Parse "1-8, 10, 12-15" into sorted positions within 1..N. */
export function parsePositions(input: string, n: number): number[] {
  const set = new Set<number>();
  for (const part of input.split(',')) {
    const t = part.trim();
    if (!t) continue;
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(t);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      validateRange(a, b, n);
      for (let i = a; i <= b; i++) set.add(i);
    } else if (/^\d+$/.test(t)) {
      const v = Number(t);
      if (v < 1 || v > n) throw new Error(`Position ${v} is outside 1–${n}.`);
      set.add(v);
    } else {
      throw new Error(`Cannot parse "${t}" — use numbers or ranges like 1-8.`);
    }
  }
  return [...set].sort((a, b) => a - b);
}

/** Compress positions back to "1-8, 10" for editing. */
export function serializePositions(positions: number[]): string {
  const sorted = [...positions].sort((a, b) => a - b);
  const parts: string[] = [];
  let run: number[] = [];
  const flush = () => {
    if (run.length === 0) return;
    parts.push(run.length === 1 ? String(run[0]) : `${run[0]}-${run[run.length - 1]}`);
    run = [];
  };
  for (const p of sorted) {
    if (run.length && p === run[run.length - 1] + 1) run.push(p);
    else {
      flush();
      run = [p];
    }
  }
  flush();
  return parts.join(', ');
}

export function Modules() {
  const s = useStore();
  const snap = s.activeId ? s.playlists[s.activeId] : undefined;
  const [name, setName] = useState('');
  const [positions, setPositions] = useState('');
  const [err, setErr] = useState<string | null>(null);
  if (!snap) return <Empty title="No active playlist" hint="Add one to organize modules." />;
  const mods = s.modules.filter((m) => m.playlistId === snap.playlistId);

  const create = () => {
    try {
      if (!name.trim()) {
        setErr('Give the module a name first.');
        return;
      }
      const pos = parsePositions(positions, snap.entries.length);
      if (pos.length === 0) {
        setErr('Assign at least one video position.');
        return;
      }
      setErr(null);
      s.saveModule({ playlistId: snap.playlistId, name: name.trim(), positions: pos });
      setName('');
      setPositions('');
      notify(`Module created with ${pos.length} videos.`);
    } catch (e: any) {
      setErr(e?.message ?? 'Invalid positions.');
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-base font-bold">Modules <span className="font-normal text-slate-400">(optional grouping over playlist positions)</span></h2>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input className={inputCls} placeholder="Module name (you choose — never auto-assigned)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Module name" />
          <input className={inputCls} placeholder={`Positions, e.g. 1-8, 10 (1–${snap.entries.length})`} value={positions} onChange={(e) => setPositions(e.target.value)} aria-label="Module positions" />
          <Btn variant="primary" onClick={create} disabled={!name.trim()}><Plus size={14} /> Create</Btn>
        </div>
        {err && <p className="mt-1 text-sm text-red-300">{err}</p>}
      </Card>
      {mods.length === 0 && (
        <Card>
          <h3 className="text-sm font-bold">What is a module?</h3>
          <p className="mt-1 text-sm text-slate-400">
            A module is a group of playlist videos <i>you</i> define — e.g. “JavaScript Fundamentals” or “Practice
            Exercises”. LearnQuest never claims to know a playlist's real syllabus; modules only group what you assign.
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-300">
            <li>Name it above (e.g. <span className="font-mono">HTML Basics</span>).</li>
            <li>List positions like <span className="font-mono">1-8, 10</span> (valid: 1–{snap.entries.length}).</li>
            <li>Press <b>Create</b> — progress, rename, reassign, and reorder controls appear on each module card.</li>
          </ol>
          <p className="mt-1 text-xs text-slate-500">Videos may stay unassigned. Nothing is created until you press Create — no fake chapters.</p>
        </Card>
      )}
      {mods.map((m, idx) => {
        const entries = snap.entries.filter((e) => m.positions.includes(e.position));
        const sum = sumEntries(entries);
        const progressIndex = buildEntryProgressIndex(snap, s.progress);
        const done = m.positions.filter((p) => isProgressComplete(progressIndex.get(p))).length;
        return (
          <Card key={m.id}>
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-auto font-semibold">{m.name} <span className="text-xs font-normal text-slate-400">· {m.positions.length} videos · {done} done · {sum.isComplete ? formatSecondsHHMMSS(sum.totalSec) : `${formatSecondsHHMMSS(sum.totalSec)} +?`}</span></p>
              <Btn onClick={() => s.moveModule(m.id, -1)} disabled={idx === 0} aria-label={`Move ${m.name} up`}><ChevronUp size={14} /></Btn>
              <Btn onClick={() => s.moveModule(m.id, 1)} disabled={idx === mods.length - 1} aria-label={`Move ${m.name} down`}><ChevronDown size={14} /></Btn>
              <Btn onClick={async () => { const l = await promptDialog({ title: 'Rename module', initial: m.name }); if (l) s.saveModule({ ...m, name: l }, m.id); }} aria-label={`Rename ${m.name}`}><Pencil size={14} /></Btn>
              <Btn onClick={async () => {
                const v = await promptDialog({ title: `Assign videos — ${m.name}`, body: `Positions within 1–${snap.entries.length}, e.g. 1-8, 10.`, initial: serializePositions(m.positions), confirmLabel: 'Save' });
                if (v === null) return;
                try {
                  s.saveModule({ ...m, positions: parsePositions(v, snap.entries.length) }, m.id);
                } catch (e: any) {
                  notify(e?.message ?? 'Invalid positions.');
                }
              }}><Pencil size={14} /><span className="text-xs">videos</span></Btn>
              <Btn onClick={() => s.deleteModule(m.id)} variant="danger" aria-label={`Delete ${m.name}`}><Trash2 size={14} /></Btn>
            </div>
            <ProgressBar pct={m.positions.length ? (done / m.positions.length) * 100 : 0} tone="cyan" />
            <p className="mt-1 text-xs text-slate-500">Positions: {m.positions.slice(0, 20).join(', ')}{m.positions.length > 20 ? ` … +${m.positions.length - 20}` : ''}</p>
          </Card>
        );
      })}
    </div>
  );
}
