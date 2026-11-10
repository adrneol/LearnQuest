import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axisIndices } from './playlistSeries.js';
import { niceTicks } from './scale.js';
import { useChartTheme } from './theme.js';

interface Datum {
  label: string;
  value: number | null;
}

const number = new Intl.NumberFormat('en', { maximumFractionDigits: 4 });

/** Short evidence series, with exact source values and a complete table. */
export function EvidenceChart({ title, data, unit, kind = 'line', heightClass = 'h-44', describe = number.format }: {
  title: string;
  data: Datum[];
  unit: string;
  kind?: 'line' | 'bar';
  heightClass?: string;
  describe?: (value: number) => string;
}) {
  const theme = useChartTheme();
  const [width, setWidth] = useState(0);
  const [selection, setSelection] = useState(0);
  const selected = data[Math.min(selection, data.length - 1)];
  if (!selected) return <p className="text-sm text-[var(--text-muted)]">No observations.</p>;

  const display = (value: number | null) => value === null ? 'No measurable value' : describe(value);
  const ticks = niceTicks(data.reduce((max, item) => Math.max(max, item.value ?? 0), 0));
  const chartChildren = (
    <>
      <CartesianGrid vertical={false} stroke={theme.GRID_STROKE} />
      <XAxis dataKey="label" tick={theme.TICK} interval={0} tickLine={false} axisLine={false}
        ticks={axisIndices(data.length, width - 55).map((index) => data[index].label)} />
      <YAxis tick={theme.TICK} width={40} domain={[0, ticks[ticks.length - 1]]} ticks={ticks}
        tickFormatter={(value: number) => number.format(value)} tickLine={false} axisLine={false} />
      <Tooltip contentStyle={theme.TOOLTIP_STYLE} formatter={(value: number) => [display(value), unit]} isAnimationActive={false} />
    </>
  );
  const chart = kind === 'line' ? (
    <LineChart data={data} margin={{ top: 6, right: 18, left: 0, bottom: 0 }}>
      {chartChildren}
      <Line dataKey="value" type="linear" connectNulls={false} stroke={theme.SERIES.primary} strokeWidth={1.75}
        dot={{ r: 2.5, strokeWidth: 0 }} isAnimationActive={false} />
    </LineChart>
  ) : (
    <BarChart data={data} margin={{ top: 6, right: 18, left: 0, bottom: 0 }}>
      {chartChildren}
      <Bar dataKey="value" fill={theme.SERIES.steel} maxBarSize={54} radius={[2, 2, 0, 0]} isAnimationActive={false} />
    </BarChart>
  );

  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs text-[var(--text-muted)]">{unit}</p>
      <div role="region" aria-label={title + '. Use left and right arrows to inspect.'} tabIndex={0}
        onKeyDown={(event) => {
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? data.length - 1
            : event.key === 'ArrowLeft' ? Math.max(0, selection - 1)
            : event.key === 'ArrowRight' ? Math.min(data.length - 1, selection + 1) : null;
          if (next === null) return;
          event.preventDefault();
          setSelection(next);
        }}>
        <div className={heightClass} aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%" onResize={setWidth}>{chart}</ResponsiveContainer>
        </div>
        <p role="status" className="text-xs tabular-nums text-[var(--text-muted)]">{selected.label} · {display(selected.value)}</p>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer font-semibold">View chart data as a table</summary>
        <table className="lq-data-table text-left">
          <caption className="sr-only">{title}</caption>
          <thead><tr><th scope="col">Observation</th><th scope="col">{unit}</th></tr></thead>
          <tbody>{data.map((item) => <tr key={item.label}><th scope="row">{item.label}</th><td>{display(item.value)}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}
