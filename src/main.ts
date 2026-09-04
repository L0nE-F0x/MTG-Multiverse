import { store } from './core/store.ts';
import { loadUniverse } from './data/universe.ts';
import { App } from './core/App.ts';
import { connectUrlState } from './core/urlState.ts';
import { connectEmbed, isEmbedded, notifyHost } from './core/embed.ts';

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

  // The UI layer is optional at runtime: if it fails to load, the galaxy still
  // flies. Keeps the renderer independently testable.
  let ui: UIHandles | null = null;
  try {
    const mod = await import('./ui/index.ts');
    ui = mod.mountUI(uiRoot, universe);
  } catch (err) {
    console.warn('[mcu] UI layer unavailable, running renderer only:', err);
  }

  // Before the app starts, so a ?card= link is already selected on first frame
  // and the camera flies straight to it rather than snapping afterwards.
  connectUrlState(universe);

  setBoot(0.9, 'Igniting stars');
  const app = new App(canvas, universe, {
    onHoverAnchor: (p) => ui?.setHoverAnchor(p),
  });
  app.start();

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

  // The service worker belongs to the public site only. Embedded in a host
  // app the page is served from that app's bundle, where registration either
  // throws outright or quietly starts caching assets on the host's origin.
  const ownsOrigin = !isEmbedded() && location.protocol.startsWith('http');
  if (import.meta.env.PROD && ownsOrigin && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

main().catch((err: unknown) => {
  console.error('[mcu] boot failed', err);
  bootError(err instanceof Error ? err.message : String(err));
});
