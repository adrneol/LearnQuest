import { useCallback, useRef, useState } from 'react';
import { Plus, RefreshCw, Download, Upload, Trash2, Settings2, EllipsisVertical, Search, AlertTriangle } from 'lucide-react';
import {
  computePlaylistProgress, rangeDuration, computeRangeProgress, toCsv, XP_RULES, snapshotCompleteness,
  completedEntryKeys,
} from '../../domain/index.js';
import { useStore } from '../../app/store.js';
import { confirmDialog, promptDialog } from '../../components/ui/dialog.js';
import { PopupShell } from '../../components/ui/popup.js';
import { moveMenuFocus } from '../../components/ui/menuKeys.js';
import { fetchPlaylistFromServer, snapshotToCsv, parseImportFile } from '../../services/api/playlistApi.js';
import { Card, Btn, inputCls } from '../../components/ui/ui.js';
import { TimezonePicker } from '../../components/ui/TimezonePicker.js';
import { NumberField } from '../../components/ui/NumberField.js';
import { validateBackup } from '../../services/persistence/backup.js';
import { notify } from '../../services/notifications/notify.js';

export function Reports() {
  const s = useStore();
  const snap = s.activeId ? s.playlists[s.activeId] : undefined;
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const add = async (refresh = false) => {
    // Add reads only the dedicated Add field; Refresh always targets the
    // active playlist and never an unrelated URL typed into that field.
    const target = refresh ? snap?.playlistId ?? '' : url.trim();
    if (!target) {
      setMsg(refresh ? 'Select an active playlist before refreshing.' : 'Enter a playlist URL or ID to add.');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      // Refresh bypasses a fresh backend cache entry (`refresh=1`) so the
      // button always revalidates upstream; plain Add reuses valid cache.
      const { snapshot, cached } = await fetchPlaylistFromServer(target, { refresh });
      if (!snapshot.entries.length) {
        setMsg('That playlist has no accessible entries; nothing was added or marked complete.');
        return;
      }
      s.addSnapshot(snapshot);
      setMsg(refresh ? `Refreshed ${snapshot.title} (N=${snapshot.entries.length}${cached ? ', served from cache' : ', fresh from YouTube'}). Progress follows video identity; check flagged ranges.` : `Added ${snapshot.title} (N=${snapshot.entries.length}${cached ? ' — served from cache' : ''}).`);
      if (!refresh) setUrl('');
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
        <h2 className="lq-section-title">Playlists ({allIds.length}) · combined {combined.done}/{combined.total} videos</h2>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input className={inputCls} placeholder="New playlist URL or ID" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="New playlist URL" />
          <Btn variant="primary" onClick={() => add(false)} disabled={busy || !url.trim()}><Plus size={14} /> Add</Btn>
          <Btn onClick={() => add(true)} disabled={busy || !snap}><RefreshCw size={14} /> Refresh active{snap ? ` (#${snap.entries.length})` : ''}</Btn>
        </div>
        {msg && <p className="mt-1 text-sm text-[var(--text)]">{msg}</p>}
        <PlaylistTable ids={allIds} />
      </Card>

      <Card>
        <h3 className="lq-section-title">Exports (same verified engine as dashboard — no PDFs)</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          <Btn onClick={async () => download(`learnquest-backup-${Date.now()}.json`, await s.exportBackup())}><Download size={14} /> Backup JSON</Btn>
          <Btn disabled={!snap} onClick={() => snap && download(`${snap.playlistId}-videos.csv`, snapshotToCsv(snap, completedEntryKeys(snap, s.progress)))}><Download size={14} /> Videos CSV</Btn>
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
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[var(--surface-soft)] px-3 py-2 text-sm">
            <Upload size={14} /> Restore backup
            <input type="file" accept="application/json" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                const text = await f.text();
                const check = validateBackup(text);
                if (!check.ok) {
                  setMsg('Restore rejected — nothing was changed. ' + check.errors.slice(0, 5).join(' '));
                  return;
                }
                // Safe recovery path: download the current state before the
                // atomic replace, then require explicit confirmation.
                download(`learnquest-pre-restore-${Date.now()}.json`, await s.exportBackup());
                const ok = await confirmDialog({
                  title: 'Replace all local learning data?',
                  body: 'The validated backup will replace every collection in one transaction. A pre-restore JSON backup was downloaded first.',
                  confirmLabel: 'Restore',
                  danger: true,
                });
                if (!ok) {
                  setMsg('Restore cancelled; current data was not changed.');
                  return;
                }
                const result = await s.importBackup(text);
                setMsg('Backup restored and validated.' + (result.warnings.length ? ' ' + result.warnings.join(' ') : ''));
              } catch (err: any) {
                setMsg('Restore failed; current data was preserved. ' + (err?.message ?? 'Invalid file.'));
              }
            }} />
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[var(--surface-soft)] px-3 py-2 text-sm">
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

      <OrphanReview />

      <Card>
        <h3 className="flex items-center gap-1.5 text-sm font-bold"><Settings2 size={15} /> Preferences</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <TimezonePicker value={s.prefs.timezone} onChange={(tz) => s.setPrefs({ timezone: tz })} />
          <NumberField
            label="Default session (min)"
            value={s.prefs.sessionLenMin}
            onCommit={(v) => { if (v !== null) s.setPrefs({ sessionLenMin: v }); }}
            min={1}
            max={600}
          />
          <label className="flex items-end gap-2 text-sm">
            <input type="checkbox" checked={s.prefs.reducedMotion} onChange={(e) => s.setPrefs({ reducedMotion: e.target.checked })} /> Reduce motion
          </label>
        </div>
        <div className="mt-3 rounded-lg bg-[var(--surface-soft)] p-3 text-xs text-[var(--text-muted)]">
          <p className="font-semibold text-[var(--text)]">XP rules (deterministic, deduped)</p>
          <p>video {XP_RULES.videoDone} · exercise {XP_RULES.exerciseDone} · code {XP_RULES.codeReproduced} · built {XP_RULES.builtExample} · revision {XP_RULES.revisionDone} · checkpoint {XP_RULES.checkpointDone} · 30min focus {XP_RULES.focusSession30min} · study day {XP_RULES.studyDay} · achievement 25. Re-clicks never double-award (ledger dedup keys).</p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn onClick={() => s.clearCacheOnly()}>Clear cached metadata (keep progress)</Btn>
          <Btn variant="quiet" className="lq-delete-trigger" onClick={async () => {
            const confirmed = await confirmDialog({
              title: 'Clear all learning data?',
              body: 'This deletes all learning data and resets learning preferences. Export a backup first if you want to retain a copy.',
              confirmLabel: 'Clear learning data',
              danger: true,
            });
            if (confirmed) {
              try { await s.clearAllData(); }
              catch (error) { notify(error instanceof Error ? error.message : 'Could not clear learning data.'); }
            }
          }}><Trash2 size={16} aria-hidden="true" /> Clear all data…</Btn>
        </div>
      </Card>
    </div>
  );
}

/**
 * Records whose occurrence disappeared after a playlist change. They are
 * preserved with all annotations, excluded from every completion count, and
 * only removed by an explicit user action.
 */
function OrphanReview() {
  const s = useStore();
  const entries = Object.entries(s.progress).filter(([, rec]) => rec.orphaned);
  if (entries.length === 0) return null;
  return (
    <Card className="border-amber-500/30">
      <h3 className="flex items-center gap-1.5 text-sm font-bold text-amber-800 dark:text-amber-200"><AlertTriangle size={15} /> Playlist changes need review ({entries.length})</h3>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        These records were preserved because their video occurrence was removed or replaced. They are not counted as
        completion for any current video. Review the notes, then delete the orphan if it is no longer useful.
      </p>
      <ul className="mt-2 max-h-64 space-y-1 overflow-auto text-xs">
        {entries.map(([key, rec]) => {
          const snap = s.playlists[rec.playlistId];
          const entry = snap?.entries.find((e) => e.entryId === rec.entryId);
          return (
            <li key={key} className="flex items-start gap-2 rounded-lg bg-[var(--surface-soft)] p-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[var(--text)]">
                  {snap ? (s.meta[snap.playlistId]?.customTitle ?? snap.title) : rec.playlistId} · #{rec.position} {entry?.title ?? rec.videoId}
                </span>
                <span className="block truncate text-[var(--text-faint)]">
                  {rec.reviewReason === 'video-mismatch' ? 'video replaced at this position' : rec.reviewReason === 'removed' ? 'removed from playlist' : 'unmatched'}
                  {' · '}{rec.completedAt ? `completed ${new Date(rec.completedAt).toLocaleDateString()}` : 'no completion'}
                  {rec.notes ? ` · notes: ${rec.notes}` : ''}
                </span>
              </span>
              <button
                className="shrink-0 text-[var(--text-faint)] hover:text-red-800 dark:text-red-300"
                aria-label={`Delete orphaned record ${rec.videoId}`}
                onClick={() => s.deleteProgressRecord(key)}
              >
                <Trash2 size={14} />
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Compact, scalable playlist manager: search, status badges, one overflow menu per row. */
function PlaylistTable({ ids }: { ids: string[] }) {
  const s = useStore();
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const menuAnchor = useRef<HTMLButtonElement | null>(null);
  const focusMenu = useCallback((element: HTMLDivElement | null) => {
    moveMenuFocus(element, 'Home');
  }, []);

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

  if (ids.length === 0) return <p className="mt-2 text-xs text-[var(--text-faint)]">No playlists yet.</p>;

  const menuRow = rows.find((row) => row.id === menuFor);
  const closeMenu = () => {
    setMenuFor(null);
    menuAnchor.current?.focus({ preventScroll: true });
  };
  const act = async (kind: 'rename' | 'archive' | 'remove', row: (typeof rows)[number]) => {
    closeMenu();
    if (kind === 'rename') {
      const t = await promptDialog({ title: 'Rename playlist (local label)', initial: row.m?.customTitle ?? row.p.title });
      if (t) s.renamePlaylist(row.id, t);
    } else if (kind === 'archive') {
      try {
        if (row.m?.archived) await s.restorePlaylistManaged(row.id);
        else await s.archivePlaylistManaged(row.id);
      } catch (e: any) {
        notify(e?.message ?? 'The playlist archive action did not complete.');
      }
    } else {
      // Permanent deletion lives in the Dashboard manager so it always uses
      // the two-choice flow, typed-title confirmation, and backend protocol.
      window.location.hash = '/dash';
      notify('Manage removal in Dashboard → Your playlists. Archive keeps all data; permanent deletion requires typing the exact title.');
    }
  };

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[160px] flex-1">
          <Search size={14} className="absolute left-2.5 top-2.5 text-[var(--text-faint)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search playlists…" aria-label="Search playlists" className={`${inputCls} pl-8`} />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> archived
        </label>
        <span className="text-xs text-[var(--text-faint)]">{rows.length}/{ids.length} shown</span>
      </div>
      <ul className="mt-1 max-h-80 space-y-1 overflow-auto pr-0.5">
        {rows.map((r) => (
          <li
            key={r.id}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm ${r.id === s.activeId ? 'bg-[var(--surface-hover)]' : 'bg-[var(--surface-soft)]'}`}
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${r.comp.unresolved > 0 ? 'bg-amber-400' : 'bg-emerald-400'}`} title={r.comp.unresolved > 0 ? `${r.comp.unresolved} unresolved` : 'complete metadata'} />
            <button className="min-w-0 flex-1 truncate text-left" onClick={() => s.setActive(r.id)} title={r.title}>
              <span className={`font-medium ${r.id === s.activeId ? 'text-[var(--text)]' : 'text-[var(--text)]'}`}>{r.title}</span>
              <span className="ml-2 whitespace-nowrap font-mono text-[11px] text-[var(--text-faint)]">
                N={r.p.entries.length} · {r.prog.completedCount}/{r.prog.n} · {new Date(r.p.fetchedAt).toLocaleDateString()}
                {r.m?.archived ? ' · archived' : ''}
              </span>
            </button>
            <div className="shrink-0">
              <Btn variant="quiet"
                onClick={(event) => {
                  menuAnchor.current = event.currentTarget;
                  setMenuFor(menuFor === r.id ? null : r.id);
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                  event.preventDefault();
                  menuAnchor.current = event.currentTarget;
                  setMenuFor(r.id);
                }}
                aria-label={`Actions for ${r.title}`}
                aria-expanded={menuFor === r.id}
                aria-haspopup="menu"
                className="lq-icon-button"
              >
                <EllipsisVertical size={17} aria-hidden="true" />
              </Btn>
            </div>
          </li>
        ))}
      </ul>
      <PopupShell anchor={() => menuAnchor.current} open={Boolean(menuRow)} onClose={closeMenu} minWidth={208}>
        {menuRow && (
          <div ref={focusMenu} role="menu" aria-label={'Actions for ' + menuRow.title}
            className="overflow-auto overscroll-contain p-1" onKeyDown={(event) => {
              if (event.key === 'Tab') closeMenu();
              if (moveMenuFocus(event.currentTarget, event.key)) event.preventDefault();
            }}>
            <MenuItem label="Rename…" onPick={() => act('rename', menuRow)} />
            <MenuItem label={menuRow.m?.archived ? 'Unarchive' : 'Archive'} onPick={() => act('archive', menuRow)} />
            <div role="separator" className="my-1 border-t border-[var(--border)]" />
            <MenuItem label="Manage removal…" danger onPick={() => act('remove', menuRow)} />
          </div>
        )}
      </PopupShell>
    </div>
  );
}

function MenuItem({ label, danger, onPick }: { label: string; danger?: boolean; onPick: () => void }) {
  return (
    <button
      role="menuitem"
      onClick={onPick}
      className={`lq-menu-item ${danger ? 'lq-menu-item--danger' : ''}`}
    >
      {label}
    </button>
  );
}
