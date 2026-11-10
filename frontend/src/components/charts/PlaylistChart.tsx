import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import { formatSecondsHHMMSS as time } from '../../domain/duration/duration.js';
import { usePointerGesture } from '../navigation/usePointerGesture.js';
import { Btn, inputCls } from '../ui/ui.js';
import { AXIS_WIDTH, markHeight, PlaylistPlot, RIGHT_MARGIN } from './PlaylistPlot.js';
import { inspectionFor, markKey, resolvePin, type ChartInspection, type MarkKey } from './chartInspection.js';
import { PlaylistTable } from './PlaylistTable.js';
import { PlaylistTooltip } from './PlaylistTooltip.js';
import { chartMarks, clampViewport, markBudget, positionIndex, type ChartMark, type PlaylistMetric, type PlaylistPoint, type Viewport } from './playlistSeries.js';

interface Props {
  data: readonly PlaylistPoint[];
  metric: PlaylistMetric;
  ariaLabel: string;
  caption: string;
  emptyHint: string;
  heightClass: string;
}

export function PlaylistChart({ data, metric, ariaLabel, caption, emptyHint, heightClass }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const jump = useRef<HTMLInputElement>(null);
  const instructions = useId();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [detail, setDetail] = useState<Viewport | null>(null);
  const [pinnedMark, setPinnedMark] = useState<MarkKey>();
  const [focusedMark, setFocusedMark] = useState<string>();
  const [hoveredMark, setHoveredMark] = useState<string>();
  const pointerType = useRef<string>();
  const [localScale, setLocalScale] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const drag = useRef<{ x: number; width: number; window: Viewport } | null>(null);
  const count = data.length;
  const hasData = count > 0;
  const hasDetail = detail !== null;
  const plotWidth = size.width - AXIS_WIDTH - RIGHT_MARGIN;
  const window = detail ? clampViewport(count, detail.start, detail.length) : { start: 0, length: count };
  const budget = markBudget(plotWidth);
  const marks = useMemo(() => chartMarks(data, { start: window.start, length: window.length }, budget, metric),
    [data, window.start, window.length, budget, metric]);
  const fullMax = useMemo(() => data.reduce((max, point) => Math.max(max, metric === 'duration' ? point.durationSec ?? 0 : point.cumSec), 0), [data, metric]);
  const first = data[window.start];
  const last = data[window.start + window.length - 1];
  const floor = metric === 'cumulative' && detail && localScale ? first?.cumSec ?? 0 : 0;
  const ceiling = detail && localScale
    ? marks.reduce((max, mark) => Math.max(max, mark.max ?? floor), floor)
    : fullMax;
  const unit = ceiling - floor >= 3600 ? 3600 : ceiling - floor >= 180 ? 60 : 1;
  const units = unit === 3600 ? 'hours' : unit === 60 ? 'minutes' : 'seconds';
  const pinned = useMemo(() => pinnedMark ? resolvePin(data, pinnedMark, metric) : undefined, [data, metric, pinnedMark]);
  const selectedIndex = pinned?.start ?? -1;
  const active = marks.findIndex((mark) => selectedIndex >= mark.start && selectedIndex < mark.end);
  const chosen = active >= 0 ? marks[active] : undefined;
  const aggregate = marks.some((mark) => mark.end - mark.start > 1);
  const durationGroups = useMemo(() => metric === 'cumulative' && aggregate
    ? chartMarks(data, { start: window.start, length: window.length }, budget, 'duration') : marks,
    [metric, aggregate, data, window.start, window.length, budget, marks]);
  const visibleInspections = useMemo(() => marks.map((mark, index) => inspectionFor(mark, durationGroups[index], metric)),
    [marks, durationGroups, metric]);
  const focusIndex = visibleInspections.findIndex((item) => item.id === focusedMark);
  const hoverIndex = visibleInspections.findIndex((item) => item.id === hoveredMark);
  const transientIndex = focusIndex >= 0 ? focusIndex : hoverIndex;
  const preview = visibleInspections[transientIndex];
  const displayed = preview ?? pinned?.inspection;
  const announcement = visibleInspections[focusIndex] ?? pinned?.inspection;
  const stateLabel = focusIndex >= 0 ? 'Keyboard' : displayed && displayed.id === pinned?.inspection.id ? 'Pinned' : 'Preview';
  const anchor = preview && plotWidth > 0 ? {
    x: AXIS_WIDTH + (transientIndex + .5) * plotWidth / marks.length,
    y: markHeight(marks[transientIndex], size.height, floor, ceiling, unit),
  } : undefined;

  useEffect(() => {
    const valid = (id: string | undefined) => visibleInspections.some((item) => item.id === id) ? id : undefined;
    setFocusedMark(valid);
    setHoveredMark(valid);
  }, [visibleInspections]);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [hasData]);

  useEffect(() => {
    const node = ref.current;
    if (!node || !hasDetail || window.length >= count || plotWidth <= 0) return;
    const stride = plotWidth / window.length;
    let remainder = 0;
    const pan = (event: WheelEvent) => {
      if (event.ctrlKey || document.activeElement !== node) return;
      const delta = event.shiftKey ? event.deltaX || event.deltaY
        : Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : 0;
      if (!delta) return;
      event.preventDefault();
      const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? plotWidth : 1;
      remainder += delta * factor;
      const steps = Math.trunc(remainder / stride);
      if (!steps) return;
      remainder -= steps * stride;
      setDetail((previous) => {
        if (!previous) return previous;
        const next = clampViewport(count, previous.start + steps, previous.length);
        return next.start === previous.start ? previous : next;
      });
      setHoveredMark(undefined);
      setFocusedMark(undefined);
    };
    node.addEventListener('wheel', pan, { passive: false });
    return () => node.removeEventListener('wheel', pan);
  }, [hasDetail, window.length, count, plotWidth]);

  useEffect(() => {
    if (!hoveredMark || pointerType.current !== 'touch') return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target)) setHoveredMark(undefined);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [hoveredMark]);

  const show = useCallback((start: number, length: number) => {
    const next = clampViewport(count, start, length);
    setDetail((previous) => previous?.start === next.start && previous.length === next.length ? previous : next);
    setHoveredMark(undefined);
    setFocusedMark(undefined);
  }, [count]);

  const selectPoint = useCallback((index: number, center = false) => {
    setPinnedMark({ first: data[index].id });
    setHoveredMark(undefined);
    setFocusedMark(undefined);
    if (center || !marks.some((mark) => mark.start === index && mark.end === index + 1)) {
      const length = Math.min(count, markBudget(plotWidth, 23));
      show(index - Math.floor(length / 2), length);
    }
  }, [data, marks, count, plotWidth, show]);

  function activate(mark: ChartMark) {
    const group = mark.end - mark.start > 1;
    setPinnedMark(markKey(mark));
    if (group) show(mark.start, mark.end - mark.start);
  }

  const gesture = usePointerGesture({
    start(event) {
      if (!detail || window.length >= count) return false;
      drag.current = { x: event.clientX, width: Math.max(1, plotWidth), window };
      return true;
    },
    move(point) {
      if (!drag.current) return;
      const start = drag.current;
      show(start.window.start + (start.x - point.x) * start.window.length / start.width, start.window.length);
    },
    finish(cancelled) {
      if (cancelled && drag.current) setDetail(drag.current.window);
      drag.current = null;
    },
  });

  if (!first || !last) return <p className="py-8 text-sm text-[var(--text-muted)]">{emptyHint}</p>;

  const indexAt = (x: number) => {
    const offset = x - AXIS_WIDTH;
    return offset < 0 || offset >= plotWidth ? undefined : Math.floor(offset / plotWidth * marks.length);
  };
  const pageBy = (direction: number) => show(window.start + direction * window.length, window.length);
  const zoom = (factor: number) => {
    const length = Math.max(1, Math.min(count, Math.round(window.length * factor)));
    const middle = chosen ? Math.floor((chosen.start + chosen.end - 1) / 2) : window.start + window.length / 2;
    show(middle - length / 2, length);
  };

  return (
    <section className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <p className="text-xs text-[var(--text-muted)]">{caption}</p>
        <Btn variant="quiet" onClick={() => {
          setHoveredMark(undefined);
          setFocusedMark(undefined);
          if (detail) { setDetail(null); setLocalScale(false); }
          else show(0, Math.min(count, markBudget(plotWidth, 23)));
        }}>{detail ? 'Return to full overview' : 'Explore individual videos'}</Btn>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-y border-[var(--border)] py-1.5">
        <p className="text-xs font-semibold tabular-nums">{detail ? 'Positions' : 'Overview'} — {first.pos}–{last.pos} of {count}</p>
        {detail && (
          <div className="flex flex-wrap items-center gap-1">
            <Btn variant="quiet" aria-label="Previous positions" disabled={window.start === 0} onClick={() => pageBy(-1)}><ChevronLeft size={15} aria-hidden="true" /></Btn>
            <Btn variant="quiet" aria-label="Next positions" disabled={window.start + window.length >= count} onClick={() => pageBy(1)}><ChevronRight size={15} aria-hidden="true" /></Btn>
            <Btn variant="quiet" aria-label="Zoom in" disabled={window.length === 1} onClick={() => zoom(.5)}><Plus size={15} aria-hidden="true" /></Btn>
            <Btn variant="quiet" aria-label="Zoom out" disabled={window.length === count} onClick={() => zoom(2)}><Minus size={15} aria-hidden="true" /></Btn>
            <Btn variant="quiet" aria-pressed={localScale} onClick={() => setLocalScale((value) => !value)}>
              Visible scale
            </Btn>
          </div>
        )}
      </div>
      <p id={instructions} className="text-xs text-[var(--text-muted)]">
        Axis in {units} {aggregate ? '· Min–max per group. Select a group to zoom.' : '· One mark per video.'}
        {marks.some((mark) => mark.unresolved > 0) && ' × Unresolved.'}
        {detail && localScale && ` Visible-range scale starts at ${time(floor)}.`}
        {' Use ← →, Home or End to inspect, and Enter or Space to pin.'}
        {detail && ' Focus the plot to pan with Shift+wheel.'}
      </p>
      <div ref={ref} role="region" aria-label={ariaLabel} aria-describedby={instructions} tabIndex={0}
        className={`${heightClass} relative min-w-0 touch-pan-y select-none`}
        {...gesture}
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible')) setFocusedMark(visibleInspections[Math.max(0, active)]?.id);
        }}
        onBlur={() => setFocusedMark(undefined)}
        onPointerDown={(event) => {
          pointerType.current = event.pointerType;
          setFocusedMark(undefined);
          if (event.pointerType === 'touch') setHoveredMark(undefined);
          gesture.onPointerDown(event);
        }}
        onPointerMove={(event) => {
          gesture.onPointerMove(event);
          if (event.pointerType === 'mouse' && !event.buttons) {
            pointerType.current = 'mouse';
            const index = indexAt(event.nativeEvent.offsetX);
            setHoveredMark(index === undefined ? undefined : visibleInspections[index]?.id);
          }
        }}
        onPointerLeave={(event) => { if (event.pointerType !== 'touch') setHoveredMark(undefined); }}
        onClick={(event) => {
          const index = indexAt(event.nativeEvent.offsetX);
          if (index === undefined || !marks[index]) return;
          const mark = marks[index];
          activate(mark);
          if (pointerType.current === 'touch' && mark.end === mark.start + 1) setHoveredMark(visibleInspections[index].id);
        }}
        onKeyDown={(event) => {
          const current = focusIndex >= 0 ? focusIndex : active;
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? marks.length - 1
            : event.key === 'ArrowRight' ? Math.min(current + 1, marks.length - 1)
            : event.key === 'ArrowLeft' ? Math.max(0, current - 1) : undefined;
          if (event.key === 'Escape') {
            setHoveredMark(undefined);
            setFocusedMark(undefined);
          } else if (next !== undefined && marks[next]) {
            event.preventDefault();
            setHoveredMark(undefined);
            setFocusedMark(visibleInspections[next].id);
          } else if ((event.key === 'Enter' || event.key === ' ') && marks[current]) {
            event.preventDefault();
            activate(marks[current]);
          } else if (detail && (event.key === 'PageUp' || event.key === 'PageDown')) {
            event.preventDefault();
            pageBy(event.key === 'PageUp' ? -1 : 1);
          }
        }}>
        <PlaylistPlot marks={marks} width={size.width} height={size.height} floor={floor} ceiling={ceiling}
          unit={unit} metric={metric} selected={active < 0 ? undefined : active} />
        {preview && anchor && (
          <>
            <span aria-hidden="true" className={`pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-[var(--focus)] ${focusIndex >= 0 ? 'border-2' : 'border'}`}
              style={{ left: anchor.x, top: anchor.y }} />
            <PlaylistTooltip inspection={preview} plot={ref} {...anchor} />
          </>
        )}
      </div>
      <div data-chart-inspector className="min-h-10 break-words rounded-md bg-[var(--surface-soft)] px-3 py-2 text-xs">
        {displayed ? (
          <>
            <span aria-hidden="true" className="mr-2 text-[var(--text-muted)]">{stateLabel}</span>
            {' '}
            <Inspection item={displayed} />
          </>
        ) : 'Select a mark to keep its details here.'}
        <span className="sr-only" role="status">{announcement && <Inspection item={announcement} />}</span>
      </div>
      <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => {
        event.preventDefault();
        const position = jump.current?.valueAsNumber;
        const index = position === undefined ? count : positionIndex(data, position);
        const found = data[index]?.pos === position;
        setInvalid(!found);
        if (!found) return;
        selectPoint(index, true);
      }}>
        <input ref={jump} aria-label="Video position" type="number" step={1} required min={data[0].pos} max={data[count - 1].pos}
          aria-invalid={invalid} onChange={() => setInvalid(false)} className={`${inputCls} max-w-32`} placeholder="Position" />
        <Btn type="submit" variant="quiet">Jump to video</Btn>
        {invalid && <span role="status" className="text-xs text-[var(--danger)]">That position is outside this selection or missing.</span>}
      </form>
      <PlaylistTable data={data} metric={metric} selectedIndex={selectedIndex} groupEnd={pinned?.end} onInspect={selectPoint} />
    </section>
  );
}

function Inspection({ item }: { item: ChartInspection }) {
  return <><b>{item.heading}</b>{item.detail && ` · ${item.detail}`}
    {' · '}{item.valueLabel && item.valueLabel + ' '}{item.value}
    {item.subtotal && ` · ${item.subtotal}`}{item.completed && ' · Completed'}</>;
}
