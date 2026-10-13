import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useStore } from '../../app/store.js';
import { Dropdown } from '../../components/ui/Dropdown.js';
import { notify } from '../../services/notifications/notify.js';
import { Card, Btn, Field, inputCls, Empty } from '../../components/ui/ui.js';

export function Revision() {
  const s = useStore();
  const snap = s.activeId ? s.playlists[s.activeId] : undefined;
  const [f, setF] = useState<'all' | 'low' | 'todo-ex' | 'questions' | 'overdue'>('all');
  const [flagPos, setFlagPos] = useState('');
  if (!snap) return <Empty title="No active playlist" hint="Add one to track learning quality." />;
  const today = new Date().toISOString().slice(0, 10);

  const items = snap.entries.map((e) => ({ e, r: s.progress[`${snap.playlistId}::${e.position}`] })).filter(({ r }) => r && (r.completedAt || r.confidence || r.needsRevision || r.questions || r.notes));
  const filtered = items.filter(({ r }) => {
    if (!r) return false;
    if (f === 'low') return (r.confidence ?? 5) <= 2;
    if (f === 'todo-ex') return r.needsRevision || !r.exerciseDone;
    if (f === 'questions') return !!(r.questions && r.questions.trim());
    if (f === 'overdue') return !!r.revisionDate && r.revisionDate < today;
    return true;
  });

  const markRevised = (pk: string) => {
    s.updateRecord(pk, { needsRevision: false, revisionDate: null } as any);
    (s as any).updateRecord(pk, { revisionDoneAt: new Date().toISOString() } as any);
    s.awardXp('revision', 4, `rev:${pk}:${Date.now()}`);
  };

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-base font-bold">Revision queue <span className="font-normal text-slate-400">(completion ≠ mastery)</span></h2>
        <p className="mt-1 text-sm text-slate-400">
          Lessons land here when flagged <b>needs revision</b> (Player, Library, or below), rated confidence 1–2,
          given a revision date, or left with open questions. Confidence and notes decide priority; nothing here
          claims mastery. Marking a lesson revised removes its flag and records the review.
        </p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="sm:max-w-[220px] sm:flex-1">
            <Field label={`Flag video by position (1–${snap.entries.length})`}>
              <input value={flagPos} onChange={(e) => setFlagPos(e.target.value)} placeholder="e.g. 12" inputMode="numeric" className={inputCls} aria-label="Position to flag for revision" />
            </Field>
          </div>
          <Btn
            variant="primary"
            onClick={() => {
              const p = Number(flagPos);
              if (!Number.isInteger(p) || p < 1 || p > snap.entries.length) {
                notify(`Position must be 1–${snap.entries.length}.`);
                return;
              }
              const entry = snap.entries.find((e) => e.position === p)!;
              const pk = `${snap.playlistId}::${p}`;
              s.updateRecord(pk, {
                playlistId: snap.playlistId, position: p, videoId: entry.videoId,
                status: s.progress[pk]?.status ?? 'in-progress', completedAt: s.progress[pk]?.completedAt ?? null,
                needsRevision: true,
              } as any);
              setFlagPos('');
              notify(`Video #${p} flagged for revision.`);
            }}
          >
            <Plus size={14} /> Flag for revision
          </Btn>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {(['all', 'low', 'todo-ex', 'questions', 'overdue'] as const).map((v) => (
            <button key={v} onClick={() => setF(v)} className={`rounded-full px-3 py-1 text-xs ${f === v ? 'bg-cyan-600 text-white' : 'bg-white/5 text-slate-300'}`}>{v}</button>
          ))}
        </div>
      </Card>
      {filtered.length === 0 && (
        <Card>
          <h3 className="text-sm font-bold">Queue clear — nothing needs revision right now</h3>
          <p className="mt-1 text-sm text-slate-400">
            Revision tracking is for lessons you have completed but want to revisit. A blank queue means no lesson
            currently carries a revision signal — not a broken feature.
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-300">
            <li>Flag a lesson with <b>Needs revision</b> in the Player, the Library table, or the position box above.</li>
            <li>Rate <b>confidence 1–5</b>, add notes / key concepts / open questions, and optionally set a <b>revision date</b>.</li>
            <li>Filter by low confidence, open exercises, questions, or overdue dates to prioritize.</li>
            <li>Press <b>Mark revised</b> after a real review — the flag clears, the review is recorded, and the lesson leaves the queue.</li>
          </ol>
          <p className="mt-1 text-xs text-slate-500">Only your actions create queue entries. No sample history is ever fabricated.</p>
        </Card>
      )}
      {filtered.map(({ e, r }) => {
        const pk = `${snap.playlistId}::${e.position}`;
        return (
          <Card key={pk}>
            <p className="text-sm font-semibold">#{e.position} {e.title}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Dropdown
                label="Confidence (1–5)"
                value={r?.confidence ? String(r.confidence) : ''}
                options={[
                  { value: '', label: '—' },
                  ...[1, 2, 3, 4, 5].map((v) => ({ value: String(v), label: `${v} / 5` })),
                ]}
                onChange={(v) => s.updateRecord(pk, { confidence: v ? (Number(v) as any) : undefined } as any)}
              />
              <Field label="Revision date"><input type="date" className={inputCls} value={r?.revisionDate ?? ''} onChange={(ev) => s.updateRecord(pk, { revisionDate: ev.target.value || null } as any)} /></Field>
              <Field label="Notes"><textarea className={inputCls} rows={2} value={r?.notes ?? ''} onChange={(ev) => s.updateRecord(pk, { notes: ev.target.value })} /></Field>
              <Field label="Key concepts"><textarea className={inputCls} rows={2} value={r?.keyConcepts ?? ''} onChange={(ev) => s.updateRecord(pk, { keyConcepts: ev.target.value })} /></Field>
              <Field label="Questions to investigate"><textarea className={inputCls} rows={2} value={r?.questions ?? ''} onChange={(ev) => s.updateRecord(pk, { questions: ev.target.value })} /></Field>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <label className="flex items-center gap-1"><input type="checkbox" checked={!!r?.codeReproduced} onChange={(ev) => { s.updateRecord(pk, { codeReproduced: ev.target.checked } as any); if (ev.target.checked) s.awardXp('code', 5, `code:${pk}`); }} /> code reproduced</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={!!r?.exerciseDone} onChange={(ev) => { s.updateRecord(pk, { exerciseDone: ev.target.checked } as any); if (ev.target.checked) s.awardXp('ex', 5, `ex:${pk}`); }} /> exercise done</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={!!r?.builtExample} onChange={(ev) => { s.updateRecord(pk, { builtExample: ev.target.checked } as any); if (ev.target.checked) s.awardXp('built', 8, `built:${pk}`); }} /> built example</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={!!r?.needsRevision} onChange={(ev) => s.updateRecord(pk, { needsRevision: ev.target.checked } as any)} /> needs revision</label>
                <Btn onClick={() => markRevised(pk)}>Mark revised</Btn>
              </div>
            </div>
          </Card>
        );
      })}
      <p className="text-[11px] text-slate-600">Tip: click a video's circle in Library to create its record, then add notes here.</p>
    </div>
  );
}

/* ---------------- Reports: playlists, exports, prefs ---------------- */
