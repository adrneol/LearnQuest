import type { PlaylistEntry, PlaylistSnapshot } from '../../types/index.js';
import { MAX_ENTRIES, PLAYLIST_ID_RE } from '../../domain/playlist/playlist.js';
import { normalizeSnapshotIdentity, SNAPSHOT_SCHEMA_VERSION } from '../../domain/progress/identity.js';

/** Largest duration we accept from an import: 7 days (rejects absurd values). */
export const MAX_IMPORTED_DURATION_SEC = 7 * 24 * 3600;
const UNRESOLVED_REASONS = new Set(['deleted', 'private', 'notFound', 'regionRestricted', 'missingDuration', 'unknown']);

export function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 10 || value.length > 40) return false;
  const t = Date.parse(value);
  return Number.isFinite(t);
}

/**
 * Validate a complete playlist snapshot before touching state. Positions must
 * be contiguous 1..N (no invisible holes), duplicate videoIds are allowed
 * intentionally, and incomplete metadata stays explicitly incomplete.
 */
export function validateImportedSnapshot(data: unknown): { ok: boolean; errors: string[]; snapshot?: PlaylistSnapshot } {
  const errors: string[] = [];
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, errors: ['Import must be a JSON object.'] };
  }
  const d = data as Record<string, unknown>;
  if (typeof d.playlistId !== 'string' || !PLAYLIST_ID_RE.test(d.playlistId)) {
    errors.push('playlistId missing/invalid (expected a 10–64 character YouTube playlist ID).');
  }
  if (typeof d.title !== 'string' || !d.title.trim() || d.title.length > 500) errors.push('title missing/invalid.');
  if (d.channelTitle !== undefined && (typeof d.channelTitle !== 'string' || d.channelTitle.length > 500)) {
    errors.push('channelTitle invalid.');
  }
  if (d.thumbnail !== undefined && (typeof d.thumbnail !== 'string' || d.thumbnail.length > 2000)) {
    errors.push('thumbnail invalid.');
  }
  if (!Array.isArray(d.entries)) errors.push('entries must be an array.');
  if (d.reportedCount !== undefined && d.reportedCount !== null) {
    if (!Number.isSafeInteger(d.reportedCount) || (d.reportedCount as number) < 0) {
      errors.push('reportedCount must be a finite non-negative integer or null.');
    }
  }
  if (d.snapshotVersion !== undefined) {
    if (!Number.isSafeInteger(d.snapshotVersion) || (d.snapshotVersion as number) < 1) {
      errors.push('snapshotVersion must be a positive integer.');
    } else if ((d.snapshotVersion as number) > SNAPSHOT_SCHEMA_VERSION) {
      errors.push(`Unsupported snapshot version ${String(d.snapshotVersion)} (max ${SNAPSHOT_SCHEMA_VERSION}).`);
    }
  }
  if (d.fetchedAt !== undefined && !isIsoTimestamp(d.fetchedAt)) errors.push('fetchedAt must be a valid ISO timestamp.');
  if (Array.isArray(d.entries) && d.entries.length > MAX_ENTRIES) {
    errors.push(`Snapshot exceeds the supported limit of ${MAX_ENTRIES} entries.`);
  }
  if (Array.isArray(d.entries) && d.entries.length === 0) {
    errors.push('Snapshot has no entries; an empty playlist cannot be tracked.');
  }
  const entries: PlaylistEntry[] = [];
  if (Array.isArray(d.entries) && d.entries.length <= MAX_ENTRIES) {
    const seenPositions = new Set<number>();
    const seenEntryIds = new Set<string>();
    d.entries.forEach((raw: unknown, idx: number) => {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        errors.push(`entries[${idx}] must be an object.`);
        return;
      }
      const e = raw as Record<string, unknown>;
      const pos = e.position as number;
      const vid = e.videoId as string;
      const title = e.title as string;
      const dur = e.durationSec as number | null;
      if (!Number.isSafeInteger(pos) || pos < 1) {
        errors.push(`entries[${idx}].position invalid.`);
        return;
      }
      if (seenPositions.has(pos)) {
        errors.push(`duplicate position ${pos}.`);
        return;
      }
      seenPositions.add(pos);
      if (typeof vid !== 'string' || vid.length > 128) {
        errors.push(`entries[${idx}].videoId invalid.`);
        return;
      }
      if (typeof title !== 'string' || title.length > 500) {
        errors.push(`entries[${idx}].title invalid.`);
        return;
      }
      if (dur !== null && (!Number.isSafeInteger(dur) || (dur as number) < 0 || (dur as number) > MAX_IMPORTED_DURATION_SEC)) {
        errors.push(`entries[${idx}].durationSec invalid.`);
        return;
      }
      if (!vid && dur !== null) {
        errors.push(`entries[${idx}] has no videoId but a duration (inconsistent unresolved metadata).`);
        return;
      }
      if (e.unresolvedReason !== undefined && !UNRESOLVED_REASONS.has(String(e.unresolvedReason))) {
        errors.push(`entries[${idx}].unresolvedReason invalid.`);
        return;
      }
      if (e.publishedAt !== undefined && !isIsoTimestamp(e.publishedAt)) {
        errors.push(`entries[${idx}].publishedAt invalid.`);
        return;
      }
      let entryId: string | undefined;
      if (e.entryId !== undefined) {
        if (typeof e.entryId !== 'string' || !e.entryId.trim() || e.entryId.length > 256) {
          errors.push(`entries[${idx}].entryId invalid.`);
          return;
        }
        entryId = e.entryId.trim();
        if (seenEntryIds.has(entryId)) {
          errors.push(`duplicate entryId ${entryId}.`);
          return;
        }
        seenEntryIds.add(entryId);
      }
      entries.push({
        position: pos,
        entryId,
        videoId: vid,
        title,
        thumbnail: typeof e.thumbnail === 'string' && e.thumbnail.length <= 2000 ? (e.thumbnail as string) : undefined,
        durationSec: dur,
        unresolvedReason:
          dur === null
            ? (e.unresolvedReason as PlaylistEntry['unresolvedReason']) ?? 'missingDuration'
            : undefined,
        publishedAt: typeof e.publishedAt === 'string' ? e.publishedAt : undefined,
      });
    });
    // Explicit contiguity check: a hidden gap would corrupt range totals.
    const sortedPositions = [...seenPositions].sort((a, b) => a - b);
    for (let i = 0; i < sortedPositions.length; i++) {
      if (sortedPositions[i] !== i + 1) {
        errors.push(`positions must be contiguous from 1 (gap at ${i + 1}).`);
        break;
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  entries.sort((a, b) => a.position - b.position);
  const snapshot: PlaylistSnapshot = normalizeSnapshotIdentity({
    playlistId: d.playlistId as string,
    title: (d.title as string).trim(),
    channelTitle: typeof d.channelTitle === 'string' ? (d.channelTitle as string) : undefined,
    thumbnail: typeof d.thumbnail === 'string' ? (d.thumbnail as string) : undefined,
    reportedCount: typeof d.reportedCount === 'number' ? (d.reportedCount as number) : entries.length,
    entries,
    source: 'imported',
    fetchedAt: isIsoTimestamp(d.fetchedAt) ? (d.fetchedAt as string) : new Date().toISOString(),
    snapshotVersion: Number.isSafeInteger(d.snapshotVersion) ? (d.snapshotVersion as number) : 1,
  });
  return { ok: true, errors: [], snapshot };
}

/**
 * CSV cell encoding with spreadsheet-formula injection protection. Numeric
 * values are emitted as numbers; string cells beginning with a formula sigil
 * (`= + - @`, tab, or CR, optionally after whitespace) are prefixed with a
 * single quote so Excel/Sheets treat them as text.
 */
export function toCsv(rows: (string | number | null | undefined)[][], header: string[]): string {
  const esc = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (typeof v === 'string' && /^(?:\s*[=+\-@]|[\t\r])/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
}
