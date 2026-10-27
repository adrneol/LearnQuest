import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  Play, ListVideo, Clapperboard, ChartLine, BookOpen, Target, CheckCircle2,
  Timer as TimerIcon, Gauge, Swords, RefreshCw, History, BarChart3, Settings as SettingsIcon,
  X, PartyPopper, Menu, ChevronsLeft, ChevronsRight,
} from 'lucide-react';
import { useStore } from './store';
import { checkApiHealth } from '../services/api/playlistApi';
import { PlaylistSwitcher, Onboarding } from '../features/playlists/Playlists';
import { Player } from '../features/player/Player';
import { Modules } from '../features/modules/Modules';
import { Goals } from '../features/goals/Goals';
import { Checkpoints } from '../features/checkpoints/Checkpoints';
import { Settings } from '../features/settings/Settings';
import { Notifier } from '../components/layout/Notifier';
import { DialogHost } from '../components/ui/dialog';
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
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-sm text-slate-400" role="status">
      Loading section…
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
        <div role="alert" className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-slate-100">
          <h1 className="text-lg font-bold">Something went wrong in this view</h1>
          <p className="mt-1 text-sm text-slate-300">
            Your stored learning data was not deleted here. Reload to re-read it; export a backup from
            Reports if the problem repeats.
          </p>
          <p className="mt-2 break-words font-mono text-[11px] text-red-200">{this.state.error.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-sm hover:bg-white/15"
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
      { id: 'dash', label: 'Dashboard', icon: <Play size={17} /> },
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

function SyncIndicator() {
  const s = useStore();
  if (s.mode !== 'cloud') return null;
  if (s.syncStatus === 'saving') return <span className="rounded-full bg-amber-500/15 px-2 py-1 text-[11px] text-amber-200" role="status">Saving…</span>;
  if (s.syncStatus === 'saved') return <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[11px] text-emerald-200" role="status">Saved</span>;
  if (s.syncStatus === 'conflict') {
    return (
      <button type="button" onClick={() => { void s.reloadCloudData(); }} className="rounded-full bg-red-500/15 px-2 py-1 text-[11px] text-red-200 hover:bg-red-500/25" title={s.syncError ?? 'Save conflict'}>
        Save conflict · reload
      </button>
    );
  }
  if (s.syncStatus === 'error') {
    return (
      <button type="button" onClick={s.retryCloudSave} className="rounded-full bg-red-500/15 px-2 py-1 text-[11px] text-red-200 hover:bg-red-500/25" title={s.syncError ?? 'Save failed'}>
        Save failed · retry
      </button>
    );
  }
  return <span className="rounded-full bg-white/5 px-2 py-1 text-[11px] text-slate-400" role="status">Cloud account</span>;
}

function AppInner() {
  const s = useStore();
  const [tab, setTab] = useState<Tab>(() => tabFromHash());
  const [drawer, setDrawer] = useState(false);
  const [accountSection, setAccountSection] = useState<AccountSection>('profile');
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('lq-nav-collapsed') === '1');
  const [health, setHealth] = useState<{ ok: boolean; hasKey: boolean }>({ ok: false, hasKey: false });
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    checkApiHealth().then(setHealth);
  }, []);

  // While the backend is unreachable, retry the cheap health check whenever
  // the tab regains focus/visibility (cold-start wake, outage recovery) so
  // the status pill recovers without a page reload. Silent while healthy:
  // zero extra traffic once connected.
  useEffect(() => {
    if (health.ok) return;
    const recheck = () => {
      checkApiHealth().then(setHealth);
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') recheck();
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [health.ok]);

  // hash routing: back/forward buttons work
  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
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
    go('account');
  }, [go]);

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
      <div className="mx-auto max-w-2xl p-6 text-slate-200">
        <div role="alert" className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5">
          <h1 className="text-lg font-bold">Could not open your learning data</h1>
          <p className="mt-2 text-sm text-slate-300">{s.loadError}</p>
          <p className="mt-2 text-xs text-slate-400">
            Nothing was overwritten and no defaults were saved. If this persists, retry before restoring a JSON backup;
            in local test mode, use the same browser profile because private windows cannot see the original IndexedDB.
          </p>
          <button
            type="button"
            onClick={s.retryLoad}
            className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-sm hover:bg-white/15"
          >
            Retry read
          </button>
        </div>
      </div>
    );
  }

  if (!s.ready) {
    return (
      <div className="mx-auto max-w-3xl p-8 text-center text-slate-300">
        <p className="text-lg font-semibold">Loading LearnQuest…</p>
        <p className="text-sm text-slate-500">{s.mode === 'cloud' ? 'Loading your account learning data…' : 'Restoring your local learning data from IndexedDB.'}</p>
      </div>
    );
  }

  const snap = s.activeId ? s.playlists[s.activeId] : undefined;
  const displayTitle = snap && s.meta[snap.playlistId]?.customTitle ? s.meta[snap.playlistId].customTitle! : snap?.title;

  const statusTone = health.ok && health.hasKey
    ? 'bg-emerald-500/15 text-emerald-300'
    : health.ok
      ? 'bg-amber-500/15 text-amber-300'
      : 'bg-white/5 text-slate-400';
  const statusText = health.ok ? (health.hasKey ? '● API ready' : '● API key missing') : '○ API offline';

  const navList = (compact: boolean, onNavigate?: () => void) => (
    <nav aria-label="Sections" className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 py-2">
      {GROUPS.map((g) => (
        <div key={g.title}>
          {!compact && (
            <p className="px-3 pb-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">{g.title}</p>
          )}
          <ul className="space-y-0.5">
            {g.items.map((t) => {
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
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-1.5 text-sm transition ${
                      active ? 'bg-violet-600 font-semibold text-white shadow-lg shadow-violet-900/40' : 'text-slate-300 hover:bg-white/10'
                    } ${compact ? 'justify-center px-0' : ''}`}
                  >
                    <span className="shrink-0">{t.icon}</span>
                    {!compact && <span className="truncate">{t.label}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const statusButton = (compact: boolean) => (
    <button
      onClick={() => {
        go('settings');
      }}
      title={health.ok ? (health.hasKey ? 'API online, key configured' : 'API online but key missing — open Settings for setup steps') : 'API offline — import JSON still works'}
      aria-label={compact ? `Connection status: ${statusText} — open Settings` : undefined}
      className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[11px] ${statusTone} ${compact ? 'justify-center px-0' : ''}`}
    >
      <span className="shrink-0" aria-hidden="true">{health.ok && health.hasKey ? '●' : health.ok ? '●' : '○'}</span>
      {!compact && <span className="truncate">{statusText} — setup</span>}
    </button>
  );

  return (
    <div
      data-reduced-motion={s.prefs.reducedMotion ? 'true' : 'false'}
      className="min-h-screen bg-[#0b0e1a] bg-[radial-gradient(ellipse_at_top,rgba(124,58,237,0.18),transparent_60%),radial-gradient(ellipse_at_bottom,rgba(34,211,238,0.08),transparent_60%)]"
    >
      {/* Desktop sidebar */}
      <aside
        data-app-background
        className={`fixed bottom-0 left-0 top-0 z-30 hidden flex-col border-r border-white/10 bg-[#0d1122]/95 backdrop-blur transition-[width] lg:flex ${
          collapsed ? 'w-[68px]' : 'w-60'
        }`}
        aria-label="Primary"
      >
        <div className={`flex items-center gap-2 px-3 py-3 ${collapsed ? 'justify-center' : ''}`}>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-600 to-cyan-500 text-sm font-black">LQ</span>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-bold leading-none">LearnQuest</p>
              <p className="truncate text-[11px] text-slate-400">exact-duration tracker</p>
            </div>
          )}
        </div>
        {!collapsed && (
          <div className="px-3">
            <PlaylistSwitcher />
          </div>
        )}
        {navList(collapsed)}
        <div className="space-y-2 border-t border-white/10 p-2">
          {statusButton(collapsed)}
          <button
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex w-full items-center justify-center gap-1 rounded-xl bg-white/5 px-2 py-1.5 text-xs text-slate-400 hover:bg-white/10"
          >
            {collapsed ? <ChevronsRight size={15} /> : <><ChevronsLeft size={15} /> Collapse</>}
          </button>
        </div>
      </aside>

      {/* Mobile header */}
      <header ref={headerRef} data-app-background className="sticky top-0 z-20 border-b border-white/10 bg-[#0b0e1a]/90 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <button
            ref={menuBtnRef}
            onClick={() => setDrawer(true)}
            aria-label="Open menu"
            aria-expanded={drawer}
            className="grid h-9 w-9 place-items-center rounded-xl bg-white/5 text-slate-200 hover:bg-white/10"
          >
            <Menu size={18} />
          </button>
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-violet-600 to-cyan-500 text-xs font-black">LQ</span>
          <p className="mr-auto text-sm font-bold">LearnQuest</p>
          <button
            onClick={() => go('settings')}
            className={`rounded-full px-2 py-1 text-[11px] ${statusTone}`}
            title="Connection status — open Settings"
          >
            {health.ok && health.hasKey ? '●' : health.ok ? '● key?' : '○'}
          </button>
          {s.authUser && <AccountMenu onNavigate={goAccount} />}
        </div>
        <div className="px-3 pb-2">
          <PlaylistSwitcher />
        </div>
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
            className="absolute bottom-0 left-0 top-0 flex w-72 max-w-[85vw] flex-col border-r border-white/10 bg-[#0d1122]"
          >
            <div className="flex items-center gap-2 border-b border-white/10 px-3 py-3">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-violet-600 to-cyan-500 text-xs font-black">LQ</span>
              <p className="mr-auto text-sm font-bold">LearnQuest</p>
              <button
                ref={closeBtnRef}
                onClick={() => {
                  setDrawer(false);
                  menuBtnRef.current?.focus();
                }}
                aria-label="Close menu"
                className="grid h-9 w-9 place-items-center rounded-xl bg-white/5 hover:bg-white/10"
              >
                <X size={17} />
              </button>
            </div>
            {navList(false, () => menuBtnRef.current?.focus())}
            <div className="border-t border-white/10 p-2">{statusButton(false)}</div>
          </div>
        </div>
      )}

      {/* Content */}
      <div data-app-background className={collapsed ? 'lg:pl-[68px]' : 'lg:pl-60'}>
        {s.authUser && (
          <div className="sticky top-0 z-20 hidden border-b border-white/10 bg-[#0b0e1a]/90 backdrop-blur lg:block">
            <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-slate-200">{displayTitle ?? 'LearnQuest'}</p>
                <p className="truncate text-[10px] text-slate-500">
                  {snap ? `N=${snap.entries.length} · ${snap.source} · fetched ${new Date(snap.fetchedAt).toLocaleString()}` : 'No active playlist'}
                </p>
              </div>
              <SyncIndicator />
              <AccountMenu onNavigate={goAccount} />
            </div>
          </div>
        )}
        <main className="mx-auto w-full max-w-6xl space-y-4 overflow-x-clip px-3 py-4 sm:px-4">
          {!snap && <Onboarding onGo={(t) => go(t)} />}
          <LegacyMigrationCard />
          {s.lastDiff && (
            <div className="flex items-start gap-2 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-3 text-sm">
              <p className="min-w-0 flex-1">{s.lastDiff}</p>
              <button onClick={() => s.setLastDiff(null)} aria-label="Dismiss" className="shrink-0"><X size={16} /></button>
            </div>
          )}
          {s.celebration && (
            <div className="flex items-start gap-3 rounded-2xl border border-violet-500/40 bg-gradient-to-r from-violet-600/25 to-cyan-500/15 p-4">
              <PartyPopper className="mt-0.5 shrink-0 text-violet-300" />
              <p className="min-w-0 flex-1 text-sm">{s.celebration}</p>
              <button onClick={s.clearCelebration} className="shrink-0 rounded-xl bg-white/10 px-3 py-1.5 text-sm">Continue</button>
            </div>
          )}
          {snap && (
            <p className="truncate text-xs text-slate-500">
              Active playlist: <span className="text-slate-300">{displayTitle}</span> · N={snap.entries.length} · {snap.source} · fetched {new Date(snap.fetchedAt).toLocaleString()}
            </p>
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
            {tab === 'account' && <Account section={accountSection} onSection={setAccountSection} />}
          </Suspense>
        </main>

        <footer className="mx-auto max-w-6xl px-4 pb-10 text-center text-[11px] text-slate-600">
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
