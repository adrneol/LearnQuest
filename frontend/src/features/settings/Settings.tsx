import { useEffect, useState } from 'react';
import { KeyRound, PlugZap } from 'lucide-react';
import { useStore } from '../../app/store.js';
import { checkApiHealth } from '../../services/api/playlistApi.js';
import { Card, Field, inputCls } from '../../components/ui/ui.js';
import { TimezonePicker } from '../../components/ui/TimezonePicker.js';

export function Settings() {
  const s = useStore();
  const [health, setHealth] = useState<{ ok: boolean; hasKey: boolean }>({ ok: false, hasKey: false });

  useEffect(() => {
    checkApiHealth().then(setHealth);
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="flex items-center gap-1.5 text-base font-bold"><PlugZap size={16} /> Backend connection</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className={`rounded-full px-2.5 py-1 text-xs ${health.ok && health.hasKey ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
            {health.ok ? (health.hasKey ? '● Connected — API key configured' : '● Backend reachable — API key missing') : '○ Backend unreachable'}
          </span>
          <button onClick={() => checkApiHealth().then(setHealth)} className="rounded-xl bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10">
            Recheck
          </button>
        </div>
        {(!health.ok || !health.hasKey) && (
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-300">
            <li>Create a Google Cloud project and enable <b>YouTube Data API v3</b> (read-only, no billing required).</li>
            <li>Create an <b>API key</b> restricted to that API and your backend host.</li>
            <li>Paste it into <code className="font-mono text-cyan-300">backend/.env</code> as <code className="font-mono">YOUTUBE_API_KEY=…</code> (never into chat, never into the frontend).</li>
            <li>Restart the backend. This indicator flips to green — no data is lost.</li>
          </ol>
        )}
        <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-500">
          <KeyRound size={13} className="mt-0.5 shrink-0" />
          Keys never appear in frontend bundles, API responses, logs, or the UI. Until configured, playlist-URL fetching stays disabled but JSON snapshot import in Reports works fully.
        </p>
      </Card>

      <Card>
        <h2 className="text-base font-bold">Preferences</h2>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div>
            <TimezonePicker value={s.prefs.timezone} onChange={(tz) => s.setPrefs({ timezone: tz })} />
            <p className="mt-1 text-[11px] text-slate-500">Aggregation only — stored UTC events are never rewritten. Daily/weekly figures recompute instantly, no refetch needed.</p>
          </div>
          <div className="space-y-3">
            <Field label={`Verified completion threshold: ${Math.round(s.settings.verifiedThreshold * 100)}% unique coverage`}>
              <input
                type="range" min={50} max={100} step={5}
                value={Math.round(s.settings.verifiedThreshold * 100)}
                onChange={(e) => s.setSettings({ verifiedThreshold: Number(e.target.value) / 100 })}
                className="w-full" aria-label="Verified completion threshold"
              />
            </Field>
            <Field label="Default session length (min)">
              <input type="number" min={5} value={s.prefs.sessionLenMin} onChange={(e) => s.setPrefs({ sessionLenMin: Number(e.target.value) })} className={inputCls} />
            </Field>
            <Field label="Break length (min)">
              <input type="number" min={0} value={s.prefs.breakMin} onChange={(e) => s.setPrefs({ breakMin: Number(e.target.value) })} className={inputCls} />
            </Field>
            <Field label="Minimum viable session (min)">
              <input type="number" min={1} value={s.prefs.minViableMin} onChange={(e) => s.setPrefs({ minViableMin: Number(e.target.value) })} className={inputCls} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={s.prefs.reducedMotion} onChange={(e) => s.setPrefs({ reducedMotion: e.target.checked })} /> Reduce motion
            </label>
          </div>
        </div>
      </Card>
    </div>
  );
}
