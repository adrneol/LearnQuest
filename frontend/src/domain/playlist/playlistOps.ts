// Small, testable playlist-scoped operations shared by the store and UI.

export interface PlaylistScoped {
  playlistId: string;
}

/**
 * Move a module one step within its own playlist only. The global module
 * array may interleave playlists; crossing that boundary would silently
 * reorder an unrelated course.
 */
export function moveModuleWithinPlaylist<T extends { id: string; playlistId: string }>(
  modules: T[],
  id: string,
  dir: -1 | 1,
): T[] {
  const current = modules.find((m) => m.id === id);
  if (!current) return modules;
  const scopedIndices = modules
    .map((m, idx) => ({ m, idx }))
    .filter(({ m }) => m.playlistId === current.playlistId);
  const pos = scopedIndices.findIndex(({ m }) => m.id === id);
  const target = scopedIndices[pos + dir];
  if (pos < 0 || !target) return modules;
  const next = [...modules];
  [next[scopedIndices[pos].idx], next[target.idx]] = [next[target.idx], next[scopedIndices[pos].idx]];
  return next;
}

export interface PlaylistDependencies {
  progress: Record<string, { playlistId: string }>;
  ranges: { playlistId: string }[];
  checkpoints: (PlaylistScoped & { id: string })[];
  modules: PlaylistScoped[];
  sessions: { playlistId: string | null }[];
  segments: PlaylistScoped[];
  playSessions: PlaylistScoped[];
  flexGoals: { playlistId: string | null; checkpointId?: string }[];
  queue: Record<string, number[]>;
}

/**
 * Removal semantics promised by the UI: progress for this playlist is
 * deleted, together with every record that depends on its occurrence identity
 * (sessions, playback segments, queue, ranges, checkpoints, modules, scoped
 * goals). Other playlists are untouched, and a later re-import starts clean
 * rather than resurrecting stale data.
 */
export function playlistRemovalPlan<T extends PlaylistDependencies>(data: T, playlistId: string): {
  progress: T['progress'];
  ranges: T['ranges'];
  checkpoints: T['checkpoints'];
  modules: T['modules'];
  sessions: T['sessions'];
  segments: T['segments'];
  playSessions: T['playSessions'];
  flexGoals: T['flexGoals'];
  queue: T['queue'];
} {
  const checkpointIds = new Set(data.checkpoints.filter((c) => c.playlistId === playlistId).map((c) => c.id));
  const progress = Object.fromEntries(
    Object.entries(data.progress).filter(([, rec]) => (rec as { playlistId?: string }).playlistId !== playlistId),
  );
  const queue = { ...data.queue };
  delete queue[playlistId];
  return {
    progress: progress as T['progress'],
    ranges: data.ranges.filter((r) => r.playlistId !== playlistId) as T['ranges'],
    checkpoints: data.checkpoints.filter((c) => c.playlistId !== playlistId) as T['checkpoints'],
    modules: data.modules.filter((m) => m.playlistId !== playlistId) as T['modules'],
    sessions: data.sessions.filter((s) => s.playlistId !== playlistId) as T['sessions'],
    segments: data.segments.filter((s) => s.playlistId !== playlistId) as T['segments'],
    playSessions: data.playSessions.filter((s) => s.playlistId !== playlistId) as T['playSessions'],
    flexGoals: data.flexGoals.filter((g) => {
      if (g.playlistId === playlistId) return false;
      if (g.checkpointId && checkpointIds.has(g.checkpointId)) return false;
      return true;
    }) as T['flexGoals'],
    queue: queue as T['queue'],
  };
}
