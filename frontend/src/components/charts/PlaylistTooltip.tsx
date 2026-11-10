import { useLayoutEffect, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { ChartInspection } from './chartInspection.js';
import { tooltipPosition } from './tooltipPosition.js';

export function PlaylistTooltip({ inspection, plot, x, y }: {
  inspection: ChartInspection; plot: RefObject<HTMLDivElement>; x: number; y: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    const surface = plot.current;
    if (!node || !surface) return;
    let frame = 0;
    const place = () => {
      frame = 0;
      const rect = surface.getBoundingClientRect();
      const visual = window.visualViewport;
      const left = visual?.offsetLeft ?? 0;
      const top = visual?.offsetTop ?? 0;
      const width = visual?.width ?? document.documentElement.clientWidth;
      const height = visual?.height ?? document.documentElement.clientHeight;
      const maxWidth = `min(15.5rem, ${Math.max(1, width - 16)}px)`;
      if (node.style.maxWidth !== maxWidth) node.style.maxWidth = maxWidth;
      const obstacles = [...document.querySelectorAll('.lq-topbar, .lq-dock-trigger, .lq-navigation-panel')]
        .flatMap((element) => [...element.getClientRects()]);
      const modal = [...document.querySelectorAll('[aria-modal="true"], dialog[open]')].some((element) => element.getClientRects().length);
      const position = modal ? undefined : tooltipPosition(
        { x: rect.left + x, y: rect.top + y }, node.offsetWidth, node.offsetHeight,
        { left, top, right: left + width, bottom: top + height }, obstacles, width <= 640 ? rect : undefined,
      );
      node.style.visibility = position ? 'visible' : 'hidden';
      if (position) node.style.transform = `translate(${position.x}px, ${position.y}px)`;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };
    place();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true });
    const dock = document.querySelector('.lq-dock-track');
    if (dock) observer.observe(dock, { childList: true });
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [inspection, plot, x, y]);

  return createPortal(
    <div ref={ref} aria-hidden="true" data-chart-tooltip className="lq-chart-tooltip">
      <p className="font-semibold">{inspection.group && 'Group · '}{inspection.heading}</p>
      <p className="lq-chart-tooltip-meta line-clamp-2">{inspection.detail}</p>
      <p className="lq-chart-tooltip-value">
        {inspection.valueLabel && <span>{inspection.valueLabel}</span>}
        {inspection.value}
      </p>
      {inspection.subtotal && <p className="lq-chart-tooltip-meta">{inspection.subtotal}</p>}
      {inspection.completed && <p className="lq-chart-tooltip-meta">Completed</p>}
    </div>,
    document.body,
  );
}
