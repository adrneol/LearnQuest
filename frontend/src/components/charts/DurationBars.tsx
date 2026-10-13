import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { TICK, GRID_STROKE, TOOLTIP_STYLE, SERIES, positionTicks, fmtHMSLabel, type RangePoint } from './theme.js';

export interface Props {
  data: RangePoint[];
  heightClass?: string;
}

/**
 * View A — individual video durations ONLY (bar chart, one bar per video).
 * X = playlist position, Y = minutes per video. No cumulative series.
 */
export function DurationBars({ data, heightClass = 'h-64' }: Props) {
  if (data.length === 0) {
    return (
      <div className={`${heightClass} grid place-items-center rounded-xl border border-dashed border-white/15 text-sm text-slate-500`}>
        Pick a valid range to see every entry plotted.
      </div>
    );
  }
  return (
    <div className={`${heightClass} w-full min-w-0 overflow-hidden`}>
      <p className="mb-1 text-[11px] text-slate-500">
        Individual video durations — minutes per video · X: playlist position (every entry plotted, labels thinned as needed)
      </p>
      <div className="h-[calc(100%-1.25rem)] min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 20, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
            <XAxis
              dataKey="pos"
              tick={TICK}
              ticks={positionTicks(data[0].pos, data[data.length - 1].pos)}
              minTickGap={8}
              label={{ value: 'playlist position', position: 'insideBottom', offset: -14, fontSize: 11, fill: '#64748b' }}
            />
            <YAxis
              tick={TICK}
              width={52}
              label={{ value: 'minutes / video', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#64748b' }}
            />
            <Tooltip content={<BarTip />} />
            <Bar dataKey="min" name="min" fill={SERIES.cyan} radius={[3, 3, 0, 0]} maxBarSize={26} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function BarTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload as RangePoint | undefined;
  if (!p) return null;
  return (
    <div style={TOOLTIP_STYLE} className="max-w-[240px] p-2.5">
      <p className="font-semibold text-violet-300">Video #{p.pos}</p>
      <p className="truncate text-xs text-slate-300" title={p.title}>{p.title}</p>
      <p className="mt-1 font-mono text-xs">
        Duration: {p.unresolved ? <span className="text-amber-300">unresolved</span> : fmtHMSLabel(p.durationSec ?? 0)}
      </p>
      <p className="text-[11px] text-slate-500">{p.unresolved ? 'unresolved metadata' : p.done ? 'completed' : 'not completed'}</p>
    </div>
  );
}
