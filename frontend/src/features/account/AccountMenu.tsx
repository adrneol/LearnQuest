import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Download, LogOut, ShieldCheck, UserRound, Settings2 } from 'lucide-react';
import { useStore } from '../../app/store.js';
import { notify } from '../../services/notifications/notify.js';

export type AccountSection = 'profile' | 'settings' | 'security';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'LQ';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function AccountMenu({ onNavigate }: { onNavigate: (section: AccountSection) => void }) {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const user = s.authUser;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        btn.current?.focus();
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);
        if (!buttons.length) return;
        e.preventDefault();
        const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === 'ArrowDown' ? (idx + 1) % buttons.length : (idx <= 0 ? buttons.length - 1 : idx - 1);
        buttons[next]?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.setTimeout(() => menu.current?.querySelector<HTMLButtonElement>('button')?.focus(), 0);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;
  const label = user.displayName || user.username || user.email;

  const go = (section: AccountSection) => {
    setOpen(false);
    onNavigate(section);
  };

  const exportData = async () => {
    setBusy(true);
    try {
      await s.exportAccountData();
    } catch (e: any) {
      notify(e?.message ?? 'Export failed.');
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    try {
      await s.signOut();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <div ref={root} className="relative">
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${label}`}
        className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-2 py-1.5 text-left hover:bg-white/10"
      >
        <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-violet-600 to-cyan-500 text-xs font-black text-white">
          {initials(label)}
        </span>
        <span className="hidden max-w-[150px] sm:block">
          <span className="block truncate text-xs font-semibold text-slate-100">{label}</span>
          <span className="block truncate text-[10px] text-slate-400">@{user.username ?? 'account'}</span>
        </span>
        <ChevronDown size={14} className={`text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="Account"
          className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-white/10 bg-[#141830] p-1.5 shadow-2xl"
        >
          <div className="px-2 py-1.5">
            <p className="truncate text-xs font-semibold">{label}</p>
            <p className="truncate text-[10px] text-slate-400">{user.email}</p>
          </div>
          <MenuButton icon={<UserRound size={14} />} onClick={() => go('profile')}>Profile</MenuButton>
          <MenuButton icon={<Settings2 size={14} />} onClick={() => go('settings')}>Account settings</MenuButton>
          <MenuButton icon={<ShieldCheck size={14} />} onClick={() => go('security')}>Security and active sessions</MenuButton>
          <MenuButton icon={<Download size={14} />} onClick={exportData} disabled={busy}>Export account data</MenuButton>
          <div className="my-1 h-px bg-white/10" />
          <MenuButton icon={<LogOut size={14} />} onClick={signOut} disabled={busy}>Sign out</MenuButton>
        </div>
      )}
    </div>
  );
}

function MenuButton({ children, icon, onClick, disabled }: { children: ReactNode; icon: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
    >
      <span className="text-slate-400">{icon}</span>
      {children}
    </button>
  );
}
