import { describe, it, expect } from 'vitest';
import { buildAccountExport, ACCOUNT_EXPORT_FORMAT, ACCOUNT_EXPORT_FORMAT_VERSION } from '../src/services/exports/accountExport.js';
import { buildZip, crc32, type ZipEntry } from '../src/services/exports/zip.js';
import { buildBackup, validateBackup } from '../src/services/persistence/backup.js';
import type { BackupState } from '../src/services/persistence/backup.js';
import { DEFAULT_CHALLENGE } from '../src/domain/competition/competition.js';

const emptyExportState = (): BackupState => ({
  playlists: {}, meta: {}, activeId: null, progress: {}, ranges: [], checkpoints: [],
  modules: [], sessions: [], goals: {}, xp: [], achievements: {},
  prefs: { timezone: 'UTC', sessionLenMin: 25, breakMin: 5, reducedMotion: false, minViableMin: 10 },
  segments: [], playSessions: [], queue: {}, flexGoals: [],
  challenge: { ...DEFAULT_CHALLENGE }, challengeEnabled: false, rankHistory: [],
  settings: { verifiedThreshold: 0.9 },
});

const sampleState = (): BackupState => {
  const state: BackupState = emptyExportState();
  state.playlists = {
    PLtest00000000000001: {
      playlistId: 'PLtest00000000000001',
      title: 'Unicode ✓ playlist — λes',
      entries: [
        { position: 1, entryId: 'e-1', videoId: 'v1', title: 'First ✓', durationSec: 300 },
        { position: 2, entryId: 'e-2', videoId: 'v2', title: 'Second', durationSec: null },
      ],
      source: 'imported',
      fetchedAt: '2026-11-01T10:00:00.000Z',
      snapshotVersion: 1,
    },
  };
  state.meta = {
    PLtest00000000000001: { archived: false, addedAt: '2026-11-01T10:05:00.000Z' },
  };
  state.activeId = 'PLtest00000000000001';
  state.progress = {
    'PLtest00000000000001::e-1': {
      playlistId: 'PLtest00000000000001', position: 1, videoId: 'v1', entryId: 'e-1',
      status: 'done', completedAt: '2026-11-02T09:00:00.000Z', source: 'manual',
      orphaned: false, reviewReason: undefined,
    },
  };
  state.sessions = [
    { id: 'sess-1', clientId: 'client-1', playlistId: 'PLtest00000000000001', startedAt: '2026-11-02T08:00:00.000Z', finishedAt: '2026-11-02T08:30:00.000Z', activeSec: 1500, elapsedSec: 1800, dateKey: '2026-11-02', pausedSec: 300 },
  ];
  state.goals = { '2026-11-02': { dateKey: '2026-11-02', targetFocusSec: 3600, targetCount: 5, minViableSec: 600 } };
  state.xp = [{ id: 'xp-1', reason: 'videoDone', points: 120, dedupKey: 'done:pl:e-1', at: '2026-11-02T09:00:00.000Z' }];
  state.achievements = { first_video: '2026-11-02T09:00:00.000Z' };
  state.prefs = { timezone: 'UTC', sessionLenMin: 25, breakMin: 5, reducedMotion: false, minViableMin: 10 };
  state.settings = { verifiedThreshold: 0.9 };
  state.rankHistory = [];
  return state;
};

const profile = {
  username: 'exporttester',
  displayName: 'Export Tester',
  email: 'export-test@example.invalid',
  timezone: 'UTC',
  hasPassword: true,
  googleLinked: false,
  memberSince: '2026-10-01T00:00:00.000Z',
};

/** Minimal ZIP reader (stored entries only) for round-trip verification. */
function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Locate End Of Central Directory by scanning backwards
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 65558; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('EOCD not found');
  const total = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  let offset = eocd - centralSize;
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let n = 0; n < total; n += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('central dir signature mismatch');
    const crc = view.getUint32(offset + 16, true);
    const size = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = dec.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    // Read the local header to find the data start
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const data = bytes.slice(dataStart, dataStart + size);
    expect(crc32(data)).toBe(crc);
    out.set(name, data);
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe('account export (.zip)', () => {
  const state = sampleState();
  const now = new Date('2026-11-10T12:00:00.000Z');
  const { zip, manifest } = buildAccountExport(state, profile, now);
  const files = unzip(zip);

  it('declares the documented format in the manifest', () => {
    expect(manifest.format).toBe(ACCOUNT_EXPORT_FORMAT);
    expect(manifest.formatVersion).toBe(ACCOUNT_EXPORT_FORMAT_VERSION);
    expect(manifest.exportedAt).toBe(now.toISOString());
  });

  it('exports every learning-data domain file (all 20) and reports counts', () => {
    const expected = [
      'learning-data/playlists.json', 'learning-data/meta.json', 'learning-data/active-playlist.json',
      'learning-data/progress.json', 'learning-data/ranges.json', 'learning-data/checkpoints.json',
      'learning-data/modules.json', 'learning-data/learning-sessions.json', 'learning-data/goals.json',
      'learning-data/xp.json', 'learning-data/achievements.json', 'learning-data/segments.json',
      'learning-data/play-sessions.json', 'learning-data/queue.json', 'learning-data/flexible-goals.json',
      'learning-data/challenges.json', 'learning-data/challenge-settings.json', 'learning-data/rank-history.json',
      'learning-data/settings.json', 'learning-data/preferences.json',
    ];
    for (const name of expected) {
      expect(files.has(`LearnQuest-Account-Export/${name}`), `missing ${name}`).toBe(true);
    }
    expect(manifest.domains['learning-data/playlists.json']).toBe(1);
    expect(manifest.domains['learning-data/sessions.json' as never] ?? manifest.domains['learning-data/learning-sessions.json']).toBe(1);
    expect(manifest.domains['reports/videos.csv']).toBe(2);
    expect(manifest.domains['reports/sessions.csv']).toBe(1);
    expect(manifest.totalRecords).toBeGreaterThan(10);
  });

  it('contains the README and the manifest with valid JSON', () => {
    const readme = new TextDecoder().decode(files.get('LearnQuest-Account-Export/README.md'));
    expect(readme).toContain('# LearnQuest account export');
    expect(readme).not.toMatch(/argon2id|SESSION_SECRET|CSRF-TOKEN|passwordHash/i);
    const manifestRaw = new TextDecoder().decode(files.get('LearnQuest-Account-Export/manifest.json'));
    expect(() => JSON.parse(manifestRaw)).not.toThrow();
  });

  it('never includes authentication or credential material', () => {
    for (const [name, data] of files) {
      const text = new TextDecoder().decode(data);
      expect(text, `forbidden material in ${name}`).not.toMatch(/argon2|SESSION_SECRET|csrfToken|__Host-lq_session|passwordHash/i);
    }
  });

  it('round-trips unicode content exactly', () => {
    const playlists = JSON.parse(new TextDecoder().decode(files.get('LearnQuest-Account-Export/learning-data/playlists.json')));
    expect(playlists.PLtest00000000000001.title).toBe('Unicode ✓ playlist — λes');
    expect(playlists.PLtest00000000000001.entries[0].title).toBe('First ✓');
  });

  it('exports sessions CSV with ISO timestamps, never auth sessions', () => {
    const csv = new TextDecoder().decode(files.get('LearnQuest-Account-Export/reports/sessions.csv'));
    expect(csv).toContain('2026-11-02T08:00:00.000Z');
    expect(csv).toContain('dateKey');
    expect(csv.split('\n').length).toBe(2); // header + one row
  });

  it('full restore-compatible backup still round-trips through validateBackup', async () => {
    const json = await buildBackup(state);
    const validated = validateBackup(json);
    expect(validated.ok).toBe(true);
  });

  it('an empty account still produces a complete archive', () => {
    const empty = emptyExportState();
    const out = buildAccountExport(empty, { ...profile, email: 'empty@example.invalid' }, now);
    const parsed = unzip(out.zip);
    expect(parsed.has('LearnQuest-Account-Export/README.md')).toBe(true);
    expect(parsed.has('LearnQuest-Account-Export/manifest.json')).toBe(true);
    expect(out.manifest.domains['learning-data/playlists.json']).toBe(0);
  });
});
