/**
 * Real fullscreen, for phones.
 *
 * An installed PWA in `display: standalone` still hands the system its strip
 * along the top — on Android that is the clock, the signal bars and the
 * battery, sitting over a galaxy. The manifest cannot fix that on its own:
 * `display: fullscreen` would also apply to the desktop install, where opening
 * an app maximised over everything is hostile rather than immersive, and
 * `display_override` is honoured by exactly the browsers that would do the
 * same. So the platform stays `standalone` and this asks for fullscreen at
 * runtime, where the request can be conditioned on the device it is running on
 * and revoked by the person using it.
 *
 * The request needs a user gesture, which is why `autoEnter` is wired to the
 * title screen's Enter button rather than to boot: that button is the one tap
 * every visit already makes.
 *
 * iOS is not covered and cannot be — Safari on iPhone has no element
 * fullscreen at all. What it has instead is `apple-mobile-web-app-status-bar-
 * style: black-translucent` in `index.html`, which puts the page *under* the
 * clock, and the `--mcu-safe-*` tokens in `base.css` that keep the chrome out
 * from under it.
 */

const KEY = 'aetherfield.fullscreen.v1';

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenEnabled?: boolean;
};

type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

/** Once per page load. A deliberate exit should not be undone by re-entering. */
let autoTried = false;

export function fullscreenSupported(): boolean {
  const d = document as FsDocument;
  return d.fullscreenEnabled === true || d.webkitFullscreenEnabled === true;
}

export function isFullscreen(): boolean {
  const d = document as FsDocument;
  return (d.fullscreenElement ?? d.webkitFullscreenElement ?? null) !== null;
}

/** Touch device, by the same test the rest of the UI uses for hit targets. */
function isCoarse(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

export function prefersFullscreen(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    // Unset means "on, if this is a phone". Someone who has never opened
    // Settings is exactly the person who wants the status bar gone.
    if (raw === null) return isCoarse();
    return raw === '1';
  } catch {
    return isCoarse();
  }
}

function remember(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* private window, or a host that blocks storage */
  }
}

export async function enterFullscreen(): Promise<void> {
  if (isFullscreen()) return;
  const el = document.documentElement as FsElement;
  try {
    // `navigationUI: 'hide'` is what drops Android's navigation bar as well as
    // the status bar. Unsupported values are ignored, not rejected.
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
  } catch {
    // No gesture, or the platform refused. Nothing here is load-bearing.
  }
}

export async function exitFullscreen(): Promise<void> {
  if (!isFullscreen()) return;
  const d = document as FsDocument;
  try {
    if (d.exitFullscreen) await d.exitFullscreen();
    else if (d.webkitExitFullscreen) await d.webkitExitFullscreen();
  } catch {
    /* already gone */
  }
}

/** Settings checkbox. Records the choice as well as acting on it. */
export async function setFullscreen(on: boolean): Promise<void> {
  remember(on);
  if (on) await enterFullscreen();
  else await exitFullscreen();
}

/**
 * Take fullscreen on the way in from the title screen, if this is a touch
 * device and nobody has turned it off. Called from the Enter button's own
 * click handler so the gesture is still live.
 */
export function autoEnterFullscreen(): void {
  if (autoTried) return;
  autoTried = true;
  if (!isCoarse() || !fullscreenSupported() || !prefersFullscreen()) return;
  void enterFullscreen();
}

/** Subscribe to entering/leaving, including via the system's own gesture. */
export function onFullscreenChange(fn: () => void): () => void {
  document.addEventListener('fullscreenchange', fn);
  document.addEventListener('webkitfullscreenchange', fn);
  return () => {
    document.removeEventListener('fullscreenchange', fn);
    document.removeEventListener('webkitfullscreenchange', fn);
  };
}
