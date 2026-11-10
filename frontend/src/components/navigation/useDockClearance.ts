import { useLayoutEffect, type RefObject } from 'react';
import type { DockPosition } from './geometry';

const pageControl = 'a[href], button, input, select, textarea, summary, [role="button"], [contenteditable="true"], iframe';

// Only sample the dock's narrow edge strip. Keep the saved fraction intact
// when a control temporarily occupies the preferred position.
export function useDockClearance(
  track: RefObject<HTMLDivElement>,
  dock: DockPosition,
  route: string,
  open: boolean,
  dragging: boolean,
) {
  useLayoutEffect(() => {
    const element = track.current;
    const main = document.querySelector('main');
    if (!element || !main || open || dragging || typeof document.elementsFromPoint !== 'function') return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const bounds = element.getBoundingClientRect();
      const size = element.querySelector('button')?.offsetHeight || 44;
      const mainBounds = main.getBoundingClientRect();
      const travel = Math.max(0, bounds.height - size);
      const preferred = travel * dock.fraction;
      const left = dock.edge === 'left' ? bounds.left : bounds.right - size;
      const edge = dock.edge === 'left' ? left + size - 2 : left + 2;
      const inside = dock.edge === 'left' ? mainBounds.left : mainBounds.right;
      let position = preferred;
      if (edge >= mainBounds.left && edge <= mainBounds.right) {
        const clear = (y: number) => [2, size / 2, size - 2].every((offset) =>
          [edge, (inside + edge) / 2].every((x) =>
            !document.elementsFromPoint(x, bounds.top + y + offset).some((hit) =>
              main.contains(hit) && hit.closest(pageControl),
            ),
          ),
        );
        if (!clear(preferred)) {
          for (let distance = size; distance < travel + size; distance += size) {
            const above = Math.max(0, preferred - distance);
            const below = Math.min(travel, preferred + distance);
            if (clear(above)) { position = above; break; }
            if (clear(below)) { position = below; break; }
          }
        }
      }
      element.style.setProperty('--dock-offset', position - preferred + 'px');
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    observer?.observe(element);
    observer?.observe(main);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [track, dock, route, open, dragging]);
}
