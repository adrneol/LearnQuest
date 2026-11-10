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

const REGION_ORDER: Record<string, number> = {
  System: 0, Africa: 1, America: 2, Antarctica: 3, Asia: 4, Atlantic: 5, Australia: 6,
  Europe: 7, Indian: 8, Pacific: 9, Etc: 10, UTC: 11,
};

function offsetRank(value: string): string {
  // Group by current offset bucket only for the grouped view; computed live per `now`.
  return value.split('/')[0];
}

function groupByRegion(zones: string[]): Array<{ region: string; zones: string[] }> {
  const groups = new Map<string, string[]>();
  for (const z of zones) {
    if (z === 'local' || z === 'UTC') continue; // System bucket
    const region = offsetRank(z);
    if (!groups.has(region)) groups.set(region, []);
    groups.get(region)!.push(z);
  }
  const regionList = [...groups.keys()].sort(
    (a, b) => (REGION_ORDER[a] ?? 99) - (REGION_ORDER[b] ?? 99) || a.localeCompare(b),
  );
  return [
    ...(zones.includes('local') || zones.includes('UTC')
      ? [{ region: 'System', zones: ['local', 'UTC'].filter((z) => zones.includes(z)) }]
      : []),
    ...regionList.map((region) => ({ region, zones: groups.get(region)!.sort((a, b) => a.localeCompare(b)) })),
  ];
}

/** Polished searchable timezone picker. All IANA zones the runtime can produce, grouped by region. */
export function TimezonePicker({ value, onChange, label = 'Display timezone' }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [invalidNote, setInvalidNote] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const zones = useMemo(() => getAvailableZones(), []);
  const searching = q.trim().length > 0;
  const results = useMemo(() => (searching ? searchZones(q, zones) : zones), [q, searching, zones]);
  const grouped = useMemo(() => (searching ? null : groupByRegion(zones)), [searching, zones]);
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
  }, [open]);

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]') as HTMLElement | null | undefined;
    if (open && el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const summary = (tz: string) => {
    if (tz === 'local') {
      const dev = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'device';
      return { title: `Device (${dev})`, sub: formatOffset(-new Date().getTimezoneOffset()) };
    }
    return { title: `${cityOf(tz)}, ${tz === 'UTC' ? 'System' : regionOf(tz)}`, sub: `${tz} · ${formatOffset(utcOffsetMinutes(now, tz))}` };
  };

  const cur = summary(value);
  const pick = (tz: string) => {
    onChange(tz);
    setOpen(false);
  };

  const optionFor = (tz: string, flatIndex: number) => {
    const s = summary(tz);
    const sel = tz === value;
    return (
      <button
        key={tz}
        id={`tz-${tz}`}
        role="option"
        aria-selected={sel}
        data-active={flatIndex === active ? 'true' : 'false'}
        onMouseEnter={() => setActive(flatIndex)}
        onClick={() => pick(tz)}
        className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm ${flatIndex === active ? 'bg-[var(--surface-hover)]' : ''} ${sel ? 'text-[var(--text)] font-semibold' : 'text-[var(--text)]'}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate">{s.title}</span>
          <span className="block truncate font-mono text-[11px] text-[var(--text-faint)]">{s.sub}</span>
        </span>
        {sel && <Check size={15} className="shrink-0 text-emerald-700 dark:text-emerald-400" />}
      </button>
    );
  };

  const flatIndexOf = (tz: string) => results.indexOf(tz);

  return (
    <div ref={rootRef}>
      <span className="mb-1 block text-xs font-medium text-[var(--text-muted)]">{label}</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2 text-left text-sm text-[var(--text)] hover:border-[var(--border-strong)]"
      >
        <Globe size={15} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{cur.title}</span>
          <span className="block truncate font-mono text-[11px] text-[var(--text-muted)]">{cur.sub}</span>
        </span>
        <ChevronDown size={15} className={`shrink-0 text-[var(--text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {invalidNote && <p role="status" className="mt-1 text-xs text-amber-800 dark:text-amber-300">{invalidNote}</p>}
      <PopupShell anchor={() => rootRef.current} open={open} onClose={() => setOpen(false)}>
        <div className="border-b border-[var(--border)] p-2">
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
                setActive((a) => Math.min((results as string[]).length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const target = searching ? (results as string[])[active] : (results as string[])[active];
                if (target) pick(target);
              }
            }}
            placeholder="Search city, region, IANA id, offset…"
            aria-label="Search timezones"
            role="combobox"
            aria-expanded="true"
            aria-controls="tz-listbox"
            aria-activedescendant={(results as string[])[active] ? `tz-${(results as string[])[active]}` : undefined}
            className={inputCls}
          />
        </div>
        <div ref={listRef} id="tz-listbox" role="listbox" aria-label="Timezones" className="max-h-72 overflow-auto p-1">
          {results.length === 0 && <p className="p-3 text-sm text-[var(--text-faint)]">No matches. Try a city or region.</p>}
          {grouped
            ? grouped.map(({ region, zones: groupZones }) => (
                <div key={region} role="group" aria-labelledby={`tz-region-${region}`} className="mb-1 last:mb-0">
                  <p id={`tz-region-${region}`} className="px-2 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">{region}</p>
                  {groupZones.map((tz) => optionFor(tz, flatIndexOf(tz)))}
                </div>
              ))
            : (results as string[]).slice(0, 100).map((tz, i) => optionFor(tz, i))}
        </div>
      </PopupShell>
    </div>
  );
}
