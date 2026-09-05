import { store } from './core/store.ts';
import { loadUniverse } from './data/universe.ts';
import { App } from './core/App.ts';
import { connectUrlState } from './core/urlState.ts';
import { connectEmbed, isEmbedded, notifyHost, onHostMessage } from './core/embed.ts';
import { defaultFilter } from './core/store.ts';
import { connectSettingsPersistence, restoreSettings } from './core/persist.ts';

/** Handles exposed by the UI layer; mirrored here so main does not hard-depend on it. */
interface UIHandles {
  setHoverAnchor(p: { x: number; y: number } | null): void;
  enter(): void;
  openTitle(): void;
  openTour(): void;
  destroy(): void;
}

const boot = {
  root: document.getElementById('boot')!,
  fill: document.getElementById('boot-fill')!,
  label: document.getElementById('boot-label')!,
};

function setBoot(fraction: number, label: string): void {
  boot.fill.style.width = `${Math.round(fraction * 100)}%`;
  boot.label.textContent = label;
}

function bootError(message: string): void {
  boot.label.classList.add('error');
  boot.label.textContent = message;
  boot.fill.style.background = '#ff8f7a';
  // A host showing this in a frame has no other way to learn that the boot
  // failed: an <iframe> fires `load` for a 404 page just as happily.
  notifyHost({ type: 'error', message });
}

async function main(): Promise<void> {
  const canvas = document.getElementById('stage') as HTMLCanvasElement;
  const uiRoot = document.getElementById('ui-root')!;

  // Before anything can render a link. Outside a frame this is a no-op.
  connectEmbed();

  if (!canvas.getContext('webgl2')) {
    bootError('This needs WebGL2, which this browser or GPU does not provide.');
    return;
  }

  const universe = await loadUniverse((fraction, label) => {
    store.set('loadProgress', fraction);
    store.set('loadLabel', label);
    setBoot(fraction, label);
  });

  // Before the UI mounts, so the settings panel renders the stored values
  // instead of flashing defaults and then correcting itself.
  restoreSettings();

  // The UI layer is optional at runtime: if it fails to load, the galaxy still
  // flies. Keeps the renderer independently testable.
  const camHost = {
    cameraSnapshot: () => ({ theta: 0, phi: 1.07, radius: 900, target: [0, 0, 0] as [number, number, number] }),
  };
  let ui: UIHandles | null = null;
  try {
    const mod = await import('./ui/index.ts');
    ui = mod.mountUI(uiRoot, universe, camHost);
  } catch (err) {
    console.warn('[mcu] UI layer unavailable, running renderer only:', err);
  }

  // Before the app starts, so a ?card= link is already selected on first frame
  // and the camera flies straight to it rather than snapping afterwards.
  connectUrlState(universe);
  connectSettingsPersistence();

  setBoot(0.9, 'Igniting stars');
  const app = new App(canvas, universe, {
    onHoverAnchor: (p) => ui?.setHoverAnchor(p),
  });
  camHost.cameraSnapshot = () => app.rig.snapshot();
  app.start();

  onHostMessage((msg) => {
    if (msg.type === 'clear-highlight') {
      store.set('highlightOracles', new Set());
      store.patchFilter({ oracles: defaultFilter().oracles });
      return;
    }
    if (msg.type === 'show-set') {
      const idx = universe.indexOfSetCode(msg.code);
      if (idx < 0) return;
      store.patchFilter({ sets: new Set([idx]) });
      store.set('layout', 'sets');
      return;
    }
    const oracles = new Set<number>();
    for (const id of msg.uuids ?? []) {
      const i = universe.indexOfUuid(id);
      if (i >= 0) oracles.add(universe.col.oracleIdx[i]!);
    }
    for (const name of msg.names ?? []) {
      for (const o of universe.oraclesNamed(name)) oracles.add(o);
    }
    store.set('highlightOracles', oracles);
  });

  // Hold the overlay until two frames have actually rendered, so the reveal
  // never lands on a blank canvas while shaders are still compiling.
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

  setBoot(1, `${universe.count.toLocaleString()} cards charted`);
  store.set('loadProgress', 1);
  store.set('ready', true);
  notifyHost({ type: 'ready', cards: universe.count });
  boot.root.classList.add('done');
  setTimeout(() => boot.root.remove(), 900);

  Object.assign(window as unknown as Record<string, unknown>, { __mcu: { app, universe, store, ui } });

  // The service worker belongs to the public site at its origin root.
  // Framed inside FND it would cache the host's assets. Served under
  // filthy-net-deck.com/aetherfield/ it would claim that origin (sw.js is
  // root-absolute and Netlify sends Service-Worker-Allowed: /). Pathname
  // must be `/` — `isEmbedded()` only means "inside an iframe".
  const atSiteRoot = location.pathname === '/' || location.pathname === '/index.html';
  const ownsOrigin = !isEmbedded() && location.protocol.startsWith('http') && atSiteRoot;
  if (import.meta.env.PROD && ownsOrigin && 'serviceWorker' in navigator) {
    const swUrl = new URL('sw.js', document.baseURI).href;
    void navigator.serviceWorker.register(swUrl).catch(() => {});
  }
}

main().catch((err: unknown) => {
  console.error('[mcu] boot failed', err);
  bootError(err instanceof Error ? err.message : String(err));
});
