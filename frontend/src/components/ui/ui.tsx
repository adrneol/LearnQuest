import React, { forwardRef, useId } from 'react';

export const Card = forwardRef<HTMLElement, React.ComponentPropsWithoutRef<'section'>>(function Card({
  className = '', ...props
}, ref) {
  return <section {...props} ref={ref} className={`lq-card ${className}`} />;
});

interface BtnProps extends React.ComponentPropsWithoutRef<'button'> {
  variant?: 'primary' | 'ghost' | 'danger' | 'quiet';
}

export const Btn = forwardRef<HTMLButtonElement, BtnProps>(function Btn({
  variant = 'ghost', className = '', type = 'button', ...props
}, ref) {
  return <button {...props} ref={ref} type={type} className={`lq-button lq-button--${variant} ${className}`} />;
});

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const fieldId = useId();
  const content = React.Children.toArray(children);
  const control = content.find((child) => React.isValidElement<{ id?: string }>(child) &&
    (child.type === 'input' || child.type === 'textarea' || child.type === 'select'));
  if (React.isValidElement<{ id?: string }>(control)) {
    const id = control.props.id ?? fieldId;
    return (
      <div className="lq-label">
        <label className="mb-1 block" htmlFor={id}>{label}</label>
        {content.map((child) => child === control ? React.cloneElement(control, { id }) : child)}
      </div>
    );
  }
  return (
    <label className="lq-label">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

export const inputCls = 'lq-input';

export function ProgressBar({ pct, label, tone = 'neutral', className = '' }: { pct: number; label: string; tone?: 'neutral' | 'cyan' | 'emerald'; className?: string }) {
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
    <div className={`h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-soft)] ${className}`} role="progressbar" aria-label={label} aria-valuenow={Math.round(safe)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${color}`} style={{ width: `${safe}%`, transition: reduced ? 'none' : 'width 400ms ease' }} />
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint: string; action?: React.ReactNode }) {
  return (
    <div className="lq-empty">
      <p className="font-semibold text-[var(--text)]">{title}</p>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{hint}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-[var(--radius-panel)] bg-[var(--surface-soft)] ${className}`} />;
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
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 shrink-0 accent-[var(--accent)]" />
      <span>{label}</span>
    </label>
  );
}

export function SectionHeading({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="lq-section-title">{title}</h3>
      {children}
    </div>
  );
}
