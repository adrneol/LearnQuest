// Seed synthetic data through the app's own restore path, then screenshot all routes.
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = 'http://localhost:5200';
const OUT = join(process.cwd(), 'test-results', 'screenshots');
await mkdir(OUT, { recursive: true });
const backup = join(process.cwd(), 'test-results', 'demo-backup.json');
const routes = ['#/dash', '#/learn', '#/player', '#/goals', '#/checks', '#/focus', '#/analytics',
  '#/efficiency', '#/history', '#/revise', '#/modules', '#/competition', '#/reports', '#/settings', '#/account/profile', '#/account/security'];
const viewports = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '390x844', width: 390, height: 844 },
];

const browser = await chromium.launch({ headless: true });
for (const vp of viewports) {
  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    await ctx.addInitScript((t) => { try { localStorage.setItem('lq-theme', t); } catch {} }, theme);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#/reports`, { waitUntil: 'domcontentloaded' });
    await page.setInputFiles('input[type="file"][accept="application/json"]', backup);
    await page.waitForSelector('text=Replace all local learning data?', { timeout: 8000 }).catch(() => null);
    const restoreBtn = page.getByRole('button', { name: 'Restore' });
    if (await restoreBtn.count()) await restoreBtn.click();
    await page.waitForTimeout(1200);
    for (const route of routes) {
      await page.goto(`${BASE}/${route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      const name = `${vp.name}-${theme}${route.replace(/[^a-z/]/g, '').replace(/\//g, '_')}.png`;
      await page.screenshot({ path: join(OUT, name), fullPage: false, timeout: 60_000 });
    }
    await ctx.close();
  }
}
await browser.close();
console.log('done');
