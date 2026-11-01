/**
 * Real-browser cross-tab authentication check. This is deliberately outside
 * the Vitest include pattern: it starts a Vite server and two real pages in one
 * browser context so BroadcastChannel and storage-event delivery are exercised
 * by the browser rather than simulated in jsdom.
 *
 * Run with: npm run test:browser
 * It is test-only and is not imported by the application bundle.
 */
import assert from 'node:assert/strict';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const USER = {
  userId: 'user-two-tabs',
  email: 'tabs@example.test',
  username: 'tabs_learner',
  displayName: 'Tabs Learner',
  onboardingComplete: true,
  timezone: 'UTC',
  sessionLenMin: 25,
  breakMin: 5,
  minViableMin: 10,
  createdAt: '2026-10-01T00:00:00.000Z',
  hasPassword: true,
  googleLinked: true,
};
const CONFIG = {
  nodeEnv: 'production',
  authEnabled: true,
  setupRequired: false,
  configured: {
    mongodb: true,
    google: true,
    brevo: true,
    session: true,
    emailLinks: true,
    youtube: false,
  },
  missing: [],
  cookieSecure: true,
  appOrigin: 'https://learn-quest-one.vercel.app',
  emailActionTtlMin: 30,
};
const EMPTY_STATE = {
  playlists: {}, meta: {}, activeId: null, progress: {}, ranges: [], checkpoints: [],
  modules: [], sessions: [], goals: {}, xp: [], achievements: {}, segments: [],
  playSessions: [], queue: {}, flexGoals: [],
  challenge: {
    seed: 20261013,
    cohortSize: 100,
    tierDist: { Ultra: 2, High: 8, Good: 20, Normal: 30, Average: 25, 'Below Average': 15 },
    windowDays: 14,
    dailyCapHours: 6,
  },
  challengeEnabled: false,
  rankHistory: [],
  settings: { verifiedThreshold: 0.9 },
  prefs: { timezone: 'UTC', sessionLenMin: 25, breakMin: 5, reducedMotion: false, minViableMin: 10 },
};
const RESET_TOKEN = 'opaque-reset-token-abcdefghijklmnopqrstuvwxyz';
const SECRETS = [
  USER.email, USER.userId, USER.username, USER.displayName, 'csrf-session', RESET_TOKEN,
  'a-long-new-password',
];

const INIT = () => {
  window.__lq = {
    clicks: [], fetches: [], posts: [], received: [], storageWrites: [], storage: [],
    signInAt: null, localStorage: {}, sessionStorage: {}, errors: [],
  };
  const recordStorage = () => {
    window.__lq.localStorage = Object.fromEntries(Object.entries(localStorage));
    window.__lq.sessionStorage = Object.fromEntries(Object.entries(sessionStorage));
  };
  recordStorage();

  const nativeSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function patchedSetItem(key, value) {
    try {
      if (String(key).startsWith('lq-auth-sync')) {
        window.__lq.storageWrites.push({ key: String(key), at: Date.now(), text: String(value) });
      }
    } catch { /* observation only */ }
    return nativeSetItem.call(this, key, value);
  };

  const nativeFetch = window.fetch;
  window.fetch = async function wrappedFetch(input, init) {
    const url = String(input);
    const record = url.includes('/api/') ? { url, at: Date.now() } : null;
    if (record) window.__lq.fetches.push(record);
    try {
      const response = await Reflect.apply(nativeFetch, this, [input, init]);
      if (record) {
        record.end = Date.now();
        record.status = response.status;
      }
      return response;
    } catch (error) {
      if (record) {
        record.end = Date.now();
        record.error = String(error);
      }
      throw error;
    }
  };

  document.addEventListener('click', (event) => {
    const button = event.target && event.target.closest ? event.target.closest('button') : null;
    if (button) {
      window.__lq.clicks.push({
        at: Date.now(),
        label: button.getAttribute('aria-label'),
        text: (button.textContent || '').trim().slice(0, 80),
      });
    }
  }, true);

  const Native = window.BroadcastChannel;
  if (Native) {
    window.BroadcastChannel = class extends Native {
      constructor(name) {
        super(name);
        this.__lqName = name;
      }
      postMessage(message) {
        try {
          if (this.__lqName === 'lq-auth-sync-v2') {
            window.__lq.posts.push({ at: Date.now(), text: JSON.stringify(message) });
          }
        } catch { /* observation only */ }
        return super.postMessage(message);
      }
    };
    try {
      const observer = new Native('lq-auth-sync-v2');
      observer.onmessage = (event) => {
        try {
          window.__lq.received.push({ at: Date.now(), text: JSON.stringify(event.data) });
        } catch { /* observation only */ }
      };
      window.__lqObserver = observer;
    } catch { /* observation only */ }
  }
  window.addEventListener('storage', (event) => {
    if (event.key && event.key.startsWith('lq-auth-sync')) {
      window.__lq.storage.push({ key: event.key, at: Date.now(), text: event.newValue || '' });
    }
  });

  const detectSignedOut = () => {
    if (window.__lq.signInAt) return;
    for (const heading of document.querySelectorAll('h1,h2,h3')) {
      if ((heading.textContent || '').trim() === 'Sign in') {
        window.__lq.signInAt = Date.now();
        return;
      }
    }
  };
  const start = () => {
    new MutationObserver(() => {
      detectSignedOut();
      recordStorage();
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    detectSignedOut();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
};

function fulfillJson(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: body === null ? '' : JSON.stringify(body),
  });
}

function createApi(options = {}) {
  const calls = [];
  let releaseLogout = null;
  const route = async (requestRoute) => {
    const url = new URL(requestRoute.request().url());
    const path = url.pathname;
    const method = requestRoute.request().method();
    calls.push({ method, path });
    if (path === '/api/auth/logout' || path === '/api/auth/logout-all') {
      if (options.holdLogout) {
        await new Promise((resolve) => { releaseLogout = resolve; });
      }
      if (options.logoutStatus && options.logoutStatus >= 400) {
        return fulfillJson(requestRoute, { error: 'The server could not revoke this session.' }, options.logoutStatus);
      }
      return fulfillJson(requestRoute, null, 204);
    }
    if (path === '/api/health') return fulfillJson(requestRoute, { ok: true, hasKey: false });
    if (path === '/api/auth/session') {
      return fulfillJson(requestRoute, { authenticated: true, user: USER, csrfToken: 'csrf-session', ...CONFIG });
    }
    if (path === '/api/auth/config') return fulfillJson(requestRoute, CONFIG);
    if (path === '/api/account/data') {
      return fulfillJson(requestRoute, { ok: true, state: EMPTY_STATE, version: 0, userId: USER.userId });
    }
    if (path === '/api/account/sessions') return fulfillJson(requestRoute, { sessions: [] });
    if (path === '/api/auth/password/reset/validate') return fulfillJson(requestRoute, { ok: true, valid: true });
    if (path === '/api/auth/password/reset') return fulfillJson(requestRoute, null, 204);
    return fulfillJson(requestRoute, { error: `unmocked ${path}` }, 404);
  };
  return {
    calls,
    route,
    releaseLogout: () => releaseLogout?.(),
  };
}

async function createContext(browser, options = {}) {
  const context = await browser.newContext();
  if (options.disableBroadcastChannel) {
    await context.addInitScript(() => {
      Object.defineProperty(window, 'BroadcastChannel', { configurable: true, value: undefined });
    });
  }
  await context.addInitScript(() => {
    // This harness covers same-profile BroadcastChannel/storage behaviour only.
    // The authenticated cross-profile SSE path is exercised end-to-end by
    // auth-invalidation.browser.mjs against a real backend and real streams.
    Object.defineProperty(window, 'EventSource', { configurable: true, value: undefined });
  });
  await context.addInitScript(INIT);
  const api = createApi(options);
  await context.route(/^https?:\/\/[^/]+\/api(?:\/|$)/, api.route);
  return { context, api };
}

async function snapshot(page) {
  return page.evaluate(() => JSON.parse(JSON.stringify(window.__lq)));
}

async function reset(page) {
  await page.evaluate(() => {
    window.__lq.clicks = [];
    window.__lq.posts = [];
    window.__lq.received = [];
    window.__lq.storageWrites = [];
    window.__lq.storage = [];
    window.__lq.signInAt = null;
    window.__lq.fetches = [];
    window.__lq.errors = [];
    window.__lq.localStorage = Object.fromEntries(Object.entries(localStorage));
    window.__lq.sessionStorage = Object.fromEntries(Object.entries(sessionStorage));
  });
}

async function waitAuthenticated(page) {
  await page.locator('[aria-label^="Account menu for"]').last().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(250);
}

function assertNoSecrets(pageData, label) {
  const observable = JSON.stringify({
    posts: pageData.posts,
    received: pageData.received,
    storageWrites: pageData.storageWrites,
    storage: pageData.storage,
    localStorage: pageData.localStorage,
    sessionStorage: pageData.sessionStorage,
  });
  for (const secret of SECRETS) {
    assert.equal(observable.includes(secret), false, `${label}: cross-tab state leaked ${secret}`);
  }
}

function measure(label, acting, receiving, before) {
  const clicks = acting.clicks.filter((click) => click.at >= before);
  assert.ok(clicks.length > 0, `${label}: no browser click was recorded`);
  const click = clicks[clicks.length - 1];
  const publications = acting.posts.length
    ? acting.posts
    : acting.storageWrites;
  const publication = publications[0];
  const deliveries = acting.posts.length ? receiving.received : receiving.storage;
  const delivery = deliveries[0];
  assert.ok(publication, `${label}: no cross-tab notification was published`);
  assert.ok(delivery, `${label}: the other page did not receive the notification`);
  assert.ok(receiving.signInAt, `${label}: the other page never rendered the signed-out state`);

  const result = {
    label,
    actionToPublicationMs: publication.at - click.at,
    publicationToReceiveMs: delivery.at - publication.at,
    receiveToRenderMs: receiving.signInAt - delivery.at,
    publicationToRenderMs: receiving.signInAt - publication.at,
    actionToRenderMs: receiving.signInAt - click.at,
    channel: acting.posts.length ? 'BroadcastChannel' : 'storage',
  };
  assert.ok(
    result.publicationToRenderMs < 500,
    `${label}: notification-to-render took ${result.publicationToRenderMs}ms (limit 500ms)`,
  );
  assert.ok(
    result.actionToRenderMs < 500,
    `${label}: action-to-render took ${result.actionToRenderMs}ms (limit 500ms)`,
  );
  return result;
}

function watchPageErrors(page) {
  page.on('pageerror', (error) => {
    void page.evaluate((text) => {
      if (window.__lq) window.__lq.errors.push(text);
    }, error.message).catch(() => undefined);
  });
}

async function openPages(context, origin) {
  const acting = await context.newPage();
  const receiving = await context.newPage();
  watchPageErrors(acting);
  watchPageErrors(receiving);
  await acting.goto(origin);
  await receiving.goto(origin);
  await waitAuthenticated(acting);
  await waitAuthenticated(receiving);
  return { acting, receiving };
}

async function runScenario(label, browser, origin, options, action) {
  const { context, api } = await createContext(browser, options);
  try {
    const { acting, receiving } = await openPages(context, origin);
    await reset(acting);
    await reset(receiving);
    await acting.bringToFront();
    const before = Date.now();
    const extra = await action({ acting, receiving, api, before });
    const [actingData, receivingData] = await Promise.all([snapshot(acting), snapshot(receiving)]);
    const result = measure(label, actingData, receivingData, before);
    assertNoSecrets(actingData, `${label} acting page`);
    assertNoSecrets(receivingData, `${label} receiving page`);
    assert.equal(actingData.errors.length, 0, `${label}: acting page errors: ${actingData.errors.join('; ')}`);
    assert.equal(receivingData.errors.length, 0, `${label}: receiving page errors: ${receivingData.errors.join('; ')}`);
    return { ...result, ...extra, calls: api.calls };
  } finally {
    api.releaseLogout();
    await context.close();
  }
}

async function normalSignOut(browser, origin, options = {}) {
  return runScenario('normal sign out', browser, origin, options, async ({ acting, receiving }) => {
    await receiving.evaluate(() => localStorage.setItem('lq-unrelated-local-data', 'keep'));
    await acting.locator('[aria-label^="Account menu for"]').last().click();
    await acting.getByRole('menuitem', { name: 'Sign out' }).click();
    await receiving.getByRole('heading', { name: 'Sign in' }).waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await receiving.locator('[aria-label^="Account menu for"]').count(), 0);
    assert.equal(
      await receiving.evaluate(() => localStorage.getItem('lq-unrelated-local-data')),
      'keep',
      'sign-out removed unrelated local data',
    );
    return {};
  });
}

async function signOutAll(browser, origin) {
  return runScenario('sign out all', browser, origin, {}, async ({ acting, receiving, api }) => {
    await acting.evaluate(() => { window.location.hash = '#/account/security'; });
    await acting.getByRole('button', { name: 'Sign out all devices' }).waitFor({ state: 'visible', timeout: 5000 });
    await acting.getByRole('button', { name: 'Sign out all devices' }).click();
    const dialog = acting.locator('[data-lq-modal="shared-dialog"]');
    await dialog.waitFor({ state: 'visible', timeout: 5000 });
    await dialog.getByRole('button', { name: 'Sign out all devices' }).click();
    await receiving.getByRole('heading', { name: 'Sign in' }).waitFor({ state: 'visible', timeout: 5000 });
    const logoutAll = api.calls.filter((call) => call.path === '/api/auth/logout-all');
    const logout = api.calls.filter((call) => call.path === '/api/auth/logout');
    assert.equal(logoutAll.length, 1, 'sign out all must call /auth/logout-all once');
    assert.equal(logout.length, 0, 'sign out all must not call /auth/logout');
    return {};
  });
}

async function passwordReset(browser, origin) {
  const { context, api } = await createContext(browser);
  try {
    const receiving = await context.newPage();
    watchPageErrors(receiving);
    await receiving.goto(origin);
    await waitAuthenticated(receiving);
    const resetPage = await context.newPage();
    watchPageErrors(resetPage);
    await resetPage.goto(`${origin}/#/reset-password?token=${RESET_TOKEN}`);
    await resetPage.getByRole('heading', { name: 'Choose a new password' }).waitFor({ state: 'visible', timeout: 10000 });
    await reset(receiving);
    await reset(resetPage);
    await resetPage.bringToFront();
    await resetPage.getByLabel('New password', { exact: true }).fill('a-long-new-password');
    await resetPage.getByLabel('Confirm new password').fill('a-long-new-password');
    const before = Date.now();
    await resetPage.getByRole('button', { name: 'Set new password' }).click();
    await receiving.getByRole('heading', { name: 'Sign in' }).waitFor({ state: 'visible', timeout: 5000 });
    await resetPage.getByRole('heading', { name: 'Password reset complete' }).waitFor({ state: 'visible', timeout: 5000 });
    const [resetData, receivingData] = await Promise.all([snapshot(resetPage), snapshot(receiving)]);
    const result = measure('password reset', resetData, receivingData, before);
    assertNoSecrets(resetData, 'password reset page');
    assertNoSecrets(receivingData, 'password reset receiving page');
    assert.equal(resetData.errors.length, 0, `password reset page errors: ${resetData.errors.join('; ')}`);
    assert.equal(receivingData.errors.length, 0, `password reset receiving page errors: ${receivingData.errors.join('; ')}`);
    assert.equal(resetPage.url().includes(RESET_TOKEN), false, 'the reset token remained in the URL');
    return { ...result, calls: api.calls };
  } finally {
    await context.close();
  }
}

async function failedSignOut(browser, origin) {
  return runScenario('failed server sign out', browser, origin, { logoutStatus: 503 }, async ({ acting, receiving }) => {
    await acting.locator('[aria-label^="Account menu for"]').last().click();
    await acting.getByRole('menuitem', { name: 'Sign out' }).click();
    await receiving.getByRole('heading', { name: 'Sign in' }).waitFor({ state: 'visible', timeout: 5000 });
    await receiving.getByText(/could not confirm sign-out/i).first().waitFor({ state: 'visible', timeout: 5000 });
    await acting.getByText(/could not confirm sign-out/i).first().waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await receiving.getByText('Password reset complete').count(), 0);
    return {};
  });
}

async function slowServerSignOut(browser, origin) {
  return runScenario('slow server sign out', browser, origin, { holdLogout: true }, async ({ acting, receiving, api }) => {
    await acting.locator('[aria-label^="Account menu for"]').last().click();
    await acting.getByRole('menuitem', { name: 'Sign out' }).click();
    await receiving.getByRole('heading', { name: 'Sign in' }).waitFor({ state: 'visible', timeout: 5000 });
    const actingData = await snapshot(acting);
    const logoutCall = actingData.fetches.find((call) => call.url.endsWith('/api/auth/logout'));
    assert.ok(logoutCall, 'the sign-out request did not start');
    assert.equal(logoutCall.end, undefined, 'the signed-out UI waited for the server response');
    api.releaseLogout();
    return {};
  });
}

async function storageFallback(browser, origin) {
  return runScenario('storage fallback sign out', browser, origin, { disableBroadcastChannel: true }, async ({ acting, receiving }) => {
    await acting.locator('[aria-label^="Account menu for"]').last().click();
    await acting.getByRole('menuitem', { name: 'Sign out' }).click();
    await receiving.getByRole('heading', { name: 'Sign in' }).waitFor({ state: 'visible', timeout: 5000 });
    return {};
  });
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = address && typeof address === 'object' ? address.port : null;
      probe.close(() => (port ? resolve(port) : reject(new Error('Could not reserve a local port'))));
    });
  });
}

async function main() {
  const server = await createServer({
    root: PROJECT_ROOT,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: await freePort(), strictPort: true },
  });
  await server.listen();
  const address = server.httpServer?.address();
  assert.ok(address && typeof address === 'object', 'Vite server did not expose a TCP address');
  const origin = `http://127.0.0.1:${address.port}`;

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    try {
      browser = await chromium.launch({ headless: true, channel: 'chrome' });
    } catch {
      throw new Error('No Chromium or Google Chrome executable was found for the real-browser test.');
    }
  }

  const results = [];
  try {
    results.push(await normalSignOut(browser, origin));
    results.push(await signOutAll(browser, origin));
    results.push(await passwordReset(browser, origin));
    results.push(await failedSignOut(browser, origin));
    results.push(await slowServerSignOut(browser, origin));
    results.push(await storageFallback(browser, origin));
  } finally {
    await browser.close();
    await server.close();
  }

  for (const result of results) {
    console.log(
      `${result.label}: publish ${result.actionToPublicationMs}ms, deliver ${result.publicationToReceiveMs}ms, `
      + `render ${result.receiveToRenderMs}ms, publish-to-render ${result.publicationToRenderMs}ms `
      + `(${result.channel})`,
    );
  }
  console.log(`PASS: ${results.length} real-browser cross-tab scenarios; every notification-to-render was <500ms.`);
}

await main();
