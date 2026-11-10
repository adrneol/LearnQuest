import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { chromium } from 'playwright-core';
import { build } from 'vite';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixedTime = '2026-11-10T12:00:00Z';
const playlistId = 'PLbrowserfixture0001';
const state = {
  activeId: playlistId,
  playlists: {
    [playlistId]: {
      playlistId, title: 'Synthetic learning playlist', source: 'imported',
      fetchedAt: fixedTime, reportedCount: 150, snapshotVersion: 2,
      entries: Array.from({ length: 150 }, (_, index) => ({
        position: index + 1,
        entryId: `fixture-entry-${index + 1}`,
        videoId: index < 2 ? 'duplicate01' : `test${String(index).padStart(7, '0')}`,
        title: `Lesson ${index + 1}: Synthetic learning fixture`,
        durationSec: index === 2 ? null : (index % 7 + 1) * 73,
        ...(index === 2 ? { unresolvedReason: 'missingDuration' } : {}),
      })),
    },
  },
  meta: { [playlistId]: { archived: false, addedAt: fixedTime } },
  prefs: { timezone: 'UTC', sessionLenMin: 25, breakMin: 5, reducedMotion: true, minViableMin: 10 },
};

const user = {
  userId: 'browser-fixture', username: 'fixture_learner', displayName: 'Fixture Learner',
  email: 'fixture@example.invalid', onboardingComplete: true, timezone: 'UTC',
  sessionLenMin: 25, breakMin: 5, minViableMin: 10,
  createdAt: fixedTime, hasPassword: true, googleLinked: false,
};

function cloudReply(path, motion) {
  if (path === '/api/auth/session') return { body: {
    authenticated: true, user, csrfToken: 'synthetic-browser-fixture',
    nodeEnv: 'production', authEnabled: true, setupRequired: false, missing: [],
    configured: { mongodb: true, google: true, brevo: true, session: true, emailLinks: true, youtube: false },
    cookieSecure: true, appOrigin: 'https://example.invalid', emailActionTtlMin: 30,
  } };
  if (path === '/api/account/data') return { body: {
    ok: true, schemaVersion: 1, version: 0,
    state: {
      ...state, progress: {}, ranges: [], checkpoints: [], modules: [], sessions: [],
      goals: {}, xp: [], achievements: {}, segments: [], playSessions: [], queue: {}, flexGoals: [],
      prefs: { ...state.prefs, reducedMotion: !motion },
      challenge: { seed: 20261013, cohortSize: 100, windowDays: 14, dailyCapHours: 6,
        tierDist: { Ultra: 2, High: 8, Good: 20, Normal: 30, Average: 25, 'Below Average': 15 } },
      challengeEnabled: false, rankHistory: [], settings: { verifiedThreshold: 0.9 },
    },
  } };
  if (path === '/api/ready' || path === '/api/health') return { body: { ok: true, hasKey: true } };
  if (path === '/api/account/sessions') return { body: { sessions: [{
    sessionId: 'synthetic-current-session', current: true, userAgent: 'Fixture browser',
    createdAt: fixedTime, lastSeenAt: fixedTime, idleExpiresAt: '2026-11-11T12:00:00Z', expiresAt: '2026-11-17T12:00:00Z',
  }] } };
  if (path === '/api/account/delete') return { status: 503, body: { error: 'Synthetic deletion failure. Retry later.' } };
  return { status: 404, body: { error: 'No fixture response for this request.' } };
}

// Select the store mode only in the fixture build. Cloud-mode requests are
// intercepted in each isolated browser context and never leave loopback.
const fixtureMode = {
  name: 'learnquest-fixture-mode',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('/src/main.tsx')) return;
    assert.ok(code.includes('<StoreProvider>'));
    return code.replace('<StoreProvider>',
      '<StoreProvider mode={new URLSearchParams(location.search).has("cloud-fixture") ? "cloud" : "local"}>');
  },
};

const contentType = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
};

export async function startBrowserFixture(t) {
  // Compile the actual app for local IndexedDB mode. Serve only generated
  // bytes, without a dev proxy, .env files, watchers, or a backend.
  const result = await build({
    root, configFile: false, envFile: false, envDir: false,
    envPrefix: [], mode: 'test', logLevel: 'error',
    plugins: [fixtureMode, react(), tailwind()],
    build: { write: false, copyPublicDir: false, reportCompressedSize: false },
  });
  const files = new Map((Array.isArray(result) ? result : [result]).flatMap(({ output }) =>
    output.map((file) => [`/${file.fileName}`, file.type === 'asset' ? file.source : file.code])));
  assert.ok(files.has('/index.html'), 'Expected Vite to emit the app entry point');
  files.set('/theme-init.js', await readFile(new URL('../../../public/theme-init.js', import.meta.url)));
  const deploy = JSON.parse(await readFile(new URL('../../../vercel.json', import.meta.url), 'utf8'));
  const csp = deploy.headers.flatMap(({ headers }) => headers).find(({ key }) => key === 'Content-Security-Policy').value;

  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    if (path === '/__fixture__') {
      res.setHeader('Content-Type', contentType.html);
      res.end('<!doctype html><title>Synthetic fixture</title>');
      return;
    }
    const file = path === '/' ? '/index.html' : path;
    const body = files.get(file);
    if (body === undefined) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader('Content-Type', contentType[file.split('.').at(-1)] ?? 'application/octet-stream');
    if (file === '/index.html') {
      // Keep the deployed resource policy while serving the fixture over HTTP loopback.
      res.setHeader('Content-Security-Policy', csp.replace(/; upgrade-insecure-requests$/, ''));
    }
    res.end(body);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  let browser;
  t.after(async () => {
    try {
      await browser?.close();
    } finally {
      // Close the listener before draining sockets so keep-alive connections
      // cannot keep the test runner alive after the browser has finished.
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    }
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.LQ_BROWSER_EXECUTABLE || undefined,
    args: ['--no-proxy-server'],
  });

  return {
    browserVersion: browser.version(),
    async open(test, { width = 1440, height = 900, theme = 'dark', route = 'learn', touch = false,
      cloud = false, motion = false, resolvedDurations = false } = {}) {
      const context = await browser.newContext({
        viewport: { width, height }, deviceScaleFactor: 1, locale: 'en-US',
        timezoneId: 'UTC', colorScheme: theme, reducedMotion: motion ? 'no-preference' : 'reduce', serviceWorkers: 'block', hasTouch: touch,
      });
      test.after(() => context.close());
      await context.route('**/*', (request) => {
        const url = new URL(request.request().url());
        if (url.origin !== origin) return request.abort('blockedbyclient');
        if (!url.pathname.startsWith('/api/')) return request.continue();
        if (!cloud) return request.abort('blockedbyclient');
        if (url.pathname === '/api/auth/events') return request.fulfill({ status: 204 });
        const reply = cloudReply(url.pathname, motion);
        return request.fulfill({ status: reply.status ?? 200, json: reply.body });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(8_000);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        // This fixture intentionally blocks YouTube and simulates API failures.
        if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
          errors.push(message.text());
        }
      });
      test.after(() => assert.deepEqual(errors, [], 'Unexpected browser or application console errors'));
      await page.clock.install({ time: new Date(fixedTime) });
      await page.goto(`${origin}/__fixture__`, { waitUntil: 'domcontentloaded' });
      const localState = resolvedDurations ? structuredClone(state) : state;
      if (resolvedDurations) {
        const entry = localState.playlists[playlistId].entries[2];
        entry.durationSec = 219;
        delete entry.unresolvedReason;
      }
      await page.evaluate(async ({ state, theme }) => {
        localStorage.setItem('lq-theme', theme);
        await new Promise((resolve, reject) => {
          const open = indexedDB.open('learnquest-db', 2);
          open.onupgradeneeded = () => open.result.createObjectStore('kv');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction('kv', 'readwrite');
            for (const [key, value] of Object.entries(state)) tx.objectStore('kv').put(value, key);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onabort = () => { db.close(); reject(tx.error); };
          };
        });
      }, { state: localState, theme });
      await page.goto(`${origin}/${cloud ? '?cloud-fixture' : ''}#/${route}`, { waitUntil: 'domcontentloaded' });
      return page;
    },
  };
}

export async function waitForLibrary(page) {
  await page.getByRole('heading', { name: /Range explorer/ }).waitFor();
}
