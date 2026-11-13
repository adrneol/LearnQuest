import React, { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X, Check, BookOpenCheck } from 'lucide-react';
import { useStore } from './store';
import { PlaylistSwitcher, Onboarding } from '../features/playlists/Playlists';
import { Player } from '../features/player/Player';
import { Modules } from '../features/modules/Modules';
import { Goals } from '../features/goals/Goals';
import { Checkpoints } from '../features/checkpoints/Checkpoints';
import { Settings } from '../features/settings/Settings';
import { Notifier } from '../components/layout/Notifier';
import { DialogHost } from '../components/ui/dialog';
import { NavigationDock } from '../components/navigation/NavigationDock';
import { destinations, groupForRoute, routeGroups, routeIds } from './routes';
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
  return routeIds.has(h as Tab) ? h as Tab : null;
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

function Brand() {
  return (
    <div className="lq-brand" translate="no">
      <span className="lq-brand-mark" aria-hidden="true"><BookOpenCheck size={21} strokeWidth={1.65} /></span>
      <span>LearnQuest</span>
    </div>
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

function CloudRecoveryBanner() {
  const s = useStore();
  const draft = s.cloudRecoveryDraft;
  if (s.mode !== 'cloud' || !draft) return null;
  const collections = Object.keys(draft.collections).map((name) => COLLECTION_LABELS[name] ?? name);
  // Recovery applies local state and queues a cloud write; the migration
  // read-only freeze rejects cloud writes, so offer it only after the freeze
  // clears. Discarding the local copy stays available — deleting an
  // account-scoped draft cannot hurt the account.
  const readOnly = s.migrationReadOnly;
  return (
    <section role="status" aria-live="polite" aria-labelledby="cloud-recovery-title" className="lq-alert lq-alert--info">
      <h2 id="cloud-recovery-title" className="font-semibold">Local recovery changes are available</h2>
      <p className="mt-1">
        This browser retained unfinished changes from {new Date(draft.updatedAt).toLocaleString()}. They are not saved to your account yet.
        Recovering compares them with the current account version before saving.
      </p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">Affected areas: {collections.join(', ')}.</p>
      {readOnly && (
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          LearnQuest is finishing storage maintenance. Recovery unlocks when it completes; you may keep this tab open or discard the local copy.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Btn disabled={readOnly} onClick={s.restoreCloudRecoveryDraft}>Review and recover changes</Btn>
        <Btn variant="quiet" onClick={s.discardCloudRecoveryDraft}>Discard local recovery copy</Btn>
      </div>
    </section>
  );
}

function AppInner() {
  const s = useStore();
  const [tab, setTab] = useState<Tab>(() => tabFromHash() ?? 'dash');
  const [accountSection, setAccountSection] = useState<AccountSection>(() => accountSectionFromHash());
  const headerRef = useRef<HTMLElement>(null);
  const lastTabRef = useRef<Tab | null>(null);
  const isAccountPage = tab === 'account';

  useEffect(() => {
    const onHash = () => {
      const next = tabFromHash();
      if (next === null) return; // Ordinary document anchors are not routes.
      setTab(next);
      setAccountSection(accountSectionFromHash());
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((t: Tab) => {
    setTab(t);
    if (tabFromHash() !== t) window.location.hash = `/${t}`;
    window.scrollTo({ top: 0 });
  }, []);

  const goAccount = useCallback((section: AccountSection) => {
    setAccountSection(section);
    setTab('account');
    const target = `#/account/${section}`;
    if (window.location.hash !== target) window.location.hash = target;
    window.scrollTo({ top: 0 });
  }, []);

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
  const pageGroup = routeGroups[groupForRoute(tab)].title;

  return (
    <div
      data-reduced-motion={s.prefs.reducedMotion ? 'true' : 'false'}
      data-page={isAccountPage ? 'account' : 'workspace'}
      className="lq-shell"
    >
      <a data-app-background href="#main-content" className="lq-skip"
        onClick={(event) => followInApp(event, () => focusSection('main-content'))}>
        Skip to main content
      </a>

      <NavigationDock tab={tab} onNavigate={go} />

      <div data-app-background className="lq-workspace">
        <header ref={headerRef} className="lq-topbar">
          <div className="lq-topbar-inner">
            <Brand />
            {!isAccountPage && <div className="lq-topbar-playlist"><PlaylistSwitcher /></div>}
            <div className="lq-topbar-actions">
              <SyncIndicator />
              {s.authUser && <AccountMenu onNavigate={goAccount} />}
            </div>
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="lq-main" data-route={tab}
          aria-labelledby={isAccountPage ? 'account-page-title' : 'workspace-page-title'}>
          {!isAccountPage && (
            <div className="lq-page-heading">
              <span className="lq-page-group">{pageGroup}</span>
              <h1 id="workspace-page-title" tabIndex={-1}>{pageTitle}</h1>
              <p>{PAGE_DESCRIPTIONS[tab]}</p>
            </div>
          )}
          <MigrationReadOnlyBanner />
          <CloudRecoveryBanner />
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
