import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { PopupShell } from './popup.js';
import { inputCls } from './ui.js';

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
  hideLabel?: boolean;
  disabled?: boolean;
  error?: string | null;
}

export function Dropdown({ value, options, onChange, label, hideLabel, disabled, error }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];
  const active = Math.min(activeIndex, options.length - 1);
  const popupId = id + '-listbox';

  const mountList = useCallback((element: HTMLDivElement | null) => {
    list.current = element;
    element?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (open && active >= 0) {
      list.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  }, [active, open]);

  const show = () => {
    setActiveIndex(Math.max(0, selectedIndex));
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    if (list.current?.contains(document.activeElement)) trigger.current?.focus();
  };

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
    trigger.current?.focus();
  };

  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowDown': setActiveIndex(Math.max(0, Math.min(active + 1, options.length - 1))); break;
      case 'ArrowUp': setActiveIndex(Math.max(0, active - 1)); break;
      case 'Home': setActiveIndex(0); break;
      case 'End': setActiveIndex(Math.max(0, options.length - 1)); break;
      case 'Enter':
      case ' ':
        if (options[active]) pick(options[active].value);
        break;
      case 'Escape':
        event.stopPropagation();
        close();
        break;
      case 'Tab':
        close();
        return; // The browser continues from the restored trigger.
      default: return;
    }
    event.preventDefault();
  };

  return (
    <div ref={root} className="min-w-0">
      <span id={id + '-label'} className={hideLabel ? 'sr-only' : 'lq-label mb-1'}>
        {label}
      </span>
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? popupId : undefined}
        aria-labelledby={id + '-label'}
        aria-describedby={error ? id + '-error' : selected ? id + '-value' : undefined}
        aria-invalid={Boolean(error)}
        onClick={() => open ? close() : show()}
        onKeyDown={(event) => {
          if (!open && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            show();
          }
        }}
        className={inputCls + ' flex items-center gap-2 text-left hover:bg-[var(--surface-hover)] disabled:opacity-55'}
      >
        <span id={id + '-value'} className="min-w-0 flex-1">
          <span className="block truncate" title={selected?.label}>{selected?.label ?? '—'}</span>
          {selected?.hint && <span className="block truncate text-xs text-[var(--text-faint)]">{selected.hint}</span>}
        </span>
        <ChevronDown aria-hidden="true" size={15} className="shrink-0 text-[var(--text-muted)]" />
      </button>
      {error && <p id={id + '-error'} className="mt-1 text-xs text-[var(--danger)]">{error}</p>}
      <PopupShell anchor={() => root.current} open={open} onClose={close}>
        <div
          ref={mountList}
          id={popupId}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={active >= 0 ? id + '-option-' + active : undefined}
          onKeyDown={onListKey}
          className="overflow-auto overscroll-contain p-1 focus-visible:outline-offset-[-2px]"
        >
          {options.map((option, index) => (
            <div
              key={option.value}
              id={id + '-option-' + index}
              role="option"
              aria-selected={option.value === value}
              data-active={index === active}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => pick(option.value)}
              className={'flex min-h-10 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-2.5 py-2 text-sm ' +
                (index === active ? 'bg-[var(--selected)]' : '')}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{option.label}</span>
                {option.hint && <span className="block truncate text-xs text-[var(--text-faint)]">{option.hint}</span>}
              </span>
              {option.value === value && <Check aria-hidden="true" size={15} className="shrink-0 text-[var(--success)]" />}
            </div>
          ))}
        </div>
      </PopupShell>
    </div>
  );
}
