import { formatSecondsHHMMSS as time } from '../../domain/duration/duration.js';
import type { PlaylistPoint } from './playlistSeries.js';

const unavailable = {
  deleted: 'deleted video',
  private: 'private video',
  notFound: 'video not found',
  regionRestricted: 'region restricted',
};

export function chartDuration(point: PlaylistPoint) {
  if (point.durationSec !== null) return time(point.durationSec);
  const reason = point.unresolvedReason;
  if (reason && Object.hasOwn(unavailable, reason)) return `Unavailable (${unavailable[reason as keyof typeof unavailable]})`;
  return point.videoId ? 'Unresolved' : 'Unavailable (missing entry)';
}
