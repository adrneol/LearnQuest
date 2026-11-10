import { chromium } from 'playwright-core';
import { join } from 'node:path';

const BASE = 'http://localhost:5200';
const backup = join(process.cwd(), 'test-results', 'demo-backup.json');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (msg) => { if (['error', 'warning'].includes(msg.type())) console.log('console', msg.type(), msg.text()); });
page.on('pageerror', (err) => console.log('pageerror', err.message));
page.on('requestfailed', (req) => console.log('requestfailed', req.url(), req.failure()?.errorText));
page.on('response', (res) => { if (res.status() >= 400) console.log('http', res.status(), res.url()); });
await page.goto(`${BASE}/#/reports`, { waitUntil: 'domcontentloaded' });
await page.setInputFiles('input[type="file"][accept="application/json"]', backup);
await page.waitForTimeout(800);
const btn = page.getByRole('button', { name: 'Restore' });
if (await btn.count()) await btn.click();
await page.waitForTimeout(1200);
for (const route of ['#/analytics', '#/efficiency', '#/history', '#/reports', '#/revision']) {
  await page.goto(`${BASE}/${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 1600));
  console.log('ROUTE', route, '=>', JSON.stringify(bodyText));
}
await browser.close();
