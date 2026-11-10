import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Compass } from 'lucide-react';
import { groupForRoute } from '../../app/routes';
import type { Tab } from '../../app/tabs';
import { dockFromPointer, DOCK_KEY, readDock, type DockPosition, type Point } from './geometry';
import { NavigationPanel } from './NavigationPanel';
import { useDockClearance } from './useDockClearance';
import { usePointerGesture } from './usePointerGesture';

export function NavigationDock({ tab, onNavigate }: { tab: Tab; onNavigate: (tab: Tab) => void }) {
  const [dock, setDock] = useState(() => readDock((key) => window.localStorage.getItem(key)));
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState(() => groupForRoute(tab));
  const [preview, setPreview] = useState<Point | null>(null);
  const lastTab = useRef(tab);
  const track = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const drop = useRef<DockPosition | null>(null);
  useDockClearance(track, dock, tab, open, Boolean(preview));

  useEffect(() => {
    const element = track.current;
    const viewport = window.visualViewport;
    if (!element || !viewport) return;
    const update = () => {
      element.style.setProperty('--visual-top', viewport.offsetTop + 'px');
      element.style.setProperty('--visual-bottom', viewport.offsetTop + viewport.height + 'px');
      element.style.setProperty('--visual-left', viewport.offsetLeft + 'px');
      element.style.setProperty('--visual-width', viewport.width + 'px');
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);

  useEffect(() => {
    const closeOnRoute = () => setOpen(false);
    window.addEventListener('hashchange', closeOnRoute);
    return () => window.removeEventListener('hashchange', closeOnRoute);
  }, []);

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !track.current?.contains(event.target)) {
        if (track.current?.contains(document.activeElement)) trigger.current?.focus({ preventScroll: true });
        setOpen(false);
      }
    };
    const escapeFromDock = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && event.target === trigger.current) setOpen(false);
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', escapeFromDock);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', escapeFromDock);
    };
  }, [open]);

  const commit = (position: DockPosition) => {
    setDock(position);
    track.current?.style.removeProperty('--dock-offset');
    try {
      window.localStorage.setItem(DOCK_KEY, JSON.stringify(position));
    } catch {
      // Movement remains available when preference storage is blocked.
    }
  };

  const gesture = usePointerGesture({
    move(point) {
      const bounds = track.current?.getBoundingClientRect();
      const size = trigger.current?.offsetHeight;
      if (!bounds || !size) return;
      setOpen(false);
      drop.current = dockFromPointer(point, bounds, size);
      setPreview({
        x: Math.max(0, Math.min(bounds.width - size, point.x - bounds.left - size / 2)),
        y: Math.max(0, Math.min(bounds.height - size, point.y - bounds.top - size / 2)),
      });
    },
    finish(cancelled) {
      if (drop.current && !cancelled) commit(drop.current);
      drop.current = null;
      setPreview(null);
    },
  });

  return (
    <>
      <div className="lq-dock-track" data-app-background data-dock-edge={dock.edge} ref={track}
        style={{ '--dock-fraction': dock.fraction } as CSSProperties}>
        <button ref={trigger} type="button" className="lq-dock-trigger" data-edge={dock.edge}
          data-dragging={Boolean(preview)} aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open}
          aria-controls={open ? 'workspace-navigation' : undefined} title="Navigate · drag to move"
          style={preview ? { left: preview.x, top: preview.y } : undefined}
          {...gesture} onClick={() => {
            if (lastTab.current !== tab) setGroup(groupForRoute(tab));
            lastTab.current = tab;
            setOpen(!open);
          }}>
          <Compass size={23} strokeWidth={1.5} aria-hidden="true" />
        </button>
        {open && <NavigationPanel tab={tab} group={group} setGroup={setGroup} dock={dock} setDock={commit}
          dismiss={() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }}
          navigate={(target) => { setOpen(false); onNavigate(target); }} />}
      </div>
    </>
  );
}
