import { chromium } from 'playwright-core';
import { join } from 'node:path';

const BASE = 'http://localhost:5200';
const OUT = join(process.cwd(), 'test-results', 'screenshots');
const browser = await chromium.launch({ headless: true });
for (const theme of ['dark', 'light']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript((t) => { try { localStorage.setItem('lq-theme', t); } catch {} }, theme);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/#/dash`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('navigation', { name: 'Workspace navigation' }).waitFor();
  await page.screenshot({ path: join(OUT, `390x844-${theme}_navigation.png`), animations: 'disabled' });
  await ctx.close();
}
await browser.close();
console.log('done');
