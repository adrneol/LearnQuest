import { useStore } from '../../app/store.js';
import { Card } from '../../components/ui/ui.js';
import { Dropdown } from '../../components/ui/Dropdown.js';
import type { Tab } from '../../app/tabs.js';
import { AddPlaylist } from './AddPlaylist.js';

export function PlaylistSwitcher() {
  const s = useStore();
  const ids = Object.keys(s.playlists).filter((id) => !s.meta[id]?.archived);
  return (
    <div className="min-w-0">
      <Dropdown
        label="Active playlist"
        hideLabel
        value={s.activeId ?? ''}
        options={[
          { value: '', label: '— Select playlist —' },
          ...ids.map((id) => ({
            value: id,
            label: s.meta[id]?.customTitle ?? s.playlists[id]?.title ?? id,
            hint: `${s.playlists[id]?.entries.length ?? 0} videos · ${s.playlists[id]?.source === 'api' ? 'YouTube' : 'Imported'}`,
          })),
        ]}
        onChange={(v) => s.setActive(v || null)}
      />
    </div>
  );
}

export function Onboarding({ onGo }: { onGo: (t: Tab) => void }) {
  const s = useStore();
  const greeting = s.authUser?.displayName || s.authUser?.username;
  return (
    <Card className="border-[var(--border-strong)]">
      <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--text-faint)]">Your account is ready</p>
      <h1 className="mt-1 text-xl font-bold">
        {greeting ? `Welcome to LearnQuest, ${greeting}.` : 'Welcome to LearnQuest.'}
      </h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Add your first public YouTube playlist to begin. Durations are fetched per video (never averaged), and every
        total is computed from real data. Nothing is saved until the server confirms the write.
      </p>
      <div className="mt-3">
        <AddPlaylist inputId="onboarding-add-playlist" autoFocus onAdded={() => onGo('dash')} />
      </div>
      <p className="mt-2 text-xs text-[var(--text-faint)]">
        Example test target: <code className="text-[var(--text-muted)]">https://www.youtube.com/playlist?list=PLu0W_9lII9agq5TrH9XLIKQvv0iaF2X3w</code> (used only as a test case — never hardcoded).
      </p>
    </Card>
  );
}

/* ---------------- Dashboard ---------------- */
