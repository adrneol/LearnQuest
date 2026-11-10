import { useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceDot } from 'recharts';
import { PanChart, niceTicks } from './PanChart.js';
import { useChartTheme, positionTicks, fmtHMSLabel, type CumPoint } from './theme.js';

const SLOT = 16;

/**
 * Cumulative resolved content curve. One record per playlist position, never
 * binned or averaged. Overview fits all entries; detail mode pans.
 */
export function CumulativeChart({ data, heightClass = 'h-48', complete }: { data: CumPoint[]; heightClass?: string; complete: boolean }) {
  const { TICK, GRID_STROKE, TOOLTIP_STYLE, TOOLTIP_LABEL_STYLE, SERIES, AXIS_LINE } = useChartTheme();
  const [mode, setMode] = useState<'overview' | 'detail'>('overview');
  if (data.length === 0) {
    return (
      <div className={`${heightClass} grid place-items-center rounded-lg border border-dashed border-[var(--border-strong)] text-sm text-[var(--text-faint)]`}>
        No entries to plot yet.
      </div>
    );
  }
  const first = data[0];
  const last = data[data.length - 1];
  const maxHrs = Math.max(...data.map((d) => d.hrs), 1);
  const yMax = niceTicks(maxHrs, 4).slice(-1)[0];
  const yTicks = niceTicks(maxHrs);
  const count = data.length;
  const overviewTicks = count <= 25 ? 0 : clamp(Math.floor(count / 14), 5, 9);

  return (
    <div className={`${heightClass} w-full min-w-0 overflow-hidden`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[11px] text-[var(--text-faint)]">
          Cumulative resolved content (hours){complete ? '' : ' · incomplete metadata'}
        </p>
        <button
          type="button"
          onClick={() => setMode((m) => (m === 'overview' ? 'detail' : 'overview'))}
          aria-pressed={mode === 'detail'}
          className="text-[11px] font-semibold text-[var(--text-muted)] underline underline-offset-2 hover:text-[var(--text)]"
        >
          {mode === 'overview' ? 'Explore individual videos' : 'Return to full overview'}
        </button>
      </div>
      <div className="h-[calc(100%-1.5rem)] min-h-0 min-w-0">
        <PanChart count={count} slotWidth={SLOT} yTicks={[...yTicks].reverse().map(String)} ariaLabel="Cumulative duration chart." mode={mode} positionLabel="Positions">
          {(_innerWidth) => (
            <ResponsiveContainer width="100%" height="100%">
              {mode === 'overview' ? (
                <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 18, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical />
                  <XAxis
                    dataKey="pos"
                    type="category"
                    tick={TICK}
                    ticks={positionTicks(first.pos, last.pos, overviewTicks)}
                    minTickGap={8}
                    axisLine={{ stroke: AXIS_LINE }}
                    tickLine={{ stroke: AXIS_LINE }}
                  />
                  <YAxis tick={TICK} width={38} axisLine={{ stroke: AXIS_LINE }} tickLine={{ stroke: AXIS_LINE }} domain={[0, yMax]} ticks={yTicks} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    labelFormatter={(l) => `Video #${l}`}
                    formatter={(v: any, _name: any, props: any) => {
                      const p = props?.payload as CumPoint | undefined;
                      return [p ? fmtHMSLabel(p.cumSec) : `${v} h`, 'cumulative'];
                    }}
                  />
                  <Area type="monotone" dataKey="hrs" stroke={SERIES.primary} fill={`${SERIES.primary}1f`} strokeWidth={2} />
                  <ReferenceDot x={first.pos} y={first.hrs} r={3} fill={SERIES.steel} stroke="none" />
                  <ReferenceDot x={last.pos} y={last.hrs} r={3} fill={SERIES.emerald} stroke="none" />
                </AreaChart>
              ) : (
                <AreaChart data={data} margin={{ top: 6, right: 0, bottom: 18, left: 2 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical />
                  <XAxis
                    dataKey="pos"
                    type="category"
                    tick={TICK}
                    ticks={positionTicks(first.pos, last.pos, 0)}
                    minTickGap={8}
                    axisLine={{ stroke: AXIS_LINE }}
                    tickLine={{ stroke: AXIS_LINE }}
                  />
                  <YAxis hide domain={[0, yMax]} ticks={yTicks} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    labelStyle={TOOLTIP_LABEL_STYLE}
                    labelFormatter={(l) => `Video #${l}`}
                    formatter={(v: any, _name: any, props: any) => {
                      const p = props?.payload as CumPoint | undefined;
                      return [p ? fmtHMSLabel(p.cumSec) : String(v), 'cumulative'];
                    }}
                  />
                  <Area type="monotone" dataKey="hrs" stroke={SERIES.primary} fill={`${SERIES.primary}1f`} strokeWidth={2} />
                  <ReferenceDot x={first.pos} y={first.hrs} r={3} fill={SERIES.steel} stroke="none" />
                  <ReferenceDot x={last.pos} y={last.hrs} r={3} fill={SERIES.emerald} stroke="none" />
                </AreaChart>
              )}
            </ResponsiveContainer>
          )}
        </PanChart>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
