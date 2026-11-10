import { chromium } from 'playwright-core';
import { join } from 'node:path';

const BASE = 'http://localhost:5200';
const backup = join(process.cwd(), 'test-results', 'demo-backup.json');
const out = join(process.cwd(), 'test-results', 'screenshots');
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
await ctx.addInitScript(() => { try { localStorage.setItem('lq-theme', 'dark'); } catch {} });
const page = await ctx.newPage();
page.on('pageerror', (err) => console.log('pageerror', err.message));
await page.goto(`${BASE}/#/reports`, { waitUntil: 'domcontentloaded' });
await page.setInputFiles('input[type="file"][accept="application/json"]', backup);
await page.waitForTimeout(900);
const btn = page.getByRole('button', { name: 'Restore' });
if (await btn.count()) await btn.click();
await page.waitForTimeout(1500);
await page.goto(`${BASE}/#/learn`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
// click the "Full playlist" preset for largest dataset
await page.getByRole('button', { name: /Full playlist/ }).click();
await page.waitForTimeout(800);
// expand detailed exploration
const explore = page.getByRole('button', { name: 'Explore individual videos' }).first();
await explore.click();
await page.waitForTimeout(800);
await page.screenshot({ path: join(out, 'learn-139-detail.png'), fullPage: false });
// move forward a few slots with keyboard
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(300);
await page.screenshot({ path: join(out, 'learn-139-detail-fwd.png'), fullPage: false });
// aim x-axis: verify first position visible at index 1 not 0
const badge = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('span')];
  const hit = spans.find((s) => /#\d+–\d+\//.test(s.textContent ?? ''));
  return hit ? hit.textContent : 'none';
});
console.log('badge:', JSON.stringify(badge));
await browser.close();
