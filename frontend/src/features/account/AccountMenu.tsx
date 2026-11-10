import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Download, LogOut, ShieldCheck, UserRound, Settings2 } from 'lucide-react';
import { useStore } from '../../app/store.js';
import { notify } from '../../services/notifications/notify.js';
import { downloadZip } from '../../services/exports/zip.js';
import { themeLabel, useTheme, type Theme } from '../../app/theme.js';
import { moveMenuFocus } from '../../components/ui/menuKeys.js';

export type AccountSection = 'profile' | 'settings' | 'security';
const APPEARANCE: Theme[] = ['light', 'dark', 'system'];

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
  const theme = useTheme();

  useLayoutEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        btn.current?.focus();
        return;
      }
      if (!menu.current?.contains(document.activeElement)) return;
      if (e.key === 'Tab') {
        setOpen(false);
        btn.current?.focus();
        return;
      }
      if (moveMenuFocus(menu.current, e.key)) e.preventDefault();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    menu.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus({ preventScroll: true });
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
      const { zip } = await s.exportAccountBundle();
      downloadZip(`learnquest-account-export-${new Date().toISOString().slice(0, 10)}.zip`, zip);
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
        className="flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] px-2 text-left transition-colors hover:bg-[var(--surface-hover)]"
      >
        <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-full bg-[var(--surface-hover)] text-[10px] font-bold text-[var(--text)]">
          {initials(label)}
        </span>
        <span className="hidden max-w-[150px] sm:block">
          <span className="block truncate text-xs font-semibold text-[var(--text)]">{label}</span>
          <span className="block truncate text-[10px] text-[var(--text-muted)]">@{user.username ?? 'account'}</span>
        </span>
        <ChevronDown aria-hidden="true" size={14} className={`text-[var(--text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="Account"
          className="absolute right-0 z-50 mt-2 max-h-[70dvh] w-64 max-w-[calc(100vw-2rem)] overflow-auto overscroll-contain rounded-[var(--radius-panel)] border border-[var(--border-strong)] bg-[var(--surface-strong)] p-1 shadow-[var(--elevation)]"
        >
          <div className="px-2 py-1.5">
            <p className="truncate text-xs font-semibold">{label}</p>
            <p className="truncate text-[10px] text-[var(--text-muted)]">{user.email}</p>
          </div>
          <MenuButton icon={<UserRound size={14} />} onClick={() => go('profile')}>Profile</MenuButton>
          <MenuButton icon={<Settings2 size={14} />} onClick={() => go('settings')}>Account settings</MenuButton>
          <MenuButton icon={<ShieldCheck size={14} />} onClick={() => go('security')}>Security and active sessions</MenuButton>
          <MenuButton icon={<Download size={14} />} onClick={exportData} disabled={busy}>Export account data</MenuButton>
          <div role="group" aria-label="Appearance" className="my-1 border-y border-[var(--border)] px-1 py-1.5">
            <p className="px-1 pb-1 text-xs font-semibold text-[var(--text-muted)]" aria-hidden="true">Appearance</p>
            <div className="lq-segmented grid grid-cols-3">
              {APPEARANCE.map((pref) => (
                <button key={pref} type="button" role="menuitemradio" aria-checked={theme.pref === pref}
                  onClick={() => theme.setTheme(pref)} title={themeLabel(pref, theme.resolved)}>
                  {pref === 'system' ? 'System' : themeLabel(pref, theme.resolved)}
                </button>
              ))}
            </div>
          </div>
          <div className="my-1 h-px bg-[var(--surface-hover)]" />
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
      className="lq-menu-item disabled:opacity-50"
    >
      <span aria-hidden="true" className="text-[var(--text-muted)]">{icon}</span>
      {children}
    </button>
  );
}
