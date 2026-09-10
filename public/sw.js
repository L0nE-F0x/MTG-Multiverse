/*
 * App-shell service worker.
 *
 * Everything here is resolved against the worker's own directory rather than
 * the origin root, because the same file is registered from two places: the
 * public site at `https://mtg-multiverse.netlify.app/`, and the copy Filthy
 * Net Deck proxies at `https://filthy-net-deck.com/aetherfield/`. Relative
 * URLs in a worker script resolve against the script URL, so `./index.html`
 * is the right entry in both, and `SCOPE` below is `/` on one and
 * `/aetherfield/` on the other.
 *
 * That prefix is also the guard: a worker served from a subdirectory must
 * never answer for anything above it, or installing Aetherfield from the host
 * site would put its cache in front of the host's own pages.
 *
 * Hashed Vite assets are immutable and go cache-first; everything else
 * (including `data/`, so a new catalogue is picked up without a hard refresh)
 * is network-first.
 */

const VERSION = 'aetherfield-pwa-6';

/** Directory this worker was served from, with its trailing slash. */
const SCOPE = new URL('./', self.location.href).pathname;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './mark.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(SCOPE)) return;

  if (url.pathname.startsWith(`${SCOPE}assets/`)) {
    event.respondWith(cacheFirst(req));
    return;
  }
  event.respondWith(networkFirst(req));
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res.ok) {
    const copy = res.clone();
    void caches.open(VERSION).then((c) => c.put(req, copy));
  }
  return res;
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const copy = res.clone();
      void caches.open(VERSION).then((c) => c.put(req, copy));
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    throw new Error('offline');
  }
}
