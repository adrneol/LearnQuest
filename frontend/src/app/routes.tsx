import {
  BarChart3, BookOpen, CheckCircle2, Clapperboard, ChartLine, Compass,
  Gauge, History, LayoutDashboard, ListVideo, RefreshCw, Settings,
  Swords, Target, Timer, UserRound, type LucideIcon,
} from 'lucide-react';
import type { Tab } from './tabs';

interface Destination { id: Tab; label: string; icon: LucideIcon }
interface RouteGroup { title: string; icon: LucideIcon; items: Destination[] }

export const routeGroups: RouteGroup[] = [
  {
    title: 'Learn', icon: BookOpen, items: [
      { id: 'dash', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'learn', label: 'Library', icon: ListVideo },
      { id: 'player', label: 'Player', icon: Clapperboard },
      { id: 'goals', label: 'Goals', icon: Target },
      { id: 'checks', label: 'Checkpoints', icon: CheckCircle2 },
      { id: 'focus', label: 'Focus', icon: Timer },
    ],
  },
  {
    title: 'Insights', icon: ChartLine, items: [
      { id: 'analytics', label: 'Analytics', icon: ChartLine },
      { id: 'efficiency', label: 'Efficiency', icon: Gauge },
      { id: 'history', label: 'History', icon: History },
      { id: 'revise', label: 'Revision', icon: RefreshCw },
    ],
  },
  {
    title: 'Manage', icon: Compass, items: [
      { id: 'modules', label: 'Modules', icon: BookOpen },
      { id: 'competition', label: 'Arena', icon: Swords },
      { id: 'reports', label: 'Reports', icon: BarChart3 },
      { id: 'settings', label: 'Settings', icon: Settings },
      { id: 'account', label: 'Account', icon: UserRound },
    ],
  },
];

export const destinations = routeGroups.flatMap(({ items }) => items);
export const routeIds = new Set(destinations.map(({ id }) => id));
export const groupForRoute = (tab: Tab) => Math.max(0, routeGroups.findIndex(({ items }) => items.some(({ id }) => id === tab)));
export const routeHref = (tab: Tab) => '#/' + tab;
