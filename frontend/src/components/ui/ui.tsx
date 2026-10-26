import React from 'react';

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`glass rounded-2xl p-4 sm:p-5 shadow-xl ${className}`}>{children}</section>;
}

export function Btn({
  children, onClick, variant = 'ghost', className = '', type = 'button', disabled, title,
}: {
  children: React.ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger'; className?: string; type?: 'button' | 'submit'; disabled?: boolean; title?: string;
}) {
  const base = 'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition active:scale-[0.98] disabled:opacity-50';
  const styles =
    variant === 'primary'
      ? 'bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-900/40'
      : variant === 'danger'
        ? 'bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25'
        : 'bg-white/5 border border-white/10 hover:bg-white/10 text-slate-200';
  return (
    <button type={type} disabled={disabled} title={title} onClick={onClick} className={`${base} ${styles} ${className}`}>
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-slate-400">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  'w-full rounded-xl bg-black/30 border border-white/10 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500';

export function ProgressBar({ pct, tone = 'violet' }: { pct: number; tone?: 'violet' | 'cyan' | 'emerald' }) {
  const color = tone === 'emerald' ? 'bg-emerald-400' : tone === 'cyan' ? 'bg-cyan-400' : 'bg-violet-500';
  const safe = Math.max(0, Math.min(100, pct));
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={Math.round(safe)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${color}`} style={{ width: `${safe}%`, transition: reduced ? 'none' : 'width 400ms ease' }} />
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 p-6 text-center">
      <p className="font-semibold text-slate-200">{title}</p>
      <p className="mt-1 text-sm text-slate-400">{hint}</p>
    </div>
  );
}
