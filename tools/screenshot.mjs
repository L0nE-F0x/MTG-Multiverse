/**
 * Headless capture harness for iterating on the visuals.
 *
 *   node tools/screenshot.mjs --out shot.png --eval "__mcu.store.set('layout','sets')"
 *
 * Uses the system Chromium. Tries the real GPU first because the nebula is a
 * raymarch and SwiftShader takes tens of seconds a frame; falls back to
 * software rendering if the GPU path cannot start.
 */
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]]);
    return acc;
  }, []),
);

const OUT = args.out ?? 'shot.png';
const URL = args.url ?? 'http://127.0.0.1:5173/';
const WIDTH = Number(args.width ?? 1728);
const HEIGHT = Number(args.height ?? 1080);
const SETTLE = Number(args.settle ?? 2500);

const BROWSERS = ['/usr/bin/chromium', '/usr/bin/google-chrome-stable'];
const executablePath = BROWSERS.find(existsSync);
if (!executablePath) throw new Error('No chromium/chrome binary found');

const GPU_FLAGS = [
  '--no-sandbox',
  '--headless=new',
  '--enable-gpu',
  '--use-gl=angle',
  '--use-angle=gl-egl',
  '--ignore-gpu-blocklist',
  '--enable-unsafe-swiftshader',
  '--disable-dev-shm-usage',
];
const SOFTWARE_FLAGS = [
  '--no-sandbox', '--headless=new', '--use-gl=angle',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage',
];

async function capture(flags, label) {
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [...flags, `--window-size=${WIDTH},${HEIGHT}`],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });

    // Suppress the intro overlay before any page script runs. Setting it after
    // load is too late: the overlay opens the moment `ready` flips.
    if (!args.intro) {
      await page.evaluateOnNewDocument(() => {
        try { localStorage.setItem('mcu.introSeen', '1'); } catch { /* private mode */ }
      });
    }

    const logs = [];
    page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    try {
      await page.waitForFunction('window.__mcu !== undefined', {
        timeout: Number(args.boot ?? 90000), polling: 250,
      });
    } catch {
      // Capture whatever is on screen anyway: a stalled boot overlay plus the
      // console log usually says exactly what failed.
      const bootLabel = await page.evaluate(() => document.getElementById('boot-label')?.textContent);
      console.error(`[${label}] BOOT STALLED. boot-label="${bootLabel}"`);
      const type = OUT.endsWith('.jpg') || OUT.endsWith('.jpeg') ? 'jpeg' : 'png';
    await page.screenshot({
      path: OUT,
      type,
      ...(type === 'jpeg' ? { quality: Number(args.quality ?? 88) } : {}),
    });
      console.error('--- console ---\n' + logs.slice(-40).join('\n'));
      return false;
    }

    // --eval-file avoids shell-quoting gymnastics for anything non-trivial.
    const script = args['eval-file']
      ? readFileSync(args['eval-file'], 'utf8')
      : typeof args.eval === 'string' ? args.eval : null;
    if (script) await page.evaluate(script);
    await new Promise((r) => setTimeout(r, SETTLE));

    const renderer = await page.evaluate(() => {
      const gl = document.getElementById('stage').getContext('webgl2');
      const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
      return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
    });
    const fps = await page.evaluate(() => window.__mcu.store.state.stats.fps);

    const type = OUT.endsWith('.jpg') || OUT.endsWith('.jpeg') ? 'jpeg' : 'png';
    await page.screenshot({
      path: OUT,
      type,
      ...(type === 'jpeg' ? { quality: Number(args.quality ?? 88) } : {}),
    });
    console.error(`[${label}] renderer=${renderer} fps=${fps} -> ${OUT}`);
    const noise = logs.filter((l) => !/vite|hmr|Download the React/i.test(l));
    if (noise.length) console.error('--- console ---\n' + noise.slice(0, 30).join('\n'));
    return true;
  } finally {
    await browser.close();
  }
}

try {
  await capture(GPU_FLAGS, 'gpu');
} catch (err) {
  console.error('GPU path failed, retrying with SwiftShader:', err.message);
  await capture(SOFTWARE_FLAGS, 'swiftshader');
}
