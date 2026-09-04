/**
 * Running inside another application's webview.
 *
 * Filthy Net Deck ships this site as a static folder and shows it in a
 * same-origin `<iframe>`. Everything in this module is what differs in that
 * context; detection is `window.top !== window.self`, so an ordinary browser
 * visit installs none of it and pays nothing.
 *
 * Only two things actually break when framed inside a Tauri webview:
 *
 *  - **`target="_blank"` goes nowhere.** There is no browser chrome to open a
 *    tab in, and Tauri will not hand the URL to the OS by itself, so the
 *    Scryfall link on the card panel is simply dead — no error, no navigation.
 *    Outbound links are forwarded to the host, which has an opener plugin.
 *  - **The host cannot tell "still compiling shaders" from "the bundle is
 *    missing".** An iframe's `load` event fires for a 404 page too, and the
 *    document is opaque to the host if it ever stops being same-origin. An
 *    explicit ready ping is the only honest signal, which is why the host
 *    waits for one rather than for `load`.
 *
 * The message shape is the contract with the host. Every message carries
 * `source`, because an iframe receives *everything* its parent broadcasts on
 * this channel and the host window is not the only thing that can talk on it.
 */

/** Discriminator on every message, in both directions. */
export const EMBED_CHANNEL = 'aetherfield';

export type HostMessage =
  /** Booted, first frame rendered, `cards` stars charted. */
  | { type: 'ready'; cards: number }
  /** Boot failed; the host should show its own fallback. */
  | { type: 'error'; message: string }
  /** Open this in the system browser — see the note on `target="_blank"`. */
  | { type: 'open-external'; url: string };

/** What the host actually receives. Tagged so it can ignore other traffic. */
export type ChannelMessage = HostMessage & { source: typeof EMBED_CHANNEL };

let framed: boolean | null = null;

export function isEmbedded(): boolean {
  if (framed !== null) return framed;
  try {
    framed = window.top !== window.self;
  } catch {
    // A cross-origin parent throws on access. Throwing at all means framed.
    framed = true;
  }
  return framed;
}

/**
 * Tell the host something. A no-op outside a frame, so callers do not have to
 * branch.
 *
 * The target origin is `'*'`: the host serves this folder and is same-origin
 * in the shipped build, but keeping it loose means the site still embeds from
 * a dev server on another port, and nothing sent here is private.
 */
export function notifyHost(message: HostMessage): void {
  if (!isEmbedded()) return;
  try {
    window.parent.postMessage({ source: EMBED_CHANNEL, ...message }, '*');
  } catch {
    /* The host went away mid-flight. Nothing useful to do about it. */
  }
}

/**
 * Hand outbound links to the host. Returns a disposer.
 *
 * Capture phase on purpose: this has to win before the browser's default
 * navigation, and before any component that might stop propagation on its own
 * anchors. Modified clicks are left alone — they mean "open somewhere else" to
 * the person clicking, and the host is the one that decides what that means.
 */
export function connectEmbed(): () => void {
  if (!isEmbedded()) return () => {};

  const onClick = (event: MouseEvent): void => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement)) return;

    // `anchor.href` is already resolved to absolute by the DOM.
    let url: URL;
    try {
      url = new URL(anchor.href);
    } catch {
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    // In-document navigation stays in the frame; only leaving does not work.
    if (url.origin === window.location.origin) return;

    event.preventDefault();
    notifyHost({ type: 'open-external', url: url.href });
  };

  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
}
