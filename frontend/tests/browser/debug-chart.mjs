import { chromium } from 'playwright-core';
import { join } from 'node:path';

const BASE = 'http://localhost:5200';
const backup = join(process.cwd(), 'test-results', 'demo-backup.json');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (msg) => console.log('console', msg.type(), msg.text()));
page.on('pageerror', (err) => console.log('pageerror', err.message));
await page.goto(`${BASE}/#/reports`, { waitUntil: 'domcontentloaded' });
await page.setInputFiles('input[type="file"][accept="application/json"]', backup);
await page.waitForTimeout(500);
const btn = page.getByRole('button', { name: 'Restore' });
if (await btn.count()) await btn.click();
await page.waitForTimeout(1500);
await page.goto(`${BASE}/#/dash`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
const info = await page.evaluate(() => {
  const region = document.querySelector('[role="region"][aria-label*="Cumulative"]');
  const bodyText = document.body.innerText;
  if (!region) return { found: false, bodyText: bodyText.slice(0, 400) };
  const rect = region.getBoundingClientRect();
  const inner = region.querySelector('div[style*="translate"]');
  const innerRect = inner?.getBoundingClientRect();
  const svgs = [...region.querySelectorAll('svg')].map((s) => ({ w: s.clientWidth, h: s.clientHeight, tag: s.tagName, htmlLen: s.innerHTML.length }));
  return {
    found: true,
    rect: { w: rect.width, h: rect.height, left: rect.left, top: rect.top },
    inner: innerRect ? { w: innerRect.width, left: innerRect.left } : null,
    svgs,
    outerLeft: region.outerHTML.slice(0, 600),
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
