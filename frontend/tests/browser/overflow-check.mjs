import { chromium } from 'playwright-core';
import { join } from 'node:path';

const BASE = 'http://localhost:5200';
const backup = join(process.cwd(), 'test-results', 'demo-backup.json');
const routes = ['#/dash', '#/learn', '#/player', '#/goals', '#/checks', '#/focus', '#/analytics',
  '#/efficiency', '#/history', '#/revise', '#/modules', '#/competition', '#/reports', '#/settings', '#/account/profile', '#/account/security'];
const viewports = [
  { name: '360x800', width: 360, height: 800 },
  { name: '375x812', width: 375, height: 812 },
  { name: '390x844', width: 390, height: 844 },
  { name: '430x932', width: 430, height: 932 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '820x1180', width: 820, height: 1180 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1728x864', width: 1728, height: 864 },
];
const browser = await chromium.launch({ headless: true });
const issues = [];
for (const vp of viewports) {
  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    await ctx.addInitScript((t) => { try { localStorage.setItem('lq-theme', t); } catch {} }, theme);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#/reports`, { waitUntil: 'domcontentloaded' });
    await page.setInputFiles('input[type="file"][accept="application/json"]', backup);
    await page.waitForTimeout(800);
    const btn = page.getByRole('button', { name: 'Restore' });
    if (await btn.count()) await btn.click();
    await page.waitForTimeout(1500);
    for (const route of routes) {
      await page.goto(`${BASE}/${route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      const overflow = await page.evaluate(() => ({
        docW: document.documentElement.scrollWidth,
        winW: window.innerWidth,
        bodyW: document.body.scrollWidth,
      }));
      if (overflow.docW > overflow.winW + 1 || overflow.bodyW > overflow.winW + 1) {
        issues.push({ viewport: vp.name, theme, route, ...overflow });
      }
    }
    await ctx.close();
  }
}
await browser.close();
if (issues.length === 0) console.log('OVERFLOW: none anywhere');
else {
  console.log(`OVERFLOW: ${issues.length} issue(s)`);
  for (const i of issues) console.log(JSON.stringify(i));
}
process.exit(0);
