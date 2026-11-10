import { chromium } from 'playwright-core';
import { join } from 'node:path';

const BASE = 'http://localhost:5200';
const backup = join(process.cwd(), 'test-results', 'demo-backup.json');
const OUT = join(process.cwd(), 'test-results', 'screenshots');
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('lq-theme', 'dark'); } catch {} });
const page = await ctx.newPage();
page.on('pageerror', (err) => console.log('pageerror', err.message));
await page.goto(`${BASE}/#/reports`, { waitUntil: 'domcontentloaded' });
await page.setInputFiles('input[type="file"][accept="application/json"]', backup);
await page.waitForTimeout(900);
const btn = page.getByRole('button', { name: 'Restore' });
if (await btn.count()) await btn.click();
await page.waitForTimeout(1500);
await page.goto(`${BASE}/#/analytics`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Explore individual videos' }).first().click();
await page.waitForTimeout(800);
const state = await page.evaluate(() => ({
  docW: document.documentElement.scrollWidth,
  winW: window.innerWidth,
  hasSlider: !!document.querySelector('[aria-label="Chart scroll position"]'),
  hasGridFromBars: !!document.querySelector('[role="region"]'),
}));
console.log('state', JSON.stringify(state));
await page.screenshot({ path: join(OUT, '1440x900-dark_analytics_detail.png') });
await browser.close();
