import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard, ListVideo, Clapperboard, ChartLine, BookOpen, Target, CheckCircle2,
  Timer as TimerIcon, Gauge, Swords, RefreshCw, History, BarChart3, Settings as SettingsIcon,
  X, PartyPopper, Menu, ChevronsLeft, ChevronsRight, UserRound,
} from 'lucide-react';
import { useStore } from './store';
import { PlaylistSwitcher, Onboarding } from '../features/playlists/Playlists';
import { Player } from '../features/player/Player';
import { Modules } from '../features/modules/Modules';
import { Goals } from '../features/goals/Goals';
import { Checkpoints } from '../features/checkpoints/Checkpoints';
import { Settings } from '../features/settings/Settings';
import { Notifier } from '../components/layout/Notifier';
import { DialogHost } from '../components/ui/dialog';
import { Skeleton } from '../components/ui/ui';
import { Account } from '../features/account/Account';
import { AccountMenu, type AccountSection } from '../features/account/AccountMenu';
import { LegacyMigrationCard } from '../features/account/LegacyMigrationCard';
import type { Tab } from './tabs';

// Chart-heavy screens are split out so the initial shell stays small.
const Dashboard = lazy(() => import('../features/dashboard/Dashboard').then((m) => ({ default: m.Dashboard })));
const Library = lazy(() => import('../features/playlists/Library').then((m) => ({ default: m.Library })));
const Analytics = lazy(() => import('../features/analytics/Analytics').then((m) => ({ default: m.Analytics })));
const Efficiency = lazy(() => import('../features/efficiency/Efficiency').then((m) => ({ default: m.Efficiency })));
const HistoryView = lazy(() => import('../features/history/History').then((m) => ({ default: m.HistoryView })));
const Focus = lazy(() => import('../features/focus/Focus').then((m) => ({ default: m.Focus })));
const Competition = lazy(() => import('../features/competition/Competition').then((m) => ({ default: m.Competition })));
const Revision = lazy(() => import('../features/revision/Revision').then((m) => ({ default: m.Revision })));
const Reports = lazy(() => import('../features/reports/Reports').then((m) => ({ default: m.Reports })));

function SectionLoading() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading section">
      <Skeleton className="h-24 w-full" />
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-36 w-full" />
      </div>
      <span className="sr-only">Loading section…</span>
    </div>
  );
}

export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Rendering never changes authoritative storage. Surfacing the error beats
    // a blank screen; reload re-reads the account or local store safely.
    console.error('LearnQuest UI error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-5 text-[var(--text)]">
          <h1 className="text-lg font-bold">Something went wrong in this view</h1>
          <p className="mt-1 text-sm text-[var(--text)]">
            Your stored learning data was not deleted here. Reload to re-read it; export a backup from
            Reports if the problem repeats.
          </p>
          <p className="mt-2 break-words font-mono text-[11px] text-red-800 dark:text-red-200">{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-3 rounded-lg bg-[var(--surface-hover)] px-3 py-2 text-sm hover:bg-[var(--surface-hover)]"
          >
            Reload LearnQuest
          </button>
        </div>
      </div>
    );
  }
}

interface NavItem {
  id: Tab;
  label: string;
  icon: React.ReactNode;
}

const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Learn',
    items: [
      { id: 'dash', label: 'Dashboard', icon: <LayoutDashboard size={17} /> },
      { id: 'learn', label: 'Library', icon: <ListVideo size={17} /> },
      { id: 'player', label: 'Player', icon: <Clapperboard size={17} /> },
    ],
  },
  {
    title: 'Plan',
    items: [
      { id: 'goals', label: 'Goals', icon: <Target size={17} /> },
      { id: 'checks', label: 'Checkpoints', icon: <CheckCircle2 size={17} /> },
      { id: 'focus', label: 'Focus', icon: <TimerIcon size={17} /> },
    ],
  },
  {
    title: 'Insights',
    items: [
      { id: 'analytics', label: 'Analytics', icon: <ChartLine size={17} /> },
      { id: 'efficiency', label: 'Efficiency', icon: <Gauge size={17} /> },
      { id: 'history', label: 'History', icon: <History size={17} /> },
      { id: 'revise', label: 'Revision', icon: <RefreshCw size={17} /> },
    ],
  },
  {
    title: 'Manage',
    items: [
      { id: 'modules', label: 'Modules', icon: <BookOpen size={17} /> },
      { id: 'competition', label: 'Arena', icon: <Swords size={17} /> },
      { id: 'reports', label: 'Reports', icon: <BarChart3 size={17} /> },
      { id: 'settings', label: 'Settings', icon: <SettingsIcon size={17} /> },
    ],
  },
];

const ALL_IDS = new Set<Tab>(GROUPS.flatMap((g) => g.items.map((i) => i.id)));

function tabFromHash(): Tab {
  const h = window.location.hash.replace(/^#\/?/, '');
  if (h.startsWith('account')) return 'account';
  return (ALL_IDS.has(h as Tab) ? h : 'dash') as Tab;
}

function accountSectionFromHash(): AccountSection {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/');
  if (parts[0] !== 'account') return 'profile';
  return parts[1] === 'settings' || parts[1] === 'security' ? parts[1] : 'profile';
}

function SyncIndicator() {
  const s = useStore();
  if (s.mode !== 'cloud') return null;
  // Persistent "saved" status is permanent noise; show the indicator only
  // while a real user action needs attention: in-flight save, failed save,
  // or conflicts awaiting a decision. Caught up = quiet header.
  if (s.syncStatus === 'saving') return <span className="text-[11px] text-[var(--text-muted)]" role="status">Saving…</span>;
  if (s.syncStatus === 'resolving') return <span className="text-[11px] text-[var(--text-muted)]" role="status">Reconciling changes…</span>;
  if (s.syncStatus === 'saved') return null;
  if (s.syncStatus === 'review') {
    return (
      <a href="#cloud-conflicts" className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-800 dark:text-amber-200 hover:bg-amber-500/25" title={s.syncError ?? 'Two devices changed the same records'}>
        Review {s.cloudConflicts.length} change{s.cloudConflicts.length === 1 ? '' : 's'}
      </a>
    );
  }
  if (s.syncStatus === 'error') {
    return (
      <button type="button" onClick={s.retryCloudSave} className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-800 dark:text-red-200 hover:bg-red-500/25" title={s.syncError ?? 'Save failed'}>
        Save failed · retry
      </button>
    );
  }
  return null;
}

const COLLECTION_LABELS: Record<string, string> = {
  playlists: 'Playlists', meta: 'Playlist details', activeId: 'Active playlist',
  progress: 'Lesson progress', ranges: 'Ranges', checkpoints: 'Checkpoints',
  modules: 'Modules', sessions: 'Focus sessions', goals: 'Daily goals', xp: 'XP',
  achievements: 'Achievements', segments: 'Playback history', playSessions: 'Play sessions',
  queue: 'Queues', flexGoals: 'Flexible goals', challenge: 'Arena settings',
  challengeEnabled: 'Arena setting', rankHistory: 'Rank history', settings: 'Settings',
  prefs: 'Preferences',
};

/**
 * A durable storage-migration freeze makes learning-data writes read-only.
 * The banner is explicit, does not hide the app, and does not imply the local
 * edits were saved or discarded.
 */
function MigrationReadOnlyBanner() {
  const s = useStore();
  if (s.mode !== 'cloud' || !s.migrationReadOnly) return null;
  return (
    <section
      role="status"
      aria-live="polite"
      aria-labelledby="migration-readonly-title"
      className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 p-3 text-sm"
    >
      <h2 id="migration-readonly-title" className="font-semibold text-cyan-800 dark:text-cyan-100">Learning data is temporarily read-only</h2>
      <p className="mt-1 text-xs text-cyan-800 dark:text-cyan-100/80">
        LearnQuest is finishing a storage-maintenance step. Your edits remain in this tab and are not lost.
        Keep this tab open; the next edit after the freeze is released will retry the save. Reading and
        navigation still work.
      </p>
    </section>
  );
}

/**
 * Two devices that edited the same record differently need an explicit
 * decision. The banner never auto-picks a side and never reloads away the
 * local edit.
 */
function CloudConflictBanner() {
  const s = useStore();
  if (s.mode !== 'cloud' || s.cloudConflicts.length === 0) return null;
  const collections = [...new Set(s.cloudConflicts.map((c) => c.collection))];
  return (
    <section id="cloud-conflicts" role="alert" aria-labelledby="cloud-conflicts-title" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <h2 id="cloud-conflicts-title" className="font-semibold text-amber-800 dark:text-amber-100">Two devices changed the same records</h2>
      <p className="mt-1 text-xs text-amber-800 dark:text-amber-100/80">
        Your local changes are still here. Nothing was overwritten. Choose which version to keep for each area;
        unrelated changes from both devices were already merged and saved.
      </p>
      <ul className="mt-2 space-y-2">
        {collections.map((collection) => (
          <li key={collection} className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--surface-soft)] p-2">
            <span className="min-w-0 flex-1 font-medium">{COLLECTION_LABELS[collection] ?? collection}</span>
            <span className="text-[11px] text-amber-800 dark:text-amber-100/70">
              {s.cloudConflicts.filter((c) => c.collection === collection).length} conflicting record(s)
            </span>
            <button type="button" onClick={() => s.resolveCloudConflict(collection, 'keep-local')} className="rounded-lg bg-amber-400/20 px-2.5 py-1 text-xs font-semibold hover:bg-amber-400/30">
              Keep this device
            </button>
            <button type="button" onClick={() => s.resolveCloudConflict(collection, 'use-server')} className="rounded-lg bg-[var(--surface-hover)] px-2.5 py-1 text-xs font-semibold hover:bg-[var(--surface-hover)]">
              Use server version
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AppInner() {
  const s = useStore();
  const [tab, setTab] = useState<Tab>(() => tabFromHash());
  const [drawer, setDrawer] = useState(false);
  const [accountSection, setAccountSection] = useState<AccountSection>(() => accountSectionFromHash());
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('lq-nav-collapsed') === '1');
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const lastTabRef = useRef<Tab | null>(null);
  const isAccountPage = tab === 'account';

  // hash routing: back/forward buttons work
  useEffect(() => {
    const onHash = () => {
      setTab(tabFromHash());
      setAccountSection(accountSectionFromHash());
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Entering Account from another route moves focus to the account page's
  // own heading. Switching account sections keeps the normal tab focus so a
  // keyboard user is not pulled away from the tab list on every selection.
  useEffect(() => {
    const enteredAccount = isAccountPage && lastTabRef.current !== 'account';
    lastTabRef.current = tab;
    if (!enteredAccount) return;
    const timer = window.setTimeout(() => {
      document.getElementById('account-page-title')?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isAccountPage, tab]);

  const go = useCallback((t: Tab) => {
    setTab(t);
    setDrawer(false);
    if (tabFromHash() !== t) window.location.hash = `/${t}`;
    window.scrollTo({ top: 0 });
  }, []);

  const goAccount = useCallback((section: AccountSection) => {
    setAccountSection(section);
    setTab('account');
    setDrawer(false);
    const target = `#/account/${section}`;
    if (window.location.hash !== target) window.location.hash = target;
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    localStorage.setItem('lq-nav-collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  // Mobile header height drives sticky offsets (Revision toolbar/scroll).
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () => {
      const h = Math.max(0, Math.round(el.getBoundingClientRect().height));
      document.documentElement.style.setProperty('--lq-mobile-header-h', `${h}px`);
    };
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener('resize', update);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  // Lock body scroll, trap focus inside the drawer, mark the page inert, and
  // restore focus to the opener. A drawer must never leak Tab into the page.
  useEffect(() => {
    if (!drawer) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : menuBtnRef.current;
    const background = Array.from(document.querySelectorAll<HTMLElement>('[data-app-background]'));
    for (const el of background) el.setAttribute('inert', '');
    const focusTimer = window.setTimeout(() => closeBtnRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setDrawer(false);
        return;
      }
      if (e.key !== 'Tab') return;
      const root = drawerRef.current;
      if (!root) return;
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      for (const el of background) el.removeAttribute('inert');
      previousFocus.current?.focus?.();
    };
  }, [drawer]);

  if (s.loadError) {
    // A failed read is not an empty database. The store deliberately refuses to
    // start the writer in this state, so retrying cannot lose existing records.
    return (
      <div className="mx-auto max-w-2xl p-6 text-[var(--text)]">
        <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-5">
          <h1 className="text-lg font-bold">Could not open your learning data</h1>
          <p className="mt-2 text-sm text-[var(--text)]">{s.loadError}</p>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            Nothing was overwritten and no defaults were saved. If this persists, retry before restoring a JSON backup;
            in local test mode, use the same browser profile because private windows cannot see the original IndexedDB.
          </p>
          <button
            type="button"
            onClick={s.retryLoad}
            className="mt-3 rounded-lg bg-[var(--surface-hover)] px-3 py-2 text-sm hover:bg-[var(--surface-hover)]"
          >
            Retry read
          </button>
        </div>
      </div>
    );
  }

  if (!s.ready) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-8" role="status" aria-label="Loading LearnQuest">
        <Skeleton className="h-32 w-full" />
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
        <p className="text-center text-sm text-[var(--text-muted)]">{s.mode === 'cloud' ? 'Loading your account learning data…' : 'Restoring your local learning data from IndexedDB.'}</p>
      </div>
    );
  }

  const snap = s.activeId ? s.playlists[s.activeId] : undefined;
  const displayTitle = snap && s.meta[snap.playlistId]?.customTitle ? s.meta[snap.playlistId].customTitle! : snap?.title;



  const navItem = (t: NavItem, compact: boolean, onNavigate?: () => void) => {
    const active = tab === t.id;
    return (
      <li key={t.id}>
        <button
          onClick={() => {
            go(t.id);
            onNavigate?.();
          }}
          aria-current={active ? 'page' : undefined}
          title={compact ? t.label : undefined}
          aria-label={compact ? t.label : undefined}
          className={`relative flex w-full items-center gap-2.5 rounded-md px-2 py-[7px] text-sm transition-colors ${
            active
              ? 'bg-[var(--surface-hover)] font-semibold text-[var(--text)]'
              : 'text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]'
          } ${compact ? 'justify-center px-0' : ''}`}
        >
          {active && (
            <span aria-hidden="true" className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-[var(--text)]" />
          )}
          <span className={`shrink-0 ${active ? 'text-[var(--text)]' : 'text-[var(--text-faint)]'}`} aria-hidden="true">{t.icon}</span>
          {!compact && <span className="truncate">{t.label}</span>}
        </button>
      </li>
    );
  };

  const navList = (compact: boolean, onNavigate?: () => void) => (
    <nav aria-label="Sections" className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 py-2">
      {GROUPS.map((g) => (
        <div key={g.title} role="group" aria-labelledby={`nav-group-${g.title}`}>
          {!compact && (
            <p id={`nav-group-${g.title}`} className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">{g.title}</p>
          )}
          <ul className="space-y-0.5">
            {g.items.map((t) => navItem(t, compact, onNavigate))}
          </ul>
        </div>
      ))}
      <div role="group" aria-labelledby="nav-group-account" className="border-t border-[var(--border)] pt-2">
        {!compact && (
          <p id="nav-group-account" className="px-2 pb-0.5 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Account</p>
        )}
        <ul className="space-y-0.5">
          {navItem({ id: 'account' as Tab, label: 'Account', icon: <UserRound size={17} /> }, compact, onNavigate)}
        </ul>
      </div>
    </nav>
  );

  return (
    <div
      data-reduced-motion={s.prefs.reducedMotion ? 'true' : 'false'}
      data-page={isAccountPage ? 'account' : 'workspace'}
      className="min-h-screen bg-[var(--page-bg)]"
    >
      <a
        href="#main-content"
        className="sr-only z-[100] rounded-md bg-[var(--surface-strong)] px-4 py-2 text-sm text-[var(--text)] focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to main content
      </a>
      {/* Desktop sidebar */}
      <aside
        data-app-background
        className={`fixed bottom-0 left-0 top-0 z-30 hidden flex-col border-r border-[var(--border)] bg-[var(--surface)] transition-[width] lg:flex ${
          collapsed ? 'w-[68px]' : 'w-60'
        }`}
        aria-label="Primary"
      >
        <div className={`flex items-center gap-2 border-b border-[var(--border)] px-3 py-3 ${collapsed ? 'justify-center' : ''}`}>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[var(--accent)] text-[11px] font-black text-[var(--accent-text)]">LQ</span>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-bold leading-none">LearnQuest</p>
              <p className="mt-0.5 truncate text-[10px] text-[var(--text-faint)]">Exact-duration tracker</p>
            </div>
          )}
        </div>
        {!collapsed && !isAccountPage && (
          <div className="px-3">
            <PlaylistSwitcher />
          </div>
        )}
        {navList(collapsed)}
        <div className="border-t border-[var(--border)] p-2">
          <button
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex w-full items-center justify-center gap-1 rounded-lg bg-[var(--surface-soft)] px-2 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
          >
            {collapsed ? <ChevronsRight size={15} /> : <><ChevronsLeft size={15} /> Collapse</>}
          </button>
        </div>
      </aside>

      {/* Mobile header */}
      <header ref={headerRef} data-app-background className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--page-bg)] lg:hidden">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <button
            ref={menuBtnRef}
            onClick={() => setDrawer(true)}
            aria-label="Open menu"
            aria-expanded={drawer}
            className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--surface-soft)] text-[var(--text)] hover:bg-[var(--surface-hover)]"
          >
            <Menu size={18} />
          </button>
          <span className="grid h-8 w-8 place-items-center rounded-md bg-[var(--accent)] text-[11px] font-black text-[var(--accent-text)]">LQ</span>
          <p className="mr-auto text-sm font-bold">{isAccountPage ? 'Account' : 'LearnQuest'}</p>
          {s.authUser && <AccountMenu onNavigate={goAccount} />}
        </div>
        {!isAccountPage && (
          <div className="px-3 pb-2">
            <PlaylistSwitcher />
          </div>
        )}
      </header>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="presentation">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="absolute bottom-0 left-0 top-0 flex w-72 max-w-[85vw] flex-col border-r border-[var(--border)] bg-[var(--surface)]"
          >
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[var(--accent)] text-[11px] font-black text-[var(--accent-text)]">LQ</span>
              <p className="mr-auto text-sm font-bold">LearnQuest</p>
              <button
                ref={closeBtnRef}
                onClick={() => {
                  setDrawer(false);
                  menuBtnRef.current?.focus();
                }}
                aria-label="Close menu"
                className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--surface-soft)] hover:bg-[var(--surface-hover)]"
              >
                <X size={17} />
              </button>
            </div>
            {navList(false, () => menuBtnRef.current?.focus())}
          </div>
        </div>
      )}

      {/* Content */}
      <div data-app-background className={collapsed ? 'lg:pl-[68px]' : 'lg:pl-60'}>
        {s.authUser && (
          <div className="sticky top-0 z-20 hidden border-b border-[var(--border)] bg-[var(--page-bg)] lg:block">
            <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-2">
              <div className="min-w-0 flex-1">
                {isAccountPage ? (
                  <p className="truncate text-xs font-semibold text-[var(--text)]">Account</p>
                ) : (
                  <>
                    <p className="truncate text-xs font-semibold text-[var(--text)]">{displayTitle ?? 'LearnQuest'}</p>
                    <p className="truncate text-[10px] text-[var(--text-faint)]">
                      {snap ? `N=${snap.entries.length} · ${snap.source} · fetched ${new Date(snap.fetchedAt).toLocaleString()}` : 'No active playlist'}
                    </p>
                  </>
                )}
              </div>
              <SyncIndicator />
              <AccountMenu onNavigate={goAccount} />
            </div>
          </div>
        )}
        <main id="main-content" className="mx-auto w-full max-w-6xl space-y-4 overflow-x-clip px-3 py-4 sm:px-4">
          <MigrationReadOnlyBanner />
          <CloudConflictBanner />
          {!isAccountPage && !snap && tab === 'dash' && <Onboarding onGo={(t) => go(t)} />}
          {!isAccountPage && <LegacyMigrationCard />}
          {!isAccountPage && s.lastDiff && (
            <div className="flex items-start gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-3 text-sm">
              <p className="min-w-0 flex-1">{s.lastDiff}</p>
              <button onClick={() => s.setLastDiff(null)} aria-label="Dismiss" className="shrink-0"><X size={16} /></button>
            </div>
          )}
          {!isAccountPage && s.celebration && (
            <div className="flex items-start gap-3 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-soft)] p-4">
              <PartyPopper className="mt-0.5 shrink-0 text-[var(--text)]" />
              <p className="min-w-0 flex-1 text-sm">{s.celebration}</p>
              <button onClick={s.clearCelebration} className="shrink-0 rounded-lg bg-[var(--surface-hover)] px-3 py-1.5 text-sm">Continue</button>
            </div>
          )}
          <Suspense fallback={<SectionLoading />}>
            {tab === 'dash' && <Dashboard />}
            {tab === 'learn' && <Library />}
            {tab === 'player' && <Player />}
            {tab === 'analytics' && <Analytics />}
            {tab === 'modules' && <Modules />}
            {tab === 'goals' && <Goals />}
            {tab === 'checks' && <Checkpoints />}
            {tab === 'focus' && <Focus />}
            {tab === 'efficiency' && <Efficiency />}
            {tab === 'competition' && <Competition />}
            {tab === 'revise' && <Revision />}
            {tab === 'history' && <HistoryView />}
            {tab === 'reports' && <Reports />}
            {tab === 'settings' && <Settings />}
            {tab === 'account' && <Account section={accountSection} onSection={goAccount} />}
          </Suspense>
        </main>

        <footer className="mx-auto max-w-6xl px-4 pb-10 text-center text-[11px] text-[var(--text-faint)]">
          {s.mode === 'cloud'
            ? 'Your learning data is stored with your account. Exports and backups are available in Reports and Account.'
            : 'Local test mode: progress lives in this browser (IndexedDB). Production builds use authenticated cloud persistence.'}
        </footer>
      </div>
      <Notifier />
      <DialogHost />
    </div>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <AppInner />
    </AppErrorBoundary>
  );
}
