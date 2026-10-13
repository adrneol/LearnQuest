import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceDot } from 'recharts';
import { TICK, GRID_STROKE, TOOLTIP_STYLE, SERIES, positionTicks, fmtHMSLabel } from './theme.js';

export interface CumPoint {
  pos: number;
  hrs: number;
  cumSec: number;
}

interface Props {
  data: CumPoint[];
  heightClass?: string;
  complete: boolean;
}

/**
 * Cumulative content-duration curve: one record per playlist position, running
 * total of RESOLVED durations only (unresolved entries add 0 and are disclosed
 * by the caller — never zero-filled silently). Adaptive x ticks keep the first
 * and last positions inspectable via tooltip.
 */
export function CumulativeChart({ data, heightClass = 'h-48', complete }: Props) {
  if (data.length === 0) {
    return (
      <div className={`${heightClass} grid place-items-center rounded-xl border border-dashed border-white/15 text-sm text-slate-500`}>
        No entries to plot yet.
      </div>
    );
  }
  const first = data[0];
  const last = data[data.length - 1];
  return (
    <div className={`${heightClass} w-full min-w-0 overflow-hidden`}>
      <p className="mb-1 text-[11px] text-slate-500">
        Cumulative resolved content (hours) by playlist position{complete ? '' : ' · incomplete metadata — curve shows resolved entries only'}
      </p>
      <div className="h-[calc(100%-1.25rem)] min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 20, left: 0 }}>
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
              width={48}
              label={{ value: 'hours', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#64748b' }}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelStyle={{ color: '#c4b5fd', fontWeight: 600 }}
              labelFormatter={(l) => `Video #${l}`}
              formatter={(v: any, _name: any, props: any) => {
                const p = props?.payload as CumPoint | undefined;
                return [p ? fmtHMSLabel(p.cumSec) : `${v} h`, 'cumulative'];
              }}
            />
            <Area type="monotone" dataKey="hrs" stroke={SERIES.violet} fill={`${SERIES.violet}33`} strokeWidth={2} />
            <ReferenceDot x={first.pos} y={first.hrs} r={3} fill={SERIES.cyan} stroke="none" />
            <ReferenceDot x={last.pos} y={last.hrs} r={3} fill={SERIES.emerald} stroke="none" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
