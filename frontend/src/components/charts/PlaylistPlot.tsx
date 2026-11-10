import { memo } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from 'recharts';
import { axisIndices, type ChartMark, type PlaylistMetric } from './playlistSeries.js';
import { niceTicks } from './scale.js';
import { useChartTheme } from './theme.js';

export const AXIS_WIDTH = 48;
export const RIGHT_MARGIN = 16;
const number = new Intl.NumberFormat('en', { maximumSignificantDigits: 4, useGrouping: false });

export const PlaylistPlot = memo(function PlaylistPlot({ marks, width, height, ceiling, floor, unit, metric, selected }: {
  marks: ChartMark[]; width: number; height: number; ceiling: number; floor: number;
  unit: number; metric: PlaylistMetric; selected?: number;
}) {
  const theme = useChartTheme();
  const buckets = marks.some(({ start, end }) => end - start > 1);
  let alternate = false;
  const data = marks.map((mark, index) => {
    if (index && mark.first.pos !== marks[index - 1].last.pos + 1) alternate = !alternate;
    return {
      ...mark, index,
      span: mark.min === null ? null : [mark.min, mark.max],
      missing: mark.unresolved ? floor : null,
      zero: mark.value === 0 ? 0 : null,
      main: alternate ? null : mark.value,
      alternate: alternate ? mark.value : null,
    };
  });
  const ticks = niceTicks((ceiling - floor) / unit).map((tick) => floor + tick * unit);
  ticks[ticks.length - 1] = Math.max(ceiling, ticks.at(-1) ?? 1);
  const xTicks = axisIndices(data.length, width - AXIS_WIDTH - RIGHT_MARGIN);
  const bandWidth = (width - AXIS_WIDTH - RIGHT_MARGIN) / Math.max(1, data.length);
  if (width <= AXIS_WIDTH + RIGHT_MARGIN || height <= 0) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none">
      <ComposedChart width={width} height={height} data={data} margin={{ top: 11, right: RIGHT_MARGIN, bottom: 2, left: 0 }}>
        <CartesianGrid vertical={false} stroke={theme.GRID_STROKE} />
        <XAxis dataKey="index" scale="band" type="category" interval={0} ticks={xTicks}
          tickLine={false} axisLine={{ stroke: theme.AXIS_LINE }}
          tick={({ y, payload }: { y: number; payload: { value: number } }) => {
            const index = payload.value;
            return <text className="recharts-cartesian-axis-tick-value" textAnchor="middle" y={y + 9}
              x={AXIS_WIDTH + (index + .5) * bandWidth} {...theme.TICK}>
              {index === data.length - 1 ? data[index].last.pos : data[index].first.pos}
            </text>;
          }} />
        <YAxis width={AXIS_WIDTH} type="number" ticks={ticks} domain={[floor, ticks[ticks.length - 1]]}
          tick={theme.TICK} tickLine={false} axisLine={false} tickFormatter={(value: number) => number.format(value / unit)} />
        {selected !== undefined && <ReferenceLine x={selected} stroke={theme.AXIS_LINE} strokeDasharray="3 2" />}
        {buckets ? (
          <>
            <Bar dataKey="span" fill={theme.SERIES.steel} maxBarSize={18} isAnimationActive={false} />
            <Line dataKey="max" stroke="none" dot={{ r: 2.3, fill: theme.SERIES.primary, stroke: 'none' }} isAnimationActive={false} />
          </>
        ) : metric === 'duration' ? (
          <>
            <Bar dataKey="value" fill={theme.SERIES.steel} maxBarSize={54} radius={[2, 2, 0, 0]} isAnimationActive={false} />
            <Line dataKey="zero" stroke="none" dot={{ r: 2.5, fill: theme.SERIES.primary, stroke: 'none' }} isAnimationActive={false} />
          </>
        ) : (
          (['main', 'alternate'] as const).map((key) => (
            <Line key={key} dataKey={key} type="linear" connectNulls={false} stroke={theme.SERIES.primary} strokeWidth={1.8}
              dot={{ r: 2.4, strokeWidth: 0, fill: theme.SERIES.primary }} isAnimationActive={false} />
          ))
        )}
        <Line dataKey="missing" stroke="none" dot={({ cx, cy, index }: { cx?: number; cy?: number; index?: number }) =>
          typeof cx === 'number' && typeof cy === 'number'
            ? <path key={index} d={`M${cx - 3},${cy - 3}l6,6m0,-6l-6,6`} fill="none" stroke={theme.SERIES.amber} strokeWidth={1.4} />
            : <g key={index} />}
          isAnimationActive={false} />
      </ComposedChart>
    </div>
  );
});
