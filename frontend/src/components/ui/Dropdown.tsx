import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { PopupShell } from './popup.js';

export interface DropOption {
  value: string;
  label: string;
  hint?: string;
}

interface Props {
  value: string;
  options: DropOption[];
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
  error?: string | null;
}

/**
 * Dark-system dropdown. The option list renders through PopupShell (a
 * body-level portal), so cards, grids, and sidebars can never clip it; it
 * flips upward when room below is tight. Full keyboard support.
 */
export function Dropdown({ value, options, onChange, label, disabled, error }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);
  // IDs must not contain spaces — aria-labelledby tokenizes on whitespace.
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  useEffect(() => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
  }, [value, options]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => btnRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open ]);

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]') as HTMLElement | null | undefined;
    if (open && el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [active, open ]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    btnRef.current?.focus();
  };

  return (
    <div ref={rootRef}>
      <span id={`dd-label-${slug}`} className="mb-1 block text-xs font-medium text-slate-400">
        {label}
      </span>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`dd-label-${slug}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if ((e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-left text-sm text-slate-100 hover:border-white/25 disabled:opacity-50"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate">{selected?.label ?? '—'}</span>
          {selected?.hint && <span className="block truncate text-[11px] text-slate-500">{selected.hint}</span>}
        </span>
        <ChevronDown size={15} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
      <PopupShell anchor={() => rootRef.current} open={open} onClose={() => setOpen(false)}>
        <div
          ref={listRef}
          role="listbox"
            aria-label={label}
            aria-activedescendant={options[active] ? `dd-${slug}-${options[active].value}` : undefined}
          className="overflow-auto p-1"
        >
          {options.map((o, i) => {
            const sel = o.value === value;
            return (
                <button
                  key={o.value}
                  id={`dd-${slug}-${o.value}`}
                role="option"
                aria-selected={sel}
                data-active={i === active ? 'true' : 'false'}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActive(Math.min(options.length - 1, i + 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActive(Math.max(0, i - 1));
                  } else if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    pick(options[active]?.value ?? o.value);
                  }
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${
                  i === active ? 'bg-violet-600/30' : ''
                } ${sel ? 'text-white' : 'text-slate-300'}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.label}</span>
                  {o.hint && <span className="block truncate text-[11px] text-slate-500">{o.hint}</span>}
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
