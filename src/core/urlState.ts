/**
 * Two-way sync between the URL and the store, so any view can be linked to.
 *
 * `?card=<scryfall-uuid>` opens that card, `?layout=<mode>` picks the
 * arrangement, and `?shell=play` skips the title screen. Writes use
 * replaceState so that flying around the galaxy does not fill the browser's
 * history with hundreds of entries.
 */
import { store, type LayoutMode, type ShellMode } from './store.ts';
import type { Universe } from '../data/universe.ts';

const LAYOUTS: LayoutMode[] = ['galaxy', 'timeline', 'sets', 'colorwheel', 'sphere', 'price'];
const isLayout = (v: string | null): v is LayoutMode =>
  v !== null && (LAYOUTS as string[]).includes(v);

const isShell = (v: string | null): v is ShellMode => v === 'title' || v === 'play';

export function connectUrlState(universe: Universe): () => void {
  const params = new URLSearchParams(window.location.search);

  const layout = params.get('layout');
  if (isLayout(layout)) store.set('layout', layout);

  const card = params.get('card');
  if (card) {
    const index = universe.indexOfUuid(card);
    if (index >= 0) store.set('selected', index);
    else console.warn(`[mcu] no card matches ?card=${card}`);
  }

  // A host that launches straight into the galaxy has already asked its own
  // "do you want this?" question with the button that opened us — a second
  // title screen is just a door to walk through twice. The parameter is only
  // echoed back into the URL when it was supplied, so the public site keeps a
  // clean `/?layout=…` and still opens on the title as it should.
  const pinShell = isShell(params.get('shell'));
  if (pinShell) store.set('shell', params.get('shell') as ShellMode);

  let queued = 0;
  const write = (): void => {
    // Coalesce: selecting a card also moves the camera, and both can fire in
    // the same tick.
    if (queued) return;
    queued = window.setTimeout(() => {
      queued = 0;
      const next = new URLSearchParams();
      if (pinShell) next.set('shell', store.state.shell);
      if (store.state.layout !== 'galaxy') next.set('layout', store.state.layout);
      if (store.state.selected >= 0) next.set('card', universe.uuid(store.state.selected));
      const qs = next.toString();
      const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
      window.history.replaceState(null, '', url);
    }, 250);
  };

  const offSelected = store.on('selected', write);
  const offLayout = store.on('layout', write);
  // Only meaningful while the shell is pinned, but subscribing unconditionally
  // is cheaper than branching and the writer already ignores it otherwise.
  const offShell = store.on('shell', write);

  return () => {
    offSelected();
    offLayout();
    offShell();
    if (queued) clearTimeout(queued);
  };
}
