import { describe, it, expect } from 'vitest';
import {
  normalizeSnapshotIdentity, identityKey, legacyPositionKey, findProgressForEntry,
  reconcileProgress, reconcileQueuePositions, countCompletedEntries, isProgressComplete,
  reconcileSegments, reconcilePlaySessions,
} from '../src/domain/index.js';
import type { PlaylistSnapshot, PlaylistEntry, ProgressRecord, PlaybackSegment, PlaySession } from '../src/domain/index.js';

function entry(position: number, videoId: string, title = videoId, entryId?: string): PlaylistEntry {
  return { position, videoId, title, durationSec: 60, entryId };
}

function snap(playlistId: string, entries: PlaylistEntry[]): PlaylistSnapshot {
  return {
    playlistId,
    title: 'Course',
    reportedCount: entries.length,
    entries,
    source: 'api',
    fetchedAt: '2026-10-01T00:00:00.000Z',
    snapshotVersion: 1,
  };
}

function rec(playlistId: string, e: PlaylistEntry, patch: Partial<ProgressRecord> = {}): ProgressRecord {
  return {
    playlistId,
    position: e.position,
    entryId: e.entryId,
    videoId: e.videoId,
    completedAt: '2026-10-01T10:00:00.000Z',
    status: 'done',
    source: 'manual',
    ...patch,
  };
}

describe('stable occurrence identity and progress migration', () => {
  it('follows a video through reordering without moving completion to another video', () => {
    const old = normalizeSnapshotIdentity(snap('PLidentity000000000000', [entry(1, 'A'), entry(2, 'B'), entry(3, 'C')]));
    const moved = normalizeSnapshotIdentity(snap('PLidentity000000000000', [entry(1, 'B'), entry(2, 'A'), entry(3, 'C')]));
    const progress = { [legacyPositionKey(old.playlistId, 2)]: rec(old.playlistId, old.entries[1], { notes: 'B notes' }) };

    const r = reconcileProgress(old, moved, progress);
    expect(r.moved).toBe(1);
    expect(r.orphaned).toBe(0);
    const b = moved.entries.find((e) => e.videoId === 'B')!;
    const a = moved.entries.find((e) => e.videoId === 'A')!;
    expect(findProgressForEntry(r.progress, moved.playlistId, b)?.notes).toBe('B notes');
    expect(findProgressForEntry(r.progress, moved.playlistId, b)?.position).toBe(1);
    expect(findProgressForEntry(r.progress, moved.playlistId, a)).toBeUndefined();
  });

  it('maps API entryIds through insertion and keeps duplicate occurrences distinct', () => {
    const old = normalizeSnapshotIdentity(snap('PLidentity000000000001', [
      entry(1, 'A', 'A', 'item-a1'),
      entry(2, 'A', 'A again', 'item-a2'),
      entry(3, 'B', 'B', 'item-b'),
    ]));
    const inserted = normalizeSnapshotIdentity(snap('PLidentity000000000001', [
      entry(1, 'X', 'New', 'item-x'),
      entry(2, 'A', 'A', 'item-a1'),
      entry(3, 'A', 'A again', 'item-a2'),
      entry(4, 'B', 'B', 'item-b'),
    ]));
    const progress = {
      [identityKey(old.playlistId, 'item-a1')]: rec(old.playlistId, old.entries[0], { notes: 'first occurrence' }),
      [identityKey(old.playlistId, 'item-a2')]: rec(old.playlistId, old.entries[1], { notes: 'second occurrence' }),
    };
    const r = reconcileProgress(old, inserted, progress);
    const first = findProgressForEntry(r.progress, inserted.playlistId, inserted.entries[1]);
    const second = findProgressForEntry(r.progress, inserted.playlistId, inserted.entries[2]);
    expect(first?.notes).toBe('first occurrence');
    expect(second?.notes).toBe('second occurrence');
    expect(first?.position).toBe(2);
    expect(second?.position).toBe(3);
    expect(r.orphaned).toBe(0);
    expect(countCompletedEntries(inserted, r.progress)).toBe(2);
  });

  it('orphans a removed video instead of transferring its completion to a neighbour', () => {
    const old = normalizeSnapshotIdentity(snap('PLidentity000000000002', [entry(1, 'A'), entry(2, 'B'), entry(3, 'C')]));
    const removed = normalizeSnapshotIdentity(snap('PLidentity000000000002', [entry(1, 'A'), entry(2, 'C')]));
    const progress = { [identityKey(old.playlistId, old.entries[1].entryId!)]: rec(old.playlistId, old.entries[1], { notes: 'keep me' }) };
    const r = reconcileProgress(old, removed, progress);
    expect(r.orphaned).toBe(1);
    expect(countCompletedEntries(removed, r.progress)).toBe(0);
    const orphan = Object.values(r.progress).find((x) => x.orphaned);
    expect(orphan?.notes).toBe('keep me');
    expect(orphan?.reviewReason).toBe('removed');
    // C at its old position must not inherit B's completion.
    expect(findProgressForEntry(r.progress, removed.playlistId, removed.entries[1])).toBeUndefined();
  });

  it('flags a legacy record whose stored videoId disagrees with the position', () => {
    const current = normalizeSnapshotIdentity(snap('PLidentity000000000003', [entry(1, 'A')]));
    const progress = {
      [legacyPositionKey(current.playlistId, 1)]: rec(current.playlistId, { ...entry(1, 'A'), entryId: current.entries[0].entryId }, { videoId: 'DIFFERENT' }),
    };
    const r = reconcileProgress(undefined, current, progress);
    expect(r.mismatches + r.orphaned).toBeGreaterThan(0);
    expect(findProgressForEntry(r.progress, current.playlistId, current.entries[0])).toBeUndefined();
    expect(Object.values(r.progress).some((x) => x.orphaned && x.videoId === 'DIFFERENT')).toBe(true);
  });

  it('never orphans progress owned by another playlist during a refresh', () => {
    const oldP = normalizeSnapshotIdentity(snap('PLidentity000000000004', [entry(1, 'A')]));
    const newP = normalizeSnapshotIdentity(snap('PLidentity000000000004', [entry(1, 'A')]));
    const other = normalizeSnapshotIdentity(snap('PLidentity000000000005', [entry(1, 'Z')]));
    const qKey = identityKey(other.playlistId, other.entries[0].entryId!);
    const qRecord = rec(other.playlistId, other.entries[0], { notes: 'other course' });
    const progress = { [identityKey(oldP.playlistId, oldP.entries[0].entryId!)]: rec(oldP.playlistId, oldP.entries[0]), [qKey]: qRecord };

    const r = reconcileProgress(oldP, newP, progress);
    expect(r.progress[qKey]).toEqual(qRecord);
    expect(r.orphaned).toBe(0);
    expect(countCompletedEntries(other, r.progress)).toBe(1);
  });

  it('migrates legacy position-keyed records at load without losing annotations', () => {
    const current = normalizeSnapshotIdentity(snap('PLidentity000000000006', [entry(1, 'A', 'A', 'item-a'), entry(2, 'B', 'B', 'item-b')]));
    const progress = {
      [legacyPositionKey(current.playlistId, 1)]: rec(current.playlistId, current.entries[0], {
        notes: 'legacy note', confidence: 4, keyConcepts: 'closures', exerciseDone: false,
      }),
    };
    const r = reconcileProgress(undefined, current, progress);
    const migrated = findProgressForEntry(r.progress, current.playlistId, current.entries[0]);
    expect(migrated?.notes).toBe('legacy note');
    expect(migrated?.confidence).toBe(4);
    expect(migrated?.keyConcepts).toBe('closures');
    expect(migrated?.exerciseDone).toBe(false);
    expect(isProgressComplete(migrated)).toBe(true);
  });

  it('rekeys queue, segments, and play sessions by occurrence identity', () => {
    const old = normalizeSnapshotIdentity(snap('PLidentity000000000007', [entry(1, 'A', 'A', 'item-a'), entry(2, 'B', 'B', 'item-b')]));
    const next = normalizeSnapshotIdentity(snap('PLidentity000000000007', [entry(1, 'B', 'B', 'item-b'), entry(2, 'A', 'A', 'item-a')]));
    expect(reconcileQueuePositions(old, next, [1, 2, 99])).toEqual([2, 1]);
    const segment: PlaybackSegment = {
      id: 's1', playlistId: old.playlistId, position: 1, entryId: 'item-a', videoId: 'A',
      sessionId: 'sess', wallStartMs: 1000, wallEndMs: 2000, timelineStartSec: 0, timelineEndSec: 10,
      playbackRate: 1, source: 'verified',
    };
    expect(reconcileSegments(old, next, [segment])[0]).toMatchObject({ position: 2, entryId: 'item-a' });
    const playSession: PlaySession = {
      id: 'p1', playlistId: old.playlistId, position: 1, entryId: 'item-a', videoId: 'A',
      startedAt: '2026-10-01T00:00:00.000Z', finishedAt: '2026-10-01T00:01:00.000Z',
      activePlaybackSec: 60, contentSec: 60, uniqueGainSec: 60, pauseSec: 0, source: 'verified',
    };
    expect(reconcilePlaySessions(old, next, [playSession])[0]).toMatchObject({ position: 2, entryId: 'item-a' });
  });
});
