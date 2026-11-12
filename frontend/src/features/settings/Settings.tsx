import { useEffect, useId, useState } from 'react';
import { KeyRound, Sun, Moon, Monitor, Trash2 } from 'lucide-react';
import { useStore } from '../../app/store.js';
import { useTheme, type Theme } from '../../app/theme.js';
import { checkApiHealth } from '../../services/api/playlistApi.js';
import { confirmDialog } from '../../components/ui/dialog.js';
import { notify } from '../../services/notifications/notify.js';
import { XP_RULES } from '../../domain/index.js';
import { Card, Field, Btn } from '../../components/ui/ui.js';
import { TimezonePicker } from '../../components/ui/TimezonePicker.js';
import { NumberField } from '../../components/ui/NumberField.js';

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

function ThemeOptions() {
  const { pref, resolved, setTheme } = useTheme();
  const group = useId();
  return (
    <fieldset className="mt-3">
      <legend className="lq-label">Theme</legend>
      <div className="mt-1 grid grid-cols-3 gap-2">
        {THEMES.map(({ value, label, icon: Icon }) => (
          <label key={value} className="relative min-w-0 cursor-pointer">
            <input type="radio" name={group} checked={pref === value} onChange={() => setTheme(value)}
              aria-label={label} className="peer sr-only" />
            <span className="flex min-h-11 items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--control-border)] px-1 py-2 text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--surface-hover)] peer-checked:border-[var(--text)] peer-checked:bg-[var(--selected)] peer-checked:text-[var(--text)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus)]">
              <Icon size={15} aria-hidden="true" className="hidden sm:block" /> {label}
            </span>
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-[var(--text-faint)]">Saved on this device.{pref === 'system' ? ` Currently using ${resolved} mode.` : ''}</p>
    </fieldset>
  );
}

export function Settings() {
  const s = useStore();
  const [health, setHealth] = useState<{ ok: boolean; hasKey: boolean }>({ ok: false, hasKey: false });

  useEffect(() => {
    checkApiHealth().then(setHealth);
  }, []);

  const clearAllData = async () => {
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
  };

  const configured = health.ok && health.hasKey;

  return (
    <div className="lq-workflow">
      <Card className="lq-workflow">
        <section>
        <h2 className="lq-section-title">Appearance</h2>
        <ThemeOptions />
        </section>

        <section className="lq-workflow-section">
        <h2 className="lq-section-title">Preferences</h2>
        <div className="mt-3 grid items-start gap-4 sm:grid-cols-2">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Learning and display</h3>
            <div>
            <TimezonePicker value={s.prefs.timezone} onChange={(tz) => s.setPrefs({ timezone: tz })} />
            <p className="mt-1 text-[11px] text-[var(--text-faint)]">Aggregation only — stored UTC events are never rewritten.</p>
            </div>
            <Field label={`Verified completion threshold: ${Math.round(s.settings.verifiedThreshold * 100)}%`}>
              <input
                type="range" min={50} max={100} step={5}
                value={Math.round(s.settings.verifiedThreshold * 100)}
                onChange={(e) => s.setSettings({ verifiedThreshold: Number(e.target.value) / 100 })}
                className="w-full accent-zinc-900 dark:accent-zinc-100" aria-label="Verified completion threshold"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={s.prefs.reducedMotion} onChange={(e) => s.setPrefs({ reducedMotion: e.target.checked })} className="accent-zinc-900 dark:accent-zinc-100" /> Reduce motion
            </label>
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Session timing</h3>
            <NumberField
              label="Default session length (min)"
              value={s.prefs.sessionLenMin}
              onCommit={(v) => { if (v !== null) s.setPrefs({ sessionLenMin: v }); }}
              min={1}
              max={600}
            />
            <NumberField
              label="Break length (min)"
              value={s.prefs.breakMin}
              onCommit={(v) => { if (v !== null) s.setPrefs({ breakMin: v }); }}
              min={0}
              max={240}
            />
            <NumberField
              label="Minimum viable session (min)"
              value={s.prefs.minViableMin}
              onCommit={(v) => { if (v !== null) s.setPrefs({ minViableMin: v }); }}
              min={1}
              max={600}
            />
          </div>
        </div>
        <details className="mt-4 border-t border-[var(--border)] pt-3 text-xs text-[var(--text-muted)]">
          <summary className="cursor-pointer font-semibold text-[var(--text)]">XP rules (deterministic, deduped)</summary>
          <p className="mt-2 max-w-[72ch]">video {XP_RULES.videoDone} · exercise {XP_RULES.exerciseDone} · code {XP_RULES.codeReproduced} · built {XP_RULES.builtExample} · revision {XP_RULES.revisionDone} · checkpoint {XP_RULES.checkpointDone} · 30min focus {XP_RULES.focusSession30min} · study day {XP_RULES.studyDay} · achievement 25. Re-clicks never double-award (ledger dedup keys).</p>
        </details>
      </section>
      </Card>

      <div className="lq-workflow-columns" data-layout="balanced">
      <Card className="lq-workflow-section">
        <div className="flex items-center justify-between gap-2">
          <h2 className="lq-section-title">Backend connection</h2>
          <button onClick={() => checkApiHealth().then(setHealth)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">
            Recheck
          </button>
        </div>
        {configured ? (
          <p className="mt-1 text-xs text-[var(--text-muted)]">YouTube metadata API connected.</p>
        ) : (
          <>
            <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">
              {health.ok ? 'Backend reachable — API key missing.' : 'Backend unreachable. JSON import still works.'}
            </p>
            <details className="mt-3">
              <summary className="text-sm font-semibold">YouTube API setup</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-[var(--text-muted)]">
              <li>Create a Google Cloud project and enable <b>YouTube Data API v3</b> (read-only).</li>
              <li>Create an <b>API key</b> restricted to that API and your backend host.</li>
              <li>Paste it into <code className="font-mono text-[var(--text)]">backend/.env</code> as <code className="font-mono">YOUTUBE_API_KEY=…</code> (never into chat, never into the frontend).</li>
              <li>Restart the backend, then Recheck.</li>
              </ol>
            </details>
          </>
        )}
        {!configured && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--text-faint)]">
            <KeyRound size={13} className="mt-0.5 shrink-0" />
            Keys never appear in frontend bundles, API responses, logs, or the UI.
          </p>
        )}
      </Card>

      <Card className="lq-workflow-section">
        <h2 className="lq-section-title">Data &amp; privacy</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {s.mode === 'cloud'
            ? 'Your data is saved to your account. CSV/JSON exports stay on your device.'
            : 'Your data stays in this browser (IndexedDB). Export a backup before clearing browser data.'}
        </p>
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] p-3 text-[11px] text-[var(--text-muted)]">
          <p className="font-semibold text-[var(--text)]">Scope of these actions</p>
          <p className="mt-1">Clear cached metadata keeps every progress, note, revision, focus-session and Arena record — only stored YouTube playlist metadata is dropped and refetched on demand. Clear all learning data permanently deletes every records domain in this account or browser; your sign-in identity is untouched. Export a backup first.</p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn onClick={() => s.clearCacheOnly()}>Clear cached metadata (keep progress)</Btn>
          <Btn variant="quiet" className="lq-delete-trigger" onClick={() => void clearAllData()}>
            <Trash2 size={16} aria-hidden="true" /> Clear all learning data…
          </Btn>
        </div>
      </Card>
      </div>
    </div>
  );
}
