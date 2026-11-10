import { PlaylistChart } from './PlaylistChart.js';
import type { PlaylistPoint } from './playlistSeries.js';

export function CumulativeChart({ data, heightClass = 'h-48', complete }: {
  data: readonly PlaylistPoint[]; heightClass?: string; complete: boolean;
}) {
  return <PlaylistChart data={data} metric="cumulative" ariaLabel="Cumulative duration chart." heightClass={heightClass}
    caption={`Cumulative resolved content from playlist start${complete ? '' : ' · incomplete metadata'}`}
    emptyHint="No videos to chart." />;
}
