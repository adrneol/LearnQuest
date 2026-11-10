import { chromium } from 'playwright-core';
import { join } from 'node:path';

const BASE = 'http://localhost:5200';
const backup = join(process.cwd(), 'test-results', 'demo-backup-1000.json');
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('lq-theme', 'dark'); } catch {} });
const page = await ctx.newPage();
page.on('console', (msg) => { if (['error'].includes(msg.type())) console.log('console ERR', msg.text()); });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${BASE}/#/reports`, { waitUntil: 'domcontentloaded' });
await page.setInputFiles('input[type="file"][accept="application/json"]', backup);
await page.waitForTimeout(900);
const btn = page.getByRole('button', { name: 'Restore' });
if (await btn.count()) await btn.click();
await page.waitForTimeout(1800);
const checks = [
  { route: '#/analytics', terms: ['Completed vs remaining', 'Duration distribution', 'Session lengths'] },
  { route: '#/learn', terms: ['Full playlist (1–1000)', 'Distribution & composition'] },
];
for (const { route, terms } of checks) {
  await page.goto(`${BASE}/${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  const state = await page.evaluate(() => ({
    text: document.body.innerText,
    w: document.documentElement.scrollWidth,
    win: window.innerWidth,
  }));
  const ok = terms.every((t) => state.text.includes(t)) && state.w <= state.win + 1;
  console.log(route, ok ? 'OK' : 'ISSUE', 'scrollW=', state.w, 'winW=', state.win);
}
await browser.close();
console.log('done');
