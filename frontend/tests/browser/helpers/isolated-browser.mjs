import assert from 'node:assert/strict';
import { createServer } from 'node:http';
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
    plugins: [react(), tailwind()],
    build: { write: false, copyPublicDir: false, reportCompressedSize: false },
  });
  const files = new Map((Array.isArray(result) ? result : [result]).flatMap(({ output }) =>
    output.map((file) => [`/${file.fileName}`, file.type === 'asset' ? file.source : file.code])));
  assert.ok(files.has('/index.html'), 'Expected Vite to emit the app entry point');

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
    async open(test, { width = 1440, height = 900, theme = 'dark', route = 'learn' } = {}) {
      const context = await browser.newContext({
        viewport: { width, height }, deviceScaleFactor: 1, locale: 'en-US',
        timezoneId: 'UTC', colorScheme: theme, reducedMotion: 'reduce', serviceWorkers: 'block',
      });
      test.after(() => context.close());
      await context.route('**/*', (request) => {
        const url = new URL(request.request().url());
        return url.origin === origin && !url.pathname.startsWith('/api/')
          ? request.continue() : request.abort('blockedbyclient');
      });
      const page = await context.newPage();
      page.setDefaultTimeout(8_000);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      test.after(() => assert.deepEqual(errors, [], 'Unexpected uncaught browser errors'));
      await page.clock.install({ time: new Date(fixedTime) });
      await page.goto(`${origin}/__fixture__`, { waitUntil: 'domcontentloaded' });
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
      }, { state, theme });
      await page.goto(`${origin}/#/${route}`, { waitUntil: 'domcontentloaded' });
      return page;
    },
  };
}

export async function waitForLibrary(page) {
  await page.getByRole('heading', { name: /Range explorer/ }).waitFor();
}
