// Stable playlist-occurrence identity and progress reconciliation.
//
// A position is a presentation detail: refreshing a playlist can insert,
// delete, or reorder entries. Completion/annotation records are therefore
// keyed by an occurrence identity (`entryId`), with the legacy position key
// retained as a read-only fallback for pre-migration data. Duplicate videoIds
// are distinct occurrences; when the same video appears twice, occurrences are
// paired in playlist order so an existing completion cannot jump between them.

import type { PlaySession, PlaylistEntry, PlaylistSnapshot, ProgressRecord } from '../../types/index.js';
import type { PlaybackSegment } from '../playback/playback.js';

export const SNAPSHOT_SCHEMA_VERSION = 2;
export const PROGRESS_SCHEMA_VERSION = 2;

/** Stable synthetic identity for snapshots that did not carry one. */
export function syntheticEntryId(videoId: string, occurrence: number, position: number): string {
  const base = videoId || 'missing';
  return `${base}#${occurrence}${videoId ? '' : `@${position}`}`;
}

/**
 * Normalize identity fields without changing positions/durations. Idempotent:
 * existing unique entryIds are preserved; missing ones are derived from the
 * videoId and its occurrence number in playlist order.
 */
export function normalizeSnapshotIdentity(snapshot: PlaylistSnapshot): PlaylistSnapshot {
  const entries = [...snapshot.entries].sort((a, b) => a.position - b.position);
  const seenEntryIds = new Set<string>();
  const videoCounts = new Map<string, number>();
  const normalized: PlaylistEntry[] = entries.map((entry) => {
    const count = (videoCounts.get(entry.videoId) ?? 0) + 1;
    videoCounts.set(entry.videoId, count);
    let entryId = typeof entry.entryId === 'string' ? entry.entryId.trim() : '';
    if (!entryId || seenEntryIds.has(entryId)) {
      entryId = syntheticEntryId(entry.videoId, count, entry.position);
      let suffix = 2;
      while (seenEntryIds.has(entryId)) entryId = `${syntheticEntryId(entry.videoId, count, entry.position)}~${suffix++}`;
    }
    seenEntryIds.add(entryId);
    return { ...entry, entryId };
  });
  return {
    ...snapshot,
    entries: normalized,
    snapshotVersion: Math.max(SNAPSHOT_SCHEMA_VERSION, Number.isSafeInteger(snapshot.snapshotVersion) ? snapshot.snapshotVersion : 1),
  };
}

export function identityKey(playlistId: string, entryId: string): string {
  return `${playlistId}::${entryId}`;
}

export function legacyPositionKey(playlistId: string, position: number): string {
  return `${playlistId}::${position}`;
}

export function entryKey(playlistId: string, entry: PlaylistEntry): string {
  return identityKey(playlistId, entry.entryId ?? syntheticEntryId(entry.videoId, 1, entry.position));
}

/** The one canonical completion predicate. A present key is not completion. */
export function isProgressComplete(rec: ProgressRecord | null | undefined): boolean {
  return Boolean(rec && !rec.orphaned && rec.completedAt && rec.status === 'done');
}

export function isEntryComplete(
  progress: Record<string, ProgressRecord>,
  playlistId: string,
  entry: PlaylistEntry,
): boolean {
  return isProgressComplete(findProgressForEntry(progress, playlistId, entry));
}

/** Direct lookup with a guarded legacy fallback. Never crosses video identity. */
export function findProgressForEntry(
  progress: Record<string, ProgressRecord>,
  playlistId: string,
  entry: PlaylistEntry,
): ProgressRecord | undefined {
  const normalized = entry.entryId ? entry : { ...entry, entryId: syntheticEntryId(entry.videoId, 1, entry.position) };
  const direct = progress[entryKey(playlistId, normalized)];
  if (direct && direct.videoId === entry.videoId && !direct.orphaned) return direct;
  const legacy = progress[legacyPositionKey(playlistId, entry.position)];
  if (legacy && legacy.videoId === entry.videoId && !legacy.orphaned) return legacy;
  for (const rec of Object.values(progress)) {
    if (rec.playlistId !== playlistId || rec.orphaned) continue;
    if (rec.entryId && rec.entryId === normalized.entryId && rec.videoId === entry.videoId) return rec;
  }
  return undefined;
}

export function findProgressAtPosition(
  progress: Record<string, ProgressRecord>,
  snapshot: PlaylistSnapshot,
  position: number,
): ProgressRecord | undefined {
  const entry = snapshot.entries.find((e) => e.position === position);
  return entry ? findProgressForEntry(progress, snapshot.playlistId, entry) : undefined;
}

/** Index every current entry to at most one record, pairing duplicates by occurrence. */
export function buildEntryProgressIndex(
  snapshot: PlaylistSnapshot,
  progress: Record<string, ProgressRecord>,
): Map<number, ProgressRecord> {
  const normalized = normalizeSnapshotIdentity(snapshot);
  const used = new Set<string>();
  const out = new Map<number, ProgressRecord>();
  const records = Object.entries(progress)
    .filter(([, rec]) => !rec.orphaned && rec.playlistId === snapshot.playlistId)
    .sort(([, a], [, b]) => a.position - b.position);
  const byVideo = new Map<string, [string, ProgressRecord][]>();
  for (const [key, rec] of records) {
    const arr = byVideo.get(rec.videoId) ?? [];
    arr.push([key, rec]);
    byVideo.set(rec.videoId, arr);
  }
  for (const entry of normalized.entries) {
    const directKey = entryKey(snapshot.playlistId, entry);
    const direct = progress[directKey];
    if (direct && direct.videoId === entry.videoId && !direct.orphaned && !used.has(directKey)) {
      out.set(entry.position, direct);
      used.add(directKey);
      continue;
    }
    // Legacy position key only when its stored videoId agrees.
    const legacyKey = legacyPositionKey(snapshot.playlistId, entry.position);
    const legacy = progress[legacyKey];
    if (legacy && legacy.videoId === entry.videoId && !legacy.orphaned && !used.has(legacyKey)) {
      out.set(entry.position, legacy);
      used.add(legacyKey);
      continue;
    }
    // Occurrence-order pairing: first unused matching occurrence in playlist order.
    const pair = (byVideo.get(entry.videoId) ?? []).find(([key]) => !used.has(key));
    if (pair) {
      out.set(entry.position, pair[1]);
      used.add(pair[0]);
    }
  }
  return out;
}

export function completedEntryKeys(snapshot: PlaylistSnapshot, progress: Record<string, ProgressRecord>): Set<string> {
  const index = buildEntryProgressIndex(snapshot, progress);
  const out = new Set<string>();
  for (const entry of snapshot.entries) {
    if (isProgressComplete(index.get(entry.position))) out.add(entryKey(snapshot.playlistId, entry));
  }
  return out;
}

export function countCompletedEntries(snapshot: PlaylistSnapshot, progress: Record<string, ProgressRecord>): number {
  return completedEntryKeys(snapshot, progress).size;
}

export interface ProgressReconciliation {
  progress: Record<string, ProgressRecord>;
  moved: number;
  orphaned: number;
  mismatches: number;
}

function mergeRecords(a: ProgressRecord, b: ProgressRecord): ProgressRecord {
  // Preserve every annotation. Completion/source follows the most recent
  // completion, while textual fields are never dropped.
  const completed = (x: ProgressRecord, y: ProgressRecord) => {
    if (!isProgressComplete(x) && isProgressComplete(y)) return b;
    if (isProgressComplete(x) && !isProgressComplete(y)) return a;
    return (y.completedAt ?? '') > (x.completedAt ?? '') ? b : a;
  };
  const winner = completed(a, b);
  const loser = winner === a ? b : a;
  const merged: ProgressRecord = { ...loser, ...winner };
  for (const field of ['notes', 'keyConcepts', 'questions'] as const) {
    if (!merged[field] && loser[field]) merged[field] = loser[field];
  }
  merged.confidence = winner.confidence ?? loser.confidence;
  merged.exerciseDone = winner.exerciseDone ?? loser.exerciseDone;
  merged.codeReproduced = winner.codeReproduced ?? loser.codeReproduced;
  merged.builtExample = winner.builtExample ?? loser.builtExample;
  merged.needsRevision = winner.needsRevision ?? loser.needsRevision;
  merged.revisionDate = winner.revisionDate ?? loser.revisionDate;
  merged.revisionDoneAt = winner.revisionDoneAt ?? loser.revisionDoneAt;
  // Review history is append-only: union both sides by review day so a
  // migration can never silently drop an earlier review.
  const reviewByDay = new Map<string, NonNullable<ProgressRecord['reviewHistory']>[number]>();
  for (const event of [...(loser.reviewHistory ?? []), ...(winner.reviewHistory ?? [])]) {
    if (event && typeof event.dateKey === 'string') reviewByDay.set(event.dateKey, event);
  }
  if (reviewByDay.size > 0) merged.reviewHistory = [...reviewByDay.values()].sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt));
  return merged;
}

function putRecord(out: Record<string, ProgressRecord>, preferredKey: string, rec: ProgressRecord): void {
  if (out[preferredKey]) out[preferredKey] = mergeRecords(out[preferredKey], rec);
  else out[preferredKey] = rec;
}

function orphanKey(playlistId: string, rec: ProgressRecord, used: Set<string>): string {
  const base = `${playlistId}::orphan::${rec.entryId ?? rec.videoId ?? 'unknown'}::${rec.position}`;
  let key = base;
  let i = 2;
  while (used.has(key)) key = `${base}~${i++}`;
  used.add(key);
  return key;
}

/**
 * Rekey progress after a refresh. A record follows its old occurrence only
 * when that occurrence still exists in the new snapshot. Replaced/removed
 * videos preserve the record as an orphan for review and are never counted.
 */
export function reconcileProgress(
  oldSnapshot: PlaylistSnapshot | undefined,
  newSnapshot: PlaylistSnapshot,
  progress: Record<string, ProgressRecord>,
): ProgressReconciliation {
  const next = normalizeSnapshotIdentity(newSnapshot);
  const old = oldSnapshot ? normalizeSnapshotIdentity(oldSnapshot) : undefined;
  const nextById = new Map<string, PlaylistEntry>();
  for (const e of next.entries) nextById.set(e.entryId!, e);
  const nextByVideo = new Map<string, PlaylistEntry[]>();
  for (const e of next.entries) {
    const arr = nextByVideo.get(e.videoId) ?? [];
    arr.push(e);
    nextByVideo.set(e.videoId, arr);
  }
  const oldById = new Map<string, PlaylistEntry>();
  const oldByPos = new Map<number, PlaylistEntry>();
  if (old) for (const e of old.entries) {
    oldById.set(e.entryId!, e);
    oldByPos.set(e.position, e);
  }
  const oldVideoOccurrence = new Map<string, PlaylistEntry>();
  if (old) {
    const occurrences = new Map<string, number>();
    for (const e of old.entries) {
      const n = (occurrences.get(e.videoId) ?? 0) + 1;
      occurrences.set(e.videoId, n);
      oldVideoOccurrence.set(`${e.videoId}#${n}`, e);
    }
  }
  const nextOccurrence = new Map<string, PlaylistEntry>();
  const occurrences = new Map<string, number>();
  for (const e of next.entries) {
    const n = (occurrences.get(e.videoId) ?? 0) + 1;
    occurrences.set(e.videoId, n);
    nextOccurrence.set(`${e.videoId}#${n}`, e);
  }
  const out: Record<string, ProgressRecord> = {};
  const usedKeys = new Set<string>();
  let moved = 0;
  let orphaned = 0;
  let mismatches = 0;
  for (const [oldKey, rec] of Object.entries(progress)) {
    // Reconciliation is scoped to the refreshed playlist. Records owned by
    // other playlists pass through untouched; treating them as "removed" here
    // would silently orphan every other course on each refresh.
    if (rec.playlistId !== newSnapshot.playlistId) {
      out[oldKey] = rec;
      continue;
    }
    const oldEntry = rec.entryId
      ? oldById.get(rec.entryId)
      : oldByPos.get(rec.position);
    let target: PlaylistEntry | undefined;
    if (oldEntry && oldEntry.videoId === rec.videoId) {
      target = nextById.get(oldEntry.entryId!);
      if (!target) {
        const occ = (old?.entries ?? []).filter((e) => e.videoId === rec.videoId).findIndex((e) => e.entryId === oldEntry.entryId) + 1;
        if (occ > 0) target = nextOccurrence.get(`${rec.videoId}#${occ}`);
      }
    } else if (oldEntry && oldEntry.videoId !== rec.videoId) {
      mismatches += 1;
    } else if (!old) {
      target = nextById.get(rec.entryId ?? '') ?? (nextByVideo.get(rec.videoId)?.length === 1 ? nextByVideo.get(rec.videoId)![0] : undefined);
    }
    if (target && target.videoId === rec.videoId && !rec.orphaned) {
      const key = identityKey(next.playlistId, target.entryId!);
      if (key !== oldKey) moved += 1;
      putRecord(out, key, { ...rec, playlistId: next.playlistId, position: target.position, entryId: target.entryId, orphaned: false, reviewReason: undefined });
    } else {
      if (!rec.orphaned) orphaned += 1;
      const reason = oldEntry && oldEntry.videoId !== rec.videoId ? 'video-mismatch' : oldEntry ? 'removed' : 'unknown';
      putRecord(out, orphanKey(next.playlistId, rec, usedKeys), {
        ...rec,
        playlistId: next.playlistId,
        entryId: rec.entryId ?? oldEntry?.entryId,
        orphaned: true,
        reviewReason: rec.reviewReason ?? reason,
      });
    }
  }
  return { progress: out, moved, orphaned, mismatches };
}

/** Reconcile legacy position-keyed records at load time (no previous snapshot). */
export function reconcileLoadedProgress(
  snapshot: PlaylistSnapshot,
  progress: Record<string, ProgressRecord>,
): ProgressReconciliation {
  return reconcileProgress(undefined, snapshot, progress);
}

/** Map queue positions through a snapshot refresh; removed entries drop out. */
export function reconcileQueuePositions(
  oldSnapshot: PlaylistSnapshot | undefined,
  newSnapshot: PlaylistSnapshot,
  positions: number[] | undefined,
): number[] {
  if (!positions?.length) return [];
  const next = normalizeSnapshotIdentity(newSnapshot);
  if (!oldSnapshot) {
    const valid = new Set(next.entries.map((e) => e.position));
    return [...new Set(positions.filter((p) => valid.has(p)))];
  }
  const old = normalizeSnapshotIdentity(oldSnapshot);
  const oldByPos = new Map(old.entries.map((e) => [e.position, e]));
  const nextById = new Map(next.entries.map((e) => [e.entryId!, e]));
  const out: number[] = [];
  for (const p of positions) {
    const oldEntry = oldByPos.get(p);
    if (!oldEntry) continue;
    const target = nextById.get(oldEntry.entryId!);
    if (target && !out.includes(target.position)) out.push(target.position);
  }
  return out;
}

/** Attach stable entryIds to existing playback telemetry after a refresh. */
export function reconcileSegments(
  oldSnapshot: PlaylistSnapshot | undefined,
  newSnapshot: PlaylistSnapshot,
  segments: PlaybackSegment[],
): PlaybackSegment[] {
  const old = oldSnapshot ? normalizeSnapshotIdentity(oldSnapshot) : undefined;
  const next = normalizeSnapshotIdentity(newSnapshot);
  const oldByPos = new Map((old?.entries ?? []).map((e) => [e.position, e]));
  const nextById = new Map(next.entries.map((e) => [e.entryId!, e]));
  const nextByPos = new Map(next.entries.map((e) => [e.position, e]));
  return segments.map((seg) => {
    if (seg.playlistId !== newSnapshot.playlistId) return seg;
    const oldEntry = seg.entryId
      ? old?.entries.find((e) => e.entryId === seg.entryId)
      : oldByPos.get(seg.position)?.videoId === seg.videoId
        ? oldByPos.get(seg.position)
        : undefined;
    if (oldEntry) {
      const target = nextById.get(oldEntry.entryId!);
      if (target && target.videoId === seg.videoId) return { ...seg, position: target.position, entryId: target.entryId };
      return { ...seg, entryId: oldEntry.entryId };
    }
    // On load (no old snapshot) attach only when the position still agrees.
    const current = nextByPos.get(seg.position);
    if (current && current.videoId === seg.videoId) return { ...seg, entryId: seg.entryId ?? current.entryId };
    return { ...seg, entryId: seg.entryId ?? `unmatched@${seg.position}:${seg.videoId}` };
  });
}

export function reconcilePlaySessions(
  oldSnapshot: PlaylistSnapshot | undefined,
  newSnapshot: PlaylistSnapshot,
  sessions: PlaySession[],
): PlaySession[] {
  const old = oldSnapshot ? normalizeSnapshotIdentity(oldSnapshot) : undefined;
  const next = normalizeSnapshotIdentity(newSnapshot);
  const oldByPos = new Map((old?.entries ?? []).map((e) => [e.position, e]));
  const nextById = new Map(next.entries.map((e) => [e.entryId!, e]));
  const nextByPos = new Map(next.entries.map((e) => [e.position, e]));
  return sessions.map((sess) => {
    if (sess.playlistId !== newSnapshot.playlistId) return sess;
    const oldEntry = sess.entryId
      ? old?.entries.find((e) => e.entryId === sess.entryId)
      : oldByPos.get(sess.position)?.videoId === sess.videoId
        ? oldByPos.get(sess.position)
        : undefined;
    if (oldEntry) {
      const target = nextById.get(oldEntry.entryId!);
      if (target && target.videoId === sess.videoId) return { ...sess, position: target.position, entryId: target.entryId };
      return { ...sess, entryId: oldEntry.entryId };
    }
    const current = nextByPos.get(sess.position);
    if (current && current.videoId === sess.videoId) return { ...sess, entryId: sess.entryId ?? current.entryId };
    return { ...sess, entryId: sess.entryId ?? `unmatched@${sess.position}:${sess.videoId}` };
  });
}

/** Key used for per-occurrence telemetry; never position-only after migration. */
export function segmentIdentityKey(seg: Pick<PlaybackSegment, 'playlistId' | 'position' | 'videoId' | 'entryId'>): string {
  return `${seg.playlistId}::${seg.entryId ?? `${seg.position}:${seg.videoId}`}`;
}

export function playSessionIdentityKey(sess: Pick<PlaySession, 'playlistId' | 'position' | 'videoId' | 'entryId'>): string {
  return `${sess.playlistId}::${sess.entryId ?? `${sess.position}:${sess.videoId}`}`;
}
