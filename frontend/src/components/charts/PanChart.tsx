import {
  useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode,
} from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Custom horizontal chart viewport.
 *
 * Two deliberate, visually distinct modes, switched by the chart owner:
 *
 * OVERVIEW — every data point plotted at container width; adaptive axis tick
 * density; no horizontal navigation UI whatsoever; the full dataset is always
 * visible on first paint.
 *
 * DETAIL — an internal plot coordinate system of `count × slotWidth` pixels,
 * panned inside a clipped container. Navigation is pointer-drag, touch drag,
 * trackpad/shift+wheel deltaX, keyboard arrows, and a dedicated navigation
 * toolbar row above the plot (never overlapping the data). Vertical page
 * scrolling is never hijacked; the Y-axis strip stays stationary; the plot can
 * never pan past the first or final data point; nothing renders past the
 * dataset. There is no native horizontal scrollbar and no default range input.
 */
export interface PanChartProps {
  count: number;
  /** Pixels per point in detail mode. */
  slotWidth?: number;
  ariaLabel: string;
  mode: 'overview' | 'detail';
  /** Tick labels for the fixed Y-strip in detail mode (bottom → top). */
  yTicks?: string[];
  yMin?: string;
  yMax?: string;
/** Ordered, canonical one-based positions behind each plotted point (sibling of current window). */
positions?: number[];
  /** Leads the navigation toolbar row and the range readout in detail mode. */
  positionLabel?: string;
  children: (innerWidth: number) => ReactNode;
}

const KEY_STEP_SLOTS = 4;

export function PanChart({ count, slotWidth = 16, yTicks, ariaLabel, mode, positionLabel, positions, children }: PanChartProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [offset, setOffset] = useState(0); // px panned right, 0..maxOffset
  const dragRef = useRef<{ pointerId: number | null; startX: number; startOffset: number }>({ pointerId: null, startX: 0, startOffset: 0 });

  const innerWidth = viewportWidth > 0 ? Math.max(count * slotWidth, viewportWidth) : Math.max(count * slotWidth, 1);
  const maxOffset = Math.max(innerWidth - viewportWidth, 0);
  const needsScroll = maxOffset > 1;
  const safeOffset = Math.min(Math.max(offset, 0), maxOffset);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;
    const update = () => setViewportWidth(el.clientWidth);
    update();
    const raf = requestAnimationFrame(update); // belt: measure again after paint
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [mode, count]);

  const clamp = useCallback((value: number) => Math.min(Math.max(value, 0), maxOffset), [maxOffset]);

  // Mode (and dataset size) changes clamp an existing pan position back into
  // bounds instead of stranding the viewport.
  useEffect(() => {
    setOffset((o) => clamp(o));
  }, [clamp, count]);

  const panBy = useCallback((delta: number) => setOffset((o) => clamp(o + delta)), [clamp]);
  const panTo = useCallback((position: number) => setOffset(clamp(position)), [clamp]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (mode !== 'detail' || !needsScroll) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      panBy(-KEY_STEP_SLOTS * slotWidth);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      panBy(KEY_STEP_SLOTS * slotWidth);
    } else if (event.key === 'Home') {
      event.preventDefault();
      panTo(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      panTo(maxOffset);
    }
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== 'detail' || !needsScroll) return;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startOffset: safeOffset };
    (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    const delta = dragRef.current.startX - event.clientX;
    setOffset(clamp(dragRef.current.startOffset + delta));
  };

  const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    dragRef.current.pointerId = null;
    try {
      (event.currentTarget as HTMLDivElement).releasePointerCapture(event.pointerId);
    } catch {
      /* pointer already released */
    }
  };

  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (mode !== 'detail' || !needsScroll) return;
    const horizontal = Math.abs(event.deltaX) >= Math.abs(event.deltaY);
    const delta = horizontal ? event.deltaX : (event.shiftKey ? event.deltaY : 0);
    if (delta !== 0) {
      event.preventDefault();
      panBy(delta);
    }
  };

  const firstVisible = mode === 'detail' && viewportWidth > 0
    ? (positions?.[Math.floor(safeOffset / slotWidth)] ?? (Math.floor(safeOffset / slotWidth) + 1))
    : (positions?.[0] ?? 1);
  const lastVisible = mode === 'detail' && viewportWidth > 0
    ? (positions?.[Math.min((count - 1), Math.ceil((safeOffset + viewportWidth) / slotWidth) - 1)] ?? Math.min(count, Math.ceil((safeOffset + viewportWidth) / slotWidth)))
    : (positions?.[count - 1] ?? count);
  const positionText = needsScroll ? `${firstVisible}–${lastVisible} of ${count}` : `${count} of ${count}`;

  if (mode === 'overview') {
    // All data points plotted at the container width; no navigation UI at all.
    return (
      <div className="h-full w-full min-w-0" role="region" aria-label={ariaLabel}>
        {children(Math.max(viewportWidth || 1, count))}
      </div>
    );
  }

  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      {/* navigation toolbar — its own layout row, never over the plot */}
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-1 pb-1.5">
        <p className="truncate text-[11px] text-[var(--text-muted)]" aria-live="polite">{positionLabel ?? 'Range'} — <span className="font-mono tabular-nums text-[var(--text)]">{positionText}</span></p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => panBy(-KEY_STEP_SLOTS * slotWidth)}
            disabled={!needsScroll || safeOffset <= 0}
            aria-label="Previous positions"
            className="grid h-7 w-7 place-items-center rounded-md border border-[var(--border)] text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronLeft size={15} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => panBy(KEY_STEP_SLOTS * slotWidth)}
            disabled={!needsScroll || safeOffset >= maxOffset}
            aria-label="Next positions"
            className="grid h-7 w-7 place-items-center rounded-md border border-[var(--border)] text-[var(--text)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronRight size={15} aria-hidden />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        {yTicks && yTicks.length > 0 && (
          <div aria-hidden="true" className="pointer-events-none w-11 flex-none border-r border-[var(--border)] bg-[var(--surface)] pt-1.5 pb-[18px]">
            <div className="flex h-full min-h-0 flex-col justify-between">
              {yTicks.map((tick, i) => (
                <span
                  key={`${tick}-${i}`}
                  className="block pr-1 text-right font-mono text-[10px] leading-[10px] tabular-nums text-[var(--text-muted)]"
                >
                  {tick}
                </span>
              ))}
            </div>
          </div>
        )}
        <div
          ref={viewportRef}
          role="region"
          aria-label={ariaLabel}
          tabIndex={needsScroll ? 0 : -1}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onWheel={onWheel}
          className="relative min-w-0 flex-1 touch-pan-y select-none overflow-hidden whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
        >
          <div
            style={{ width: `${innerWidth}px`, transform: `translateX(${-safeOffset}px)` }}
            className="h-full will-change-transform"
          >
            {children(innerWidth)}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Nice-rounded axis tick values, e.g. 0, 5, 10… never scientific-notation noise. */
export function niceTicks(max: number, steps = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const rawStep = max / steps;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const residual = rawStep / magnitude;
  const step = (residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10) * magnitude;
  const out: number[] = [];
  for (let v = 0; v <= max + step / 2; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}
