import { chromium } from 'playwright-core';
import { mkdtemp } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listZip } from './helpers/zip-verify.mjs';

const BASE = 'http://localhost:5200';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
await ctx.addInitScript(() => { try { localStorage.setItem('lq-theme', 'dark'); } catch {} });
const page = await ctx.newPage();
page.on('pageerror', (err) => console.log('pageerror', err.message));
page.on('console', (msg) => { if (msg.type() === 'error') console.log('console ERR', msg.text()); });
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });

const dir = await mkdtemp(join(tmpdir(), 'lq-export-'));

// Trigger the real browser download path: buildAccountExport + anchor click.
const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
await page.evaluate(async () => {
  const mod = await import('/src/services/exports/accountExport.js');
  const zipMod = await import('/src/services/exports/zip.js');
  const { buildAccountExport } = mod;
  const { downloadZip } = zipMod;
  const now = new Date('2026-11-10T12:00:00.000Z');
  const state = {
    playlists: {}, meta: {}, activeId: null, progress: {}, ranges: [], checkpoints: [], modules: [],
    sessions: [], goals: {}, xp: [], achievements: {}, prefs: { timezone: 'UTC', sessionLenMin: 25, breakMin: 5, reducedMotion: false, minViableMin: 10 },
    segments: [], playSessions: [], queue: {}, flexGoals: [],
    challenge: { seed: 20261013, cohortSize: 100, tierDist: {}, windowDays: 14, dailyCapHours: 6 },
    challengeEnabled: false, rankHistory: [],
    settings: { verifiedThreshold: 0.9 },
  };
  const profile = {
    username: null, displayName: null, email: '', timezone: 'UTC',
    hasPassword: false, googleLinked: false, memberSince: now.toISOString(),
  };
  const { zip } = buildAccountExport(state, profile, now);
  downloadZip('learnquest-account-export-verify.zip', zip);
});
const download = await downloadPromise;
const saved = join(dir, 'download.zip');
await download.saveAs(saved);
const downloadedBytes = new Uint8Array(await readFile(saved));
const downloadedNames = listZip(downloadedBytes);
console.log('browser download entries:', downloadedNames.length, downloadedNames.includes('LearnQuest-Account-Export/README.md') ? 'README ok' : 'README MISSING');
await browser.close();

