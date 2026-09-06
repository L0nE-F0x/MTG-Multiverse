/**
 * Two-way sync between the URL and the store, so any view can be linked to.
 *
 * `?card=<scryfall-uuid>` opens that card, `?layout=<mode>` picks the
 * arrangement, `?set=<code>` filters to one set, `?cards=` isolates a deck
 * (and lights it), and `?shell=play` skips the title screen. Writes use
 * replaceState so that flying around the galaxy does not fill the browser's
 * history with hundreds of entries.
 *
 * Everything the reader understands, the writer emits again. That is not
 * tidiness: a parameter the writer forgets is a parameter that survives only
 * until the first click, which is how `?cards=` used to lose the deck it was
 * opened with.
 */
import { store, type LayoutMode, type ShellMode } from './store.ts';
import type { Universe } from '../data/universe.ts';

const LAYOUTS: LayoutMode[] = ['galaxy', 'timeline', 'sets', 'colorwheel', 'sphere', 'price'];
const isLayout = (v: string | null): v is LayoutMode =>
  v !== null && (LAYOUTS as string[]).includes(v);

const isShell = (v: string | null): v is ShellMode => v === 'title' || v === 'play';

/** True when a host (or ?shell=play) asked us not to run the cinematic intro. */
export let skipCinematic = false;

/**
 * The raw, still-encoded value of a query parameter.
 *
 * `URLSearchParams.get` decodes, and for `cards=` that is lossy: a tenth of all
 * card names contain a comma (every "Narset, Parter of Veils"), so once the
 * separators and the commas inside names are both bare commas there is no way
 * to tell them apart. Reading the raw value lets each token be decoded on its
 * own, with `%2C` staying inside the name it belongs to.
 */
function rawParam(search: string, key: string): string | null {
  for (const pair of search.replace(/^\?/, '').split('&')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    if (pair.slice(0, eq) === key) return pair.slice(eq + 1);
  }
  return null;
}

/** Percent-decoding that yields null instead of throwing on a malformed token. */
function decodeToken(raw: string): string | null {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' ')).trim();
  } catch {
    // One bad `%` sequence in a shared link should cost that card, not the
    // whole boot — this throw used to propagate out into main()'s catch and
    // put up the error screen.
    return null;
  }
}

/**
 * Oracle ids named by a `cards=` value: a comma-separated list of
 * percent-encoded card names or Scryfall uuids.
 *
 * Tokens that do not resolve are re-split on any commas they contain, which is
 * what makes links from before per-token encoding still work: those arrive as
 * one token holding the entire list.
 */
function parseCards(universe: Universe, raw: string): Set<number> {
  const oracles = new Set<number>();

  const take = (token: string): boolean => {
    if (!token) return false;
    const i = universe.indexOfUuid(token);
    if (i >= 0) {
      oracles.add(universe.col.oracleIdx[i]!);
      return true;
    }
    const named = universe.oraclesNamed(token);
    for (const o of named) oracles.add(o);
    return named.length > 0;
  };

  for (const part of raw.split(',')) {
    const token = decodeToken(part);
    if (token === null) continue;
    if (take(token)) continue;
    if (!token.includes(',')) continue;
    for (const legacy of token.split(',')) take(legacy.trim());
  }
  return oracles;
}

/** A `cards=` value for the oracle ids currently highlighted. */
function formatCards(universe: Universe, oracles: Set<number>): string {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const o of oracles) {
    const name = universe.nameOfOracle(o);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(encodeURIComponent(name));
  }
  return names.join(',');
}

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
  skipCinematic = pinShell && params.get('shell') === 'play';

  const setCode = params.get('set');
  if (setCode) {
    const idx = universe.indexOfSetCode(setCode);
    if (idx >= 0) {
      store.patchFilter({ sets: new Set([idx]) });
      if (!isLayout(layout)) store.set('layout', 'sets');
    } else console.warn(`[mcu] no set matches ?set=${setCode}`);
  }

  // A deck link isolates those cards *and* lights them. Highlight-in-place
  // alone is unreadable: additive blending of 117k dimmed points still paints
  // a full galaxy, so a hundred-card list vanishes into the haze. Filtering
  // is what made "Show this deck in the galaxy" work before the audit; the
  // host's `highlight` message stays a separate overlay (collection, not a
  // deck) and never writes `filter.oracles`.
  const cardsRaw = rawParam(window.location.search, 'cards');
  if (cardsRaw) {
    const oracles = parseCards(universe, cardsRaw);
    if (oracles.size > 0) {
      store.patchFilter({ oracles: new Set(oracles) });
      store.set('highlightOracles', new Set(oracles));
    } else console.warn('[mcu] no cards matched ?cards=');
  }

  let queued = 0;
  const write = (): void => {
    // Coalesce: selecting a card also moves the camera, and both can fire in
    // the same tick.
    if (queued) return;
    queued = window.setTimeout(() => {
      queued = 0;
      const next = new URLSearchParams();
      if (pinShell) next.set('shell', store.state.shell);
      if (store.state.selected >= 0) next.set('card', universe.uuid(store.state.selected));

      let setCode = '';
      if (store.state.filter.sets.size === 1) {
        const idx = [...store.state.filter.sets][0]!;
        setCode = universe.meta.sets[idx]?.code ?? '';
        if (setCode) next.set('set', setCode);
      }

      // `galaxy` is the default and normally left out to keep the URL clean,
      // but the reader switches to `sets` for a bare `?set=`, so alongside one
      // it has to be written or reloading the link changes the layout.
      const mode = store.state.layout;
      if (mode !== 'galaxy' || setCode) next.set('layout', mode);

      // Only the isolation filter is URL-backed. A host collection overlay
      // lives in `highlightOracles` alone and must not rewrite `?cards=` into
      // every card this machine has ever played.
      const cards = formatCards(universe, store.state.filter.oracles);
      const qs = cards ? appendRaw(next.toString(), 'cards', cards) : next.toString();
      const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
      window.history.replaceState(null, '', url);
    }, 250);
  };

  const offSelected = store.on('selected', write);
  const offLayout = store.on('layout', write);
  const offFilter = store.on('filter', write);
  // Only meaningful while the shell is pinned, but subscribing unconditionally
  // is cheaper than branching and the writer already ignores it otherwise.
  const offShell = store.on('shell', write);

  return () => {
    offSelected();
    offLayout();
    offFilter();
    offShell();
    if (queued) clearTimeout(queued);
  };
}

/**
 * Appends an already-encoded value, which `URLSearchParams.toString()` cannot
 * do: it would re-encode the `%` of every `%2C` and the separators along with
 * them, undoing exactly the distinction `parseCards` needs.
 */
function appendRaw(qs: string, key: string, value: string): string {
  return qs ? `${qs}&${key}=${value}` : `${key}=${value}`;
}
