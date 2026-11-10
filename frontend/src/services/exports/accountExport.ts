/**
 * Human-readable account export.
 *
 * Two export formats serve different needs and must not be confused:
 *  - Account export (this module): an organized .zip archive a person can
 *    open, read, diff and archive. Documents declared in `manifest.json`.
 *  - Full backup (Reports / Account): restore-compatible, versioned Backup
 *    JSON v3 consumed by `validateBackup`/`importBackup`. Never deprecated.
 *
 * Security: no passwords, hashes, session cookies, tokens or secrets are
 * included. Authentication sessions are not learning records and are never
 * exported. The 20 learning-data domains map one-to-one to JSON files with
 * stable, descriptive filenames; the README documents the layout and the
 * record relationships.
 */

import { buildZip, type ZipEntry } from './zip.js';
import { toCsv } from '../../domain/index.js';
import type { BackupState } from '../persistence/backup.js';

export const ACCOUNT_EXPORT_FORMAT = 'learnquest-account-export';
export const ACCOUNT_EXPORT_FORMAT_VERSION = 1;

export interface AccountProfileLite {
  username: string | null;
  displayName: string | null;
  email: string;
  timezone: string;
  hasPassword: boolean;
  googleLinked: boolean;
  memberSince: string;
}

const DOMAIN_FILES: Array<{ domain: keyof BackupState; file: string }> = [
  { domain: 'playlists', file: 'playlists.json' },
  { domain: 'meta', file: 'meta.json' },
  { domain: 'progress', file: 'progress.json' },
  { domain: 'ranges', file: 'ranges.json' },
  { domain: 'checkpoints', file: 'checkpoints.json' },
  { domain: 'modules', file: 'modules.json' },
  { domain: 'sessions', file: 'learning-sessions.json' },
  { domain: 'goals', file: 'goals.json' },
  { domain: 'xp', file: 'xp.json' },
  { domain: 'achievements', file: 'achievements.json' },
  { domain: 'segments', file: 'segments.json' },
  { domain: 'playSessions', file: 'play-sessions.json' },
  { domain: 'queue', file: 'queue.json' },
  { domain: 'flexGoals', file: 'flexible-goals.json' },
  { domain: 'challenge', file: 'challenges.json' },
  { domain: 'rankHistory', file: 'rank-history.json' },
  { domain: 'settings', file: 'settings.json' },
  { domain: 'prefs', file: 'preferences.json' },
];

function recordCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>).length;
  return value === undefined || value === null ? 0 : 1;
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

export function buildAccountExport(state: BackupState, profile: AccountProfileLite, now: Date = new Date()): { zip: Uint8Array; manifest: Record<string, unknown> } {
  const included: Record<string, number> = {};
  const entries: ZipEntry[] = [];

  // account/ profile and preferences (preferences duplicated into the domain
  // tree via DOMAIN_FILES below so both stay one source of truth)
  entries.push({
    path: 'LearnQuest-Account-Export/account/profile.json',
    data: pretty({
      username: profile.username,
      displayName: profile.displayName,
      email: profile.email,
      timezone: profile.timezone,
      hasPassword: profile.hasPassword,
      googleLinked: profile.googleLinked,
      memberSince: profile.memberSince,
    }),
  });
  included['account/profile.json'] = 1;

  for (const { domain, file } of DOMAIN_FILES) {
    const value = (state as unknown as Record<string, unknown>)[domain];
    included[`learning-data/${file}`] = recordCount(value);
    entries.push({ path: `LearnQuest-Account-Export/learning-data/${file}`, data: pretty(value) });
  }

  included['learning-data/challenge-enabled.json'] = typeof state.challengeEnabled === 'boolean' ? 1 : 0;
  entries.push({
    path: 'LearnQuest-Account-Export/learning-data/challenge-settings.json',
    data: pretty({
      challenge: state.challenge,
      challengeEnabled: state.challengeEnabled,
    }),
  });

  included['learning-data/active-playlist.json'] = state.activeId ? 1 : 0;
  entries.push({ path: 'LearnQuest-Account-Export/learning-data/active-playlist.json', data: pretty({ activeId: state.activeId }) });

  // reports/ — readable CSV views; no derived analytics invented here
  const videosCsv = Object.values(state.playlists)
    .flatMap((p) => p.entries.map((e) => ({ playlist: p.playlistId, title: e.title, position: e.position, videoId: e.videoId, durationSec: e.durationSec, url: `https://www.youtube.com/watch?v=${e.videoId}` })))
    .map((row) => [row.playlist, row.position, row.title, row.videoId, row.durationSec ?? 'unresolved', row.url]);
  included['reports/videos.csv'] = videosCsv.length;
  entries.push({
    path: 'LearnQuest-Account-Export/reports/videos.csv',
    data: toCsv(videosCsv, ['playlistId', 'position', 'title', 'videoId', 'durationSec', 'url']),
  });

  const sessionsCsv = state.sessions.map((x) => [
    x.id, x.clientId ?? '', x.playlistId ?? '', x.startedAt, x.finishedAt ?? '', x.dateKey,
    x.activeSec, Number((x.activeSec / 60).toFixed(2)), x.pausedSec ?? '', x.note ?? '',
  ]);
  included['reports/sessions.csv'] = sessionsCsv.length;
  entries.push({
    path: 'LearnQuest-Account-Export/reports/sessions.csv',
    data: toCsv(sessionsCsv, ['id', 'clientId', 'playlistId', 'startedAt', 'finishedAt', 'dateKey', 'activeSec', 'activeMin', 'pausedSec', 'note']),
  });

  const checkpointsCsv = state.checkpoints.map((c) => [
    c.id, c.playlistId, c.label, c.start, c.end, c.createdAt, c.completedAt ?? '', c.status,
  ]);
  included['reports/checkpoints.csv'] = checkpointsCsv.length;
  entries.push({
    path: 'LearnQuest-Account-Export/reports/checkpoints.csv',
    data: toCsv(checkpointsCsv, ['id', 'playlistId', 'label', 'start', 'end', 'createdAt', 'completedAt', 'status']),
  });

  const totalRecords = Object.values(included).reduce((a, b) => a + b, 0);
  const manifest = {
    format: ACCOUNT_EXPORT_FORMAT,
    formatVersion: ACCOUNT_EXPORT_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    application: 'learnquest-frontend',
    applicationVersion: '0.2.0',
    domains: included,
    totalRecords,
    completeness: 'Reports are derived views; see learning-data/*.json for authoritative records.',
  };
  entries.push({ path: 'LearnQuest-Account-Export/manifest.json', data: pretty(manifest) });

  entries.push({
    path: 'LearnQuest-Account-Export/README.md',
    data: [
      '# LearnQuest account export',
      '',
      `Exported at ${now.toISOString()} from LearnQuest.`,
      '',
      '## Layout',
      '',
      '- `manifest.json` — format, version, export timestamp, record counts.',
      '- `account/profile.json` — display name, username, verified email, timezone,',
      '  member-since, Google link and password sign-in availability.',
      '- `learning-data/*.json` — the 20 canonical learning-data domains, one file',
      '  per domain (`learning-sessions.json` is **learning** sessions only; no',
      '  authentication sessions, tokens, or passwords are included).',
      '- `learning-data/active-playlist.json` — the playlist currently in focus.',
      '- `learning-data/challenge-settings.json` — Arena simulation configuration and',
      '  enabled state (synthetic competitors, never real people).',
      '- `reports/*.csv` — flat, spreadsheet-friendly views of videos, focus sessions',
      '  and checkpoints.',
      '',
      '## Relationships',
      '',
      'Every record that belongs to a playlist references it by `playlistId`',
      '(`playlists.json` keys are `playlistId` values). Progress records additionally',
      'carry a stable `entryId` (identity, not position). XP events use a `dedupKey`',
      'and never double-count. Goals reference `dateKey` (`YYYY-MM-DD`, user timezone).',
      '',
      '## Inspecting the data',
      '',
      'JSON files are indented UTF-8 text. Open them in any editor or a JSON viewer.',
      'CSV files open directly in any spreadsheet tool.',
      '',
      '## Restoring',
      '',
      'This archive is for inspection and portability. To restore into LearnQuest, use',
      'the restore-compatible Backup JSON (schema v3) available in Reports or Account;',
      'it is validated atomically before any write happens.',
      '',
      '## Security',
      '',
      'No passwords, password hashes, session cookies, Google tokens, email-action',
      'tokens or other credentials are included in this archive.',
      '',
    ].join('\n'),
  });

  return { zip: buildZip(entries, now), manifest };
}
