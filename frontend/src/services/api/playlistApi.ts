import { validateImportedSnapshot, toCsv, formatSecondsHHMMSS, parseISO8601ToSeconds, entryKey } from '../../domain/index.js';
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

/**
 * Backend origin prefix. Production contract (see .env.example): the Render
 * service origin WITHOUT trailing slash and WITHOUT an `/api` suffix, e.g.
 * `https://YOUR-RENDER-SERVICE.onrender.com`. Trailing slashes are stripped
 * here so a `...onrender.com/` value cannot produce `//api/...` (404).
 * Empty = same-origin `/api` (local dev proxy handles it).
 */
export function getApiBase(): string {
  const raw = import.meta.env?.VITE_API_BASE_URL ?? '';
  return String(raw).replace(/\/+$/, '');
}

/** Join one `/api/...` path onto the configured base. Exported for tests. */
export function apiUrl(path: string): string {
  return `${getApiBase()}/api${path.startsWith('/') ? path : `/${path}`}`;
}

/** Abort a hung request instead of leaving the UI in a permanent spinner. */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('The server took too long to respond. Check the connection and retry.', { cause: e });
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchPlaylistFromServer(
  input: string,
  opts?: { refresh?: boolean },
): Promise<{ snapshot: PlaylistSnapshot; cached: boolean }> {
  const url = `${apiUrl('/playlist')}?url=${encodeURIComponent(input)}${opts?.refresh ? '&refresh=1' : ''}`;
  const res = await fetchWithTimeout(url, 20_000);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `Playlist fetch failed (HTTP ${res.status}).`);
  if (!body?.snapshot || !Array.isArray(body.snapshot.entries)) {
    throw new Error('The server returned an unexpected playlist response. Nothing was changed.');
  }
  return { snapshot: toClientSnapshot(body.snapshot as ServerSnapshot), cached: Boolean(body.cached) };
}

export async function checkApiHealth(): Promise<{ ok: boolean; hasKey: boolean }> {
  try {
    const res = await fetchWithTimeout(apiUrl('/health'), 5_000);
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
    doneKeys?.has(entryKey(snapshot.playlistId, e)) ? 'done' : 'todo',
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
