import { chromium } from 'playwright-core';
import { join } from 'node:path';

const BASE = 'http://localhost:5200';
const backup = join(process.cwd(), 'test-results', 'demo-backup.json');
const browser = await chromium.launch({ headless: true });
const out = join(process.cwd(), 'test-results', 'screenshots');
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('lq-theme', 'dark'); } catch {} });
const page = await ctx.newPage();
page.on('pageerror', (err) => console.log('pageerror', err.message));
page.on('console', (msg) => { if (msg.type() === 'error') console.log('console ERR', msg.text()); });
await page.goto(`${BASE}/#/reports`, { waitUntil: 'domcontentloaded' });
await page.setInputFiles('input[type="file"][accept="application/json"]', backup);
await page.waitForTimeout(800);
const btn = page.getByRole('button', { name: 'Restore' });
if (await btn.count()) await btn.click();
await page.waitForTimeout(1500);
for (const route of ['#/learn', '#/analytics']) {
  await page.goto(`${BASE}/${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=Full playlist', { timeout: 10_000 }).catch(() => console.log(route, 'timed out waiting for content'));
  await page.waitForTimeout(500);
  const name = route.endsWith('learn') ? 'check-learn.png' : 'check-analytics.png';
  await page.screenshot({ path: join(out, name), fullPage: false });
  const found = await page.evaluate(() => document.body.innerText.slice(0, 200));
  console.log(route, '=>', JSON.stringify(found.slice(0, 180)));
}
await browser.close();
