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

/** Click a visible title-screen button whose label matches `re`. */
async function clickLabeledButton(page, re) {
  return page.evaluate((pattern) => {
    const rx = new RegExp(pattern, 'i');
    const b = [...document.querySelectorAll('button')].find((el) => {
      if (!rx.test(el.textContent ?? '')) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      if (getComputedStyle(el).visibility === 'hidden') return false;
      return true;
    });
    if (!b) return false;
    b.click();
    return true;
  }, re);
}

/**
 * Wait until the camera stops moving, rather than sleeping a fixed amount.
 * Flights are spring-damped and the opening approach is deliberately slow, so
 * any fixed wait is either wasteful or — under GPU load — too short, which
 * showed up as the hover checks failing intermittently.
 */
async function settleCamera(page, timeout = 15000) {
  const started = Date.now();
  let previous = null;
  while (Date.now() - started < timeout) {
    const now = await page.evaluate(() => {
      const r = window.__mcu.app.rig;
      // Include the camera's actual position, not just distance and target.
      // Orbit angle damps on its own spring, so theta could still be drifting
      // after those two had settled — moving the star several pixels across
      // the screen between computing its coordinates and putting the cursor
      // there. That is the most likely source of the occasional missed pick.
      return [r.distance, ...r.target.toArray(), ...r.camera.position.toArray()]
        .map((n) => Math.round(n * 10) / 10)
        .join(',');
    });
    if (now === previous) return true;
    previous = now;
    await sleep(250);
  }
  return false;
}

/** Poll a predicate until it holds, so waits scale with the machine. */
async function waitFor(page, fn, timeout = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await page.evaluate(fn)) return true;
    await sleep(150);
  }
  return false;
}

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

  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction('window.__mcu !== undefined', { timeout: 120000, polling: 250 });
  await sleep(1500);

  await settleCamera(page); // the cinematic opening approach
  const count = await page.evaluate(() => window.__mcu.universe.count);
  check('universe loaded', count > 100000, `${count.toLocaleString()} cards`);

  const title = await page.evaluate(() => {
    const overlay = document.querySelector('.mcu-title');
    const labels = [...document.querySelectorAll('.mcu-title button')]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== 'hidden';
      })
      .map((b) => (b.textContent ?? '').trim());
    const hud = document.querySelector('.mcu-command-bar');
    return {
      open: !!overlay?.classList.contains('mcu-title--open'),
      labels,
      hudHidden: !hud || getComputedStyle(hud).visibility === 'hidden',
      disclaimer: (document.querySelector('.mcu-title-disclaimer')?.textContent ?? '').length > 40,
    };
  });
  check('title screen is open after load', title.open);
  check('title offers Enter, Tour and Settings',
    title.labels.includes('Enter the Multiverse') &&
    title.labels.includes('Tour') &&
    title.labels.includes('Settings'),
    title.labels.join(' | '));
  check('play chrome is hidden on the title screen', title.hudHidden);
  check('title screen carries the Wizards disclaimer', title.disclaimer);
  check('title screen credits ApexForge', await page.evaluate(() => {
    const a = document.querySelector('.mcu-title-credit-link');
    return a instanceof HTMLAnchorElement && a.href.includes('ame-apexforge.org');
  }));

  check('Settings opens the settings panel', await clickLabeledButton(page, '^\\s*Settings\\s*$'));
  await sleep(300);
  check('settings panel is open from the title screen', await page.evaluate(() =>
    !!document.querySelector('.mcu-settings--open')));
  await clickLabeledButton(page, '^\\s*Settings\\s*$');
  await sleep(300);

  check('Enter the Multiverse dismisses the title', await clickLabeledButton(page, 'enter the multiverse'));
  await sleep(700);
  const afterEnter = await page.evaluate(() => {
    const overlay = document.querySelector('.mcu-title');
    const hud = document.querySelector('.mcu-command-bar');
    return {
      titleOpen: !!overlay?.classList.contains('mcu-title--open'),
      hudVisible: !!hud && getComputedStyle(hud).visibility !== 'hidden',
      shell: window.__mcu.store.state.shell,
    };
  });
  check('title screen is closed after enter', !afterEnter.titleOpen);
  check('HUD is visible after enter', afterEnter.hudVisible);
  check('store.shell is play after enter', afterEnter.shell === 'play', `got "${afterEnter.shell}"`);

  check('HUD ? starts the tour', await page.evaluate(() => {
    const btn = document.querySelector('.mcu-about-btn');
    if (!(btn instanceof HTMLButtonElement)) return false;
    btn.click();
    return !!document.querySelector('.mcu-tour--open');
  }));
  await sleep(400);
  check('Skip ends the tour', await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.mcu-tour button')].find((b) => /^\s*Skip\s*$/i.test(b.textContent ?? ''));
    if (!(btn instanceof HTMLButtonElement)) return false;
    btn.click();
    return !document.querySelector('.mcu-tour--open');
  }));

  // Title auto-rotate leaves the heading wherever it drifted. Pin the default
  // angle so the Black Lotus pick is not at the mercy of how long the menu sat.
  await page.evaluate(() => {
    window.__mcu.store.patchVisual({ autoRotate: false });
    const app = window.__mcu.app;
    app.rig.setAngles(Math.PI * 0.25, app.starfield.framePhi());
    app.resetView();
  });
  await settleCamera(page);

  // --- fly to a known card so it is centred and unoccluded -----------------
  const target = await page.evaluate(() => {
    const u = window.__mcu.universe;
    const i = u.search('Black Lotus', 1)[0];
    window.__mcu.store.set('selected', i);
    return { i, name: u.name(i) };
  });
  await settleCamera(page);

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
  //
  // Retried, because a person whose first nudge lands on nothing simply moves
  // the mouse again. Hammering the picker directly measures 24/24 with no
  // misses, so a single-shot move failing here is a harness timing artifact
  // rather than a product failure — but it is worth keeping the loop bounded
  // and reporting the attempt count, so a real regression still shows up.
  let hoverAttempts = 0;
  for (; hoverAttempts < 3; hoverAttempts++) {
    await page.mouse.move(screenPos.x - 40 - hoverAttempts * 7, screenPos.y - 40);
    await sleep(200);
    await page.mouse.move(screenPos.x, screenPos.y);
    if (await waitFor(page, () => window.__mcu.store.state.hovered >= 0, 2500)) break;
  }

  const hovered = await page.evaluate(() => {
    const s = window.__mcu.store.state;
    return { hovered: s.hovered, name: s.hovered >= 0 ? window.__mcu.universe.name(s.hovered) : null };
  });
  check('hovering a star sets store.hovered', hovered.hovered >= 0,
    hovered.name
      ? `got "${hovered.name}"${hoverAttempts ? ` after ${hoverAttempts + 1} nudges` : ''}`
      : 'nothing under cursor after 3 nudges');
  check('hovered card is the one under the cursor', hovered.hovered === target.i,
    `expected "${target.name}", got "${hovered.name ?? 'none'}"`);

  // Wait rather than read once. The tooltip renders on the next animation
  // frame after `hovered` changes, and now that the hover itself may resolve on
  // a retry nudge, reading immediately raced it and reported a failure for a
  // tooltip that was about to appear.
  const tooltipVisible = await waitFor(page, () => {
    const t = document.querySelector('.mcu-tooltip');
    if (!t) return false;
    const cs = getComputedStyle(t);
    return cs.opacity !== '0' && cs.display !== 'none' && cs.visibility !== 'hidden';
  }, 3000);
  check('hover tooltip is visible', tooltipVisible);

  // --- click ---------------------------------------------------------------
  await page.mouse.click(screenPos.x, screenPos.y);
  await waitFor(page, () => window.__mcu.store.state.selected >= 0);
  await sleep(500); // let the panel's open transition finish

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

  const miniWhileOpen = await page.evaluate(() =>
    document.querySelector('.mcu-minimap')?.classList.contains('mcu-minimap--hidden') === true);
  check('colour-pie compass hides while the card panel is open', miniWhileOpen);

  // Click the void just to the right of the filter panel — dense close-ups
  // still have empty sky there, and a miss has to actually deselect.
  const voidClick = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const r = canvas.getBoundingClientRect();
    const left = window.__mcu.store.state.insets.left;
    return { x: Math.round(r.left + left + 48), y: Math.round(r.top + r.height * 0.42) };
  });
  await page.mouse.click(voidClick.x, voidClick.y);
  await sleep(450);
  const afterVoid = await page.evaluate(() => window.__mcu.store.state.selected);
  check('clicking empty space deselects the card', afterVoid === -1,
    afterVoid === -1 ? '' : `still selected ${afterVoid}`);

  const miniAfterClose = await page.evaluate(() =>
    document.querySelector('.mcu-minimap')?.classList.contains('mcu-minimap--hidden') === false);
  check('colour-pie compass returns after deselect', miniAfterClose);

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

  // --- every layout renders --------------------------------------------------
  // Clear the search first: the query above narrows the field to a handful of
  // cards, which would make the "something is visible" assertion meaningless.
  await page.evaluate(() => {
    window.__mcu.store.patchFilter({ query: '' });
    window.__mcu.store.set('results', new Int32Array(0));
  });
  await sleep(500);

  for (const layout of ['timeline', 'sets', 'colorwheel', 'sphere', 'price', 'galaxy']) {
    await page.evaluate((m) => window.__mcu.store.set('layout', m), layout);
    await sleep(2600);
    const state = await page.evaluate(() => ({
      layout: window.__mcu.store.state.layout,
      fps: window.__mcu.store.state.stats.fps,
      visible: window.__mcu.store.state.matchCount,
    }));
    check(`layout "${layout}" renders`, state.layout === layout && state.fps > 0 && state.visible > 100000,
      `${state.fps} fps, ${state.visible.toLocaleString()} visible`);
  }

  // --- deep links ------------------------------------------------------------
  // Shareable URLs are a shipped feature and a full page boot away from
  // everything else the suite exercises, so they get their own navigation.
  const deepUuid = await page.evaluate(() => {
    const u = window.__mcu.universe;
    return u.uuid(u.search('Sol Ring', 1)[0]);
  });

  await page.goto(`${URL}?card=${deepUuid}&layout=sets`, {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  await page.waitForFunction('window.__mcu !== undefined', { timeout: 120000, polling: 250 });
  await sleep(1500);

  const titleReturned = await page.evaluate(() =>
    !!document.querySelector('.mcu-title--open'));
  check('title screen returns on every visit', titleReturned);

  const deep = await page.evaluate(() => {
    const s = window.__mcu.store.state;
    return {
      layout: s.layout,
      uuid: s.selected >= 0 ? window.__mcu.universe.uuid(s.selected) : null,
      name: s.selected >= 0 ? window.__mcu.universe.name(s.selected) : null,
    };
  });
  check('deep link restores the layout', deep.layout === 'sets', `got "${deep.layout}"`);
  check('deep link selects the card', deep.uuid === deepUuid, `got "${deep.name ?? 'none'}"`);

  // And the URL is written back, so what you share matches what you see.
  await page.evaluate(() => {
    window.__mcu.store.set('layout', 'galaxy');
    window.__mcu.store.set('selected', -1);
  });
  await sleep(700);
  const cleared = await page.evaluate(() => window.location.search);
  check('URL clears once back to defaults', cleared === '', `search="${cleared}"`);

  // --- ?cards=, and its round trip -------------------------------------------
  // The audit found this dropped on the first state write, so the deck was
  // gone on reload. A name with a comma in it is the other half: a tenth of
  // all card names are "Narset, Parter of Veils", and a bare split on commas
  // tore every one of them in half.
  const deck = ['Sol Ring', 'Lightning Bolt', 'Narset, Parter of Veils'];
  const cardsParam = deck.map(encodeURIComponent).join(',');
  await page.goto(`${URL}?shell=play&cards=${cardsParam}`, {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  await page.waitForFunction('window.__mcu !== undefined', { timeout: 120000, polling: 250 });
  await sleep(1500);

  const highlighted = await page.evaluate(() => {
    const s = window.__mcu.store.state;
    return { count: s.highlightOracles.size, matches: s.matchCount, filtered: s.filter.oracles.size };
  });
  check('?cards= highlights every named card', highlighted.count === 3, `got ${highlighted.count} of 3`);
  check('?cards= with a comma in the name resolves', highlighted.count === 3,
    `"Narset, Parter of Veils" ${highlighted.count === 3 ? 'survived' : 'was split'}`);
  // Isolation is the readable view. Highlight-in-place among 117k additive
  // points made a deck vanish; filtering is what "show this deck" actually is.
  check('?cards= isolates the named cards',
    highlighted.filtered === 3 && highlighted.matches < 10000,
    `${highlighted.matches.toLocaleString()} visible, filter.oracles=${highlighted.filtered}`);

  const dfc = await page.evaluate(() => {
    const u = window.__mcu.universe;
    return u.oraclesNamed('Bonecrusher Giant').length > 0;
  });
  check('a DFC front-face name resolves without the // back face', dfc === true);

  // The first state write used to rebuild the query from scratch and forget it.
  await page.evaluate(() => {
    const u = window.__mcu.universe;
    window.__mcu.store.set('selected', u.search('Black Lotus', 1)[0]);
  });
  await sleep(700);
  const afterWrite = await page.evaluate(() => window.location.search);
  check('?cards= survives a selection write', afterWrite.includes('cards='),
    `search="${afterWrite}"`);

  // And what it wrote has to parse back to the same three cards.
  await page.goto(`${URL}${afterWrite}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction('window.__mcu !== undefined', { timeout: 120000, polling: 250 });
  await sleep(1500);
  const reloaded = await page.evaluate(() => window.__mcu.store.state.highlightOracles.size);
  check('?cards= round-trips through a reload', reloaded === 3, `got ${reloaded} of 3`);

  // Links the shipped host already produced encoded the whole joined string,
  // so the separators arrived as %2C too and the list came through as a single
  // token. Those links have to keep working.
  const legacy = encodeURIComponent('Sol Ring,Lightning Bolt');
  await page.goto(`${URL}?shell=play&cards=${legacy}`, {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  await page.waitForFunction('window.__mcu !== undefined', { timeout: 120000, polling: 250 });
  await sleep(1500);
  const legacyCount = await page.evaluate(() => window.__mcu.store.state.highlightOracles.size);
  check('a whole-string-encoded ?cards= still resolves', legacyCount === 2,
    `got ${legacyCount} of 2`);

  // --- ?set= must not change the layout on reload ----------------------------
  // `layout=galaxy` is omitted from the URL as the default, but the reader
  // switches to `sets` for a bare `?set=`, so the pair has to be written out.
  await page.goto(`${URL}?shell=play`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction('window.__mcu !== undefined', { timeout: 120000, polling: 250 });
  await sleep(1200);
  await page.evaluate(() => {
    const idx = window.__mcu.universe.indexOfSetCode('lea');
    window.__mcu.store.patchFilter({ sets: new Set([idx]) });
  });
  await sleep(700);
  const setSearch = await page.evaluate(() => window.location.search);
  check('?set= in the galaxy layout writes the layout too', setSearch.includes('layout=galaxy'),
    `search="${setSearch}"`);
  await page.goto(`${URL}${setSearch}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction('window.__mcu !== undefined', { timeout: 120000, polling: 250 });
  await sleep(1200);
  const setLayout = await page.evaluate(() => window.__mcu.store.state.layout);
  check('?set= reload keeps the galaxy layout', setLayout === 'galaxy', `got "${setLayout}"`);

  // --- ?shell=play skips the title ------------------------------------------
  const shellState = await page.evaluate(() => ({
    shell: window.__mcu.store.state.shell,
    titleOpen: !!document.querySelector('.mcu-title--open'),
  }));
  check('?shell=play skips the title screen',
    shellState.shell === 'play' && !shellState.titleOpen, `shell="${shellState.shell}"`);

  // --- the nebula controls work with the camera at rest ----------------------
  // With auto-rotate off the march is cached frame to frame, and every uniform
  // on the march material — the nebula toggle, the intensity slider, the
  // filter-driven density — used to be unable to reach the screen at all.
  await page.evaluate(() => {
    window.__mcu.store.patchVisual({ autoRotate: false, showNebula: true });
  });
  await settleCamera(page);
  // Past the 0.35s idle threshold and past the density ease, so the cache is
  // genuinely live — a settled nebula skips every frame.
  await sleep(2500);

  const cached = await page.evaluate(() => new Promise((resolve) => {
    const app = window.__mcu.app;
    let skipped = 0, frames = 0;
    const tick = () => {
      frames++;
      if (app.nebula.skipRender) skipped++;
      if (frames < 60) requestAnimationFrame(tick);
      else resolve({ skipped, frames });
    };
    requestAnimationFrame(tick);
  }));
  check('nebula march is cached while the camera rests',
    cached.skipped > cached.frames * 0.9, `skipped ${cached.skipped}/${cached.frames}`);

  const woken = await page.evaluate(() => new Promise((resolve) => {
    const app = window.__mcu.app;
    window.__mcu.store.patchVisual({ showNebula: false });
    let marched = 0, frames = 0;
    const tick = () => {
      frames++;
      if (!app.nebula.skipRender) marched++;
      if (frames < 90) requestAnimationFrame(tick);
      else resolve({ marched, frames, density: app.nebula.marchMaterial.uniforms.uDensity.value });
    };
    requestAnimationFrame(tick);
  }));
  check('toggling the nebula off reaches the screen with the camera at rest',
    woken.marched > 0, `marched ${woken.marched}/${woken.frames} frames`);
  check('nebula density actually falls to zero', woken.density < 0.01,
    `uDensity=${woken.density.toFixed(3)}`);
  await page.evaluate(() => window.__mcu.store.patchVisual({ showNebula: true, autoRotate: true }));

  // --- printing thread -------------------------------------------------------
  // Selecting a reprinted card draws a line through its printings. Dismissing
  // it used to leave the points in place, so a later layout switch revived
  // the thread with nobody selected.
  await page.goto(`${URL}?shell=play`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction('window.__mcu !== undefined', { timeout: 120000, polling: 250 });
  await sleep(1200);
  await page.evaluate(() => {
    const i = window.__mcu.universe.search('Sol Ring', 1)[0];
    window.__mcu.store.set('selected', i);
  });
  await sleep(700);
  const trailOn = await page.evaluate(() => window.__mcu.app.printingTrail.line.visible);
  check('selecting a reprinted card draws its printing thread', trailOn === true);

  await page.evaluate(() => window.__mcu.store.set('selected', -1));
  await sleep(700);
  const trailOff = await page.evaluate(() => window.__mcu.app.printingTrail.line.visible);
  check('deselecting hides the printing thread', trailOff === false);

  await page.evaluate(() => {
    const i = window.__mcu.universe.search('Sol Ring', 1)[0];
    window.__mcu.store.set('selected', i);
  });
  await sleep(400);
  await page.evaluate(() => window.__mcu.store.set('layout', 'sets'));
  await sleep(200);
  const trailSets = await page.evaluate(() => window.__mcu.app.printingTrail.line.visible);
  check('the printing thread hides in the sets layout', trailSets === false);

  await page.evaluate(() => {
    window.__mcu.store.set('selected', -1);
    window.__mcu.store.set('layout', 'galaxy');
  });
  await sleep(500);
  const trailStay = await page.evaluate(() => window.__mcu.app.printingTrail.line.visible);
  check('a dismissed thread does not return on a layout switch', trailStay === false);

  const bloomTip = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.mcu-settings-row')]
      .find((el) => (el.textContent || '').includes('Bloom'));
    return row?.getAttribute('data-tip') ?? '';
  });
  check('Bloom slider explains itself on hover', /glow|halo/i.test(bloomTip), bloomTip || 'missing data-tip');

  // --- arm flight, focus dim, era ticks, newest-set pulse --------------------
  await page.evaluate(() => {
    window.__mcu.store.set('layout', 'galaxy');
    window.__mcu.store.set('selected', -1);
    window.__mcu.store.set('cameraCue', { kind: 'arm', color: 'U' });
  });
  await sleep(180);
  const armFlying = await page.evaluate(() => window.__mcu.app.rig.isCinematic);
  check('a colour-pie click starts an arm flight', armFlying === true);
  await sleep(2400);
  /*
   * Asserted against where blue's cards *are*, not against blue's pentagon
   * angle. This check used to hard-code `PI/2 - 2*TAU/5` and so encoded the
   * bug it was meant to catch: the galaxy's arms are a spiral, every arm ends
   * up ~117 degrees around from its base angle, and clicking blue on the pie
   * flew you to green. Measuring the mean direction here means the check
   * still means something in a layout that spaces its colours differently.
   */
  const armSettled = await page.evaluate(() => {
    const { app, universe } = window.__mcu;
    const pos = app.starfield.positionBuffers.b;
    const identity = universe.col.colorIdentity;
    const BIT = { W: 1, U: 2, B: 4, R: 8, G: 16 };
    const dir = {};
    for (const [letter, bit] of Object.entries(BIT)) {
      let sx = 0, sz = 0, n = 0;
      for (let i = 0; i < universe.count; i++) {
        if (identity[i] !== bit) continue;
        const o = i * 3, x = pos[o], z = pos[o + 2];
        const r = Math.hypot(x, z);
        if (r < 1e-3) continue;
        sx += x / r; sz += z / r; n++;
      }
      dir[letter] = Math.atan2(sz / n, sx / n);
    }
    const cam = app.rig.camera.position;
    const camAngle = Math.atan2(cam.z, cam.x);
    const off = (a) => Math.abs(Math.atan2(Math.sin(a - camAngle), Math.cos(a - camAngle)));
    const nearest = Object.keys(dir).sort((a, b) => off(dir[a]) - off(dir[b]))[0];
    return {
      cinematic: app.rig.isCinematic,
      err: off(dir.U),
      nearest,
      radius: app.rig.distance,
      framed: app.starfield.frameDistance(),
    };
  });
  check('the arm flight settles with blue on the near side',
    armSettled.cinematic === false && armSettled.nearest === 'U' && armSettled.err < 0.25,
    `cinematic=${armSettled.cinematic} nearest=${armSettled.nearest} err=${armSettled.err.toFixed(3)}`);
  check('the arm flight closes the distance rather than reframing',
    armSettled.radius < armSettled.framed * 0.8,
    `radius=${armSettled.radius.toFixed(0)} framed=${armSettled.framed.toFixed(0)}`);

  // The dial has to agree with where the flight put you, or it is a compass
  // pointing at the wrong colour — which is what it was while the wedges were
  // drawn on the pentagon angles and the camera aimed at the measured ones.
  const needleOnBlue = await page.evaluate(() => {
    const svg = document.querySelector('.mcu-minimap svg');
    const needle = svg.querySelector('.mcu-minimap-needle');
    const m = needle.getAttribute('transform').match(/rotate\(([-0-9.]+)\)/);
    const deg = Number(m[1]);
    const a = (deg * Math.PI) / 180;
    // Walk in from the needle tip to a radius the wedges actually occupy.
    const pt = svg.createSVGPoint();
    pt.x = Math.cos(a) * 0.72;
    pt.y = Math.sin(a) * 0.72;
    const screen = pt.matrixTransform(svg.getScreenCTM());
    const hit = document.elementFromPoint(screen.x, screen.y);
    return hit?.closest?.('[data-arm]')?.getAttribute('data-arm') ?? null;
  });
  check('the compass tick lands on the wedge that was clicked',
    needleOnBlue === 'U', `needle over ${needleOnBlue}`);

  const focusOn = await page.evaluate(() => {
    const i = window.__mcu.universe.search('Sol Ring', 1)[0];
    window.__mcu.store.set('selected', i);
    return i;
  });
  await sleep(500);
  const focused = await page.evaluate(() => window.__mcu.app.starfield.material.uniforms.uFocus.value);
  check('selecting a card focuses the field on it', focused > 0.6, `uFocus=${Number(focused).toFixed(2)}`);
  await page.evaluate(() => window.__mcu.store.set('selected', -1));
  await sleep(500);
  const unfocused = await page.evaluate(() => window.__mcu.app.starfield.material.uniforms.uFocus.value);
  check('deselecting restores the rest of the field', unfocused < 0.25, `uFocus=${Number(unfocused).toFixed(2)}`);

  const eras = await page.evaluate(() => {
    const g = window.__mcu.app.eraMarkers.group;
    return { visible: g.visible, n: g.children.length };
  });
  check('era ticks are drawn in the galaxy layout', eras.visible === true && eras.n >= 8,
    `visible=${eras.visible} children=${eras.n}`);

  const fresh = await page.evaluate(() => ({
    pulse: window.__mcu.app.starfield.material.uniforms.uFresh.value,
    set: window.__mcu.app.starfield.material.uniforms.uNewestSet.value,
  }));
  check('the newest set is pulsing after boot', fresh.pulse > 0.05 && fresh.set >= 0,
    `uFresh=${Number(fresh.pulse).toFixed(2)} set=${fresh.set}`);

  // --- the embed message channel ---------------------------------------------
  // The host drives highlighting over postMessage. Nothing else in the suite
  // frames the app, so nothing else exercises embed.ts at all.
  const embed = await page.evaluate(async (base) => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;left:-9999px;width:900px;height:600px';
    frame.src = `${base}?shell=play`;
    const ready = new Promise((resolve) => {
      const onMsg = (e) => {
        if (e.data?.source === 'aetherfield' && e.data.type === 'ready') {
          window.removeEventListener('message', onMsg);
          resolve(e.data);
        }
      };
      window.addEventListener('message', onMsg);
      setTimeout(() => resolve(null), 90000);
    });
    document.body.append(frame);
    const readyMsg = await ready;
    if (!readyMsg) { frame.remove(); return { error: 'no ready ping' }; }

    const names = ['Sol Ring', 'Counterspell'];
    frame.contentWindow.postMessage({ source: 'aetherfield', type: 'highlight', names }, '*');
    await new Promise((r) => setTimeout(r, 600));
    const applied = frame.contentWindow.__mcu.store.state.highlightOracles.size;

    frame.contentWindow.postMessage({ source: 'aetherfield', type: 'clear-highlight' }, '*');
    await new Promise((r) => setTimeout(r, 400));
    const cleared = frame.contentWindow.__mcu.store.state.highlightOracles.size;

    const skipped = !frame.contentDocument.querySelector('.mcu-title--open');
    frame.remove();
    return { cards: readyMsg.cards, applied, cleared, skipped };
  }, URL);
  check('an embedded frame posts its ready ping', !embed.error && embed.cards > 100000,
    embed.error ?? `${(embed.cards ?? 0).toLocaleString()} cards`);
  check('the host highlight message reaches the store', embed.applied === 2,
    `got ${embed.applied} of 2`);
  check('the host clear-highlight message empties it', embed.cleared === 0,
    `got ${embed.cleared}`);
  check('an embedded frame skips the title screen', embed.skipped === true);

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
