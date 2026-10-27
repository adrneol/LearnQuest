import { useMemo, useState } from 'react';
import { Archive, AlertTriangle, ArchiveRestore, Play, Settings2, Trash2, X } from 'lucide-react';
import { useStore } from '../../app/store.js';
import { Card, Btn, Field, inputCls } from '../../components/ui/ui.js';
import { notify } from '../../services/notifications/notify.js';

interface DialogState {
  playlistId: string;
  title: string;
  choice: 'archive' | 'delete';
  confirmText: string;
  busy: boolean;
  error: string | null;
}

function countsFor(state: ReturnType<typeof useStore>, playlistId: string) {
  const progress = Object.values(state.progress).filter((p) => p.playlistId === playlistId);
  const checkpointIds = new Set(state.checkpoints.filter((c) => c.playlistId === playlistId).map((c) => c.id));
  const goalIds = new Set(
    state.flexGoals
      .filter((g) => g.playlistId === playlistId || (g.checkpointId ? checkpointIds.has(g.checkpointId) : false))
      .map((g) => g.id),
  );
  const focusKeys = new Set(
    state.sessions
      .filter((session) => session.playlistId === playlistId)
      .map((session) => `focus:${session.clientId || session.id}`),
  );
  const xp = state.xp.filter((x) => {
    if (
      x.dedupKey.startsWith(`done:${playlistId}:`)
      || x.dedupKey.startsWith(`rev:${playlistId}:`)
      || x.dedupKey.startsWith(`ach:${playlistId}:`)
      || x.dedupKey.startsWith(`code:${playlistId}:`)
      || x.dedupKey.startsWith(`ex:${playlistId}:`)
      || x.dedupKey.startsWith(`built:${playlistId}:`)
    ) return true;
    if (x.dedupKey.startsWith('cp:')) return checkpointIds.has(x.dedupKey.slice(3).split(':')[0]);
    if (x.dedupKey.startsWith('goal:')) return goalIds.has(x.dedupKey.slice(5).split(':')[0]);
    if (x.dedupKey.startsWith('focus:')) return focusKeys.has(x.dedupKey);
    return false;
  }).length;
  return {
    videos: state.playlists[playlistId]?.entries.length ?? 0,
    completed: progress.filter((p) => p.status === 'done' && p.completedAt && !p.orphaned).length,
    annotations: progress.filter((p) => p.notes || p.keyConcepts || p.questions || p.reviewHistory?.length).length,
    focusSessions: state.sessions.filter((s) => s.playlistId === playlistId).length,
    playbackSegments: state.segments.filter((s) => s.playlistId === playlistId).length,
    playSessions: state.playSessions.filter((s) => s.playlistId === playlistId).length,
    checkpoints: state.checkpoints.filter((c) => c.playlistId === playlistId).length,
    ranges: state.ranges.filter((r) => r.playlistId === playlistId).length,
    modules: state.modules.filter((m) => m.playlistId === playlistId).length,
    goals: goalIds.size,
    xp,
  };
}

export function PlaylistManager() {
  const s = useStore();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const archiveIds = useMemo(() => Object.keys(s.meta).filter((id) => s.meta[id]?.archived && s.playlists[id]), [s.meta, s.playlists]);
  const activeIds = useMemo(() => Object.keys(s.playlists).filter((id) => !s.meta[id]?.archived), [s.meta, s.playlists]);

  const open = (playlistId: string) => {
    const title = s.meta[playlistId]?.customTitle ?? s.playlists[playlistId]?.title ?? 'Untitled playlist';
    setMessage(null);
    setDialog({ playlistId, title, choice: 'archive', confirmText: '', busy: false, error: null });
  };

  const apply = async () => {
    if (!dialog) return;
    setDialog({ ...dialog, busy: true, error: null });
    try {
      if (dialog.choice === 'archive') {
        await s.archivePlaylistManaged(dialog.playlistId);
        setMessage(`"${dialog.title}" was removed from the dashboard and archived. All learning data is preserved.`);
      } else {
        if (dialog.confirmText !== dialog.title) throw new Error('Type the exact playlist title to confirm permanent deletion.');
        await s.deletePlaylistManaged(dialog.playlistId, dialog.title);
        setMessage(`"${dialog.title}" and its reliably attributable account-owned records were permanently deleted.`);
      }
      setDialog(null);
    } catch (e: any) {
      setDialog((d) => d ? { ...d, busy: false, error: e?.message ?? 'The action did not complete. Nothing was reported as successful.' } : d);
    }
  };

  const counts = dialog ? countsFor(s, dialog.playlistId) : null;

  return (
    <Card>
      <h2 className="flex items-center gap-1.5 text-sm font-bold"><Settings2 size={16} /> Your playlists</h2>
      <p className="mt-1 text-xs text-slate-500">
        Remove a playlist from the dashboard (archived, all learning data kept) or permanently delete it and its attributable data.
        Archived playlists are excluded from this dashboard's active totals and the active-playlist selector.
      </p>
      {message && <p role="status" className="mt-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-2 text-sm text-emerald-200">{message}</p>}
      <ul className="mt-2 divide-y divide-white/5">
        {activeIds.map((id) => {
          const title = s.meta[id]?.customTitle ?? s.playlists[id]?.title ?? id;
          const isActive = s.activeId === id;
          return (
            <li key={id} className="flex flex-wrap items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{isActive ? '▶ ' : ''}{title}</p>
                <p className="truncate text-[11px] text-slate-500">{id} · {s.playlists[id]?.entries.length ?? 0} videos · {s.progress && Object.values(s.progress).filter((p) => p.playlistId === id && p.status === 'done' && p.completedAt).length} completed</p>
              </div>
              {!isActive && <Btn onClick={() => s.setActive(id)}><Play size={13} /> Open</Btn>}
              <Btn onClick={() => open(id)}><Archive size={13} /> Manage / Remove</Btn>
            </li>
          );
        })}
        {activeIds.length === 0 && <li className="py-3 text-sm text-slate-500">No active playlists. Add one from Library or Reports.</li>}
      </ul>
      {archiveIds.length > 0 && (
        <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-2.5">
          <h3 className="flex items-center gap-1.5 text-xs font-bold text-slate-300"><Archive size={14} /> Archived playlists ({archiveIds.length})</h3>
          <p className="mt-0.5 text-[11px] text-slate-500">Restoring keeps the same records and never recreates XP.</p>
          <ul className="mt-1 divide-y divide-white/5">
            {archiveIds.map((id) => (
              <li key={id} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-sm text-slate-300">{s.meta[id]?.customTitle ?? s.playlists[id]?.title ?? id}</span>
                <Btn onClick={async () => {
                  try {
                    await s.restorePlaylistManaged(id);
                    setMessage('Playlist restored with its preserved learning records.');
                  } catch (e: any) {
                    notify(e?.message ?? 'Restore failed.');
                  }
                }}><ArchiveRestore size={13} /> Restore</Btn>
                <Btn variant="danger" onClick={() => open(id)}><Trash2 size={13} /> Manage / Remove</Btn>
              </li>
            ))}
          </ul>
        </div>
      )}

      {dialog && counts && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-3 backdrop-blur-sm" role="presentation" onClick={() => { if (!dialog.busy) setDialog(null); }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Remove ${dialog.title}`}
            className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#141830] p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold">Remove or delete this playlist?</h2>
                <p className="mt-1 break-words text-sm text-slate-300"><b>{dialog.title}</b></p>
                <p className="break-all text-[11px] text-slate-500">{dialog.playlistId}</p>
              </div>
              <button type="button" onClick={() => { if (!dialog.busy) setDialog(null); }} aria-label="Close" className="rounded-xl p-1.5 hover:bg-white/10"><X size={17} /></button>
            </div>

            <div className="mt-3 grid gap-2">
              <button
                type="button"
                aria-pressed={dialog.choice === 'archive'}
                onClick={() => setDialog({ ...dialog, choice: 'archive', error: null })}
                className={`rounded-xl border p-3 text-left ${dialog.choice === 'archive' ? 'border-cyan-400/60 bg-cyan-500/10' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold"><Archive size={15} /> Remove from dashboard (keep my learning data)</span>
                <span className="mt-1 block text-xs text-slate-400">
                  Archives this playlist. Progress, notes, review history, Focus sessions, playback evidence, checkpoints, saved ranges, modules, scoped goals, achievements, and XP are preserved.
                  Restore it from Archived playlists without duplicate entries or recreated XP.
                </span>
              </button>
              <button
                type="button"
                aria-pressed={dialog.choice === 'delete'}
                onClick={() => setDialog({ ...dialog, choice: 'delete', error: null })}
                className={`rounded-xl border p-3 text-left ${dialog.choice === 'delete' ? 'border-red-400/60 bg-red-500/10' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold text-red-200"><Trash2 size={15} /> Permanently delete playlist and all its learning data</span>
                <span className="mt-1 block text-xs text-slate-400">Destructive and cannot be undone through LearnQuest. The public YouTube playlist itself is not changed.</span>
              </button>
            </div>

            <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-2.5 text-[11px] text-slate-400">
              <p className="font-semibold text-slate-300">Account-owned records associated with this playlist</p>
              <p className="mt-0.5">{counts.videos} videos · {counts.completed} completed · {counts.annotations} with learning records · {counts.focusSessions} Focus sessions · {counts.playbackSegments} playback segments · {counts.playSessions} play sessions</p>
              <p>{counts.checkpoints} checkpoints · {counts.ranges} saved ranges · {counts.modules} modules · {counts.goals} scoped goals · {counts.xp} attributable XP entries</p>
            </div>

            {dialog.choice === 'delete' && (
              <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-2.5">
                <p className="flex items-start gap-1.5 text-xs text-red-200"><AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  This permanently removes the playlist snapshot, stable-entry progress and annotations, review history, playback and Focus evidence, checkpoints, saved ranges, modules, queue records, playlist-scoped goals, and XP entries that can be reliably attributed to this playlist.
                  Genuine account-wide settings, preferences, day goals, and unattributable XP are preserved, and other playlists are not changed.
                </p>
                <div className="mt-2">
                  <Field label={`Type "${dialog.title}" to confirm`}>
                    <input className={inputCls} value={dialog.confirmText} onChange={(e) => setDialog({ ...dialog, confirmText: e.target.value })} autoComplete="off" />
                  </Field>
                </div>
              </div>
            )}

            {dialog.error && <p role="alert" className="mt-2 rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-sm text-red-200">{dialog.error}</p>}
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Btn onClick={() => setDialog(null)} disabled={dialog.busy}>Cancel</Btn>
              <Btn
                variant={dialog.choice === 'delete' ? 'danger' : 'primary'}
                onClick={apply}
                disabled={dialog.busy || (dialog.choice === 'delete' && dialog.confirmText !== dialog.title)}
              >
                {dialog.busy ? 'Working…' : dialog.choice === 'archive' ? 'Archive playlist (keep data)' : 'Permanently delete playlist'}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
