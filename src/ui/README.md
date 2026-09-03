# UI layer

Plain TypeScript + DOM, no framework. The only channel to the rest of the
app is `src/core/store.ts` (read `store.state`, subscribe with `store.on` /
`store.onAny`, mutate with `store.set`, `store.patchFilter`,
`store.patchVisual`) plus the read-only accessors on the `Universe` instance
passed into `mountUI`. Nothing here imports `three` or `src/render/**`.

## Entry point

### `index.ts`
Exports `mountUI(root, universe): UIHandles`. Adds the `mcu-root` class to
`root` (styled `position:fixed; inset:0; pointer-events:none` in
`styles/base.css`, with interactive children re-enabling pointer events),
mounts every component below, and wires `UIHandles.setHoverAnchor` straight
through to the tooltip module. `destroy()` tears everything down in one
call. Reads/writes: none directly — it only composes the other modules.

## Components

### `loading.ts` — `mountLoading(root)`
Full-screen boot-sequence overlay.
- Reads: `loadProgress`, `loadLabel`, `ready`.
- Writes: none.
- Fades out and unmounts itself once `ready` becomes `true` (or immediately
  if it was already `true` at mount time).

### `hud.ts` — `mountHud(root, universe)`
Top-left wordmark + live match count, and the bottom-centre layout-mode
segmented control.
- Reads: `matchCount`, `layout`.
- Writes: `layout` (via `store.set('layout', mode)` on click).
- `universe.count` supplies the fixed "of N stars" denominator.

### `search.ts` — `mountSearch(root, universe)`
Top-centre search box with a keyboard-navigable results dropdown.
- Reads: `results` (to render the dropdown).
- Writes: `results` (`store.set`, from `universe.search(q, 40)`),
  `filter.query` (`store.patchFilter`), `selected` (`store.set`, on
  choosing a result).
- Debounces input 120ms. `/` or Ctrl+K focuses the box from anywhere
  (skipped while another field has focus). ArrowUp/ArrowDown moves the
  active row, Enter selects it, Escape clears the query and closes the
  dropdown. Closes on outside click.

### `filters.ts` — `mountFilters(root, universe)`
Collapsible left-edge panel. Every control reads `store.state.filter` to
paint itself and writes back through `store.patchFilter`; "Reset filters"
replaces the whole object with `store.set('filter', defaultFilter())`.
- Reads/writes `filter.colors`, `filter.colorMatch`, `filter.includeColorless`
  (colour pips + colourless toggle + Any/Exact/Subset segmented control),
  `filter.types` (10 type toggles), `filter.rarities` (toggles built from
  `universe.meta.rarities`, indices into that array), `filter.formats` (7
  format toggles), `filter.years` (dual slider, bounds `1993` to
  `releaseDayToYear(universe.meta.stats.maxReleaseDay)`), `filter.cmc`
  (dual slider, 0..30 where 30 displays "30+"), `filter.sets` (searchable
  multi-select over `universe.meta.sets`, indices into that array),
  `filter.hideReprints`, `filter.hideDigital`, `filter.hideTokens`
  (checkboxes).
- Below 900px width the panel becomes a slide-over drawer (closed by
  default, opened via the `FILTERS` edge tab or the in-panel `«` button).

### `rangeSlider.ts` — `createDualRangeSlider(opts)`
Standalone dual-handle range slider (two overlaid `<input type=range>` +
a filled track) used by the year and mana-value controls in `filters.ts`.
Not store-aware; takes `value`/`onChange` like a controlled component.

### `cardPanel.ts` — `mountCardPanel(root, universe)`
Right-edge card detail panel, open whenever `selected >= 0`.
- Reads: `selected`.
- Writes: `selected` (`store.set(-1)` on close/Escape, or to another
  printing's index when a printing chip is clicked).
- Renders name, set + year, colour-coded rarity, artist, colour identity
  pips, USD price (`universe.col.price[i]`, only if non-zero), format
  legality badges (derived from `universe.col.formatMask[i]` against every
  `FORMAT_BIT`), the "every printing" chip strip
  (`universe.printingsOf(i)`), and a Scryfall link (`universe.scryfallPage(i)`,
  `target="_blank" rel="noopener noreferrer"`).
- Card image: `universe.image(i, 'normal')`, lazy-loaded with a shimmer
  placeholder, a text fallback on `error`, a 3D tilt-on-mousemove effect,
  and a radial glow tinted by colour identity.
- On open, lazily fetches `https://api.scryfall.com/cards/<uuid>` for
  `type_line` / `mana_cost` / `oracle_text` / `flavor_text`. Responses are
  cached in a module-level `Map<uuid, ScryfallCard | null>`; the in-flight
  request is aborted (`AbortController`) if the selection changes before it
  resolves. Failures are swallowed — the richer fields are simply omitted.

### `tooltip.ts` — `mountTooltip(root, universe)`
Small hover tooltip (card name + set chip).
- Reads: `hovered` (visibility + content).
- Writes: none.
- `setAnchor(p)` (returned on the handle, wired to `UIHandles.setHoverAnchor`
  in `index.ts`) just stores the latest screen-space point; a `rAF` loop
  applies it via `transform: translate3d(...)` so a 60Hz anchor stream never
  touches layout. Works correctly if the renderer never calls it at all —
  the tooltip simply never becomes visible unless `hovered >= 0` too.

### `settings.ts` — `mountSettings(root)`
Collapsible top-right visual settings panel.
- Reads/writes `visual.bloom`, `visual.exposure`, `visual.starSize`,
  `visual.nebula`, `visual.dimFiltered` (sliders), `visual.showNebula`,
  `visual.showLabels`, `visual.showGrid`, `visual.motionBlur`,
  `visual.autoRotate` (checkboxes) — all via `store.patchVisual`.
- Reads: `stats` (fps + visible/total) for the telemetry readout at the
  bottom of the panel. Writes: none for telemetry.

## Shared helpers

### `dom.ts`
`el()` (typed element builder — the tag literal drives the return type, so
`el('input', …)` already comes back as `HTMLInputElement`), `debounce()`,
`clamp()`, `fmtInt()`, `capitalize()`, `listen()` (an `addEventListener`
that returns its own cleanup function). No store access.

### `theme.ts`
`MANA_COLOR_HEX` (the five WUBRG colours) and `RARITY_COLOR_HEX` /
`rarityColor()`, shared by `search.ts`, `filters.ts` and `cardPanel.ts` so
the palette is defined exactly once.

## Styles (`src/styles/*.css`)

One file per component, each imported directly by its module
(`import '../styles/x.css'`):

- `base.css` — tokens (`--mcu-*` custom properties), the `.mcu-root`
  click-through layer, shared panel/chip/pip/segmented-control chrome, the
  corner-bracket motif, `prefers-reduced-motion` handling.
- `loading.css`, `hud.css`, `search.css`, `filters.css`, `cardPanel.css`,
  `tooltip.css`, `settings.css` — one per component above.

Panels that are both fixed-and-centred *and* CSS-animated (the search bar,
the layout switcher) use the CSS `translate` property for centring and
reserve `transform` for the entrance keyframe, so the two don't clobber
each other (they compose independently, unlike two uses of `transform`).
