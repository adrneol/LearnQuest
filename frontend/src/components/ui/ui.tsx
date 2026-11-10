import React, { forwardRef } from 'react';

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5 ${className}`}>{children}</section>;
}

interface BtnProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  className?: string;
  type?: 'button' | 'submit';
  disabled?: boolean;
  title?: string;
  'aria-expanded'?: boolean;
}

export const Btn = forwardRef<HTMLButtonElement, BtnProps>(function Btn({
  children, onClick, variant = 'ghost', className = '', type = 'button', disabled, title, 'aria-expanded': ariaExpanded,
}, ref) {
  const base = 'inline-flex min-h-[40px] max-w-full min-w-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ring-offset)] disabled:cursor-not-allowed disabled:opacity-50';
  const styles =
    variant === 'primary'
      ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-text)] disabled:hover:bg-[var(--accent)]'
      : variant === 'danger'
        ? 'bg-red-500/10 text-red-800 dark:text-red-300 border border-red-500/30 hover:bg-red-500/20 disabled:hover:bg-red-500/10'
        : 'bg-[var(--surface-soft)] border border-[var(--border)] hover:bg-[var(--surface-hover)] text-[var(--text)] disabled:hover:bg-[var(--surface-soft)]';
  return (
    <button ref={ref} type={type} disabled={disabled} title={title} aria-expanded={ariaExpanded} onClick={onClick} className={`${base} ${styles} ${className}`}>
      {children}
    </button>
  );
});

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-[var(--text-muted)]">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  'w-full rounded-lg bg-[var(--surface-soft)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]';

export function ProgressBar({ pct, tone = 'neutral', className = '' }: { pct: number; tone?: 'neutral' | 'cyan' | 'emerald'; className?: string }) {
  const color = tone === 'emerald' ? 'bg-emerald-500' : tone === 'cyan' ? 'bg-cyan-500' : 'bg-[var(--text)]';
  const safe = Math.max(0, Math.min(100, pct));
  const reduced = (() => {
    try {
      const root = document.documentElement;
      if (root.dataset?.reducedMotion) return root.dataset.reducedMotion === 'true';
    } catch { /* ignore */ }
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  })();
  return (
    <div className={`h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-soft)] ${className}`} role="progressbar" aria-valuenow={Math.round(safe)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${color}`} style={{ width: `${safe}%`, transition: reduced ? 'none' : 'width 400ms ease' }} />
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--surface)] p-6 text-center">
      <p className="font-semibold text-[var(--text)]">{title}</p>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{hint}</p>
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-[var(--surface-soft)] ${className}`} />;
}

export function CheckField(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { label, checked, onChange, disabled, className = '' } = props;
  return (
    <label className={`flex items-center gap-2 text-sm text-[var(--text)] ${className}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 shrink-0 accent-zinc-900 dark:accent-zinc-100" />
      <span>{label}</span>
    </label>
  );
}

export function SectionHeading({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-sm font-bold text-[var(--text)]">{title}</h3>
      {children}
    </div>
  );
}
