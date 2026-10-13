import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { TOOLTIP_STYLE, SERIES } from './theme.js';

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
  if (total <= 0) {
    return (
      <div className={`${heightClass} grid place-items-center rounded-xl border border-dashed border-white/15 text-sm text-slate-500`}>
        {emptyHint ?? 'No entries to show yet.'}
      </div>
    );
  }
  if (done <= 0) {
    return (
      <div className={`${heightClass} flex flex-col items-center justify-center gap-1`}>
        <div className="grid h-28 w-28 place-items-center rounded-full border-8 border-white/10">
          <span className="font-mono text-xl font-bold text-slate-300">0%</span>
        </div>
        <p className="text-xs text-slate-400">0 of {total} done — complete your first video to start the chart.</p>
      </div>
    );
  }
  return (
    <div className={heightClass}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={[{ name: 'Done', value: done }, { name: 'Remaining', value: total - done }]} dataKey="value" nameKey="name" outerRadius={70} label>
            <Cell fill={SERIES.emerald} />
            <Cell fill={SERIES.slate} />
          </Pie>
          <Tooltip contentStyle={TOOLTIP_STYLE} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
