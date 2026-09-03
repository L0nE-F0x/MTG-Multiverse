/**
 * Two-way sync between the URL and the store, so any view can be linked to.
 *
 * `?card=<scryfall-uuid>` opens that card, `?layout=<mode>` picks the
 * arrangement. Writes use replaceState so that flying around the galaxy does
 * not fill the browser's history with hundreds of entries.
 */
import { store, type LayoutMode } from './store.ts';
import type { Universe } from '../data/universe.ts';

const LAYOUTS: LayoutMode[] = ['galaxy', 'timeline', 'sets', 'colorwheel', 'sphere', 'price'];
const isLayout = (v: string | null): v is LayoutMode =>
  v !== null && (LAYOUTS as string[]).includes(v);

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

  let queued = 0;
  const write = (): void => {
    // Coalesce: selecting a card also moves the camera, and both can fire in
    // the same tick.
    if (queued) return;
    queued = window.setTimeout(() => {
      queued = 0;
      const next = new URLSearchParams();
      if (store.state.layout !== 'galaxy') next.set('layout', store.state.layout);
      if (store.state.selected >= 0) next.set('card', universe.uuid(store.state.selected));
      const qs = next.toString();
      const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
      window.history.replaceState(null, '', url);
    }, 250);
  };

  const offSelected = store.on('selected', write);
  const offLayout = store.on('layout', write);

  return () => {
    offSelected();
    offLayout();
    if (queued) clearTimeout(queued);
  };
}
