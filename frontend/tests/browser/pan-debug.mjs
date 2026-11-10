import { chromium } from 'playwright-core';
import { join } from 'node:path';

const BASE = 'http://localhost:5200';
const backup = join(process.cwd(), 'test-results', 'demo-backup.json');
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
await page.waitForTimeout(600);
const dims = await page.evaluate(() => {
  const region = [...document.querySelectorAll('[role="region"]')].find((r) => r.getAttribute('aria-label')?.includes('duration chart'));
  if (!region) return null;
  const rect = region.getBoundingClientRect();
  const stats = { rectW: rect.width, clientW: region.clientWidth, docW: document.documentElement.scrollWidth };
  return stats;
});
console.log('dims', JSON.stringify(dims));
await browser.close();
