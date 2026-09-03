/**
 * End-to-end interaction test.
 *
 *   node tools/test-interaction.mjs [--url http://127.0.0.1:5173/]
 *
 * Drives real mouse and keyboard input through Chrome DevTools rather than
 * poking the store directly, because the interesting failure modes all live
 * between the two: GPU picking reading the wrong pixel, the pick buffer being
 * scaled by devicePixelRatio, click-versus-drag disambiguation, and the search
 * field's keyboard handling. Exits non-zero on the first failure.
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import process from 'node:process';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]]);
    return acc;
  }, []),
);
const URL = args.url ?? 'http://127.0.0.1:5173/';
const BROWSERS = ['/usr/bin/chromium', '/usr/bin/google-chrome-stable'];
const executablePath = BROWSERS.find(existsSync);
if (!executablePath) throw new Error('No chromium/chrome binary found');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: [
    '--no-sandbox', '--headless=new', '--enable-gpu', '--use-gl=angle',
    '--use-angle=gl-egl', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage',
    '--window-size=1600,1000',
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });

  // Suppress the intro overlay before any page script runs; setting the flag
  // after load is too late, since the overlay opens as soon as `ready` flips.
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem('mcu.introSeen', '1'); } catch { /* private mode */ }
  });

  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction('window.__mcu !== undefined', { timeout: 120000, polling: 250 });
  await sleep(1500);

  const count = await page.evaluate(() => window.__mcu.universe.count);
  check('universe loaded', count > 100000, `${count.toLocaleString()} cards`);

  // Belt and braces: if an overlay is somehow still up, dismiss it so it cannot
  // swallow the pointer events the rest of this test depends on.
  const introDismissed = await page.evaluate(() => {
    let clicked = false;
    document.querySelectorAll('button').forEach((b) => {
      if (/enter the universe/i.test(b.textContent ?? '')) { b.click(); clicked = true; }
    });
    return clicked;
  });
  if (introDismissed) console.log('  note: intro overlay was open and has been dismissed');
  await sleep(900);

  // --- fly to a known card so it is centred and unoccluded -----------------
  const target = await page.evaluate(() => {
    const u = window.__mcu.universe;
    const i = u.search('Black Lotus', 1)[0];
    window.__mcu.store.set('selected', i);
    return { i, name: u.name(i) };
  });
  await sleep(4000);

  // Drop the selection; we want hover to be what re-establishes it.
  await page.evaluate(() => window.__mcu.store.set('selected', -1));
  await sleep(600);

  // --- hover ---------------------------------------------------------------
  const screenPos = await page.evaluate((cardIndex) => {
    const app = window.__mcu.app;
    const v = new (window.__mcu.app.starfield.points.position.constructor)();
    app.starfield.positionOf(cardIndex, v);
    v.project(app.rig.camera);
    const c = document.getElementById('stage').getBoundingClientRect();
    return {
      x: c.left + ((v.x + 1) / 2) * c.width,
      y: c.top + ((1 - v.y) / 2) * c.height,
      onScreen: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z < 1,
    };
  }, target.i);
  check('target card is on screen after fly-to', screenPos.onScreen,
    `at ${Math.round(screenPos.x)},${Math.round(screenPos.y)}`);

  // Move in two steps: the picker only queues a pick on pointermove, and a
  // single jump from 0,0 can land before the first frame has been rendered.
  await page.mouse.move(screenPos.x - 40, screenPos.y - 40);
  await sleep(200);
  await page.mouse.move(screenPos.x, screenPos.y);
  await sleep(900);

  const hovered = await page.evaluate(() => {
    const s = window.__mcu.store.state;
    return { hovered: s.hovered, name: s.hovered >= 0 ? window.__mcu.universe.name(s.hovered) : null };
  });
  check('hovering a star sets store.hovered', hovered.hovered >= 0,
    hovered.name ? `got "${hovered.name}"` : 'nothing under cursor');
  check('hovered card is the one under the cursor', hovered.hovered === target.i,
    `expected "${target.name}", got "${hovered.name ?? 'none'}"`);

  const tooltipVisible = await page.evaluate(() => {
    const t = document.querySelector('.mcu-tooltip');
    if (!t) return false;
    const cs = getComputedStyle(t);
    return cs.opacity !== '0' && cs.display !== 'none' && cs.visibility !== 'hidden';
  });
  check('hover tooltip is visible', tooltipVisible);

  // --- click ---------------------------------------------------------------
  await page.mouse.click(screenPos.x, screenPos.y);
  await sleep(1200);

  const selected = await page.evaluate(() => {
    const s = window.__mcu.store.state;
    const panel = document.querySelector('.mcu-card-panel');
    const r = panel?.getBoundingClientRect();
    return {
      selected: s.selected,
      panelOpen: !!panel?.classList.contains('mcu-card-panel--open'),
      panelOnScreen: !!r && r.right > 0 && r.left < window.innerWidth && r.top < window.innerHeight && r.bottom > 0,
      name: s.selected >= 0 ? window.__mcu.universe.name(s.selected) : null,
    };
  });
  check('clicking a star selects it', selected.selected === target.i,
    `expected "${target.name}", got "${selected.name ?? 'none'}"`);
  check('card panel opens', selected.panelOpen);
  check('card panel is actually within the viewport', selected.panelOnScreen);

  // --- drag must not select ------------------------------------------------
  await page.evaluate(() => window.__mcu.store.set('selected', -1));
  await sleep(400);
  await page.mouse.move(screenPos.x, screenPos.y);
  await page.mouse.down();
  await page.mouse.move(screenPos.x + 160, screenPos.y + 60, { steps: 12 });
  await page.mouse.up();
  await sleep(600);
  const afterDrag = await page.evaluate(() => window.__mcu.store.state.selected);
  check('dragging to orbit does not select a card', afterDrag === -1,
    afterDrag === -1 ? '' : `selected ${afterDrag}`);

  // --- search --------------------------------------------------------------
  await page.keyboard.press('Slash');
  await sleep(300);
  await page.keyboard.type('Lightning Bolt', { delay: 18 });
  await sleep(700);
  const searchResults = await page.evaluate(() => {
    const s = window.__mcu.store.state;
    return {
      n: s.results.length,
      first: s.results.length ? window.__mcu.universe.name(s.results[0]) : null,
      focused: document.activeElement?.tagName === 'INPUT',
    };
  });
  check('"/" focuses the search field', searchResults.focused);
  check('search returns results', searchResults.n > 0,
    searchResults.first ? `top hit "${searchResults.first}"` : '');
  check('search ranks the exact name first', searchResults.first === 'Lightning Bolt',
    `got "${searchResults.first}"`);

  check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILED:\n' + failed.map((f) => `  - ${f.name}`).join('\n'));
  process.exit(1);
}
console.log('--- ALL INTERACTION CHECKS PASSED ---');
