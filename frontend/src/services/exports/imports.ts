import type { PlaylistEntry, PlaylistSnapshot } from '../../types/index.js';

/** Validate imported snapshot shape before touching stored state. Returns errors, never throws partial. */
export function validateImportedSnapshot(data: unknown): { ok: boolean; errors: string[]; snapshot?: PlaylistSnapshot } {
  const errors: string[] = [];
  if (typeof data !== 'object' || data === null) return { ok: false, errors: ['Import must be a JSON object.'] };
  const d = data as Record<string, unknown>;
  if (typeof d.playlistId !== 'string' || d.playlistId.length < 5) errors.push('playlistId missing/invalid.');
  if (typeof d.title !== 'string' || !d.title) errors.push('title missing.');
  if (!Array.isArray(d.entries)) errors.push('entries must be an array.');
  const entries: PlaylistEntry[] = [];
  if (Array.isArray(d.entries)) {
    const seen = new Set<number>();
    d.entries.forEach((raw: unknown, idx: number) => {
      const e = raw as Record<string, unknown>;
      const pos = e?.position as number;
      const vid = e?.videoId as string;
      const title = e?.title as string;
      const dur = e?.durationSec as number | null;
      if (!Number.isInteger(pos) || pos < 1) {
        errors.push(`entries[${idx}].position invalid.`);
        return;
      }
      if (seen.has(pos)) {
        errors.push(`duplicate position ${pos}.`);
        return;
      }
      seen.add(pos);
      if (typeof vid !== 'string') {
        errors.push(`entries[${idx}].videoId invalid.`);
        return;
      }
      if (typeof title !== 'string') {
        errors.push(`entries[${idx}].title invalid.`);
        return;
      }
      if (dur !== null && (!Number.isSafeInteger(dur) || (dur as number) < 0)) {
        errors.push(`entries[${idx}].durationSec invalid.`);
        return;
      }
      entries.push({
        position: pos,
        videoId: vid,
        title,
        thumbnail: typeof e.thumbnail === 'string' ? (e.thumbnail as string) : undefined,
        durationSec: dur,
      });
    });
  }
  if (errors.length > 0) return { ok: false, errors };
  entries.sort((a, b) => a.position - b.position);
  const snapshot: PlaylistSnapshot = {
    playlistId: d.playlistId as string,
    title: d.title as string,
    channelTitle: typeof d.channelTitle === 'string' ? (d.channelTitle as string) : undefined,
    thumbnail: typeof d.thumbnail === 'string' ? (d.thumbnail as string) : undefined,
    reportedCount: typeof d.reportedCount === 'number' ? (d.reportedCount as number) : entries.length,
    entries,
    source: 'imported',
    fetchedAt: new Date().toISOString(),
    snapshotVersion: 1,
  };
  return { ok: true, errors: [], snapshot };
}

export function toCsv(rows: (string | number | null | undefined)[][], header: string[]): string {
  const esc = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
}
