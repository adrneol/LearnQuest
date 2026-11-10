import { PlaylistChart } from './PlaylistChart.js';
import type { PlaylistPoint } from './playlistSeries.js';

export function DurationBars({ data, heightClass = 'h-64', ariaLabel = 'Video duration chart.' }: {
  data: readonly PlaylistPoint[]; heightClass?: string; ariaLabel?: string;
}) {
  return <PlaylistChart data={data} metric="duration" ariaLabel={ariaLabel} heightClass={heightClass}
    caption="Video durations"
    emptyHint="Pick a valid range to see every entry plotted." />;
}
