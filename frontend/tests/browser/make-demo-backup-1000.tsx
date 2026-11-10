import { buildBackup } from '../../src/services/persistence/backup.js';
import { DEFAULT_CHALLENGE } from '../../src/domain/competition/competition.js';
import { writeFile } from 'node:fs/promises';

const now = new Date('2026-11-10T08:00:00.000Z').toISOString();
const TITLES = ['Intro to the course', 'Foundations', 'Deep dive into memory', 'Spaced repetition explained', 'A tricky case study', 'Synthesis and practice', 'Review the essentials', 'Exam strategy', 'The big picture', 'Advanced scenarios', 'Troubleshooting stuck points', 'Putting it together', 'Questions answered', 'Worked example 1', 'Worked example 2', 'Reading the fine print', 'Common pitfalls', 'Debugging your approach', 'Connecting the dots', 'A walkthrough', 'Design decisions', 'Finish lines', 'Ceremony complete', 'Next steps'];
const TOTAL = 1000;
const entries = Array.from({ length: TOTAL }, (_, i) => {
  const pos = i + 1;
  return {
    position: pos,
    entryId: `entry-${pos}`,
    videoId: `demovideo${String(pos).padStart(2, '0')}`,
    title: TITLES[i % TITLES.length] + ' ' + (i + 1),
    durationSec: 300 + i * 97,
    reportedCount: entriesCountSafe(TOTAL, i),
  };
});
function entriesCountSafe(_n: number, _i: number): number | null { return null; }

const progress: Record<string, unknown> = {};
for (const pos of [1, 2, 3, 4, 5, 6]) {
  const entryId = `entry-${pos}`;
  progress[`PLDemoSynthetic00001::${entryId}`] = {
    playlistId: 'PLDemoSynthetic00001',
    position: pos,
    videoId: `demovideo${String(pos).padStart(2, '0')}`,
    entryId,
    status: 'done',
    completedAt: `2026-11-0${(pos % 7) + 1}T1${pos % 10}:00:00.000Z`,
    source: 'verified',
    orphaned: false,
    reviewReason: undefined,
  };
}

const state = {
  playlists: {
    PLDemoSynthetic00001: {
      playlistId: 'PLDemoSynthetic00001',
      title: 'Synthetic Study Circuit',
      entries,
      source: 'imported',
      fetchedAt: now,
      snapshotVersion: 1,
    },
  },
  meta: {
    PLDemoSynthetic00001: { archived: false, addedAt: now },
  },
  activeId: 'PLDemoSynthetic00001',
  progress,
  ranges: [
    { id: 'range-1', playlistId: 'PLDemoSynthetic00001', label: 'Foundations', start: 1, end: 8, createdAt: now, snapshotVersion: 1, status: 'valid' },
  ],
  checkpoints: [
    { id: 'cp-1', playlistId: 'PLDemoSynthetic00001', label: 'Checkpoint A', start: 1, end: 8, createdAt: now, completedAt: null, snapshotVersion: 1, status: 'valid' },
  ],
  modules: [
    { id: 'mod-1', playlistId: 'PLDemoSynthetic00001', name: 'Foundations', positions: [1, 2, 3, 4, 5, 6, 7, 8], createdAt: now },
    { id: 'mod-2', playlistId: 'PLDemoSynthetic00001', name: 'Practice', positions: [9, 10, 11, 12, 13, 14, 15, 16], createdAt: now },
  ],
  sessions: [
    { id: 's-1', clientId: 'c-1', playlistId: 'PLDemoSynthetic00001', startedAt: '2026-11-09T09:00:00.000Z', finishedAt: '2026-11-09T09:47:00.000Z', activeSec: 2400, elapsedSec: 2820, pausedSec: 420, dateKey: '2026-11-09', note: 'Foundations review' },
    { id: 's-2', clientId: 'c-2', playlistId: 'PLDemoSynthetic00001', startedAt: '2026-11-08T08:30:00.000Z', finishedAt: '2026-11-08T09:15:00.000Z', activeSec: 1800, elapsedSec: 2100, pausedSec: 300, dateKey: '2026-11-08', note: 'Deep dive' },
  ],
  goals: {
    '2026-11-09': { dateKey: '2026-11-09', targetFocusSec: 3600, targetCount: 4, minViableSec: 600 },
  },
  xp: [
    { id: 'x-1', reason: 'videoDone', points: 120, dedupKey: 'done:PLDemoSynthetic00001:entry-1', at: '2026-11-03T10:00:00.000Z' },
    { id: 'x-2', reason: 'focus', points: 200, dedupKey: 'focus:c-1', at: '2026-11-09T09:47:00.000Z' },
    { id: 'x-3', reason: 'studyDay', points: 150, dedupKey: 'day:2026-11-09', at: '2026-11-09T09:47:00.000Z' },
  ],
  achievements: { first_video: '2026-11-03T10:00:00.000Z' },
  prefs: { timezone: 'UTC', sessionLenMin: 25, breakMin: 5, reducedMotion: false, minViableMin: 10 },
  segments: [],
  playSessions: [],
  queue: { PLDemoSynthetic00001: [7, 8] },
  flexGoals: [],
  challenge: { ...DEFAULT_CHALLENGE },
  challengeEnabled: false,
  rankHistory: [],
  settings: { verifiedThreshold: 0.9 },
};

const json = buildBackup(state as any, now);
await writeFile(new URL('./demo-backup.json', import.meta.url), json, 'utf8');
console.log('wrote demo-backup.json', json.length, 'bytes');
