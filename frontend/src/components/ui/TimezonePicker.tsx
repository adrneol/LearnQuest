import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Globe } from 'lucide-react';
import {
  getAvailableZones, searchZones, cityOf, regionOf, utcOffsetMinutes, formatOffset, isValidTimezone, supportedZone,
} from '../../domain/index.js';
import { inputCls } from './ui.js';
import { PopupShell } from './popup.js';

interface Props {
  value: string;
  onChange: (tz: string) => void;
  label?: string;
}

/** Polished searchable timezone picker. Offsets computed live via Intl (DST-safe). */
export function TimezonePicker({ value, onChange, label = 'Display timezone' }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [invalidNote, setInvalidNote] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const zones = useMemo(() => getAvailableZones(), []);
  const results = useMemo(() => searchZones(q, zones), [q, zones]);
  const now = useMemo(() => new Date(), [open]);

  // validate stored preference; fall back honestly (canonical zones that only
  // resolve via a legacy runtime equivalent are still accepted)
  useEffect(() => {
    if (value !== 'local' && !isValidTimezone(supportedZone(value))) {
      setInvalidNote(`“${value}” is not supported in this browser — fell back to device timezone.`);
      onChange('local');
    } else {
      setInvalidNote(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      setTimeout(() => searchRef.current?.focus(), 60);
    }
  }, [open ]);

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]') as HTMLElement | null | undefined;
    if (open && el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [active, open ]);

  const summary = (tz: string) => {
    if (tz === 'local') {
      const dev = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'device';
      return { title: `Device (${dev})`, sub: formatOffset(-new Date().getTimezoneOffset()) };
    }
    return { title: `${cityOf(tz)} · ${regionOf(tz)}`, sub: `${tz} · ${formatOffset(utcOffsetMinutes(now, tz))}` };
  };

  const cur = summary(value);
  const pick = (tz: string) => {
    onChange(tz);
    setOpen(false);
  };

  return (
    <div ref={rootRef}>
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-left text-sm text-slate-100 hover:border-white/20"
      >
        <Globe size={15} className="shrink-0 text-cyan-300" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{cur.title}</span>
          <span className="block truncate font-mono text-[11px] text-slate-400">{cur.sub}</span>
        </span>
        <ChevronDown size={15} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {invalidNote && <p className="mt-1 text-xs text-amber-300">{invalidNote}</p>}
      <PopupShell anchor={() => rootRef.current} open={open} onClose={() => setOpen(false)}>
        <div className="border-b border-white/10 p-2">
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((a) => Math.min(results.length - 1, a + 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  if (results[active]) pick(results[active]);
                }
              }}
              placeholder="Search city, region, or alias (e.g. kolkata, ist, new york)…"
              aria-label="Search timezones"
              role="combobox"
              aria-expanded="true"
              aria-controls="tz-listbox"
              aria-activedescendant={results[active] ? `tz-${results[active]}` : undefined}
              className={inputCls}
            />
          </div>
          <div ref={listRef} id="tz-listbox" role="listbox" aria-label="Timezones" className="overflow-auto p-1">
            {results.length === 0 && <p className="p-3 text-sm text-slate-500">No matches. Try a city name.</p>}
            {results.map((tz, i) => {
              const s = summary(tz);
              const sel = tz === value;
              return (
                <button
                  key={tz}
                  id={`tz-${tz}`}
                  role="option"
                  aria-selected={sel}
                  data-active={i === active ? 'true' : 'false'}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(tz)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${i === active ? 'bg-violet-600/30' : ''} ${sel ? 'text-white' : 'text-slate-300'}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{s.title}</span>
                    <span className="block truncate font-mono text-[11px] text-slate-500">{s.sub}</span>
                  </span>
                  {sel && <Check size={15} className="shrink-0 text-emerald-400" />}
                </button>
              );
            })}
          </div>
      </PopupShell>
    </div>
  );
}
