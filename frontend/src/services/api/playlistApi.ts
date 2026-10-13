import { validateImportedSnapshot, toCsv, formatSecondsHHMMSS, parseISO8601ToSeconds } from '../../domain/index.js';
import type { PlaylistSnapshot, PlaylistEntry } from '../../domain/index.js';

// Backend contract: normalized metadata with ORIGINAL ISO durations.
// The frontend domain engine parses them — the single authority for totals.
interface ServerEntry {
  position: number;
  videoId: string;
  title: string;
  thumbnail?: string;
  durationIso: string | null;
  unresolvedReason?: PlaylistEntry['unresolvedReason'];
  publishedAt?: string;
}

interface ServerSnapshot {
  playlistId: string;
  title: string;
  channelTitle?: string;
  thumbnail?: string;
  reportedCount: number | null;
  entries: ServerEntry[];
  source: 'api';
  fetchedAt: string;
  snapshotVersion: number;
}

function toClientSnapshot(s: ServerSnapshot): PlaylistSnapshot {
  return {
    ...s,
    entries: s.entries.map((e) => {
      let durationSec: number | null = null;
      let unresolvedReason = e.unresolvedReason;
      if (typeof e.durationIso === 'string') {
        try {
          durationSec = parseISO8601ToSeconds(e.durationIso);
        } catch {
          durationSec = null;
          unresolvedReason = unresolvedReason ?? 'missingDuration';
        }
      }
      return {
        position: e.position,
        videoId: e.videoId,
        title: e.title,
        thumbnail: e.thumbnail,
        durationSec,
        unresolvedReason,
        publishedAt: e.publishedAt,
      };
    }),
  };
}

const BASE = (import.meta as any).env?.VITE_API_BASE_URL ?? '';

export async function fetchPlaylistFromServer(
  input: string,
  opts?: { refresh?: boolean },
): Promise<{ snapshot: PlaylistSnapshot; cached: boolean }> {
  const url = `${BASE}/api/playlist?url=${encodeURIComponent(input)}${opts?.refresh ? '&refresh=1' : ''}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `Playlist fetch failed (HTTP ${res.status}).`);
  return { snapshot: toClientSnapshot(body.snapshot as ServerSnapshot), cached: Boolean(body.cached) };
}

export async function checkApiHealth(): Promise<{ ok: boolean; hasKey: boolean }> {
  try {
    const res = await fetch(`${BASE}/api/health`);
    if (!res.ok) return { ok: false, hasKey: false };
    return (await res.json()) as { ok: boolean; hasKey: boolean };
  } catch {
    return { ok: false, hasKey: false };
  }
}

export function snapshotToCsv(snapshot: PlaylistSnapshot, doneKeys?: Set<string>): string {
  const rows = snapshot.entries.map((e) => [
    e.position,
    e.title,
    e.videoId,
    e.durationSec ?? '',
    e.durationSec !== null ? formatSecondsHHMMSS(e.durationSec) : 'UNRESOLVED',
    doneKeys?.has(`${snapshot.playlistId}::${e.position}`) ? 'done' : 'todo',
    `https://www.youtube.com/watch?v=${e.videoId}&list=${snapshot.playlistId}`,
  ]);
  return toCsv(rows, ['position', 'title', 'videoId', 'durationSec', 'durationHMS', 'status', 'url']);
}

export function parseImportFile(text: string): PlaylistSnapshot {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Import file is not valid JSON. CSV import: use the playlist table export format via JSON backup instead.');
  }
  const candidate = (data as any)?.snapshot ?? (data as any)?.playlists ?? data;
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate) && (candidate as any).entries) {
    const r = validateImportedSnapshot(candidate);
    if (!r.ok) throw new Error('Invalid snapshot: ' + r.errors.join(' '));
    return r.snapshot!;
  }
  throw new Error('Unrecognized import format. Export a JSON backup from Reports first.');
}
