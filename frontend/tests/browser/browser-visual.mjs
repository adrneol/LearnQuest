// Real-browser visual verification for LearnQuest (local/test mode).
// Captures before/after screenshots across viewports and themes.
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = 'http://localhost:5200';
const OUT = join(process.cwd(), 'test-results', 'screenshots');
await mkdir(OUT, { recursive: true });

const routes = ['#/dash', '#/learn', '#/player', '#/goals', '#/checks', '#/focus', '#/analytics',
  '#/efficiency', '#/history', '#/revise', '#/modules', '#/competition', '#/reports', '#/settings', '#/account/profile'];

const viewports = [
  { name: '360x800', width: 360, height: 800 },
  { name: '390x844', width: 390, height: 844 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1728x864', width: 1728, height: 864 },
];

const browser = await chromium.launch({ headless: true });
const results = [];
for (const vp of viewports) {
  for (const theme of ['dark', 'light']) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    await page.addInitScript((t) => { try { localStorage.setItem('lq-theme', t); } catch {} }, theme);
    await page.goto(`${BASE}/${'#'}/dash`, { waitUntil: 'networkidle' });
    // Seed a synthetic playlist via the app's state? Not available headless-ready;
    // capture empty/onboarding flows and interactive surfaces instead.
    for (const route of routes) {
      await page.goto(`${BASE}/${route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(450);
      const name = `${vp.name}-${theme}${route.replace(/[^a-z/]/g, '').replace(/\//g, '_')}.png`;
      await page.screenshot({ path: join(OUT, name), fullPage: true });
      results.push(name);
    }
    await page.close();
  }
}
await browser.close();
const manifest = join(OUT, 'manifest.txt');
await writeFile(manifest, results.join('\n'));
console.log(`captured ${results.length} screenshots in ${OUT}`);
