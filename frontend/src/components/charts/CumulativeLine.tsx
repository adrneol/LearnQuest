import { useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { PanChart, niceTicks } from './PanChart.js';
import { useChartTheme, positionTicks, fmtHMSLabel, type RangePoint } from './theme.js';

const SLOT = 16;

/** Cumulative minutes chart. X semantics stay playlist position (one-based). Overview fits all. */
export function CumulativeLine({ data, heightClass = 'h-64' }: { data: RangePoint[]; heightClass?: string }) {
  const { TICK, GRID_STROKE, SERIES, AXIS_LINE } = useChartTheme();
  const [mode, setMode] = useState<'overview' | 'detail'>('overview');
  if (data.length === 0) {
    return (
      <div className={`${heightClass} grid place-items-center rounded-lg border border-dashed border-[var(--border-strong)] text-sm text-[var(--text-faint)]`}>
        Pick a valid range to see the cumulative curve.
      </div>
    );
  }
  const maxCumMin = Math.max(...data.map((d) => d.cumMin), 1);
  const yMax = niceTicks(maxCumMin, 4).slice(-1)[0];
  const yTicks = niceTicks(maxCumMin);
  const count = data.length;
  const first = data[0].pos;
  const last = data[data.length - 1].pos;
  const overviewTicks = count <= 25 ? 0 : clamp(Math.floor(count / 14), 5, 9);

  return (
    <div className={`${heightClass} w-full min-w-0 overflow-hidden`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[11px] text-[var(--text-faint)]">Cumulative minutes</p>
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
                <LineChart data={data} margin={{ top: 6, right: 8, bottom: 18, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical />
                  <XAxis
                    dataKey="pos"
                    type="category"
                    tick={TICK}
                    ticks={positionTicks(first, last, overviewTicks)}
                    minTickGap={8}
                    axisLine={{ stroke: AXIS_LINE }}
                    tickLine={{ stroke: AXIS_LINE }}
                  />
                  <YAxis tick={TICK} width={38} axisLine={{ stroke: AXIS_LINE }} tickLine={{ stroke: AXIS_LINE }} domain={[0, yMax]} ticks={yTicks} />
                  <Tooltip content={<LineTip />} />
                  <Line type="monotone" dataKey="cumMin" name="cumMin" stroke={SERIES.primary} strokeWidth={2.25} dot={false} connectNulls />
                </LineChart>
              ) : (
                <LineChart data={data} margin={{ top: 6, right: 0, bottom: 18, left: 2 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical />
                  <XAxis
                    dataKey="pos"
                    type="category"
                    tick={TICK}
                    ticks={positionTicks(first, last, 0)}
                    minTickGap={8}
                    axisLine={{ stroke: AXIS_LINE }}
                    tickLine={{ stroke: AXIS_LINE }}
                  />
                  <YAxis hide domain={[0, yMax]} ticks={yTicks} />
                  <Tooltip content={<LineTip />} />
                  <Line type="monotone" dataKey="cumMin" name="cumMin" stroke={SERIES.primary} strokeWidth={2} dot={false} connectNulls />
                </LineChart>
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

function LineTip({ active, payload }: any) {
  const { TOOLTIP_STYLE } = useChartTheme();
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload as RangePoint | undefined;
  if (!p) return null;
  return (
    <div style={TOOLTIP_STYLE} className="max-w-[240px] rounded-md border p-2.5">
      <p className="font-semibold text-[var(--text)]">Video #{p.pos}</p>
      <p className="truncate text-xs text-[var(--text-muted)]" title={p.title}>{p.title}</p>
      <p className="mt-1 font-mono text-xs">
        This video: {p.unresolved ? <span className="text-amber-800 dark:text-amber-300">unresolved</span> : fmtHMSLabel(p.durationSec ?? 0)}
      </p>
      <p className="font-mono text-xs text-[var(--text-muted)]">Cumulative: {fmtHMSLabel(p.cumSec)}</p>
    </div>
  );
}
