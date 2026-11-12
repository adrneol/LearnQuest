import { useRef, useState } from 'react';
import { Plus, Upload } from 'lucide-react';
import { fetchPlaylistFromServer, parseImportFile } from '../../services/api/playlistApi.js';
import { useStore } from '../../app/store.js';
import { Btn, inputCls } from '../../components/ui/ui.js';

export interface AddPlaylistProps {
  /** Stable id for the URL input (used for label association/focus targets). */
  inputId?: string;
  autoFocus?: boolean;
  /** Called after a snapshot is accepted, e.g. to navigate away (Onboarding). */
  onAdded?: (snapshot: import('../../types/index.js').PlaylistSnapshot) => void;
}

/**
 * Canonical playlist-add experience. Used by Library (primary), Onboarding
 * and anywhere a caller needs the same validated flow — never a parallel
 * implementation. Reuses the existing fetch service, snapshot parser and the
 * store's `addSnapshot` action; no calculation or persistence logic lives here.
 */
export function AddPlaylist({ inputId = 'add-playlist-input', autoFocus = false, onAdded }: AddPlaylistProps) {
  const s = useStore();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const add = async () => {
    const target = url.trim();
    if (!target || busy) return;
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      // Plain add reuses a valid backend cache entry; it never revalidates
      // upstream like an explicit refresh does.
      const { snapshot, cached } = await fetchPlaylistFromServer(target, { refresh: false });
      if (!snapshot.entries.length) {
        setErr('That playlist has no accessible entries; nothing was added.');
        return;
      }
      s.addSnapshot(snapshot);
      setMsg(`Added ${snapshot.title} (N=${snapshot.entries.length}${cached ? ' — served from the last fetch' : ''}).`);
      setUrl('');
      onAdded?.(snapshot);
    } catch (e: any) {
      setErr(e?.message ?? 'Fetch failed.');
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const f = event.target.files?.[0];
    event.target.value = '';
    if (!f) return;
    setMsg(null);
    setErr(null);
    try {
      s.addSnapshot(parseImportFile(await f.text()));
      setMsg('Snapshot imported (labelled imported, not freshly fetched).');
    } catch (e: any) {
      setErr('Import failed: ' + (e?.message ?? 'invalid file'));
    }
  };

  return (
    <div>
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input
          id={inputId}
          className={inputCls}
          placeholder="https://www.youtube.com/playlist?list=PL…  or playlist ID"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-label="Playlist URL or ID"
          autoFocus={autoFocus}
          disabled={busy}
        />
        <Btn type="submit" variant="primary" className="shrink-0 whitespace-nowrap" disabled={busy || !url.trim()}>
          <Plus size={15} /> {busy ? 'Fetching…' : 'Add playlist'}
        </Btn>
      </form>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
        <span>Public playlists only; durations are fetched per video (never averaged).</span>
        <label className="inline-flex cursor-pointer items-center gap-1 underline hover:text-[var(--text)]">
          <Upload size={12} aria-hidden="true" /> Import snapshot JSON
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => { void importFile(e); }} />
        </label>
      </div>
      {msg && <p className="mt-2 text-xs text-[var(--text-muted)]" role="status">{msg}</p>}
      {err && <p className="mt-2 text-xs text-red-800 dark:text-red-300" role="alert">{err}</p>}
    </div>
  );
}
