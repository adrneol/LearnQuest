import { useRef, useState } from 'react';
import { Plus, RefreshCw, Download, Upload, Trash2, Settings2, EllipsisVertical, Search } from 'lucide-react';
import { computePlaylistProgress, rangeDuration, computeRangeProgress, toCsv, XP_RULES, snapshotCompleteness } from '../../domain/index.js';
import { useStore } from '../../app/store.js';
import { confirmDialog, promptDialog } from '../../components/ui/dialog.js';
import { PopupShell } from '../../components/ui/popup.js';
import { fetchPlaylistFromServer, snapshotToCsv, parseImportFile } from '../../services/api/playlistApi.js';
import { Card, Btn, Field, inputCls } from '../../components/ui/ui.js';

export function Reports() {
  const s = useStore();
  const snap = s.activeId ? s.playlists[s.activeId] : undefined;
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const add = async (refresh = false) => {
    setBusy(true);
    setMsg(null);
    try {
      // Refresh bypasses a fresh backend cache entry (`refresh=1`) so the
      // button always revalidates upstream; plain Add reuses valid cache.
      const { snapshot, cached } = await fetchPlaylistFromServer(url || (snap ? snap.playlistId : ''), { refresh });
      s.addSnapshot(snapshot);
      setMsg(refresh ? `Refreshed ${snapshot.title} (N=${snapshot.entries.length}${cached ? ', served from cache' : ', fresh from YouTube'}). Progress preserved; check flagged ranges.` : `Added ${snapshot.title} (N=${snapshot.entries.length}${cached ? ' — served from cache' : ''}).`);
      setUrl('');
    } catch (e: any) {
      setMsg(e?.message ?? 'Fetch failed.');
    } finally {
      setBusy(false);
    }
  };

  const download = (name: string, text: string, type = 'application/json') => {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const allIds = Object.keys(s.playlists);
  const combined = allIds.reduce((acc, id) => {
    const p = computePlaylistProgress(s.playlists[id], s.progress);
    acc.done += p.completedCount;
    acc.total += p.n;
    return acc;
  }, { done: 0, total: 0 });

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-base font-bold">Playlists ({allIds.length}) · combined {combined.done}/{combined.total} videos</h2>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input className={inputCls} placeholder="New playlist URL or ID" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="New playlist URL" />
          <Btn variant="primary" onClick={() => add(false)} disabled={busy || !url.trim()}><Plus size={14} /> Add</Btn>
          <Btn onClick={() => add(true)} disabled={busy || (!url.trim() && !snap)}><RefreshCw size={14} /> Refresh active</Btn>
        </div>
        {msg && <p className="mt-1 text-sm text-slate-300">{msg}</p>}
        <PlaylistTable ids={allIds} />
      </Card>

      <Card>
        <h3 className="text-sm font-bold">Exports (same verified engine as dashboard — no PDFs)</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          <Btn onClick={async () => download(`learnquest-backup-${Date.now()}.json`, await s.exportBackup())}><Download size={14} /> Backup JSON</Btn>
          <Btn disabled={!snap} onClick={() => snap && download(`${snap.playlistId}-videos.csv`, snapshotToCsv(snap, new Set(Object.keys(s.progress))))}><Download size={14} /> Videos CSV</Btn>
          <Btn disabled={!snap} onClick={() => {
            if (!snap) return;
            const rows = s.sessions.map((x) => [x.id, x.playlistId ?? '', x.startedAt, x.activeSec, Math.round(x.activeSec / 60), x.note ?? '']);
            download('sessions.csv', toCsv(rows, ['id', 'playlistId', 'startedAt', 'activeSec', 'activeMin', 'note']), 'text/csv');
          }}><Download size={14} /> Sessions CSV</Btn>
          <Btn disabled={!snap} onClick={() => {
            if (!snap) return;
            const rows = s.checkpoints.filter((c) => c.playlistId === snap.playlistId).map((c) => {
              try {
                const r = rangeDuration(snap, c.start, c.end);
                const rp = computeRangeProgress(snap, c.start, c.end, s.progress);
                return [c.label, c.start, c.end, r.isComplete ? r.totalSec : `INCOMPLETE:${r.totalSec}`, rp.done, rp.count, c.completedAt ?? ''];
              } catch {
                return [c.label, c.start, c.end, 'NEEDS_REVIEW', '', '', ''];
              }
            });
            download('checkpoints.csv', toCsv(rows as any, ['label', 'start', 'end', 'totalSec', 'done', 'count', 'completedAt']), 'text/csv');
          }}><Download size={14} /> Checkpoints CSV</Btn>
        </div>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-white/5 px-3 py-2 text-sm">
            <Upload size={14} /> Restore backup
            <input type="file" accept="application/json" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                await s.importBackup(await f.text());
                setMsg('Backup restored and validated.');
              } catch (err: any) {
                setMsg('Restore failed: ' + (err?.message ?? 'invalid file'));
              }
            }} />
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-white/5 px-3 py-2 text-sm">
            <Upload size={14} /> Import snapshot JSON
            <input type="file" accept="application/json" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                s.addSnapshot(parseImportFile(await f.text()));
                setMsg('Snapshot imported (labelled imported, not freshly fetched).');
              } catch (err: any) {
                setMsg('Import failed: ' + (err?.message ?? 'invalid file'));
              }
            }} />
          </label>
        </div>
      </Card>

      <Card>
        <h3 className="flex items-center gap-1.5 text-sm font-bold"><Settings2 size={15} /> Preferences</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <Field label="Timezone (streaks & day reset)">
            <input className={inputCls} value={s.prefs.timezone} onChange={(e) => s.setPrefs({ timezone: e.target.value })} placeholder="e.g. Europe/Berlin" />
          </Field>
          <Field label="Default session (min)">
            <input type="number" className={inputCls} value={s.prefs.sessionLenMin} min={5} onChange={(e) => s.setPrefs({ sessionLenMin: Number(e.target.value) })} />
          </Field>
          <label className="flex items-end gap-2 text-sm">
            <input type="checkbox" checked={s.prefs.reducedMotion} onChange={(e) => s.setPrefs({ reducedMotion: e.target.checked })} /> Reduce motion
          </label>
        </div>
        <div className="mt-3 rounded-xl bg-white/5 p-3 text-xs text-slate-400">
          <p className="font-semibold text-slate-300">XP rules (deterministic, deduped)</p>
          <p>video {XP_RULES.videoDone} · exercise {XP_RULES.exerciseDone} · code {XP_RULES.codeReproduced} · built {XP_RULES.builtExample} · revision {XP_RULES.revisionDone} · checkpoint {XP_RULES.checkpointDone} · 30min focus {XP_RULES.focusSession30min} · study day {XP_RULES.studyDay} · achievement 25. Re-clicks never double-award (ledger dedup keys).</p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn onClick={() => s.clearCacheOnly()}>Clear cached metadata (keep progress)</Btn>
          {!confirmClear ? (
            <Btn variant="danger" onClick={() => setConfirmClear(true)}><Trash2 size={14} /> Clear ALL data…</Btn>
          ) : (
            <>
              <span className="text-sm text-red-300">Really delete everything locally?</span>
              <Btn variant="danger" onClick={() => { s.clearAllData(); setConfirmClear(false); }}>Yes, delete</Btn>
              <Btn onClick={() => setConfirmClear(false)}>Cancel</Btn>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

/** Compact, scalable playlist manager: search, status badges, one overflow menu per row. */
function PlaylistTable({ ids }: { ids: string[] }) {
  const s = useStore();
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const menuAnchor = useRef<HTMLDivElement>(null);

  const rows = ids
    .map((id) => {
      const p = s.playlists[id];
      const m = s.meta[id];
      const prog = computePlaylistProgress(p, s.progress);
      const comp = snapshotCompleteness(p);
      return { id, p, m, prog, comp, title: m?.customTitle ?? p.title };
    })
    .filter((r) => (showArchived || !r.m?.archived) && r.title.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(b.id === s.activeId) - Number(a.id === s.activeId) || a.title.localeCompare(b.title));

  if (ids.length === 0) return <p className="mt-2 text-xs text-slate-500">No playlists yet.</p>;

  const closeMenu = () => setMenuFor(null);
  const act = async (kind: 'rename' | 'archive' | 'remove', row: (typeof rows)[number]) => {
    closeMenu();
    if (kind === 'rename') {
      const t = await promptDialog({ title: 'Rename playlist (local label)', initial: row.m?.customTitle ?? row.p.title });
      if (t) s.renamePlaylist(row.id, t);
    } else if (kind === 'archive') {
      s.setArchived(row.id, !row.m?.archived);
    } else {
      const ok = await confirmDialog({
        title: `Remove "${row.p.title}"?`,
        body: 'Progress for this playlist is deleted. Other playlists are unaffected.',
        confirmLabel: 'Remove',
        danger: true,
      });
      if (ok) s.removePlaylist(row.id);
    }
  };

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[160px] flex-1">
          <Search size={14} className="absolute left-2.5 top-2.5 text-slate-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search playlists…" aria-label="Search playlists" className={`${inputCls} pl-8`} />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-400">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> archived
        </label>
        <span className="text-xs text-slate-500">{rows.length}/{ids.length} shown</span>
      </div>
      <ul className="mt-1 max-h-80 space-y-1 overflow-auto pr-0.5">
        {rows.map((r) => (
          <li
            key={r.id}
            className={`flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-sm ${r.id === s.activeId ? 'bg-violet-600/20' : 'bg-white/5'}`}
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${r.comp.unresolved > 0 ? 'bg-amber-400' : 'bg-emerald-400'}`} title={r.comp.unresolved > 0 ? `${r.comp.unresolved} unresolved` : 'complete metadata'} />
            <button className="min-w-0 flex-1 truncate text-left" onClick={() => s.setActive(r.id)} title={r.title}>
              <span className={`font-medium ${r.id === s.activeId ? 'text-violet-200' : 'text-slate-200'}`}>{r.title}</span>
              <span className="ml-2 whitespace-nowrap font-mono text-[11px] text-slate-500">
                N={r.p.entries.length} · {r.prog.completedCount}/{r.prog.n} · {new Date(r.p.fetchedAt).toLocaleDateString()}
                {r.m?.archived ? ' · archived' : ''}
              </span>
            </button>
            <div ref={menuFor === r.id ? menuAnchor : undefined} className="shrink-0">
              <button
                onClick={() => setMenuFor(menuFor === r.id ? null : r.id)}
                aria-label={`Actions for ${r.title}`}
                aria-expanded={menuFor === r.id}
                aria-haspopup="menu"
                className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-slate-200"
              >
                <EllipsisVertical size={16} />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <PopupShell anchor={() => menuAnchor.current} open={menuFor !== null} onClose={closeMenu}>
        <div role="menu" className="p-1">
          {menuFor && (() => {
            const row = rows.find((x) => x.id === menuFor)!;
            return (
              <>
                <MenuItem label="Rename…" onPick={() => act('rename', row)} />
                <MenuItem label={row.m?.archived ? 'Unarchive' : 'Archive'} onPick={() => act('archive', row)} />
                <MenuItem label="Remove…" danger onPick={() => act('remove', row)} />
              </>
            );
          })()}
        </div>
      </PopupShell>
    </div>
  );
}

function MenuItem({ label, danger, onPick }: { label: string; danger?: boolean; onPick: () => void }) {
  return (
    <button
      role="menuitem"
      onClick={onPick}
      className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm ${danger ? 'text-red-300 hover:bg-red-500/15' : 'text-slate-200 hover:bg-white/10'}`}
    >
      {label}
    </button>
  );
}
