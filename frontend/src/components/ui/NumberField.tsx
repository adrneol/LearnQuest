import React, { useEffect, useId, useRef, useState } from 'react';
import { inputCls } from './ui.js';

interface Props {
  label: string;
  value: number | null;
  onCommit: (value: number | null) => void;
  min?: number;
  max?: number;
  integer?: boolean;
  allowEmpty?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  hint?: string;
  error?: string | null;
  /** Commit valid edits immediately (default). Set false for jump/navigation fields. */
  live?: boolean;
}

function display(value: number | null, integer: boolean): string {
  if (value === null || !Number.isFinite(value)) return '';
  if (integer) return String(Math.trunc(value));
  return String(Number(value));
}

/**
 * Numeric text field with boundary normalization:
 * - typing stays free-form (empty survives while editing);
 * - valid values commit immediately for live previews;
 * - blur/Enter strips harmless leading zeros (`019` → `19`) and enforces
 *   integer/min/max rules without silently rounding invalid input.
 */
export function NumberField({
  label,
  value,
  onCommit,
  min,
  max,
  integer = true,
  allowEmpty = false,
  placeholder,
  ariaLabel,
  disabled,
  className = '',
  hint,
  error: externalError,
  live = true,
}: Props) {
  const id = useId();
  const errorId = `${id}-error`;
  const [text, setText] = useState(() => display(value, integer));
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(display(value, integer));
  }, [value, integer]);

  const parse = (raw: string): { value?: number; error?: string } => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      return allowEmpty ? { value: undefined } : { error: 'Enter a number.' };
    }
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return { error: 'Enter a valid number.' };
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return { error: 'Enter a finite number.' };
    if (integer && !Number.isInteger(n)) return { error: 'Use a whole number.' };
    if (min !== undefined && n < min) return { error: `Minimum is ${min}.` };
    if (max !== undefined && n > max) return { error: `Maximum is ${max}.` };
    return { value: n };
  };

  const change = (raw: string) => {
    setText(raw);
    const parsed = parse(raw);
    setError(parsed.error ?? null);
    if (!parsed.error && live) onCommit(parsed.value ?? null);
  };

  const commit = () => {
    const parsed = parse(text);
    if (parsed.error) {
      setError(parsed.error);
      // Keep the user's text visible so they can correct it; never coerce an
      // empty/invalid field to zero or a different number.
      return;
    }
    if (parsed.value !== undefined) {
      setText(display(parsed.value, integer));
      onCommit(parsed.value);
    } else {
      setText('');
      onCommit(null);
    }
    setError(null);
  };

  const shownError = externalError ?? error;
  return (
    <div className={`block text-xs font-medium text-slate-400 ${className}`}>
      <label htmlFor={id} className="mb-1 block">{label}</label>
      <input
        id={id}
        type="text"
        inputMode={integer ? 'numeric' : 'decimal'}
        value={text}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={Boolean(shownError)}
        aria-describedby={shownError ? errorId : undefined}
        disabled={disabled}
        onFocus={() => { focused.current = true; }}
        onChange={(e) => change(e.target.value)}
        onBlur={() => { focused.current = false; commit(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setText(display(value, integer));
            setError(null);
            e.currentTarget.blur();
          }
        }}
        className={`${inputCls} ${shownError ? 'border-red-500/50' : ''}`}
      />
      {hint && !shownError && <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>}
      {shownError && <span id={errorId} className="mt-1 block text-[11px] text-red-300">{shownError}</span>}
    </div>
  );
}
