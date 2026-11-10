import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { useChartTheme } from './theme.js';

interface Props {
  done: number;
  total: number;
  heightClass?: string;
  emptyHint?: string;
}

/**
 * Done-vs-remaining donut with an honest zero state: when nothing is complete,
 * a neutral ring + explicit 0% replaces the misleading single-color pie.
 */
export function ProgressDonut({ done, total, heightClass = 'h-52', emptyHint }: Props) {
  const { TOOLTIP_STYLE, SERIES } = useChartTheme();
  if (total <= 0) {
    return (
      <div className={`${heightClass} grid place-items-center rounded-lg border border-dashed border-[var(--border-strong)] text-sm text-[var(--text-faint)]`}>
        {emptyHint ?? 'No entries to show yet.'}
      </div>
    );
  }
  if (done <= 0) {
    return (
      <div className={`${heightClass} flex flex-col items-center justify-center gap-1`}>
        <div className="grid h-28 w-28 place-items-center rounded-full border-8 border-[var(--border)]">
          <span className="font-mono text-xl font-bold text-[var(--text-muted)]">0%</span>
        </div>
        <p className="text-xs text-[var(--text-muted)]">0 of {total} done — complete your first video to start the chart.</p>
      </div>
    );
  }
  return (
    <figure className={`${heightClass} flex min-w-0 flex-col`}>
      <div className="min-h-0 flex-1" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={[{ name: 'Done', value: done }, { name: 'Remaining', value: total - done }]} dataKey="value" nameKey="name" outerRadius="86%" innerRadius="63%" isAnimationActive={false}>
            <Cell fill={SERIES.emerald} />
            <Cell fill={SERIES.slate} />
          </Pie>
          <Tooltip contentStyle={TOOLTIP_STYLE} isAnimationActive={false} />
        </PieChart>
      </ResponsiveContainer>
      </div>
      <figcaption className="text-center text-xs tabular-nums">{done} completed · {total - done} remaining</figcaption>
    </figure>
  );
}
