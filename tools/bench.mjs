/**
 * Frame-rate benchmark.
 *
 *   node tools/bench.mjs [--url ...] [--width 1728] [--height 1080]
 *
 * Samples the app's own fps counter across a set of representative views, with
 * the adaptive quality controller pinned so runs are comparable. Prints a table
 * so a change can be shown to have helped rather than assumed to have.
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
const WIDTH = Number(args.width ?? 1728);
const HEIGHT = Number(args.height ?? 1080);
const SAMPLE_MS = Number(args.sample ?? 5000);

const BROWSERS = ['/usr/bin/chromium', '/usr/bin/google-chrome-stable'];
const executablePath = BROWSERS.find(existsSync);
if (!executablePath) throw new Error('No chromium/chrome binary found');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Each scenario sets up a view; the harness then samples fps for SAMPLE_MS. */
const SCENARIOS = [
  { name: 'galaxy (framed)', setup: () => { window.__mcu.store.set('layout', 'galaxy'); } },
  {
    name: 'galaxy (inside disc)',
    setup: () => {
      const rig = window.__mcu.app.rig;
      window.__mcu.store.set('layout', 'galaxy');
      rig.setAngles(0.9, 1.32);
      rig.flyTo(new (rig.target.constructor)(120, 0, 60), 170);
    },
  },
  { name: 'timeline', setup: () => { window.__mcu.store.set('layout', 'timeline'); } },
  { name: 'sets', setup: () => { window.__mcu.store.set('layout', 'sets'); } },
  {
    name: 'inside disc, nebula off',
    setup: () => {
      const rig = window.__mcu.app.rig;
      window.__mcu.store.set('layout', 'galaxy');
      window.__mcu.store.patchVisual({ showNebula: false });
      rig.setAngles(0.9, 1.32);
      rig.flyTo(new (rig.target.constructor)(120, 0, 60), 170);
    },
    teardown: () => window.__mcu.store.patchVisual({ showNebula: true }),
  },
  {
    name: 'inside disc, tiny stars',
    setup: () => {
      const rig = window.__mcu.app.rig;
      window.__mcu.store.set('layout', 'galaxy');
      window.__mcu.store.patchVisual({ starSize: 0.25 });
      rig.setAngles(0.9, 1.32);
      rig.flyTo(new (rig.target.constructor)(120, 0, 60), 170);
    },
    teardown: () => window.__mcu.store.patchVisual({ starSize: 1 }),
  },
  {
    name: 'inside disc, no bloom',
    setup: () => {
      const rig = window.__mcu.app.rig;
      window.__mcu.store.set('layout', 'galaxy');
      window.__mcu.store.patchVisual({ bloom: 0 });
      rig.setAngles(0.9, 1.32);
      rig.flyTo(new (rig.target.constructor)(120, 0, 60), 170);
    },
    teardown: () => window.__mcu.store.patchVisual({ bloom: 1 }),
  },
  {
    name: 'galaxy, nebula off',
    setup: () => {
      window.__mcu.store.set('layout', 'galaxy');
      window.__mcu.store.patchVisual({ showNebula: false });
    },
    teardown: () => window.__mcu.store.patchVisual({ showNebula: true }),
  },
];

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: [
    '--no-sandbox', '--headless=new', '--enable-gpu', '--use-gl=angle',
    '--use-angle=gl-egl', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage',
    `--window-size=${WIDTH},${HEIGHT}`,
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem('mcu.introSeen', '1'); } catch { /* private mode */ }
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction('window.__mcu !== undefined', { timeout: 120000, polling: 250 });
  await sleep(2000);

  const renderer = await page.evaluate(() => {
    const gl = document.getElementById('stage').getContext('webgl2');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  console.log(`renderer: ${renderer}`);
  console.log(`viewport: ${WIDTH}x${HEIGHT}  sample: ${SAMPLE_MS}ms each\n`);

  const rows = [];
  for (const scenario of SCENARIOS) {
    try {
      await page.evaluate(scenario.setup);
    await sleep(3500); // let the camera settle and any morph finish

    // Sample the app's own counter rather than instrumenting the loop, so the
    // number is the one the telemetry readout shows a real user.
    const samples = await page.evaluate(async (ms) => {
      const out = [];
      const started = performance.now();
      while (performance.now() - started < ms) {
        out.push(window.__mcu.store.state.stats.fps);
        await new Promise((r) => setTimeout(r, 220));
      }
      return out;
    }, SAMPLE_MS);

    if (scenario.teardown) await page.evaluate(scenario.teardown);

    const valid = samples.filter((v) => v > 0).sort((a, b) => a - b);
    const median = valid.length ? valid[Math.floor(valid.length / 2)] : 0;
    const low = valid.length ? valid[Math.floor(valid.length * 0.1)] : 0;
    const tier = await page.evaluate(() => window.__mcu.app.qualityTier);
    rows.push({ name: scenario.name, median, low, tier, n: valid.length });
    } catch (err) {
      // Usually a hot-reload navigating the page out from under us. Prefer
      // running against a static preview build; note it and carry on.
      console.error(`  ! ${scenario.name}: ${err.message.split('\n')[0]}`);
      rows.push({ name: scenario.name, median: 0, low: 0, tier: -1, n: 0 });
    }
  }

  const pad = Math.max(...rows.map((r) => r.name.length));
  console.log('scenario'.padEnd(pad) + '   median   p10   tier');
  console.log('-'.repeat(pad + 24));
  for (const r of rows) {
    console.log(
      `${r.name.padEnd(pad)}   ${String(r.median).padStart(6)}   ${String(r.low).padStart(3)}` +
      `   ${String(r.tier).padStart(4)}`,
    );
  }
} finally {
  await browser.close();
}
