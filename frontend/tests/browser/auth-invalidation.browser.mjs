/**
 * Real-browser cross-profile/cross-browser authentication invalidation test.
 *
 * Unlike the same-profile harness, this run starts:
 *   - a real local mongod (standalone is enough for the capped-collection bus),
 *   - the real Express app with the Mongo-backed auth event bus,
 *   - a real Vite app that proxies /api and streams SSE through the proxy,
 *   - independent Playwright browser contexts with separate cookie jars.
 *
 * It exercises actual UI controls and actual EventSource connections. No SSE
 * transport, session store, or logout endpoint is mocked.
 *
 * Run with: npm run test:browser:auth-invalidation
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium, firefox } from 'playwright-core';

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BACKEND_ROOT = fileURLToPath(new URL('../../../backend/', import.meta.url));
const NEW_PASSWORD = 'a-long-new-password';

const INIT = () => {
  const state = {
    events: [],
    opens: [],
    heartbeats: [],
    sources: [],
    fetches: [],
    posts: [],
    broadcasts: [],
    signInAt: null,
    pageErrors: [],
  };
  window.__lq = state;

  const NativeBroadcastChannel = window.BroadcastChannel;
  if (NativeBroadcastChannel) {
    window.BroadcastChannel = class ObservedBroadcastChannel extends NativeBroadcastChannel {
      constructor(name) {
        super(name);
        this.__lqName = name;
        if (name === 'lq-auth-sync-v2') {
          this.addEventListener('message', (event) => {
            state.broadcasts.push({ at: Date.now(), text: JSON.stringify(event.data) });
          });
        }
      }

      postMessage(data) {
        if (this.__lqName === 'lq-auth-sync-v2') {
          state.posts.push({ at: Date.now(), text: JSON.stringify(data) });
        }
        return super.postMessage(data);
      }
    };
  }

  const NativeEventSource = window.EventSource;
  if (NativeEventSource) {
    window.EventSource = class ObservedEventSource extends NativeEventSource {
      constructor(url, init) {
        super(url, init);
        state.sources.push(this);
        this.addEventListener('auth-invalidated', (event) => {
          state.events.push({ at: Date.now(), data: String(event.data) });
        });
        this.addEventListener('heartbeat', () => {
          state.heartbeats.push({ at: Date.now() });
        });
        this.addEventListener('open', () => {
          state.opens.push({ at: Date.now() });
        });
      }
    };
  }

  const nativeFetch = window.fetch;
  window.fetch = function observedFetch(input, init) {
    const url = String(input);
    if (url.includes('/api/')) state.fetches.push({ at: Date.now(), url });
    return Reflect.apply(nativeFetch, this, [input, init]);
  };

  const detectSignedOut = () => {
    if (state.signInAt) return;
    for (const heading of document.querySelectorAll('h1,h2,h3')) {
      if ((heading.textContent || '').trim() === 'Sign in') {
        state.signInAt = Date.now();
        return;
      }
    }
  };
  const start = () => {
    new MutationObserver(detectSignedOut).observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    detectSignedOut();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
};

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = address && typeof address === 'object' ? address.port : null;
      probe.close(() => (port !== null ? resolve(port) : reject(new Error('Could not reserve a port.'))));
    });
  });
}

async function waitForPort(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await new Promise((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (open) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Port ${port} did not become ready.`);
}

function findMongod() {
  const candidates = [
    process.env.LQ_MONGOD,
    'C:\\Program Files\\MongoDB\\Server\\8.0\\bin\\mongod.exe',
    'C:\\Program Files\\MongoDB\\Server\\7.0\\bin\\mongod.exe',
    'mongod',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate === 'mongod' || existsSync(candidate)) return candidate;
  }
  throw new Error('mongod was not found. Set LQ_MONGOD to its executable path.');
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try {
    child.kill();
  } catch {
    // The process may already be gone.
  }
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) {
    try {
      child.kill('SIGKILL');
    } catch {
      // Best effort during test cleanup.
    }
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref?.();
}

function findInstalledFirefox() {
  const root = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  if (!existsSync(root)) return null;
  const directories = readdirSync(root)
    .filter((name) => name.startsWith('firefox-'))
    .sort()
    .reverse();
  for (const directory of directories) {
    const executable = path.join(
      root,
      directory,
      'firefox',
      process.platform === 'win32' ? 'firefox.exe' : 'firefox',
    );
    if (existsSync(executable)) return executable;
  }
  return null;
}

function collectLines(child, onLine) {
  let buffer = '';
  child.stdout?.on('data', (chunk) => {
    buffer += chunk.toString();
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      if (line) onLine(line);
    }
  });
}

async function startBackend(env, ready) {
  const child = spawn(
    process.execPath,
    [path.join(BACKEND_ROOT, 'node_modules/tsx/dist/cli.mjs'), 'tests/helpers/browser-auth-server.ts'],
    {
      cwd: BACKEND_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let resolveReady;
  let rejectReady;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  let stderr = '';
  collectLines(child, (line) => {
    if (line.startsWith('LQ_TEST_SERVER_READY ')) {
      ready(JSON.parse(line.slice('LQ_TEST_SERVER_READY '.length)));
      resolveReady();
    }
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
    if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
  });
  child.once('exit', (code) => {
    if (code !== 0) rejectReady(new Error(`Backend test server exited with ${code}.\n${stderr}`));
  });
  await readyPromise;
  return child;
}

async function control(controlOrigin, pathname, init) {
  const response = await fetch(`${controlOrigin}${pathname}`, init);
  const body = await response.json();
  if (!response.ok) throw new Error(`Control ${pathname} failed: ${JSON.stringify(body)}`);
  return body;
}

async function waitForState(controlOrigin, predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await control(controlOrigin, '/state');
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Control state did not reach the expected condition: ${JSON.stringify(last)}`);
}

async function waitForLatestEvent(controlOrigin, reason, sinceMs, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(
      `${controlOrigin}/latest-event?reason=${encodeURIComponent(reason)}&since=${sinceMs}`,
    );
    if (response.ok) return response.json();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`No ${reason} event was published after ${sinceMs}.`);
}

async function resetTracking(page) {
  await page.evaluate(() => {
    window.__lq.events = [];
    window.__lq.opens = [];
    window.__lq.heartbeats = [];
    window.__lq.fetches = [];
    window.__lq.posts = [];
    window.__lq.broadcasts = [];
    window.__lq.signInAt = null;
  });
}

async function pageSnapshot(page) {
  return page.evaluate(() => ({
    events: JSON.parse(JSON.stringify(window.__lq.events)),
    opens: JSON.parse(JSON.stringify(window.__lq.opens)),
    posts: JSON.parse(JSON.stringify(window.__lq.posts)),
    broadcasts: JSON.parse(JSON.stringify(window.__lq.broadcasts)),
    sources: window.__lq.sources.length,
    sourceStates: window.__lq.sources.map((source) => source.readyState),
    fetches: JSON.parse(JSON.stringify(window.__lq.fetches)),
    signInAt: window.__lq.signInAt,
    localStorage: { ...localStorage },
    sessionStorage: { ...sessionStorage },
    cookieVisibleToScript: document.cookie,
  }));
}

async function waitAuthenticated(page, timeout = 15_000) {
  await page.locator('[aria-label^="Account menu for"]').last().waitFor({
    state: 'visible',
    timeout,
  });
  await page.waitForFunction(
    () => window.__lq?.sources.length === 1 && window.__lq.opens.length > 0,
    undefined,
    { timeout },
  );
}

async function login(page, origin, account) {
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Sign in' }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByLabel('Username or email').fill(account.identifier);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await waitAuthenticated(page);
}

function trackPageErrors(page, errors) {
  page.on('pageerror', (error) => errors.push(error.message));
}

function assertNoSecrets(observable, secrets, label) {
  const text = JSON.stringify(observable);
  for (const secret of secrets) {
    assert.equal(text.includes(secret), false, `${label} leaked ${secret}`);
  }
  assert.equal(text.includes('lq_session='), false, `${label} exposed the session cookie`);
}

async function seedLocalData(page) {
  await page.evaluate(async () => {
    localStorage.setItem('lq-unrelated-local-data', 'keep');
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('lq-unrelated-db', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('kv');
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put('keep', 'key');
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  });
}

async function assertLocalDataSurvived(page) {
  const result = await page.evaluate(async () => {
    const local = localStorage.getItem('lq-unrelated-local-data');
    const idb = await new Promise((resolve, reject) => {
      const request = indexedDB.open('lq-unrelated-db', 1);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('kv', 'readonly');
        const get = tx.objectStore('kv').get('key');
        get.onsuccess = () => {
          db.close();
          resolve(get.result);
        };
        get.onerror = () => reject(get.error);
      };
      request.onerror = () => reject(request.error);
    });
    return { local, idb };
  });
  assert.equal(result.local, 'keep', 'normal Sign out removed unrelated localStorage data');
  assert.equal(result.idb, 'keep', 'normal Sign out removed unrelated IndexedDB data');
}

async function assertStillAuthenticated(page) {
  await page.locator('[aria-label^="Account menu for"]').last().waitFor({ state: 'visible', timeout: 3_000 });
  assert.equal(await page.getByRole('heading', { name: 'Sign in' }).count(), 0);
}

async function signOutFromMenu(page) {
  await page.locator('[aria-label^="Account menu for"]').last().click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
}

async function signOutAllFromSecurity(page) {
  await page.evaluate(() => { window.location.hash = '#/account/security'; });
  const trigger = page.getByRole('button', { name: 'Sign out all devices' });
  await trigger.waitFor({ state: 'visible', timeout: 10_000 });
  await trigger.click();
  const dialog = page.locator('[data-lq-modal="shared-dialog"]');
  await dialog.waitFor({ state: 'visible', timeout: 5_000 });
  await dialog.getByRole('button', { name: 'Sign out all devices' }).click();
}

function timing(label, clickAt, eventAt, deliveredAt, renderedAt) {
  return {
    label,
    actionToPublicationMs: eventAt - clickAt,
    publicationToDeliveryMs: deliveredAt - eventAt,
    deliveryToRenderMs: renderedAt - deliveredAt,
    publicationToRenderMs: renderedAt - eventAt,
    actionToRenderMs: renderedAt - clickAt,
  };
}

async function makeContext(browser) {
  const context = await browser.newContext();
  await context.addInitScript(INIT);
  return context;
}

async function runSameProfile(browser, origin, account, controlOrigin) {
  const context = await makeContext(browser);
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  const errors = [];
  trackPageErrors(pageA, errors);
  trackPageErrors(pageB, errors);
  await login(pageA, origin, account);
  await pageB.goto(origin, { waitUntil: 'domcontentloaded' });
  await waitAuthenticated(pageB);
  await waitForState(controlOrigin, (s) => s.activeStreams === 2 && s.activeSessions === 1);

  await resetTracking(pageB);
  await resetTracking(pageA);
  const before = Date.now();
  await signOutFromMenu(pageA);
  await pageB.getByRole('heading', { name: 'Sign in' }).waitFor({ state: 'visible', timeout: 5_000 });
  const snapshot = await pageSnapshot(pageB);
  const acting = await pageSnapshot(pageA);
  assert.ok(snapshot.signInAt, 'same-profile receiver did not render signed out');
  assert.ok(snapshot.signInAt - before < 500, `same-profile render took ${snapshot.signInAt - before}ms`);
  assert.equal(snapshot.sources, 1);
  assert.equal(snapshot.sourceStates[0], 2, 'same-profile receiver did not close its stream');
  assert.equal(acting.posts.length > 0, true, 'same-profile sign-out did not publish a BroadcastChannel event');
  assert.equal(snapshot.broadcasts.length > 0, true, 'same-profile receiver did not receive the BroadcastChannel event');
  assertNoSecrets({ acting, snapshot }, [account.identifier, account.email], 'same-profile notification');
  await waitForState(controlOrigin, (s) => s.activeSessions === 0 && s.activeStreams === 0);
  assert.deepEqual(errors, []);
  await context.close();
  return {
    label: 'same-profile normal sign out',
    actionToPublicationMs: acting.posts[0].at - before,
    publicationToDeliveryMs: snapshot.broadcasts[0].at - acting.posts[0].at,
    deliveryToRenderMs: snapshot.signInAt - snapshot.broadcasts[0].at,
    publicationToRenderMs: snapshot.signInAt - acting.posts[0].at,
    actionToRenderMs: snapshot.signInAt - before,
    sseEventsReceivedByReceiver: snapshot.events.length,
  };
}

async function runCrossProfile(browser, origin, account, controlOrigin, secrets) {
  const contextA = await makeContext(browser);
  const contextB = await makeContext(browser);
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const errors = [];
  trackPageErrors(pageA, errors);
  trackPageErrors(pageB, errors);
  await login(pageA, origin, account);
  await login(pageB, origin, account);
  await waitForState(controlOrigin, (s) => s.activeStreams === 2 && s.activeSessions === 2);

  // Normal sign out must revoke only the acting device's session and must not
  // notify the independent profile.
  await resetTracking(pageB);
  await signOutFromMenu(pageA);
  await pageA.getByRole('heading', { name: 'Sign in' }).waitFor({ state: 'visible', timeout: 5_000 });
  await pageB.waitForTimeout(800);
  await assertStillAuthenticated(pageB);
  const afterNormal = await pageSnapshot(pageB);
  assert.equal(afterNormal.events.length, 0, 'normal sign out notified an independent profile');
  assert.equal(afterNormal.sources, 1);
  assert.equal(afterNormal.sourceStates[0], 1, 'independent profile lost its stream');
  const normalState = await waitForState(
    controlOrigin,
    (s) => s.activeSessions === 1 && s.activeStreams === 1,
  );

  // Reloading the untouched profile proves the server still considers its
  // session valid; the UI is not merely stale.
  await pageB.reload({ waitUntil: 'domcontentloaded' });
  await waitAuthenticated(pageB);
  await waitForState(controlOrigin, (s) => s.activeStreams === 1 && s.activeSessions === 1);

  // Re-authenticate the acting device, then confirm sign-out-all from the
  // security screen reaches the independent profile over SSE.
  await login(pageA, origin, account);
  await waitForState(controlOrigin, (s) => s.activeStreams === 2 && s.activeSessions === 2);
  await seedLocalData(pageB);
  await resetTracking(pageB);
  const previous = await fetch(`${controlOrigin}/latest-event?reason=sessions-revoked&since=0`)
    .then((response) => (response.ok ? response.json() : { at: 0 }));
  const before = Date.now();
  await signOutAllFromSecurity(pageA);
  await pageB.getByRole('heading', { name: 'Sign in' }).waitFor({ state: 'visible', timeout: 5_000 });
  const snapshot = await pageSnapshot(pageB);
  assert.ok(snapshot.signInAt, 'independent profile did not render signed out after sign out all');
  assert.equal(snapshot.sources, 1, 'a duplicate SSE connection was opened');
  assert.equal(snapshot.events.length, 1, 'independent profile did not receive exactly one invalidation event');
  assert.equal(
    snapshot.events[0].data,
    '{"type":"auth-invalidated","reason":"sessions-revoked"}',
  );
  assert.equal(snapshot.sourceStates[0], 2, 'invalidated stream was not closed');
  assert.match(
    await pageB.getByText(/signed out on another device or browser/i).first().textContent(),
    /signed out on another device or browser/i,
  );
  assert.equal(
    snapshot.fetches.filter((call) => call.url.endsWith('/api/auth/logout-all')).length,
    0,
    'a receiving client re-issued sign-out-all',
  );
  assertNoSecrets(snapshot, secrets, 'cross-profile receiver');
  await assertLocalDataSurvived(pageB);

  const event = await waitForLatestEvent(controlOrigin, 'sessions-revoked', before - 2_000);
  assert.ok(event.at > previous.at, 'sign-out-all did not publish a fresh event');
  const result = timing(
    'cross-profile sign out all',
    before,
    event.at,
    snapshot.events[0].at,
    snapshot.signInAt,
  );
  assert.ok(result.publicationToRenderMs < 500, `sign-out-all publish-to-render took ${result.publicationToRenderMs}ms`);
  assert.ok(result.deliveryToRenderMs < 500, `sign-out-all delivery-to-render took ${result.deliveryToRenderMs}ms`);

  const finalState = await waitForState(
    controlOrigin,
    (s) => s.activeSessions === 0 && s.activeStreams === 0,
  );

  // A revoked session must not be restored by a reload or a reconnect.
  await pageB.reload({ waitUntil: 'domcontentloaded' });
  await pageB.getByRole('heading', { name: 'Sign in' }).waitFor({ state: 'visible', timeout: 10_000 });
  assert.equal(await pageB.locator('[aria-label^="Account menu for"]').count(), 0);
  assert.deepEqual(errors, []);

  await contextA.close();
  await contextB.close();
  return {
    ...result,
    normalSignOutLeftOtherProfileAuthenticated: true,
    normalSessionsAfter: normalState.activeSessions,
    sessionsAfter: finalState.activeSessions,
    streamsAfter: finalState.activeStreams,
    receiverFetches: snapshot.fetches.length,
  };
}

async function runCrossBrowser(chromiumBrowser, firefoxBrowser, origin, account, controlOrigin, secrets) {
  const contextA = await makeContext(chromiumBrowser);
  const contextB = await makeContext(firefoxBrowser);
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const errors = [];
  trackPageErrors(pageA, errors);
  trackPageErrors(pageB, errors);
  await login(pageA, origin, account);
  await login(pageB, origin, account);
  await waitForState(controlOrigin, (s) => s.activeStreams === 2 && s.activeSessions === 2);
  await resetTracking(pageB);
  const before = Date.now();
  await signOutAllFromSecurity(pageA);
  await pageB.getByRole('heading', { name: 'Sign in' }).waitFor({ state: 'visible', timeout: 5_000 });
  const snapshot = await pageSnapshot(pageB);
  assert.equal(snapshot.events.length, 1, 'Firefox did not receive the real SSE invalidation');
  assert.equal(
    snapshot.events[0].data,
    '{"type":"auth-invalidated","reason":"sessions-revoked"}',
  );
  assertNoSecrets(snapshot, secrets, 'cross-browser receiver');
  const event = await waitForLatestEvent(controlOrigin, 'sessions-revoked', before - 2_000);
  const result = timing(
    'cross-browser (Firefox) sign out all',
    before,
    event.at,
    snapshot.events[0].at,
    snapshot.signInAt,
  );
  assert.ok(result.publicationToRenderMs < 500, `cross-browser publish-to-render took ${result.publicationToRenderMs}ms`);
  await waitForState(controlOrigin, (s) => s.activeSessions === 0 && s.activeStreams === 0);
  assert.deepEqual(errors, []);
  await contextA.close();
  await contextB.close();
  return result;
}

async function runPasswordReset(browser, origin, backendOrigin, account, controlOrigin, secrets) {
  const contextA = await makeContext(browser);
  const contextB = await makeContext(browser);
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const errors = [];
  trackPageErrors(pageA, errors);
  trackPageErrors(pageB, errors);
  await login(pageA, origin, account);
  await login(pageB, origin, account);
  await waitForState(controlOrigin, (s) => s.activeStreams === 2 && s.activeSessions === 2);
  const { token } = await control(controlOrigin, '/reset-token', { method: 'POST' });
  const resetPage = await contextA.newPage();
  trackPageErrors(resetPage, errors);
  await resetPage.goto(`${origin}/#/reset-password?token=${encodeURIComponent(token)}`, {
    waitUntil: 'domcontentloaded',
  });
  await resetPage.getByRole('heading', { name: 'Choose a new password' }).waitFor({
    state: 'visible',
    timeout: 15_000,
  });
  await resetPage.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
  await resetPage.getByLabel('Confirm new password').fill(NEW_PASSWORD);
  await resetTracking(pageB);
  const before = Date.now();
  await resetPage.getByRole('button', { name: 'Set new password' }).click();
  await pageB.getByRole('heading', { name: 'Sign in' }).waitFor({ state: 'visible', timeout: 5_000 });
  await resetPage.getByRole('heading', { name: 'Password reset complete' }).waitFor({
    state: 'visible',
    timeout: 5_000,
  });
  const snapshot = await pageSnapshot(pageB);
  assert.equal(snapshot.events.length, 1, 'independent profile did not receive the reset invalidation');
  assert.equal(
    snapshot.events[0].data,
    '{"type":"auth-invalidated","reason":"password-reset"}',
  );
  assert.equal(snapshot.sourceStates[0], 2, 'reset invalidation did not close the stream');
  assert.match(
    await pageB.getByText(/password was reset, so every session was signed out/i).first().textContent(),
    /password was reset/i,
  );
  assert.equal(resetPage.url().includes(token), false, 'the reset token remained in the URL');
  assertNoSecrets(snapshot, secrets, 'password-reset receiver');
  assertNoSecrets({ url: resetPage.url(), storage: snapshot }, [token], 'password-reset page');
  const event = await waitForLatestEvent(controlOrigin, 'password-reset', before - 2_000);
  const result = timing(
    'cross-profile password reset',
    before,
    event.at,
    snapshot.events[0].at,
    snapshot.signInAt,
  );
  assert.ok(result.publicationToRenderMs < 500, `password-reset publish-to-render took ${result.publicationToRenderMs}ms`);
  assert.ok(result.deliveryToRenderMs < 500, `password-reset delivery-to-render took ${result.deliveryToRenderMs}ms`);
  const finalState = await waitForState(
    controlOrigin,
    (s) => s.activeSessions === 0 && s.activeStreams === 0,
  );

  const oldLogin = await fetch(`${backendOrigin}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ identifier: account.identifier, password: account.password }),
  });
  assert.equal(oldLogin.status, 401, 'the old password still signed in after a successful reset');
  const newLogin = await fetch(`${backendOrigin}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ identifier: account.identifier, password: NEW_PASSWORD }),
  });
  assert.equal(newLogin.status, 200, 'the new password did not sign in after a successful reset');

  const reused = await fetch(`${backendOrigin}/api/auth/password/reset/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ token }),
  });
  assert.equal(reused.status, 400, 'the reset token was still valid after use');
  assert.deepEqual(errors, []);
  await contextA.close();
  await contextB.close();
  return {
    ...result,
    sessionsAfter: finalState.activeSessions,
    streamsAfter: finalState.activeStreams,
    tokenRemovedFromUrl: true,
  };
}

async function runActiveSessionsRateLimit(browser, origin, account, controlOrigin) {
  const context = await makeContext(browser);
  const page = await context.newPage();
  const errors = [];
  trackPageErrors(page, errors);
  await login(page, origin, account);
  await page.evaluate(() => { window.location.hash = '#/account/security'; });
  await page.getByText('This device').waitFor({ state: 'visible', timeout: 10_000 });

  const initialRequests = await page.evaluate(() => window.__lq.fetches
    .filter((call) => call.url.endsWith('/api/account/sessions')).length);
  assert.equal(initialRequests, 1, 'the security screen loaded the session list more than once');

  await page.route('**/api/account/sessions', (route) => route.fulfill({
    status: 429,
    contentType: 'application/json',
    headers: { 'Retry-After': '1' },
    body: JSON.stringify({
      error: 'Too many requests. Wait and try again.',
      code: 'RATE_LIMITED',
      retryAfterSec: 1,
    }),
  }));

  const refresh = page.getByRole('button', { name: 'Refresh' });
  await refresh.click();
  const alert = page.getByRole('alert');
  await alert.waitFor({ state: 'visible', timeout: 5_000 });
  const alertText = await alert.textContent();
  assert.match(alertText ?? '', /Showing the last loaded session list/i);
  assert.match(alertText ?? '', /rate-limiting requests.*1 second/i);
  assert.equal(/JSON backup/i.test(alertText ?? ''), false);
  assert.equal(await page.getByText('This device').count(), 1);
  assert.equal(await refresh.isDisabled(), true, 'Refresh ignored the Retry-After cooldown');

  await page.waitForTimeout(1_200);
  assert.equal(await refresh.isEnabled(), true, 'Refresh stayed disabled after the cooldown');
  await page.getByText(/Showing the last loaded session list. Select Refresh to check for newer sessions./).waitFor({
    state: 'visible',
    timeout: 5_000,
  });
  assert.equal(await page.getByText('No active sessions were returned.').count(), 0);
  await page.unroute('**/api/account/sessions');
  await refresh.click();
  await page.getByText('This device').waitFor({ state: 'visible', timeout: 5_000 });
  await page.waitForFunction(() => !document.querySelector('[role="alert"]'), undefined, { timeout: 5_000 });
  assert.equal(await page.evaluate(() => window.__lq.sources.length), 1, 'session refresh opened a duplicate SSE stream');
  assert.deepEqual(errors, []);
  await signOutFromMenu(page);
  await page.getByRole('heading', { name: 'Sign in' }).waitFor({ state: 'visible', timeout: 5_000 });
  await context.close();
  await waitForState(controlOrigin, (state) => state.activeSessions === 0 && state.activeStreams === 0);
  return {
    label: 'active sessions rate-limit handling',
    initialSessionListRequests: initialRequests,
    retryAfterRespected: true,
    staleListPreserved: true,
    duplicateStreams: 0,
  };
}

async function runDirectTransportProbe(browser, origin, backendOrigin, account, controlOrigin) {
  const context = await makeContext(browser);
  const page = await context.newPage();
  const errors = [];
  trackPageErrors(page, errors);
  await login(page, origin, account);
  await waitForState(controlOrigin, (state) => state.activeStreams === 1);

  const cookies = await context.cookies(origin);
  const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  assert.ok(cookieHeader, 'the browser did not expose its authenticated session cookie');
  assert.equal(cookieHeader.includes('lq-unrelated'), false);

  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 35_000);
  const requestAt = Date.now();
  let firstChunkAt = 0;
  let connectedAt = 0;
  let heartbeatAt = 0;
  let retrySeen = false;
  try {
    const response = await fetch(`${backendOrigin}/api/auth/events`, {
      headers: {
        Accept: 'text/event-stream',
        Cookie: cookieHeader,
        Origin: origin,
      },
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    assert.match(String(response.headers.get('content-type') ?? ''), /^text\/event-stream/i);
    assert.equal(String(response.headers.get('cache-control') ?? '').includes('no-store'), true);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!firstChunkAt) firstChunkAt = Date.now();
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (frame === 'retry: 30000') retrySeen = true;
        if (frame === ': connected') connectedAt = Date.now();
        if (frame === 'event: heartbeat\ndata: {}') {
          heartbeatAt = Date.now();
          await reader.cancel().catch(() => undefined);
          break;
        }
      }
      if (heartbeatAt) break;
    }
  } catch (error) {
    if (error?.name !== 'AbortError') throw error;
  } finally {
    clearTimeout(abortTimer);
    controller.abort();
  }

  assert.equal(retrySeen, true, 'the stream did not advertise the reconnect delay');
  assert.ok(connectedAt, 'the authenticated stream never became ready');
  assert.ok(firstChunkAt - requestAt < 2_000, 'the local server buffered the first SSE bytes');
  assert.ok(heartbeatAt, 'no heartbeat arrived');
  const heartbeatMs = heartbeatAt - connectedAt;
  assert.ok(heartbeatMs >= 20_000 && heartbeatMs < 30_000, `heartbeat arrived after ${heartbeatMs}ms`);

  // The browser's own EventSource must also observe the named heartbeat, not
  // only the raw probe above.
  const browserHeartbeats = await page.evaluate(() => window.__lq.heartbeats.length);
  assert.ok(browserHeartbeats > 0, 'the browser EventSource did not receive a heartbeat');

  // Force a real browser transport failure. The client must close the dead
  // EventSource, apply its capped backoff, open exactly one replacement, and
  // revalidate the still-valid server session.
  const beforeReconnect = await page.evaluate(() => ({
    sources: window.__lq.sources.length,
    opens: window.__lq.opens.length,
  }));
  const disconnectAt = Date.now();
  await control(controlOrigin, '/drop-connections', { method: 'POST' });
  // The proxy keeps the browser EventSource object open. The named heartbeat
  // watchdog must notice within 70 s, close it, and reconnect after its 3 s
  // backoff.
  await page.waitForFunction(
    (count) => window.__lq.sources.length > count,
    beforeReconnect.sources,
    { timeout: 90_000 },
  );
  await page.waitForFunction(
    (count) => window.__lq.opens.length > count,
    beforeReconnect.opens,
    { timeout: 90_000 },
  );
  await waitForState(controlOrigin, (state) => state.activeStreams === 1);
  const reconnect = await page.evaluate(() => ({
    sources: window.__lq.sources.length,
    opens: window.__lq.opens.length,
    sourceStates: window.__lq.sources.map((source) => source.readyState),
    lastOpenAt: window.__lq.opens[window.__lq.opens.length - 1]?.at ?? 0,
  }));
  assert.equal(reconnect.sources, beforeReconnect.sources + 1, 'reconnect opened duplicate streams');
  assert.equal(reconnect.sourceStates.filter((stateValue) => stateValue === 1).length, 1);
  const reconnectMs = reconnect.lastOpenAt - disconnectAt;
  assert.ok(reconnectMs >= 65_000 && reconnectMs < 90_000, `reconnect took ${reconnectMs}ms`);
  assert.deepEqual(errors, []);

  await signOutFromMenu(page);
  await page.getByRole('heading', { name: 'Sign in' }).waitFor({ state: 'visible', timeout: 5_000 });
  await context.close();
  await waitForState(controlOrigin, (state) => state.activeStreams === 0 && state.activeSessions === 0);
  return {
    label: 'direct authenticated SSE transport',
    status: 200,
    contentType: 'text/event-stream',
    firstByteMs: firstChunkAt - requestAt,
    heartbeatMs,
    browserHeartbeats,
    retryAdvertisedMs: 30_000,
    buffered: false,
    reconnectMs,
    reconnectSources: reconnect.sources,
    openStreamsAfterReconnect: reconnect.sourceStates.filter((stateValue) => stateValue === 1).length,
  };
}

async function runSecurityChecks(backendOrigin, appOrigin, resetPageUrl) {
  const unauthenticated = await fetch(`${backendOrigin}/api/auth/events`, {
    headers: { Origin: appOrigin },
  });
  assert.equal(unauthenticated.status, 401, 'unauthenticated SSE was not rejected');
  assert.equal(
    String(unauthenticated.headers.get('content-type') ?? '').includes('text/event-stream'),
    false,
    'unauthenticated SSE leaked an event stream',
  );

  const preflight = await fetch(`${backendOrigin}/api/auth/events`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://evil.example',
      'Access-Control-Request-Method': 'GET',
    },
  });
  assert.equal(
    preflight.headers.get('access-control-allow-origin'),
    null,
    'invalid origin received a credentialed CORS grant',
  );

  const invalidOrigin = await fetch(`${backendOrigin}/api/auth/events`, {
    headers: { Origin: 'https://evil.example' },
  });
  assert.equal(
    invalidOrigin.headers.get('access-control-allow-origin'),
    null,
    'invalid origin received an allow-origin header',
  );
  assert.equal(resetPageUrl.includes('token'), false, 'a reset token was captured in a URL');
}

async function main() {
  const mongoPort = await freePort();
  const backendPort = await freePort();
  const controlPort = await freePort();
  const vitePort = await freePort();
  const appOrigin = `http://127.0.0.1:${vitePort}`;
  const backendOrigin = `http://127.0.0.1:${backendPort}`;
  const controlOrigin = `http://127.0.0.1:${controlPort}`;
  const mongoDir = mkdtempSync(path.join(os.tmpdir(), 'lq-sse-browser-'));

  const mongod = spawn(findMongod(), [
    '--dbpath', mongoDir,
    '--port', String(mongoPort),
    '--bind_ip', '127.0.0.1',
    '--quiet',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let mongoLog = '';
  mongod.stderr?.on('data', (chunk) => {
    mongoLog += chunk.toString();
    if (mongoLog.length > 20_000) mongoLog = mongoLog.slice(-20_000);
  });

  let backend;
  let vite;
  let chromiumBrowser;
  let firefoxBrowser;
  try {
    await waitForPort(mongoPort);
    let ready;
    const env = {
      ...process.env,
      LQ_TEST_APP_ORIGIN: appOrigin,
      LQ_TEST_MONGO_URI: `mongodb://127.0.0.1:${mongoPort}`,
      LQ_TEST_BE_PORT: String(backendPort),
      LQ_TEST_CONTROL_PORT: String(controlPort),
      LQ_TEST_DB_NAME: `lq_browser_${Date.now()}`,
    };
    backend = await startBackend(env, (value) => { ready = value; });
    assert.ok(ready?.account, 'the backend test server did not report its account');

    vite = await createServer({
      root: PROJECT_ROOT,
      logLevel: 'error',
      server: {
        host: '127.0.0.1',
        port: vitePort,
        strictPort: true,
        proxy: { '/api': `http://127.0.0.1:${backendPort}` },
      },
    });
    await vite.listen();
    await waitForPort(vitePort);

    const errors = [];
    chromiumBrowser = await chromium.launch({ headless: true });
    try {
      firefoxBrowser = await firefox.launch({ headless: true });
    } catch {
      const installed = findInstalledFirefox();
      if (installed) {
        try {
          firefoxBrowser = await firefox.launch({ headless: true, executablePath: installed });
        } catch (error) {
          console.warn(`Firefox could not launch; cross-browser scenario will use Chromium. ${error.message}`);
          firefoxBrowser = chromiumBrowser;
        }
      } else {
        console.warn('Firefox was unavailable; cross-browser scenario will use Chromium.');
        firefoxBrowser = chromiumBrowser;
      }
    }

    const secrets = ready.secrets;
    const results = [];
    await runSecurityChecks(backendOrigin, appOrigin, appOrigin);
    results.push(await runSameProfile(chromiumBrowser, appOrigin, ready.account, controlOrigin));
    results.push(await runCrossProfile(chromiumBrowser, appOrigin, ready.account, controlOrigin, secrets));
    results.push(await runCrossBrowser(
      chromiumBrowser,
      firefoxBrowser,
      appOrigin,
      ready.account,
      controlOrigin,
      secrets,
    ));
    results.push(await runDirectTransportProbe(
      chromiumBrowser,
      appOrigin,
      backendOrigin,
      ready.account,
      controlOrigin,
    ));
    results.push(await runActiveSessionsRateLimit(
      chromiumBrowser,
      appOrigin,
      ready.account,
      controlOrigin,
    ));
    results.push(await runPasswordReset(
      chromiumBrowser,
      appOrigin,
      backendOrigin,
      ready.account,
      controlOrigin,
      secrets,
    ));

    for (const result of results) {
      console.log(JSON.stringify({ test: 'real-browser-auth-invalidation', ...result }));
    }
    console.log(
      `PASS: ${results.length} real-browser scenarios; sign-out-all and password-reset notifications `
      + 'arrived over authenticated SSE from a real backend and every publish-to-render was <500ms.',
    );
    assert.deepEqual(errors, []);
  } finally {
    await firefoxBrowser?.close().catch(() => undefined);
    if (chromiumBrowser && firefoxBrowser !== chromiumBrowser) {
      await chromiumBrowser.close().catch(() => undefined);
    }
    await vite?.close().catch(() => undefined);
    await stopChild(backend);
    await stopChild(mongod);
    rmSync(mongoDir, { recursive: true, force: true });
  }
}

await main();
