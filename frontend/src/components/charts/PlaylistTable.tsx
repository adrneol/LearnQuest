import { memo, useId, useRef, useState } from 'react';
import { formatSecondsHHMMSS as time } from '../../domain/duration/duration.js';
import { Btn, inputCls } from '../ui/ui.js';
import { chartDuration } from './chartDuration.js';
import { positionIndex, type PlaylistMetric, type PlaylistPoint } from './playlistSeries.js';

export const PlaylistTable = memo(function PlaylistTable({ data, metric, selectedIndex, groupEnd, onInspect }: {
  data: readonly PlaylistPoint[];
  metric: PlaylistMetric;
  selectedIndex: number;
  groupEnd?: number;
  onInspect: (index: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [expanded, setExpanded] = useState<string>();
  const [invalid, setInvalid] = useState(false);
  const position = useRef<HTMLInputElement>(null);
  const titlePreview = useId();
  const pages = Math.ceil(data.length / pageSize);
  const current = Math.min(page, pages - 1);
  const start = current * pageSize;
  const rows = data.slice(start, start + pageSize);
  const expandedPoint = groupEnd === undefined && selectedIndex >= start && selectedIndex < start + rows.length
    && data[selectedIndex]?.id === expanded ? data[selectedIndex] : undefined;
  const cumulative = metric === 'cumulative';
  const hasSelection = selectedIndex >= 0;
  return (
    <details className="min-w-0 text-sm" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer font-semibold">View chart data as a table</summary>
      {open && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => {
              event.preventDefault();
              const value = position.current?.valueAsNumber;
              const index = value === undefined ? data.length : positionIndex(data, value);
              const found = data[index]?.pos === value;
              setInvalid(!found);
              if (found) setPage(Math.floor(index / pageSize));
            }}>
              <input ref={position} type="number" step={1} required aria-label="Table position" placeholder="Position"
                className={`${inputCls} max-w-28`} aria-invalid={invalid} onChange={() => setInvalid(false)} />
              <Btn type="submit" variant="quiet">Find in table</Btn>
              {invalid && <span role="status" className="text-xs text-[var(--danger)]">No video at that position in this range.</span>}
            </form>
            {hasSelection && <Btn variant="quiet" onClick={() => setPage(Math.floor(selectedIndex / pageSize))}>Show chart selection</Btn>}
          </div>
          <div id={titlePreview} hidden={!expandedPoint} className="rounded-md bg-[var(--surface-soft)] px-3 py-2">
            {expandedPoint && <><b>Video #{expandedPoint.pos}</b><p className="break-words">{expandedPoint.title}</p></>}
          </div>
          <div className="lq-chart-table-scroll" tabIndex={cumulative ? 0 : undefined}
            role={cumulative ? 'region' : undefined} aria-label={cumulative ? 'Scrollable cumulative data table' : undefined}>
            <table className={`lq-chart-table${cumulative ? ' lq-chart-table--cumulative' : ''}`}>
              <caption className="sr-only">Exact playlist values in hours, minutes and seconds</caption>
              <colgroup><col /><col /><col />{cumulative && <col />}</colgroup>
              <thead><tr><th scope="col">Position</th><th scope="col">Video title</th><th scope="col" className="lq-chart-number">Duration</th>
                {cumulative && <th scope="col" className="lq-chart-number">Known subtotal</th>}</tr></thead>
              <tbody>{rows.map((point, offset) => {
                const index = start + offset;
                const selected = groupEnd === undefined && index === selectedIndex;
                const inGroup = groupEnd !== undefined && index >= selectedIndex && index < groupEnd;
                const isExpanded = expanded === point.id && selected;
                return (
                  <tr key={point.id} data-selected={selected || inGroup || undefined}>
                    <th scope="row">#{point.pos}</th>
                    <td>
                      <button type="button" className="lq-chart-row-title" aria-pressed={selected} aria-expanded={isExpanded} aria-controls={titlePreview}
                        onClick={() => {
                          onInspect(index);
                          setExpanded(isExpanded ? undefined : point.id);
                        }}>
                        <span className="line-clamp-2">{point.title}</span>
                      </button>
                    </td>
                    <td className="lq-chart-number">{chartDuration(point)}</td>
                    {cumulative && <td className="lq-chart-number">{time(point.cumSec)}{point.incomplete && <span className="block text-xs text-[var(--text-muted)]">Incomplete</span>}</td>}
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {data.length > 25 && <>
            <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">Rows per page
              <select className={`${inputCls} !w-auto`} value={pageSize} onChange={(event) => {
                const size = Number(event.target.value);
                setPage(Math.floor(start / size));
                setPageSize(size);
              }}><option value={25}>25</option><option value={50}>50</option></select>
            </label>
            <div className="flex flex-wrap items-center gap-1">
              <Btn variant="quiet" className="aria-disabled:opacity-50" aria-disabled={current === 0} onClick={() => setPage(Math.max(0, current - 1))}>Previous rows</Btn>
              <Btn variant="quiet" className="aria-disabled:opacity-50" aria-disabled={current >= pages - 1} onClick={() => setPage(Math.min(pages - 1, current + 1))}>Next rows</Btn>
            </div>
            </>}
            <p role="status" className="basis-full text-xs tabular-nums text-[var(--text-muted)]">
              Rows {start + 1}–{start + rows.length} of {data.length} · Page {current + 1} of {pages}
            </p>
          </div>
        </div>
      )}
    </details>
  );
});
