import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ArrowLeft, List, SlidersHorizontal } from 'lucide-react';
import { destinations, groupForRoute, routeGroups, routeHref } from '../../app/routes';
import type { Tab } from '../../app/tabs';
import { Btn, inputCls } from '../ui/ui';
import { DEFAULT_DOCK, type DockPosition } from './geometry';
import { RadialDial } from './RadialDial';

interface Props {
  tab: Tab;
  group: number;
  setGroup: (index: number) => void;
  dock: DockPosition;
  setDock: (position: DockPosition) => void;
  dismiss: () => void;
  navigate: (tab: Tab) => void;
}

function scrollFromKey(event: KeyboardEvent<HTMLElement>) {
  if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || !(event.target instanceof HTMLElement)) return;
  const target = event.target;
  const searchPaging = target.matches('input[type="search"]') && (event.key === 'PageDown' || event.key === 'PageUp');
  if (!searchPaging && target.closest('input, textarea, select, [contenteditable="true"]')) return;
  const list = searchPaging ? event.currentTarget.querySelector<HTMLElement>('[data-navigation-scroll]')
    : target.closest<HTMLElement>('[data-navigation-scroll]');
  const step = list?.clientHeight ?? 0;
  const offsets: Record<string, number> = {
    ArrowDown: 40, ArrowUp: -40, PageDown: step, PageUp: -step,
    Home: -(list?.scrollHeight ?? 0), End: list?.scrollHeight ?? 0,
  };
  if (!Object.hasOwn(offsets, event.key) && !(list && event.key === ' ' && target.matches('a'))) return;
  event.preventDefault();
  list?.scrollBy(0, event.key === ' ' ? step * (event.shiftKey ? -1 : 1) : offsets[event.key]);
}

export function NavigationPanel({ tab, group, setGroup, dock, setDock, dismiss, navigate }: Props) {
  const panel = useRef<HTMLElement>(null);
  const modeButton = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'dial' | 'all' | 'position'>('dial');
  const [query, setQuery] = useState('');
  const slots = routeGroups.map(({ title, icon }) => ({ label: title, icon }));
  const visible = destinations.filter(({ label }) => label.toLowerCase().includes(query.trim().toLowerCase()));

  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    const measure = () => element.style.setProperty('--panel-height', element.getBoundingClientRect().height + 'px');
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (mode === 'all') search.current?.focus({ preventScroll: true });
    else if (mode === 'position') modeButton.current?.focus({ preventScroll: true });
    else panel.current?.querySelector<HTMLElement>('[data-selected="true"]')?.focus({ preventScroll: true });
  }, [mode]);

  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    const keepWheelLocal = (event: WheelEvent) => {
      if (event.ctrlKey || event.defaultPrevented || !(event.target instanceof Element)) return;
      const list = event.target.closest<HTMLElement>('[data-navigation-scroll]');
      // CSS contains the native scroller. Chrome and short result lists have
      // no scroll range of their own, so consume wheel input locally there.
      if (!list || list.scrollHeight <= list.clientHeight) event.preventDefault();
    };
    element.addEventListener('wheel', keepWheelLocal, { passive: false });
    return () => element.removeEventListener('wheel', keepWheelLocal);
  }, []);

  const follow = (event: MouseEvent<HTMLAnchorElement>, target: Tab) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    if (target === tab) dismiss();
    else navigate(target);
  };

  const links = (items: typeof destinations) => (
    <ul>{items.map(({ id, label, icon: Icon }) => (
      <li key={id}>
        <a href={routeHref(id)} aria-current={id === tab ? 'page' : undefined} onClick={(event) => follow(event, id)}>
          <Icon size={16} aria-hidden="true" /> {label}
        </a>
      </li>
    ))}</ul>
  );

  return (
    <nav id="workspace-navigation" aria-label="Workspace navigation" ref={panel} className="lq-navigation-panel"
      data-mode={mode} onKeyDown={(event) => {
        if (event.key !== 'Escape') { scrollFromKey(event); return; }
        event.preventDefault();
        event.stopPropagation();
        if (mode === 'dial') dismiss();
        else setMode('dial');
      }}>
      <div className="lq-navigation-modes">
        {mode === 'dial' ? (
          <>
            <Btn variant="quiet" onClick={() => { setQuery(''); setMode('all'); }}>
              <List size={16} aria-hidden="true" /> All pages
            </Btn>
            <Btn variant="quiet" className="lq-icon-button" aria-label="Dock position" onClick={() => setMode('position')}>
              <SlidersHorizontal size={16} aria-hidden="true" />
            </Btn>
          </>
        ) : (
          <Btn ref={modeButton} variant="quiet" onClick={() => setMode('dial')}>
            <ArrowLeft size={15} aria-hidden="true" /> Back to dial
          </Btn>
        )}
      </div>
      {mode === 'dial' && (
        <div className="lq-navigation-section">
          <RadialDial slots={slots} selected={group} select={setGroup} active={groupForRoute(tab)} mirrored={dock.edge === 'right'} />
          <div id="workspace-section-links" className="lq-navigation-list" data-navigation-scroll>
            <h2>{routeGroups[group].title}</h2>
            {links(routeGroups[group].items)}
          </div>
        </div>
      )}
      {mode === 'all' && (
        <>
          <input ref={search} className={inputCls} type="search" placeholder="Search pages…" aria-label="Search pages"
            value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="lq-navigation-list" data-navigation-scroll role="region" aria-label="All pages">
            {routeGroups.map(({ title, items }) => {
              const matches = items.filter((item) => visible.includes(item));
              return matches.length > 0 && <section key={title} aria-label={title}><h2>{title}</h2>{links(matches)}</section>;
            })}
            {!visible.length && <p role="status">No pages match that search.</p>}
          </div>
        </>
      )}
      {mode === 'position' && (
        <div className="lq-dock-settings" data-navigation-scroll>
          <h2>Dock position</h2>
          <div className="lq-dock-edge" role="group" aria-label="Dock edge">
            {(['left', 'right'] as const).map((edge) => (
              <Btn key={edge} variant="quiet" aria-pressed={dock.edge === edge}
                onClick={() => setDock({ ...dock, edge })}>{edge === 'left' ? 'Left edge' : 'Right edge'}</Btn>
            ))}
          </div>
          <label className="lq-dock-range">Vertical position
            <input type="range" min={0} max={100} value={Math.round(dock.fraction * 100)}
              onChange={(event) => setDock({ ...dock, fraction: Number(event.target.value) / 100 })} />
          </label>
          <Btn variant="quiet" onClick={() => setDock(DEFAULT_DOCK)}>Reset dock</Btn>
        </div>
      )}
    </nav>
  );
}
