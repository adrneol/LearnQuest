import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Play, ListVideo, Clapperboard, ChartLine, BookOpen, Target, CheckCircle2,
  Timer as TimerIcon, Gauge, Swords, RefreshCw, History, BarChart3, Settings as SettingsIcon,
  X, PartyPopper, Menu, ChevronsLeft, ChevronsRight,
} from 'lucide-react';
import { useStore } from './store';
import { checkApiHealth } from '../services/api/playlistApi';
import { PlaylistSwitcher, Onboarding } from '../features/playlists/Playlists';
import { Dashboard } from '../features/dashboard/Dashboard';
import { Library } from '../features/playlists/Library';
import { Player } from '../features/player/Player';
import { Analytics } from '../features/analytics/Analytics';
import { Modules } from '../features/modules/Modules';
import { Goals } from '../features/goals/Goals';
import { Checkpoints } from '../features/checkpoints/Checkpoints';
import { Focus } from '../features/focus/Focus';
import { Efficiency } from '../features/efficiency/Efficiency';
import { Competition } from '../features/competition/Competition';
import { Revision } from '../features/revision/Revision';
import { HistoryView } from '../features/history/History';
import { Reports } from '../features/reports/Reports';
import { Settings } from '../features/settings/Settings';
import { Notifier } from '../components/layout/Notifier';
import { DialogHost } from '../components/ui/dialog';
import type { Tab } from './tabs';

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
  return (ALL_IDS.has(h as Tab) ? h : 'dash') as Tab;
}

export default function App() {
  const s = useStore();
  const [tab, setTab] = useState<Tab>(() => tabFromHash());
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('lq-nav-collapsed') === '1');
  const [health, setHealth] = useState<{ ok: boolean; hasKey: boolean }>({ ok: false, hasKey: false });
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    checkApiHealth().then(setHealth);
  }, []);

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

  useEffect(() => {
    localStorage.setItem('lq-nav-collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  // lock body scroll + Escape handling for the drawer
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawer(false);
        menuBtnRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [drawer]);

  if (!s.ready) {
    return (
      <div className="mx-auto max-w-3xl p-8 text-center text-slate-300">
        <p className="text-lg font-semibold">Loading LearnQuest…</p>
        <p className="text-sm text-slate-500">Restoring your local learning data from IndexedDB.</p>
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
    <div className="min-h-screen bg-[#0b0e1a] bg-[radial-gradient(ellipse_at_top,rgba(124,58,237,0.18),transparent_60%),radial-gradient(ellipse_at_bottom,rgba(34,211,238,0.08),transparent_60%)]">
      {/* Desktop sidebar */}
      <aside
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
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#0b0e1a]/90 backdrop-blur lg:hidden">
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
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="absolute bottom-0 left-0 top-0 flex w-72 max-w-[85vw] flex-col border-r border-white/10 bg-[#0d1122]"
          >
            <div className="flex items-center gap-2 border-b border-white/10 px-3 py-3">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-violet-600 to-cyan-500 text-xs font-black">LQ</span>
              <p className="mr-auto text-sm font-bold">LearnQuest</p>
              <button
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
      <div className={collapsed ? 'lg:pl-[68px]' : 'lg:pl-60'}>
        <main className="mx-auto w-full max-w-6xl space-y-4 overflow-x-clip px-3 py-4 sm:px-4">
          {!snap && <Onboarding onGo={(t) => go(t)} />}
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
        </main>

        <footer className="mx-auto max-w-6xl px-4 pb-10 text-center text-[11px] text-slate-600">
          Local-first: progress lives in your browser (IndexedDB). Export JSON backups regularly — no cloud sync.
        </footer>
      </div>
      <Notifier />
      <DialogHost />
    </div>
  );
}
