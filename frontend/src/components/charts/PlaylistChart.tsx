import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import { formatSecondsHHMMSS as time } from '../../domain/duration/duration.js';
import { usePointerGesture } from '../navigation/usePointerGesture.js';
import { Btn, inputCls } from '../ui/ui.js';
import { AXIS_WIDTH, PlaylistPlot, RIGHT_MARGIN } from './PlaylistPlot.js';
import { chartMarks, clampViewport, markBudget, positionIndex, type ChartMark, type PlaylistMetric, type PlaylistPoint, type Viewport } from './playlistSeries.js';

interface Props {
  data: readonly PlaylistPoint[];
  metric: PlaylistMetric;
  ariaLabel: string;
  caption: string;
  emptyHint: string;
  heightClass: string;
}

const unavailable = {
  deleted: 'deleted video',
  private: 'private video',
  notFound: 'video not found',
  regionRestricted: 'region restricted',
};

function duration(point: PlaylistPoint) {
  if (point.durationSec !== null) return time(point.durationSec);
  const reason = point.unresolvedReason;
  if (reason && Object.hasOwn(unavailable, reason)) return `Unavailable (${unavailable[reason as keyof typeof unavailable]})`;
  return point.videoId ? 'Unresolved' : 'Unavailable (missing entry)';
}

export function PlaylistChart({ data, metric, ariaLabel, caption, emptyHint, heightClass }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const jump = useRef<HTMLInputElement>(null);
  const instructions = useId();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [detail, setDetail] = useState<Viewport | null>(null);
  const [selected, setSelected] = useState<string>();
  const [hovered, setHovered] = useState<number>();
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
  const selectedIndex = useMemo(() => data.findIndex((point) => point.id === selected), [data, selected]);
  const active = marks.findIndex((mark) => selectedIndex >= mark.start && selectedIndex < mark.end);
  const preview = hovered !== undefined ? marks[hovered] : undefined;
  const chosen = active >= 0 ? marks[active] : undefined;
  const aggregate = marks.some((mark) => mark.end - mark.start > 1);

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
      setHovered(undefined);
    };
    node.addEventListener('wheel', pan, { passive: false });
    return () => node.removeEventListener('wheel', pan);
  }, [hasDetail, window.length, count, plotWidth]);

  function show(start: number, length: number) {
    const next = clampViewport(count, start, length);
    setDetail((previous) => previous?.start === next.start && previous.length === next.length ? previous : next);
    setHovered(undefined);
  }

  function activate(mark: ChartMark) {
    setSelected(mark.first.id);
    if (mark.end - mark.start > 1) show(mark.start, mark.end - mark.start);
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

  const indexAt = (x: number, left: number) => {
    const offset = x - left - AXIS_WIDTH;
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
          setSelected(undefined);
          setHovered(undefined);
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
        {' Use ← →, Home or End to inspect, and Enter to select.'}
        {detail && ' Focus the plot to pan with Shift+wheel.'}
      </p>
      <div ref={ref} role="region" aria-label={ariaLabel} aria-describedby={instructions} tabIndex={0}
        className={`${heightClass} min-w-0 touch-pan-y select-none`}
        {...gesture}
        onFocus={() => { if (!chosen) setSelected(first.id); }}
        onPointerMove={(event) => {
          gesture.onPointerMove(event);
          if (event.pointerType === 'mouse' && !event.buttons) setHovered(indexAt(event.clientX, event.currentTarget.getBoundingClientRect().left));
        }}
        onPointerLeave={() => setHovered(undefined)}
        onClick={(event) => {
          const index = indexAt(event.clientX, event.currentTarget.getBoundingClientRect().left);
          if (index !== undefined && marks[index]) activate(marks[index]);
        }}
        onKeyDown={(event) => {
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? marks.length - 1
            : event.key === 'ArrowRight' ? Math.min(active + 1, marks.length - 1)
            : event.key === 'ArrowLeft' ? Math.max(0, active - 1) : undefined;
          if (next !== undefined && marks[next]) {
            event.preventDefault();
            setHovered(undefined);
            setSelected(marks[next].first.id);
          } else if (event.key === 'Enter' && chosen) {
            event.preventDefault();
            activate(chosen);
          } else if (detail && (event.key === 'PageUp' || event.key === 'PageDown')) {
            event.preventDefault();
            pageBy(event.key === 'PageUp' ? -1 : 1);
          }
        }}>
        <PlaylistPlot marks={marks} width={size.width} height={size.height} floor={floor} ceiling={ceiling}
          unit={unit} metric={metric} selected={active < 0 ? undefined : active} />
      </div>
      <div className="min-h-10 rounded-md bg-[var(--surface-soft)] px-3 py-2 text-xs">
        {preview ? <Inspection mark={preview} metric={metric} /> : chosen ? <Inspection mark={chosen} metric={metric} /> : 'Select or focus the chart to inspect values.'}
        <span className="sr-only" role="status">{chosen && <Inspection mark={chosen} metric={metric} />}</span>
      </div>
      <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => {
        event.preventDefault();
        const position = jump.current?.valueAsNumber;
        const index = position === undefined ? count : positionIndex(data, position);
        const found = data[index]?.pos === position;
        setInvalid(!found);
        if (!found) return;
        setSelected(data[index].id);
        const length = Math.min(count, markBudget(plotWidth, 23));
        show(index - Math.floor(length / 2), length);
      }}>
        <input ref={jump} aria-label="Video position" type="number" step={1} required min={data[0].pos} max={data[count - 1].pos}
          aria-invalid={invalid} onChange={() => setInvalid(false)} className={`${inputCls} max-w-32`} placeholder="Position" />
        <Btn type="submit" variant="quiet">Jump to video</Btn>
        {invalid && <span role="status" className="text-xs text-[var(--danger)]">That position is outside this selection or missing.</span>}
      </form>
      <PlaylistTable data={data} metric={metric} />
    </section>
  );
}

function Inspection({ mark, metric }: { mark: ChartMark; metric: PlaylistMetric }) {
  if (mark.end - mark.start > 1) {
    return <><b>Videos {mark.first.pos}–{mark.last.pos}</b> · {mark.end - mark.start} entries · {mark.unresolved} unresolved
      {mark.min !== null && <> · {metric === 'cumulative' ? 'Known subtotal bounds' : 'Duration min–max'} {time(mark.min)}–{time(mark.max!)}</>}
      {metric === 'cumulative' && <> · Boundary subtotals {time(mark.first.cumSec)} → {time(mark.last.cumSec)}</>}
    </>;
  }
  const point = mark.first;
  return <><b>Video #{point.pos}</b> · {point.title} · {duration(point)}
    {metric === 'cumulative' && <> · Known subtotal {time(point.cumSec)}{point.incomplete ? ' (incomplete)' : ''}</>}
    {point.done && ' · Completed'}</>;
}

function PlaylistTable({ data, metric }: { data: readonly PlaylistPoint[]; metric: PlaylistMetric }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const pages = Math.ceil(data.length / 25);
  const current = Math.min(page, pages - 1);
  return (
    <details className="text-sm" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer font-semibold">View chart data as a table</summary>
      {open && (
        <>
          <div className="overflow-x-auto">
            <table className="lq-data-table w-full text-left">
              <caption className="sr-only">Exact playlist values in hours, minutes and seconds</caption>
              <thead><tr><th scope="col">Position</th><th scope="col">Video</th><th scope="col">Duration</th>
                {metric === 'cumulative' && <th scope="col">Known subtotal</th>}</tr></thead>
              <tbody>{data.slice(current * 25, (current + 1) * 25).map((point) => (
                <tr key={point.id}><th scope="row">#{point.pos}</th><td>{point.title}</td><td>{duration(point)}</td>
                  {metric === 'cumulative' && <td>{time(point.cumSec)}{point.incomplete && ' (incomplete)'}</td>}</tr>
              ))}</tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Btn variant="quiet" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous rows</Btn>
            <span role="status" className="text-xs">Page {current + 1} of {pages}</span>
            <Btn variant="quiet" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next rows</Btn>
          </div>
        </>
      )}
    </details>
  );
}
