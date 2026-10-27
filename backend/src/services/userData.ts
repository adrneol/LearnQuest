import { USER_COLLECTIONS, type DataStore, type UserCollectionName } from '../store.js';
import { env } from '../config/env.js';

export const COLLECTION_KIND: Record<UserCollectionName, 'map' | 'array' | 'singleton'> = {
  playlists: 'map',
  meta: 'map',
  progress: 'map',
  ranges: 'array',
  checkpoints: 'array',
  modules: 'array',
  sessions: 'array',
  goals: 'map',
  xp: 'array',
  achievements: 'map',
  segments: 'array',
  playSessions: 'array',
  queue: 'map',
  flexGoals: 'array',
  challenge: 'singleton',
  challengeEnabled: 'singleton',
  rankHistory: 'array',
  settings: 'singleton',
  prefs: 'singleton',
  activeId: 'singleton',
};

const MAX_ITEMS: Record<UserCollectionName, number> = {
  playlists: 1_000,
  meta: 1_000,
  progress: 100_000,
  ranges: 5_000,
  checkpoints: 5_000,
  modules: 2_000,
  sessions: 50_000,
  goals: 5_000,
  xp: 100_000,
  achievements: 1_000,
  segments: 200_000,
  playSessions: 100_000,
  queue: 1_000,
  flexGoals: 5_000,
  challenge: 1,
  challengeEnabled: 1,
  rankHistory: 1_000,
  settings: 1,
  prefs: 1,
  activeId: 1,
};

export interface UserState {
  playlists: Record<string, any>;
  meta: Record<string, any>;
  progress: Record<string, any>;
  ranges: any[];
  checkpoints: any[];
  modules: any[];
  sessions: any[];
  goals: Record<string, any>;
  xp: any[];
  achievements: Record<string, any>;
  segments: any[];
  playSessions: any[];
  queue: Record<string, any>;
  flexGoals: any[];
  challenge: any;
  challengeEnabled: boolean;
  rankHistory: any[];
  settings: any;
  prefs: any;
  activeId: string | null;
}

export function emptyUserState(): UserState {
  return {
    playlists: {}, meta: {}, progress: {}, ranges: [], checkpoints: [], modules: [],
    sessions: [], goals: {}, xp: [], achievements: {}, segments: [], playSessions: [],
    queue: {}, flexGoals: [], challenge: null, challengeEnabled: false, rankHistory: [],
    settings: null, prefs: null, activeId: null,
  };
}

function httpError(message: string, status: number, code?: string): Error & { status: number; code?: string } {
  return Object.assign(new Error(message), { status, code });
}

function isObj(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIso(value: unknown): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isDateKey(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function boundedString(value: unknown, max: number, allowEmpty = true): boolean {
  return typeof value === 'string' && value.length <= max && (allowEmpty || value.length > 0);
}

function positiveInt(value: unknown, max = 10_000_000): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= max;
}

function finiteNonNegative(value: unknown, max = 365 * 24 * 3600): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
}

function noOwnershipFields(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => noOwnershipFields(v, `${path}[${i}]`));
    return;
  }
  if (!isObj(value)) return;
  for (const key of Object.keys(value)) {
    if (key === 'userId' || key === 'ownerId' || key === 'accountId') {
      throw httpError(`Client-supplied ownership field "${key}" is not allowed at ${path}.`, 400, 'OWNERSHIP_FIELD');
    }
    if (key !== '_id') noOwnershipFields(value[key], `${path}.${key}`);
  }
}

function requirePlaylistRef(value: any, name: string): void {
  if (!isObj(value) || !boundedString(value.playlistId, 128, false)) {
    throw httpError(`${name} must reference a valid playlistId.`, 400);
  }
}

function validateItem(name: UserCollectionName, value: any, index: number): void {
  const where = `${name}[${index}]`;
  if (name === 'queue') {
    if (!Array.isArray(value) || value.length > 1_000 || !value.every((p) => positiveInt(p, 1_000))) {
      throw httpError(`${where} must be an array of playlist positions.`, 400);
    }
    return;
  }
  if (name === 'achievements') {
    if (!isIso(value)) throw httpError(`${where} must be an ISO timestamp.`, 400);
    return;
  }
  if (!isObj(value)) throw httpError(`${where} must be an object.`, 400);
  switch (name) {
    case 'playlists': {
      if (!boundedString(value.playlistId, 128, false)) throw httpError(`${where}.playlistId is invalid.`, 400);
      if (!boundedString(value.title, 500, false)) throw httpError(`${where}.title is invalid.`, 400);
      if (!Array.isArray(value.entries) || value.entries.length > 1_000) throw httpError(`${where}.entries must be an array of at most 1000 entries.`, 400);
      for (const [i, e] of value.entries.entries()) {
        if (!isObj(e) || !positiveInt(e.position, 1_000) || !boundedString(e.videoId, 64) || !boundedString(e.title, 500)) {
          throw httpError(`${where}.entries[${i}] is invalid.`, 400);
        }
        if (e.durationSec !== null && !finiteNonNegative(e.durationSec, 7 * 24 * 3600)) {
          throw httpError(`${where}.entries[${i}].durationSec is invalid.`, 400);
        }
      }
      if (value.source !== 'api' && value.source !== 'imported') throw httpError(`${where}.source is invalid.`, 400);
      if (!isIso(value.fetchedAt)) throw httpError(`${where}.fetchedAt is invalid.`, 400);
      return;
    }
    case 'meta': {
      if (typeof value.archived !== 'boolean') throw httpError(`${where}.archived must be a boolean.`, 400);
      if (!isIso(value.addedAt)) throw httpError(`${where}.addedAt is invalid.`, 400);
      if (value.customTitle !== undefined && !boundedString(value.customTitle, 200)) throw httpError(`${where}.customTitle is invalid.`, 400);
      return;
    }
    case 'progress': {
      requirePlaylistRef(value, where);
      if (!positiveInt(value.position, 1_000_000)) throw httpError(`${where}.position is invalid.`, 400);
      if (!boundedString(value.videoId, 64)) throw httpError(`${where}.videoId is invalid.`, 400);
      if (!['todo', 'in-progress', 'done', 'unavailable'].includes(value.status)) throw httpError(`${where}.status is invalid.`, 400);
      if (value.completedAt !== null && !isIso(value.completedAt)) throw httpError(`${where}.completedAt is invalid.`, 400);
      if (value.confidence !== undefined && (!Number.isInteger(value.confidence) || value.confidence < 1 || value.confidence > 5)) throw httpError(`${where}.confidence is invalid.`, 400);
      for (const f of ['notes', 'keyConcepts', 'questions', 'reviewReason']) {
        if (value[f] !== undefined && !boundedString(value[f], 50_000)) throw httpError(`${where}.${f} is invalid.`, 400);
      }
      if (value.reviewHistory !== undefined) {
        if (!Array.isArray(value.reviewHistory) || value.reviewHistory.length > 500) throw httpError(`${where}.reviewHistory is invalid.`, 400);
        for (const ev of value.reviewHistory) {
          if (!isObj(ev) || !boundedString(ev.id, 200, false) || !isIso(ev.reviewedAt) || !isDateKey(ev.dateKey)) {
            throw httpError(`${where}.reviewHistory contains an invalid event.`, 400);
          }
        }
      }
      return;
    }
    case 'ranges':
    case 'checkpoints': {
      requirePlaylistRef(value, where);
      if (!boundedString(value.id, 200, false)) throw httpError(`${where}.id is invalid.`, 400);
      if (!boundedString(value.label, 300, false)) throw httpError(`${where}.label is invalid.`, 400);
      if (!positiveInt(value.start, 1_000_000) || !positiveInt(value.end, 1_000_000) || value.start > value.end) {
        throw httpError(`${where} has an invalid inclusive range.`, 400);
      }
      if (!isIso(value.createdAt)) throw httpError(`${where}.createdAt is invalid.`, 400);
      if (value.completedAt !== undefined && value.completedAt !== null && !isIso(value.completedAt)) throw httpError(`${where}.completedAt is invalid.`, 400);
      return;
    }
    case 'modules': {
      requirePlaylistRef(value, where);
      if (!boundedString(value.id, 200, false) || !boundedString(value.name, 300, false)) throw httpError(`${where} is invalid.`, 400);
      if (!Array.isArray(value.positions) || value.positions.length > 1_000 || !value.positions.every((p: unknown) => positiveInt(p, 1_000))) {
        throw httpError(`${where}.positions is invalid.`, 400);
      }
      return;
    }
    case 'sessions': {
      if (!boundedString(value.id, 200, false)) throw httpError(`${where}.id is invalid.`, 400);
      if (value.playlistId !== null && !boundedString(value.playlistId, 128, false)) throw httpError(`${where}.playlistId is invalid.`, 400);
      if (!isIso(value.startedAt)) throw httpError(`${where}.startedAt is invalid.`, 400);
      if (value.finishedAt !== null && !isIso(value.finishedAt)) throw httpError(`${where}.finishedAt is invalid.`, 400);
      if (!finiteNonNegative(value.activeSec, 31 * 24 * 3600) || !finiteNonNegative(value.elapsedSec, 31 * 24 * 3600)) {
        throw httpError(`${where} has invalid durations.`, 400);
      }
      if (value.intervals !== undefined) {
        if (!Array.isArray(value.intervals) || value.intervals.length > 1_000) throw httpError(`${where}.intervals is invalid.`, 400);
        for (const it of value.intervals) {
          if (!isObj(it) || !Number.isFinite(it.startMs) || !Number.isFinite(it.endMs) || !['active', 'paused'].includes(it.kind)) {
            throw httpError(`${where}.intervals contains an invalid interval.`, 400);
          }
        }
      }
      if (value.note !== undefined && !boundedString(value.note, 20_000)) throw httpError(`${where}.note is invalid.`, 400);
      return;
    }
    case 'goals': {
      if (!isDateKey(value.dateKey)) throw httpError(`${where}.dateKey is invalid.`, 400);
      if (!finiteNonNegative(value.targetFocusSec, 7 * 24 * 3600) || !finiteNonNegative(value.minViableSec, 7 * 24 * 3600)) {
        throw httpError(`${where} has invalid targets.`, 400);
      }
      return;
    }
    case 'xp': {
      if (!boundedString(value.id, 200, false) || !boundedString(value.dedupKey, 500, false)) throw httpError(`${where} is invalid.`, 400);
      if (!boundedString(value.reason, 300) || typeof value.points !== 'number' || !Number.isFinite(value.points) || Math.abs(value.points) > 1_000_000) {
        throw httpError(`${where} has invalid XP values.`, 400);
      }
      if (!isIso(value.at)) throw httpError(`${where}.at is invalid.`, 400);
      return;
    }
    case 'segments':
    case 'playSessions': {
      requirePlaylistRef(value, where);
      if (!boundedString(value.id, 200, false)) throw httpError(`${where}.id is invalid.`, 400);
      return;
    }
    case 'flexGoals': {
      if (!boundedString(value.id, 200, false)) throw httpError(`${where}.id is invalid.`, 400);
      if (!boundedString(value.metric, 50, false) || typeof value.target !== 'number' || !Number.isFinite(value.target)) {
        throw httpError(`${where} is invalid.`, 400);
      }
      if (!isIso(value.createdAt)) throw httpError(`${where}.createdAt is invalid.`, 400);
      return;
    }
    case 'rankHistory': {
      if (!isIso(value.at) || !Number.isFinite(value.rank) || !Number.isFinite(value.of)) throw httpError(`${where} is invalid.`, 400);
      return;
    }
    default:
      return;
  }
}

function validateSingleton(name: UserCollectionName, value: any): void {
  if (value === null || value === undefined) return;
  if (name === 'activeId') {
    if (typeof value !== 'string' || value.length > 128) throw httpError('activeId is invalid.', 400);
    return;
  }
  if (name === 'challengeEnabled') {
    if (typeof value !== 'boolean') throw httpError('challengeEnabled must be a boolean.', 400);
    return;
  }
  if (name === 'settings') {
    if (!isObj(value) || typeof value.verifiedThreshold !== 'number' || value.verifiedThreshold < 0.5 || value.verifiedThreshold > 1) {
      throw httpError('settings is invalid.', 400);
    }
    return;
  }
  if (name === 'prefs') {
    if (!isObj(value) || !boundedString(value.timezone, 100, false)) throw httpError('prefs is invalid.', 400);
    for (const f of ['sessionLenMin', 'breakMin', 'minViableMin']) {
      if (value[f] !== undefined && !finiteNonNegative(value[f], 10_000)) throw httpError(`prefs.${f} is invalid.`, 400);
    }
    return;
  }
  if (name === 'challenge') {
    if (!isObj(value)) throw httpError('challenge is invalid.', 400);
  }
}

/** Validate a collection payload and return it unchanged when valid. */
export function validateCollectionPayload(name: UserCollectionName, input: unknown): unknown {
  if (!USER_COLLECTIONS.includes(name)) throw httpError('Unknown user-data collection.', 400);
  noOwnershipFields(input, name);
  const kind = COLLECTION_KIND[name];
  if (kind === 'singleton') {
    validateSingleton(name, input);
    return input ?? null;
  }
  if (kind === 'map') {
    if (!isObj(input)) throw httpError(`${name} must be an object map.`, 400);
    const entries = Object.entries(input);
    if (entries.length > MAX_ITEMS[name]) throw httpError(`${name} exceeds its supported item limit.`, 400);
    for (const [key, value] of entries) {
      if (!key || key.length > 300) throw httpError(`${name} contains an invalid key.`, 400);
      validateItem(name, value, 0);
    }
    return input;
  }
  if (!Array.isArray(input)) throw httpError(`${name} must be an array.`, 400);
  if (input.length > MAX_ITEMS[name]) throw httpError(`${name} exceeds its supported item limit.`, 400);
  const ids = new Set<string>();
  input.forEach((item, i) => {
    validateItem(name, item, i);
    const id = String(item.id);
    if (ids.has(id)) throw httpError(`${name} contains a duplicate id.`, 400);
    ids.add(id);
  });
  return input;
}

export function validateStatePayload(raw: unknown): UserState {
  if (!isObj(raw)) throw httpError('State payload must be an object.', 400);
  const clean: Record<string, unknown> = {};
  for (const name of USER_COLLECTIONS) {
    const value = raw[name];
    if (value === undefined) {
      clean[name] = emptyUserState()[name];
      continue;
    }
    clean[name] = validateCollectionPayload(name, value);
  }
  const bytes = Buffer.byteLength(JSON.stringify(clean), 'utf8');
  if (bytes > env.accountMaxStateBytes) {
    throw httpError(`Account data exceeds the ${Math.round(env.accountMaxStateBytes / 1024 / 1024)} MB safety limit. Export a backup and split large histories.`, 413, 'STATE_TOO_LARGE');
  }
  return clean as unknown as UserState;
}

export async function getStateVersion(store: DataStore, userId: string): Promise<number> {
  const doc = await store.stateVersions.findOne({ userId });
  if (doc) return Number(doc.version) || 0;
  await store.stateVersions.updateOne(
    { userId },
    { $set: { userId, version: 0, updatedAt: new Date().toISOString() } },
    { upsert: true },
  );
  return 0;
}

/** Reserve the next version with a compare-and-set; returns the new version. */
async function reserveVersion(store: DataStore, userId: string, expected: number): Promise<number> {
  const now = new Date().toISOString();
  const updated = await store.stateVersions.findOneAndUpdate(
    { userId, version: expected },
    { $inc: { version: 1 }, $set: { updatedAt: now } },
  );
  if (updated) return Number(updated.version);
  const current = await getStateVersion(store, userId);
  if (current === expected) {
    // First write for this user (no version document yet).
    const created = await store.stateVersions.findOneAndUpdate(
      { userId },
      { $set: { userId, version: expected + 1, updatedAt: now } },
      { upsert: true },
    );
    if (created && Number(created.version) === expected + 1) return expected + 1;
  }
  throw httpError(`Your data changed in another session (expected version ${expected}, current ${current}). Reload before saving.`, 409, 'VERSION_CONFLICT');
}

function playlistIdOf(value: unknown): string | undefined {
  return isObj(value) && typeof value.playlistId === 'string' ? value.playlistId : undefined;
}

/**
 * Replace one collection. The adapter has no cross-document transaction, so
 * keep the previous rows and restore them if any delete/insert step fails.
 * This turns a mid-write disconnect into a failed request with the previous
 * collection intact instead of a partially emptied account.
 */
async function writeCollection(store: DataStore, userId: string, name: UserCollectionName, value: unknown): Promise<void> {
  const col = store.data(name);
  const previous = await col.find({ userId });
  const now = new Date().toISOString();
  const kind = COLLECTION_KIND[name];
  let cleared = false;
  try {
    await col.deleteMany({ userId });
    cleared = true;
    if (kind === 'singleton') {
      await col.insertOne({ userId, key: 'singleton', value: value ?? null, updatedAt: now, order: 0 });
      return;
    }
    if (kind === 'map') {
      const entries = Object.entries(value as Record<string, unknown>);
      for (const [key, v] of entries) {
        await col.insertOne({
          userId,
          key,
          value: v,
          playlistId: playlistIdOf(v),
          updatedAt: now,
          order: 0,
        });
      }
      return;
    }
    const items = value as any[];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      await col.insertOne({
        userId,
        key: String(item.id),
        value: item,
        playlistId: playlistIdOf(item),
        updatedAt: now,
        order: i,
      });
    }
  } catch (error) {
    if (cleared) {
      try {
        await col.deleteMany({ userId });
        for (const doc of previous) await col.insertOne(doc);
      } catch {
        // The original failure is more actionable; the retry path re-reads
        // the authoritative collection before attempting another write.
      }
    }
    throw error;
  }
}

async function restoreCollection(store: DataStore, userId: string, name: UserCollectionName, docs: any[]): Promise<void> {
  const col = store.data(name);
  await col.deleteMany({ userId });
  for (const doc of docs) await col.insertOne(doc);
}

async function releaseVersion(store: DataStore, userId: string, version: number): Promise<void> {
  if (version <= 0) return;
  try {
    await store.stateVersions.updateOne({ userId, version }, { $inc: { version: -1 } });
  } catch {
    // The failed write still returns a conflict-free error; reloading data is
    // always safe because the authoritative rows were restored above.
  }
}

export async function readUserState(store: DataStore, userId: string): Promise<{ state: UserState; version: number }> {
  const state = emptyUserState();
  const version = await getStateVersion(store, userId);
  await Promise.all(USER_COLLECTIONS.map(async (name) => {
    const col = store.data(name);
    const kind = COLLECTION_KIND[name];
    if (kind === 'singleton') {
      const doc = await col.findOne({ userId, key: 'singleton' });
      (state as any)[name] = doc ? doc.value : null;
      return;
    }
    if (kind === 'map') {
      const docs = await col.find({ userId });
      const out: Record<string, unknown> = {};
      for (const doc of docs) out[String(doc.key)] = doc.value;
      (state as any)[name] = out;
      return;
    }
    const docs = await col.find({ userId }, { sort: { order: 1 } });
    (state as any)[name] = docs.map((d) => d.value);
  }));
  return { state, version };
}

export async function replaceUserCollection(
  store: DataStore,
  userId: string,
  name: UserCollectionName,
  payload: unknown,
  expectedVersion: number,
): Promise<{ version: number; collection: UserCollectionName }> {
  const value = validateCollectionPayload(name, payload);
  const version = await reserveVersion(store, userId, expectedVersion);
  try {
    await writeCollection(store, userId, name, value ?? null);
  } catch (error) {
    await releaseVersion(store, userId, version);
    throw error;
  }
  return { version, collection: name };
}

export async function replaceAllUserState(
  store: DataStore,
  userId: string,
  raw: unknown,
  expectedVersion: number,
): Promise<{ version: number; state: UserState }> {
  const state = validateStatePayload(raw);
  const previous = new Map<UserCollectionName, any[]>();
  for (const name of USER_COLLECTIONS) {
    previous.set(name, await store.data(name).find({ userId }));
  }
  const version = await reserveVersion(store, userId, expectedVersion);
  try {
    for (const name of USER_COLLECTIONS) {
      await writeCollection(store, userId, name, (state as any)[name]);
    }
  } catch (error) {
    // Import/migration is an all-or-nothing account operation from the UI's
    // perspective. Restore every collection if a later collection fails so a
    // partial restore can never be mistaken for a completed one.
    for (const name of USER_COLLECTIONS) {
      try {
        await restoreCollection(store, userId, name, previous.get(name) ?? []);
      } catch {
        // Keep attempting the remaining restores, then surface the original
        // write failure. The client reloads authoritative data before retry.
      }
    }
    await releaseVersion(store, userId, version);
    throw error;
  }
  return { version, state };
}

export async function getUserStateExport(store: DataStore, userId: string) {
  const { state, version } = await readUserState(store, userId);
  return { schemaVersion: 3, dataVersion: version, exportedAt: new Date().toISOString(), state };
}

async function getPlaylistDoc(store: DataStore, userId: string, playlistId: string) {
  return store.data('playlists').findOne({ userId, key: playlistId });
}

async function summaryForPlaylist(store: DataStore, userId: string, playlistId: string) {
  const names: UserCollectionName[] = ['progress', 'ranges', 'checkpoints', 'modules', 'sessions', 'segments', 'playSessions'];
  const out: Record<string, number> = {};
  for (const n of names) out[n] = await store.data(n).count({ userId, playlistId });
  const goalCount = await store.data('flexGoals').count({ userId, playlistId });
  out.flexGoals = goalCount;
  return out;
}

export async function archivePlaylist(
  store: DataStore,
  userId: string,
  playlistId: string,
  archived: boolean,
  expectedVersion: number,
) {
  const snap = await getPlaylistDoc(store, userId, playlistId);
  if (!snap) throw httpError('Playlist not found for this account.', 404, 'NOT_FOUND');
  const version = await reserveVersion(store, userId, expectedVersion);
  const now = new Date().toISOString();
  const existingMeta = await store.data('meta').findOne({ userId, key: playlistId });
  await store.data('meta').updateOne(
    { userId, key: playlistId },
    {
      $set: {
        userId,
        key: playlistId,
        playlistId,
        value: { archived, addedAt: existingMeta?.value?.addedAt ?? now, ...(existingMeta?.value?.customTitle ? { customTitle: existingMeta.value.customTitle } : {}) },
        updatedAt: now,
        order: 0,
      },
    },
    { upsert: true },
  );
  const activeDoc = await store.data('activeId').findOne({ userId, key: 'singleton' });
  const activeId = activeDoc?.value ?? null;
  let fallback: string | null = activeId;
  if (archived && activeId === playlistId) {
    const [remaining, metas] = await Promise.all([
      store.data('playlists').find({ userId }, { sort: { order: 1 } }),
      store.data('meta').find({ userId }),
    ]);
    const archivedIds = new Set(metas.filter((m) => m.value?.archived).map((m) => String(m.key)));
    const next = remaining.map((d) => String(d.key)).find((id) => id !== playlistId && !archivedIds.has(id));
    fallback = next ?? null;
    await store.data('activeId').updateOne(
      { userId, key: 'singleton' },
      { $set: { userId, key: 'singleton', value: fallback, updatedAt: now, order: 0 } },
      { upsert: true },
    );
  }
  return { version, playlistId, archived, activeId: fallback };
}

/** Best-effort attribution of XP to a playlist without positional guessing. */
function xpBelongs(
  doc: any,
  playlistId: string,
  checkpointIds: Set<string>,
  goalIds: Set<string>,
  focusKeys: Set<string>,
): boolean {
  const key = String(doc?.value?.dedupKey ?? '');
  if (
    key.startsWith(`done:${playlistId}:`)
    || key.startsWith(`rev:${playlistId}:`)
    || key.startsWith(`ach:${playlistId}:`)
    || key.startsWith(`code:${playlistId}:`)
    || key.startsWith(`ex:${playlistId}:`)
    || key.startsWith(`built:${playlistId}:`)
  ) return true;
  if (key.startsWith('cp:')) return checkpointIds.has(key.slice(3).split(':')[0]);
  if (key.startsWith('goal:')) return goalIds.has(key.slice(5).split(':')[0]);
  if (key.startsWith('focus:')) return focusKeys.has(key);
  return false;
}

export interface PlaylistDeleteResult {
  playlistId: string;
  title: string;
  deleted: boolean;
  alreadyDeleted: boolean;
  deletedCounts: Record<string, number>;
  activeId: string | null;
}

async function displayedPlaylistTitle(store: DataStore, userId: string, playlistId: string): Promise<string | null> {
  const snap = await getPlaylistDoc(store, userId, playlistId);
  if (!snap) return null;
  const meta = await store.data('meta').findOne({ userId, key: playlistId });
  return meta?.value?.customTitle ?? snap.value?.title ?? 'Untitled playlist';
}

function deletionRelatedGoal(goal: any, playlistId: string, checkpointIds: Set<string>): boolean {
  if (goal?.playlistId === playlistId) return true;
  return Boolean(goal?.checkpointId && checkpointIds.has(String(goal.checkpointId)));
}

/**
 * Idempotent, ordered playlist deletion protocol. A job document records
 * progress and the identifiers used for attribution so a retry after a
 * partial failure cannot lose the ability to remove checkpoint/goal XP.
 * Success is never reported before every step completes.
 */
export async function deletePlaylistPermanently(
  store: DataStore,
  userId: string,
  playlistId: string,
  expectedVersion: number,
  confirmTitle: string,
): Promise<PlaylistDeleteResult> {
  const existingJob = await store.deletions.findOne({ userId, playlistId });
  if (existingJob?.status === 'completed') {
    const activeDoc = await store.data('activeId').findOne({ userId, key: 'singleton' });
    return {
      playlistId,
      title: String(existingJob.title ?? 'Untitled playlist'),
      deleted: true,
      alreadyDeleted: true,
      deletedCounts: existingJob.deletedCounts ?? {},
      activeId: activeDoc?.value ?? null,
    };
  }
  // A failed/running job may have already deleted the playlist document, so it
  // must stay resumable without the snapshot. A fresh request still requires it.
  const resumable = Boolean(existingJob && (existingJob.status === 'failed' || existingJob.status === 'running'));
  const snap = await getPlaylistDoc(store, userId, playlistId);
  if (!snap && !resumable) throw httpError('Playlist not found for this account.', 404, 'NOT_FOUND');
  // Persist the title on the job so a retry can still require the exact title
  // after the playlist snapshot has been deleted.
  const title = (snap ? await displayedPlaylistTitle(store, userId, playlistId) : existingJob?.title)
    ?? existingJob?.title
    ?? null;
  if (!title) throw httpError('Playlist not found for this account.', 404, 'NOT_FOUND');
  if (confirmTitle !== title) {
    throw httpError('The playlist changed since this dialog opened. Close it and review the current title before deleting.', 409, 'TITLE_MISMATCH');
  }

  const checkpointDocs = await store.data('checkpoints').find({ userId, playlistId });
  const remainingCheckpointIds = new Set(checkpointDocs.map((d) => String(d.key)));
  const allGoalDocs = await store.data('flexGoals').find({ userId });
  const remainingGoalIds = new Set(
    allGoalDocs
      .filter((d) => deletionRelatedGoal(d.value, playlistId, remainingCheckpointIds))
      .map((d) => String(d.key)),
  );
  const sessionDocs = await store.data('sessions').find({ userId, playlistId });
  const remainingFocusKeys = new Set(
    sessionDocs.map((d) => `focus:${String(d.value?.clientId || d.value?.id || d.key)}`),
  );

  // A failed/running job already reserved one version. Allow the person to
  // retry with either the original tab's version or a freshly reloaded
  // version; genuine concurrent edits still produce a conflict.
  let version: number;
  if (resumable) {
    const current = await getStateVersion(store, userId);
    const jobVersion = Number(existingJob!.version ?? -1);
    // The first attempt reserved one version. The original tab still holds
    // jobVersion - 1 and has not reloaded, so accept it only while no later
    // edit has moved the account past the failed job's reservation.
    const originalVersion = Math.max(0, jobVersion - 1);
    const acceptable = expectedVersion === current
      || expectedVersion === jobVersion
      || (current === jobVersion && expectedVersion === originalVersion);
    if (!acceptable) {
      throw httpError(`Your data changed in another session (expected version ${expectedVersion}, current ${current}). Reload before saving.`, 409, 'VERSION_CONFLICT');
    }
    version = current;
  } else {
    version = await reserveVersion(store, userId, expectedVersion);
  }

  const checkpointIds = new Set<string>(
    Array.isArray(existingJob?.checkpointIds) ? existingJob!.checkpointIds.map(String) : [...remainingCheckpointIds],
  );
  const goalIds = new Set<string>(
    Array.isArray(existingJob?.goalIds) ? existingJob!.goalIds.map(String) : [...remainingGoalIds],
  );
  const focusKeys = new Set<string>(
    Array.isArray(existingJob?.focusKeys) ? existingJob!.focusKeys.map(String) : [...remainingFocusKeys],
  );

  await store.deletions.updateOne(
    { userId, playlistId },
    {
      $set: {
        userId,
        playlistId,
        title,
        status: 'running',
        startedAt: existingJob?.startedAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version,
        checkpointIds: [...checkpointIds],
        goalIds: [...goalIds],
        focusKeys: [...focusKeys],
        deletedCounts: existingJob?.deletedCounts ?? {},
        failedCollection: null,
      },
    },
    { upsert: true },
  );

  const counts: Record<string, number> = { ...(existingJob?.deletedCounts ?? {}) };
  const plan: { name: UserCollectionName; filter: Record<string, unknown> }[] = [
    { name: 'progress', filter: { userId, playlistId } },
    { name: 'ranges', filter: { userId, playlistId } },
    { name: 'checkpoints', filter: { userId, playlistId } },
    { name: 'modules', filter: { userId, playlistId } },
    { name: 'sessions', filter: { userId, playlistId } },
    { name: 'segments', filter: { userId, playlistId } },
    { name: 'playSessions', filter: { userId, playlistId } },
    { name: 'queue', filter: { userId, key: playlistId } },
    { name: 'playlists', filter: { userId, key: playlistId } },
    { name: 'meta', filter: { userId, key: playlistId } },
  ];

  for (const step of plan) {
    try {
      counts[step.name] = (counts[step.name] ?? 0) + await store.data(step.name).deleteMany(step.filter);
    } catch (e) {
      await store.deletions.updateOne(
        { userId, playlistId },
        { $set: { status: 'failed', failedCollection: step.name, deletedCounts: counts, updatedAt: new Date().toISOString() } },
      );
      throw e;
    }
    await store.deletions.updateOne(
      { userId, playlistId },
      { $set: { deletedCounts: counts, updatedAt: new Date().toISOString() } },
    );
  }

  // Goals scoped by a deleted checkpoint are attributable even if their
  // playlistId is null; those identifiers are persisted on the job above.
  try {
    let deletedGoals = 0;
    for (const doc of allGoalDocs) {
      if (goalIds.has(String(doc.key))) {
        deletedGoals += await store.data('flexGoals').deleteOne({ userId, key: doc.key });
      }
    }
    counts.flexGoals = (counts.flexGoals ?? 0) + deletedGoals;
  } catch (e) {
    await store.deletions.updateOne(
      { userId, playlistId },
      { $set: { status: 'failed', failedCollection: 'flexGoals', deletedCounts: counts, updatedAt: new Date().toISOString() } },
    );
    throw e;
  }

  // XP is deleted only when its dedup key gives a reliable playlist/checkpoint/
  // goal/focus association. Day and other account-wide XP remain.
  try {
    const xpDocs = await store.data('xp').find({ userId });
    for (const doc of xpDocs) {
      if (xpBelongs(doc, playlistId, checkpointIds, goalIds, focusKeys)) {
        counts.xp = (counts.xp ?? 0) + await store.data('xp').deleteOne({ userId, _id: doc._id });
      }
    }
  } catch (e) {
    await store.deletions.updateOne(
      { userId, playlistId },
      { $set: { status: 'failed', failedCollection: 'xp', deletedCounts: counts, updatedAt: new Date().toISOString() } },
    );
    throw e;
  }

  // Choose a valid remaining active playlist.
  const remaining = await store.data('playlists').find({ userId }, { sort: { order: 1 } });
  const metas = await store.data('meta').find({ userId });
  const archived = new Set(metas.filter((m) => m.value?.archived).map((m) => String(m.key)));
  const fallback = remaining.map((d) => String(d.key)).find((id) => !archived.has(id)) ?? null;
  await store.data('activeId').updateOne(
    { userId, key: 'singleton' },
    { $set: { userId, key: 'singleton', value: fallback, updatedAt: new Date().toISOString(), order: 0 } },
    { upsert: true },
  );

  await store.deletions.updateOne(
    { userId, playlistId },
    { $set: { status: 'completed', completedAt: new Date().toISOString(), deletedCounts: counts, activeId: fallback } },
  );
  return { playlistId, title, deleted: true, alreadyDeleted: false, deletedCounts: counts, activeId: fallback };
}

export async function playlistSummary(store: DataStore, userId: string, playlistId: string) {
  const snap = await getPlaylistDoc(store, userId, playlistId);
  if (!snap) return null;
  const meta = await store.data('meta').findOne({ userId, key: playlistId });
  return {
    playlistId,
    // The UI displays the user's custom title. Typed-title confirmation must
    // match exactly what the user was asked to type.
    title: meta?.value?.customTitle ?? snap.value?.title ?? 'Untitled playlist',
    counts: await summaryForPlaylist(store, userId, playlistId),
  };
}

export async function deleteAllUserData(store: DataStore, userId: string): Promise<void> {
  for (const name of USER_COLLECTIONS) await store.data(name).deleteMany({ userId });
  await store.deletions.deleteMany({ userId });
  await store.migrations.deleteMany({ userId });
  await store.stateVersions.deleteMany({ userId });
  await store.actionTokens.deleteMany({ userId });
}

export { httpError };
