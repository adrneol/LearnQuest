import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useStore } from '../../app/store.js';
import { fetchPlaylistFromServer } from '../../services/api/playlistApi.js';
import { Card, Btn, inputCls } from '../../components/ui/ui.js';
import { Dropdown } from '../../components/ui/Dropdown.js';
import type { Tab } from '../../app/tabs.js';

export function PlaylistSwitcher() {
  const s = useStore();
  const ids = Object.keys(s.playlists).filter((id) => !s.meta[id]?.archived);
  return (
    <div className="min-w-[200px] flex-1 sm:max-w-[260px] sm:flex-none">
      <Dropdown
        label="Active playlist"
        value={s.activeId ?? ''}
        options={[
          { value: '', label: '— Select playlist —' },
          ...ids.map((id) => ({
            value: id,
            label: `${(s.meta[id]?.customTitle ?? s.playlists[id]?.title ?? id).slice(0, 40)}`,
            hint: `N=${s.playlists[id]?.entries.length ?? 0}`,
          })),
        ]}
        onChange={(v) => s.setActive(v || null)}
      />
    </div>
  );
}

export function Onboarding({ onGo }: { onGo: (t: Tab) => void }) {
  const s = useStore();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { snapshot } = await fetchPlaylistFromServer(url);
      if (snapshot.entries.length === 0) {
        setErr('Playlist is empty or entirely inaccessible. Nothing to track yet.');
      } else {
        s.addSnapshot(snapshot);
        onGo('dash');
      }
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to add playlist.');
    } finally {
      setBusy(false);
    }
  };

  const greeting = s.authUser?.displayName || s.authUser?.username;
  return (
    <Card className="border-violet-500/30">
      <p className="text-[11px] font-bold uppercase tracking-widest text-cyan-300">Your account is ready</p>
      <h1 className="mt-1 text-xl font-bold">
        {greeting ? `Welcome to LearnQuest, ${greeting}.` : 'Welcome to LearnQuest.'}
      </h1>
      <p className="mt-1 text-sm text-slate-400">
        Add your first public YouTube playlist to begin. Durations are fetched per video (never averaged), and every
        total is computed from real data. Nothing is saved until the server confirms the write.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          className={inputCls}
          placeholder="https://www.youtube.com/playlist?list=PL…  or playlist ID"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-label="Playlist URL or ID"
        />
        <Btn variant="primary" onClick={add} disabled={busy || !url.trim()}>
          <Plus size={15} /> {busy ? 'Fetching…' : 'Add your first playlist'}
        </Btn>
      </div>
      {err && <p className="mt-2 text-sm text-red-300">{err} You can also import a JSON snapshot in Reports.</p>}
      <p className="mt-2 text-xs text-slate-500">
        Example test target: <code className="text-slate-400">https://www.youtube.com/playlist?list=PLu0W_9lII9agq5TrH9XLIKQvv0iaF2X3w</code> (used only as a test case — never hardcoded).
      </p>
    </Card>
  );
}

/* ---------------- Dashboard ---------------- */
