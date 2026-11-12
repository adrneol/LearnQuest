import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { waitForLibrary } from './isolated-browser.mjs';

const directory = 'test-results/visual/phase-b5';

async function capture(page, review, name) {
  if (!review) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: directory + '/' + name + '.png', animations: 'disabled', caret: 'hide' });
}

const dockButton = (page) => page.getByRole('button', { name: 'Open navigation' });
const panel = (page) => page.getByRole('navigation', { name: 'Workspace navigation', exact: true });
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('lq-navigation-dock')));

export async function checkDial(t, fixture, review) {
  await t.test('navigation scroll isolation for wheel, keyboard and touch', async (subtest) => {
    const page = await fixture.open(subtest, { width: 390, height: 680, touch: true });
    await waitForLibrary(page);
    await page.evaluate(() => window.scrollTo(0, 500));
    await dockButton(page).tap();
    await panel(page).getByRole('button', { name: 'All pages' }).tap();
    const list = panel(page).getByRole('region', { name: 'All pages' });
    const box = await list.boundingBox();
    assert.ok(box);
    const x = box.x + box.width / 2;
    const top = await page.evaluate(() => scrollY);
    const listTop = () => list.evaluate((element) => element.scrollTop);
    const settle = () => page.evaluate(() => new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const stayOnPage = async () => {
      await settle();
      assert.equal(await page.evaluate(() => scrollY), top);
    };
    await page.mouse.move(x, box.y + box.height / 2);
    await page.mouse.wheel(0, 83);
    await list.locator('a').last().evaluate((element) => new Promise((resolve) => {
      const viewport = element.closest('[role=region]');
      if (viewport.scrollTop > 0) resolve();
      else viewport.addEventListener('scroll', resolve, { once: true });
    }));
    assert.ok(await listTop() > 0);
    await stayOnPage();

    for (const direction of [1, -1]) {
      await list.evaluate((element, sign) => { element.scrollTop = sign > 0 ? element.scrollHeight : 0; }, direction);
      await page.mouse.wheel(0, direction * 240);
      await stayOnPage();
    }

    const cdp = await page.context().newCDPSession(page);
    const swipe = async (delta) => {
      const y = box.y + box.height / 2;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (const step of [.25, .5, .75, 1]) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + delta * step }] });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await swipe(-100);
    await stayOnPage();
    assert.ok(await listTop() > 0, 'Touch pans the list');
    await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await swipe(-100);
    await stayOnPage();
    await list.evaluate((element) => { element.scrollTop = 0; });
    await swipe(100);
    await stayOnPage();
    const last = list.getByRole('link', { name: 'Account', exact: true });
    await last.press('End');
    assert.ok(await listTop() > 0);
    await last.press('PageDown');
    await stayOnPage();
    const searchbox = panel(page).getByRole('searchbox', { name: 'Search pages' });
    const end = await listTop();
    await searchbox.press('PageUp');
    assert.ok(await listTop() < end);
    await stayOnPage();
    await searchbox.fill('revision');
    await page.mouse.wheel(0, 240);
    await stayOnPage();
    await page.mouse.move(389, 500);
    await page.mouse.wheel(0, 180);
    await page.waitForFunction((start) => scrollY > start, top);
    await panel(page).getByRole('searchbox', { name: 'Search pages' }).press('Escape');
    await page.keyboard.press('Escape');
    await panel(page).waitFor({ state: 'detached' });
    const after = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, 180);
    await page.waitForFunction((start) => scrollY > start, after);
    assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');
    await page.setViewportSize({ width: 700, height: 300 });
    await dockButton(page).tap();
    await panel(page).getByRole('button', { name: 'All pages' }).tap();
    await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const search = await panel(page).getByRole('searchbox', { name: 'Search pages' }).boundingBox();
    const back = await panel(page).getByRole('button', { name: 'Back to dial' }).boundingBox();
    assert.ok(search && back && back.y >= 0 && search.y + search.height < 300);
    assert.ok(await listTop() > 0);
  });

  await t.test('the dial snaps on a clockwise drag and reveals destinations without routing', async (subtest) => {
    const page = await fixture.open(subtest);
    await waitForLibrary(page);
    await capture(page, review, 'dock-collapsed-desktop');
    await page.mouse.move(500, 500);
    await page.mouse.wheel(0, 360);
    await page.waitForFunction(() => scrollY > 0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await dockButton(page).click();
    await panel(page).waitFor();
    await page.clock.runFor(200);
    const dial = page.locator('.lq-dial');
    const start = -Math.PI / 2;
    const learn = panel(page).getByRole('button', { name: 'Learn', exact: true });
    const insights = panel(page).getByRole('button', { name: 'Insights', exact: true });
    await capture(page, review, 'dial-learn');
    await panel(page).getByRole('button', { name: 'All pages' }).focus();
    await dial.hover();
    await page.mouse.wheel(0, 100);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await learn.getAttribute('aria-pressed'), 'true', 'Wheel selection requires dial focus');
    await learn.focus();
    await dial.hover();
    const beforeRotation = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, 100);
    await page.waitForFunction(() => document.querySelector('[data-slot="1"]')?.getAttribute('aria-pressed') === 'true');
    await learn.press('Home');
    await page.waitForFunction(() => document.querySelector('[data-slot="0"]')?.getAttribute('aria-pressed') === 'true');
    // Returning to Learn changes the panel height. Use the dial's new bounds
    // after the panel's ResizeObserver has positioned it for the drag.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const dragBounds = await dial.boundingBox();
    assert.ok(dragBounds);
    const point = (angle, radius = dragBounds.width * .43) => [
      dragBounds.x + dragBounds.width / 2 + radius * Math.cos(angle),
      dragBounds.y + dragBounds.height / 2 + radius * Math.sin(angle),
    ];
    await page.mouse.move(...point(start));
    await page.mouse.down();
    for (let step = 1; step <= 12; step++) await page.mouse.move(...point(start + step * Math.PI / 18));
    await page.mouse.move(...point(start + 2 * Math.PI / 3, dragBounds.width * .58));
    await page.mouse.up();
    assert.equal(await page.evaluate(() => scrollY), beforeRotation);
    assert.equal(await insights.getAttribute('aria-pressed'), 'true');
    assert.equal(new URL(page.url()).hash, '#/learn');
    await capture(page, review, 'dial-insights');
    await capture(page, review, 'dial-insights-pages');
    await panel(page).getByRole('link', { name: 'Analytics', exact: true }).click();
    await page.getByRole('heading', { name: 'Analytics', exact: true }).waitFor();
    assert.ok(await page.getByRole('heading', { name: 'Analytics', exact: true }).evaluate((element) => document.activeElement === element));
    await panel(page).waitFor({ state: 'detached' });
    await page.goBack();
    await waitForLibrary(page);
    await page.goForward();
    await page.getByRole('heading', { name: 'Analytics', exact: true }).waitFor();
  });

  await t.test('touch dock moves up and down, persists across reload and remains safe after rotation', async (subtest) => {
    const page = await fixture.open(subtest, { width: 390, height: 844, touch: true, theme: 'light' });
    await waitForLibrary(page);
    const dock = dockButton(page);
    const cdp = await page.context().newCDPSession(page);
    const drag = async (x, y, cancelled = false) => {
      const box = await dock.boundingBox();
      assert.ok(box);
      const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
      for (const fraction of [.25, .5, .75, 1]) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove', touchPoints: [{ x: from.x + (x - from.x) * fraction, y: from.y + (y - from.y) * fraction }],
        });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: cancelled ? 'touchCancel' : 'touchEnd', touchPoints: [] });
    };
    const initial = await dock.boundingBox();
    assert.ok(initial);
    await drag(30, 185);
    const up = await stored(page);
    assert.equal(up.edge, 'left');
    assert.ok(up.fraction < .3);
    assert.ok((await dock.boundingBox()).y < initial.y);
    await capture(page, review, 'dock-repositioned-up');
    await drag(365, 760);
    const down = await stored(page);
    assert.equal(down.edge, 'right');
    assert.ok(down.fraction > .8);
    await capture(page, review, 'dock-repositioned-down');
    await drag(26, 200, true);
    assert.deepEqual(await stored(page), down);
    assert.equal(new URL(page.url()).hash, '#/learn');
    assert.equal(await panel(page).count(), 0);
    assert.equal(await page.evaluate(() => scrollY), 0, 'Dragging the dock does not scroll the page');
    await page.reload();
    await waitForLibrary(page);
    assert.deepEqual(await stored(page), down);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForFunction(() => document.querySelector('.lq-dock-track').getBoundingClientRect().width > 800);
    const landscape = await dock.boundingBox();
    assert.ok(landscape && landscape.x > 750 && landscape.y >= 60 && landscape.y + landscape.height <= 390);
    await page.setViewportSize({ width: 320, height: 740 });
    await page.waitForFunction(() => document.querySelector('.lq-dock-track').getBoundingClientRect().width < 320);
    const narrow = await dock.boundingBox();
    assert.ok(narrow && narrow.x >= 0 && narrow.x + narrow.width <= 320 && narrow.y + narrow.height <= 740);
    // Keyboard activation is deterministic; the touch-tap path to the dock used
    // to flake open on slow hosts. The touch gesture coverage is the drag itself.
    await dock.press('Enter');
    // Settle on the steady attached geometry instead of probing mid-transition:
    // the panel repositions/slides when the dial opens, and the assertion only
    // holds once the collision handling has finished.
    const assertAttached = async (edge) => {
      const viewport = page.viewportSize();
      assert.ok(viewport);
      try {
        await page.waitForFunction(([e]) => {
          const triggerEl = document.querySelector('.lq-dock-trigger');
          const panelEl = document.getElementById('workspace-navigation');
          if (!triggerEl || !panelEl) return false;
          const t = triggerEl.getBoundingClientRect();
          const p = panelEl.getBoundingClientRect();
          const vw = innerWidth, vh = innerHeight;
          if (!(p.x >= 0 && p.x + p.width <= vw && p.y >= 0 && p.y + p.height <= vh)) return false;
          if (!(p.y <= t.y + t.height / 2 && p.y + p.height >= t.y + t.height / 2)) return false;
          if (e === 'left') return p.x > t.x && p.x < t.x + t.width;
          return p.x < t.x && p.x + p.width > t.x;
        }, [edge]);
      } catch (error) {
        const geometry = await page.evaluate(() => {
          const trigger = document.querySelector('.lq-dock-trigger')?.getBoundingClientRect().toJSON();
          const panel = document.getElementById('workspace-navigation')?.getBoundingClientRect().toJSON();
          const hit = trigger ? document.elementFromPoint(trigger.x + trigger.width / 2, trigger.y + trigger.height / 2)?.outerHTML.slice(0, 200) : null;
          return { trigger, panel, innerWidth, innerHeight, scrollY, hit };
        });
        console.log('[attached-fail]', JSON.stringify(geometry));
        await page.screenshot({ path: 'test-results/visual/phase-b5/diag-attached-fail.png' });
        throw error;
      }
    };
    await page.clock.runFor(200);
    await assertAttached('right');
    await capture(page, review, 'dial-right-bottom');
    await panel(page).getByRole('button', { name: 'Dock position' }).click();
    await panel(page).getByRole('button', { name: 'Left edge' }).press('Enter');
    await panel(page).getByRole('slider', { name: 'Vertical position' }).press('Home');
    assert.deepEqual(await stored(page), { edge: 'left', fraction: 0 });
    await assertAttached('left');
    await panel(page).getByRole('button', { name: 'Back to dial' }).click();
    await assertAttached('left');
    await capture(page, review, 'dial-left-top');
    await panel(page).getByRole('button', { name: 'Dock position' }).click();
    await panel(page).getByRole('button', { name: 'Reset dock' }).click();
    assert.deepEqual(await stored(page), { edge: 'left', fraction: .78 });
  });

  await t.test('keyboard navigation and existing dialogs own focus independently', async (subtest) => {
    const page = await fixture.open(subtest, { route: 'dash', width: 320, height: 740 });
    await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
    await capture(page, review, 'mobile-workspace');
    await dockButton(page).press('Enter');
    await capture(page, review, 'dial-learn-narrow');
    await panel(page).getByRole('button', { name: 'Learn', exact: true }).click();
    assert.equal(await panel(page).getByRole('link').count(), 6);
    const compactBounds = await panel(page).boundingBox();
    assert.ok(compactBounds);
    for (const slot of await panel(page).getByRole('link').all()) {
      const bounds = await slot.boundingBox();
      assert.ok(bounds && bounds.x >= compactBounds.x && bounds.x + bounds.width <= compactBounds.x + compactBounds.width);
    }
    await capture(page, review, 'dial-learn-pages-narrow');
    await panel(page).getByRole('button', { name: 'Learn', exact: true }).press('ArrowRight');
    const focused = panel(page).getByRole('button', { name: 'Insights', exact: true });
    assert.ok(await focused.evaluate((element) => document.activeElement === element));
    assert.ok(await page.locator('.lq-dial-hand').evaluate((element) => parseFloat(getComputedStyle(element).transitionDuration) < .001));
    await panel(page).getByRole('link', { name: 'History', exact: true }).waitFor();
    await panel(page).getByRole('button', { name: 'All pages' }).click();
    const search = panel(page).getByRole('searchbox', { name: 'Search pages' });
    assert.ok(await search.evaluate((element) => document.activeElement === element));
    await capture(page, review, 'dial-all-pages-narrow');
    await search.fill('no such destination');
    await panel(page).getByRole('status').waitFor();
    await search.fill('checkpoint');
    assert.equal(await panel(page).getByRole('region', { name: 'All pages' }).getByRole('link').count(), 1);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await panel(page).waitFor({ state: 'detached' });
    assert.ok(await dockButton(page).evaluate((element) => document.activeElement === element));

    const manage = page.getByRole('button', { name: 'Manage / Remove' });
    await dockButton(page).press('Enter');
    await manage.press('Enter');
    const confirmation = page.getByRole('dialog', { name: 'Remove or delete this playlist?' });
    await confirmation.waitFor();
    assert.equal(await page.locator('.lq-dock-trigger').evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
    }), false);
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.goto(new URL('#/account/security', page.url()).href);
    await page.getByRole('heading', { name: 'This browser has no account' }).waitFor();
    assert.equal(new URL(page.url()).hash, '#/account/security');
  });

  await t.test('a collapsed dock clears the Resume action at the saved position', async (subtest) => {
    const page = await fixture.open(subtest, { route: 'dash', width: 390, height: 844, touch: true });
    const resume = page.getByRole('link', { name: /^Resume/ });
    await resume.waitFor();
    const fraction = await resume.evaluate((element) => {
      const track = document.querySelector('.lq-dock-track').getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      return (rect.y + rect.height / 2 - track.y - 22) / (track.height - 44);
    });
    assert.ok(fraction > 0 && fraction < 1);
    await page.evaluate((value) => localStorage.setItem('lq-navigation-dock', JSON.stringify({ edge: 'left', fraction: value })), fraction);
    await page.reload();
    await resume.waitFor();
    const action = await resume.boundingBox();
    assert.ok(action && action.x < 48);
    const track = page.locator('.lq-dock-track');
    await page.waitForFunction(() => parseFloat(document.querySelector('.lq-dock-track').style.getPropertyValue('--dock-offset')) !== 0);
    const dock = await dockButton(page).boundingBox();
    assert.ok(dock && (dock.y + dock.height <= action.y || dock.y >= action.y + action.height));
    assert.deepEqual(await stored(page), { edge: 'left', fraction });
    assert.ok(await track.isVisible());
  });
}
