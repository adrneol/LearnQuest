import { PlaylistChart } from './PlaylistChart.js';
import type { PlaylistPoint } from './playlistSeries.js';

export function CumulativeLine({ data, heightClass = 'h-64' }: { data: readonly PlaylistPoint[]; heightClass?: string }) {
  return <PlaylistChart data={data} metric="cumulative" ariaLabel="Cumulative duration chart." heightClass={heightClass}
    caption="Cumulative duration within the selected range"
    emptyHint="Pick a valid range to see the cumulative curve." />;
}
