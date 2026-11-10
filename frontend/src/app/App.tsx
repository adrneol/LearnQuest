import React, { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  LayoutDashboard, ListVideo, Clapperboard, ChartLine, BookOpen, Target, CheckCircle2,
  Timer as TimerIcon, Gauge, Swords, RefreshCw, History, BarChart3, Settings as SettingsIcon,
  X, Check, Menu, PanelLeftClose, PanelLeftOpen, UserRound, BookOpenCheck,
} from 'lucide-react';
import { useStore } from './store';
import { PlaylistSwitcher, Onboarding } from '../features/playlists/Playlists';
import { Player } from '../features/player/Player';
import { Modules } from '../features/modules/Modules';
import { Goals } from '../features/goals/Goals';
import { Checkpoints } from '../features/checkpoints/Checkpoints';
import { Settings } from '../features/settings/Settings';
import { Notifier } from '../components/layout/Notifier';
import { DialogHost, lockPageScroll } from '../components/ui/dialog';
import { Btn, Skeleton } from '../components/ui/ui';
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

const ACCOUNT_ITEM: NavItem = { id: 'account', label: 'Account', icon: <UserRound size={17} /> };
const destinations = GROUPS.flatMap(({ items }) => items);
const ALL_IDS = new Set<Tab>(destinations.map(({ id }) => id));
const PAGE_DESCRIPTIONS: Record<Exclude<Tab, 'account'>, string> = {
  dash: 'Pick up where you left off and see what’s next.',
  learn: 'Find lessons, compare durations, and save ranges to study.',
  player: 'Watch lessons and keep your learning notes in one place.',
  goals: 'Set targets for your study time and progress.',
  checks: 'Track milestones and review saved ranges.',
  focus: 'Start a study block and review your focused time.',
  analytics: 'Explore the composition of your playlist and your progress through it.',
  efficiency: 'Compare recorded study time and learning activity.',
  history: 'Review sessions, playback evidence, and self-reported entries.',
  revise: 'Return to lessons you’ve flagged for another look.',
  modules: 'Group related lessons and track them together.',
  competition: 'Compare your progress with a simulated cohort.',
  reports: 'Review your playlists and export or restore learning data.',
  settings: 'Adjust appearance, study preferences, and connection settings.',
};

function tabFromHash(): Tab | null {
  const h = window.location.hash.replace(/^#\/?/, '');
  if (!h) return 'dash';
  if (/^account(?:\/|$)/.test(h)) return 'account';
  return ALL_IDS.has(h as Tab) ? h as Tab : null;
}

function followInApp(event: React.MouseEvent<HTMLAnchorElement>, navigate: () => void) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate();
}

function focusSection(id: string) {
  const target = document.getElementById(id);
  target?.focus({ preventScroll: true });
  target?.scrollIntoView?.({ block: 'start' });
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="lq-brand" translate="no">
      <span className="lq-brand-mark" aria-hidden="true"><BookOpenCheck size={20} strokeWidth={1.7} /></span>
      {!compact && <span>LearnQuest</span>}
    </div>
  );
}

function WorkspaceNav({ tab, compact = false, onNavigate }: {
  tab: Tab; compact?: boolean; onNavigate: (tab: Tab) => void;
}) {
  const item = ({ id, label, icon }: NavItem) => (
    <li key={id}>
      <a href={`#/${id}`} className="lq-nav-link" aria-current={tab === id ? 'page' : undefined}
        title={compact ? label : undefined} onClick={(event) => followInApp(event, () => onNavigate(id))}>
        <span className="lq-nav-icon" aria-hidden="true">{icon}</span>
        <span className={compact ? 'sr-only' : 'truncate'}>{label}</span>
      </a>
    </li>
  );
  return (
    <nav aria-label="Sections" className="lq-navigation">
      {GROUPS.map(({ title, items }) => (
        <div key={title} className="lq-nav-group">
          {!compact && <p className="lq-nav-label">{title}</p>}
          <ul aria-label={title}>{items.map(item)}</ul>
        </div>
      ))}
      <ul aria-label="Account" className="lq-nav-account">{item(ACCOUNT_ITEM)}</ul>
    </nav>
  );
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
  if (s.syncStatus === 'saving') return <span className="lq-sync" role="status">Saving…</span>;
  if (s.syncStatus === 'resolving') return <span className="lq-sync" role="status">Reconciling changes…</span>;
  if (s.syncStatus === 'saved') return null;
  if (s.syncStatus === 'review') {
    return (
      <a href="#cloud-conflicts" className="lq-sync lq-sync--review" onClick={(event) => followInApp(event, () => focusSection('cloud-conflicts'))} title={s.syncError ?? 'Two devices changed the same records'}>
        Review {s.cloudConflicts.length} change{s.cloudConflicts.length === 1 ? '' : 's'}
      </a>
    );
  }
  if (s.syncStatus === 'error') {
    return (
      <button type="button" onClick={s.retryCloudSave} className="lq-sync lq-sync--error" title={s.syncError ?? 'Save failed'}>
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
      className="lq-alert lq-alert--info"
    >
      <h2 id="migration-readonly-title" className="font-semibold">Learning data is temporarily read-only</h2>
      <p className="mt-1">
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
    <section id="cloud-conflicts" tabIndex={-1} role="alert" aria-labelledby="cloud-conflicts-title" className="lq-alert lq-alert--warning">
      <h2 id="cloud-conflicts-title" className="font-semibold">Two devices changed the same records</h2>
      <p className="mt-1">
        Your local changes are still here. Nothing was overwritten. Choose which version to keep for each area;
        unrelated changes from both devices were already merged and saved.
      </p>
      <ul className="mt-2 space-y-2">
        {collections.map((collection) => (
          <li key={collection} className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--surface-soft)] p-2">
            <span className="min-w-0 flex-1 font-medium">{COLLECTION_LABELS[collection] ?? collection}</span>
            <span className="text-xs">
              {s.cloudConflicts.filter((c) => c.collection === collection).length} conflicting record(s)
            </span>
            <Btn onClick={() => s.resolveCloudConflict(collection, 'keep-local')}>
              Keep this device
            </Btn>
            <Btn onClick={() => s.resolveCloudConflict(collection, 'use-server')}>
              Use server version
            </Btn>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AppInner() {
  const s = useStore();
  const [tab, setTab] = useState<Tab>(() => tabFromHash() ?? 'dash');
  const [drawer, setDrawer] = useState(false);
  const [accountSection, setAccountSection] = useState<AccountSection>(() => accountSectionFromHash());
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('lq-nav-collapsed') === '1');
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const lastTabRef = useRef<Tab | null>(null);
  const isAccountPage = tab === 'account';

  useEffect(() => {
    const onHash = () => {
      const next = tabFromHash();
      if (next === null) return; // Ordinary document anchors are not routes.
      setTab(next);
      setAccountSection(accountSectionFromHash());
      setDrawer(false);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

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
      document.documentElement.style.removeProperty('--lq-mobile-header-h');
    };
  }, [s.ready, s.loadError]);

  useLayoutEffect(() => {
    if (!drawer || !s.ready || s.loadError) return;
    const desktop = window.matchMedia?.('(min-width: 64rem)');
    if (desktop?.matches) {
      setDrawer(false);
      return;
    }
    const opener = menuBtnRef.current;
    const sidebar = sidebarRef.current;
    const background = Array.from(document.querySelectorAll<HTMLElement>('[data-app-background]:not([inert])'));
    for (const el of background) el.setAttribute('inert', '');
    const unlockScroll = lockPageScroll();
    closeBtnRef.current?.focus();

    const onBreakpoint = (event: MediaQueryListEvent) => {
      if (event.matches) setDrawer(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setDrawer(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = drawerRef.current;
      const links = panel?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]');
      if (!panel || !links?.length) return;
      const first = links[0];
      const last = links[links.length - 1];
      const active = document.activeElement;
      if (!panel.contains(active) || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    desktop?.addEventListener('change', onBreakpoint);
    document.addEventListener('keydown', onKey);
    return () => {
      desktop?.removeEventListener('change', onBreakpoint);
      document.removeEventListener('keydown', onKey);
      unlockScroll();
      for (const el of background) el.removeAttribute('inert');
      const returnTarget = desktop?.matches
        ? sidebar?.querySelector<HTMLElement>('[aria-current="page"]')
        : opener;
      returnTarget?.focus({ preventScroll: true });
    };
  }, [drawer, s.ready, s.loadError]);

  useLayoutEffect(() => {
    if (!s.ready || s.loadError) return;
    const previous = lastTabRef.current;
    lastTabRef.current = tab;
    if (previous === tab || (previous === null && tab !== 'account')) return;
    const heading = tab === 'account' ? 'account-page-title' : 'workspace-page-title';
    document.getElementById(heading)?.focus({ preventScroll: true });
  }, [tab, s.ready, s.loadError]);

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
  const pageTitle = isAccountPage ? 'Account' : destinations.find(({ id }) => id === tab)?.label ?? 'Dashboard';
  const pageGroup = GROUPS.find(({ items }) => items.some(({ id }) => id === tab))?.title ?? 'Account';

  return (
    <div
      data-reduced-motion={s.prefs.reducedMotion ? 'true' : 'false'}
      data-page={isAccountPage ? 'account' : 'workspace'}
      data-compact={collapsed}
      className="lq-shell"
    >
      <a data-app-background href="#main-content" className="lq-skip"
        onClick={(event) => followInApp(event, () => focusSection('main-content'))}>
        Skip to main content
      </a>

      <aside ref={sidebarRef} data-app-background className="lq-sidebar" aria-label="Primary">
        <div className="lq-sidebar-head"><Brand compact={collapsed} /></div>
        <WorkspaceNav tab={tab} compact={collapsed} onNavigate={go} />
        <div className="lq-sidebar-foot">
          <Btn variant="quiet" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)} className="w-full">
            {collapsed ? <PanelLeftOpen size={17} aria-hidden="true" /> : <><PanelLeftClose size={17} aria-hidden="true" /> Collapse sidebar</>}
          </Btn>
        </div>
      </aside>

      {drawer && (
        <div className="lq-drawer-layer" role="presentation">
          <div className="lq-drawer-overlay" aria-hidden="true" onClick={() => setDrawer(false)} />
          <div id="workspace-drawer" ref={drawerRef} role="dialog" aria-modal="true" aria-label="Menu" className="lq-drawer">
            <div className="lq-drawer-head">
              <Brand />
              <Btn variant="quiet" ref={closeBtnRef} aria-label="Close menu" onClick={() => setDrawer(false)} className="w-11 px-0">
                <X size={19} aria-hidden="true" />
              </Btn>
            </div>
            <WorkspaceNav tab={tab} onNavigate={go} />
          </div>
        </div>
      )}

      <div data-app-background className="lq-workspace">
        <header ref={headerRef} className="lq-topbar">
          <div className="lq-topbar-inner">
            <Btn ref={menuBtnRef} variant="quiet" aria-label="Open menu" aria-expanded={drawer}
              aria-controls={drawer ? 'workspace-drawer' : undefined} aria-haspopup="dialog"
              onClick={() => setDrawer(true)} className="lq-menu-toggle">
              <Menu size={20} aria-hidden="true" />
            </Btn>
            <p className="lq-topbar-location">
              <span className="lg:hidden">{pageTitle}</span>
              <span className="hidden lg:inline">{pageGroup}</span>
            </p>
            {!isAccountPage && <div className="lq-topbar-playlist"><PlaylistSwitcher /></div>}
            <div className="lq-topbar-actions">
              <SyncIndicator />
              {s.authUser && <AccountMenu onNavigate={goAccount} />}
            </div>
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="lq-main" aria-labelledby={isAccountPage ? 'account-page-title' : 'workspace-page-title'}>
          {!isAccountPage && (
            <div className="lq-page-heading">
              <h1 id="workspace-page-title" tabIndex={-1}>{pageTitle}</h1>
              <p>{PAGE_DESCRIPTIONS[tab]}</p>
            </div>
          )}
          <MigrationReadOnlyBanner />
          <CloudConflictBanner />
          {!isAccountPage && !snap && tab === 'dash' && <Onboarding onGo={(t) => go(t)} />}
          {!isAccountPage && <LegacyMigrationCard />}
          {!isAccountPage && s.lastDiff && (
            <div role="status" className="lq-alert lq-alert--info flex items-start gap-2">
              <p className="min-w-0 flex-1">{s.lastDiff}</p>
              <button onClick={() => s.setLastDiff(null)} aria-label="Dismiss" className="shrink-0"><X size={16} /></button>
            </div>
          )}
          {!isAccountPage && s.celebration && (
            <div role="status" className="lq-alert lq-alert--success flex items-start gap-3">
              <Check className="mt-0.5 shrink-0" size={18} aria-hidden="true" />
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

        <footer className="lq-footer">
          {s.mode === 'cloud'
            ? 'Your learning data is stored with your account. Exports and backups are available in Reports and Account.'
            : 'Local workspace. Learning data is stored in this browser.'}
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
