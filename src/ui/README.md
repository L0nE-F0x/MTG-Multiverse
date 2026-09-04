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

### `title.ts` — `mountTitle(root, universe, host)`
Cinematic title screen shown after boot on **every** visit, and again from
the HUD wordmark. The galaxy keeps turning behind a vignette (not a frosted
wall). Three actions: Enter the Multiverse, Instructions, Settings. A tiny
Wizards-of-the-Coast disclaimer sits at the bottom.
- Reads: `shell`, `visual.autoRotate`.
- Writes: `shell` (`title` / `play`), `visual.autoRotate` (on while the
  title is up, restored on enter).
- `host.toggleSettings` / `closeSettings` / `settingsOpen` are callbacks
  into `settings.ts` so the landing Settings button can open the existing
  panel without importing it.
- Instructions is the previous intro content, now a separate overlay with
  a Back button. The HUD "?" opens that overlay without leaving play.
- Returns `{ open(), enter(), openHelp(), destroy() }`. `index.ts` also
  exposes `enter` / `openTitle` / `openHelp` on `UIHandles` so the capture
  harness can dismiss the title (`window.__mcu.ui.enter()`).

### `hud.ts` — `mountHud(root, universe, hooks)`
Top-left wordmark + live match count, a small "?" About control next to the
wordmark, and the bottom-centre layout-mode segmented control.
- Reads: `matchCount`, `layout`.
- Writes: `layout` (via `store.set('layout', mode)` on click).
- `universe.count` supplies the fixed "of N stars" denominator.
- `hooks.onHome` is the wordmark click (return to the title screen);
  `hooks.onHelp` is the "?" control (instructions overlay).
- The layout buttons carry `aria-pressed` reflecting `store.state.layout`;
  the match-count line has `aria-live="polite"` so screen readers announce
  it as filters narrow the result. Below 900px the segmented control is
  `flex: 1 1 0` per button (not `flex-wrap`, which just let each button
  re-expand to its unwrapped width and forced the row onto two lines) so it
  compresses — wrapping its own label text — to stay on one row at
  phone widths while still hitting the 44px touch-target height.

### `search.ts` — `mountSearch(root, universe)`
Top-centre search box with a keyboard-navigable results dropdown.
- Reads: `results` (to render the dropdown).
- Writes: `results` (`store.set`, from `universe.search(q, 40)`),
  `filter.query` (`store.patchFilter`), `selected` (`store.set`, on
  choosing a result).
- Debounces input 120ms. `/` or Ctrl+K still focuses the box (skipped
  while another field has focus, and while `store.state.shell` is
  `title`) but the placeholder no longer advertises the shortcut. The
  field sits top-right, left of Settings, and expands on focus. ArrowUp/ArrowDown moves the
  active row, Enter selects it, Escape clears the query and closes the
  dropdown. Closes on outside click.
- The input is a `role="combobox"` wired to the results list
  (`role="listbox"`) via `aria-controls`/`aria-expanded`, with
  `aria-activedescendant` following the arrow-key-active row and each row
  carrying `aria-selected` — the standard listbox-with-virtual-focus
  pattern, since focus itself stays in the input rather than moving to
  each row. Below 900px the field stretches under the command bar; the
  input is 16px so iOS Safari does not auto-zoom on focus.

### `filters.ts` — `mountFilters(root, universe)`
Collapsible left-edge panel. Every control reads `store.state.filter` to
paint itself and writes back through `store.patchFilter`; "Reset filters"
replaces the whole object with `store.set('filter', defaultFilter())`.
- Hover tips (`data-tip` + a floating tooltip on `mcu-root`) explain every
  control. Colourless is off by default and disabled until a colour pip
  is selected — with no colours selected the flag is a no-op and the
  engine already shows colourless cards.
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
- Below 900px width the panel becomes a floating drawer — inset from the
  top chrome (command bar + search) and the bottom layout switcher rather
  than flush with the viewport edges, so it never renders underneath either
  (they sit at a higher z-index and would otherwise clip it) — closed by
  default, opened via the `FILTERS` edge tab or the in-panel `«` button.
  Every colour pip, chip, segmented button and set row carries
  `aria-pressed`/`aria-selected` reflecting `store.state.filter`; the set
  rows are real `<button>`s (styled to look like the original `<div>` grid)
  so the set picker is keyboard-reachable.

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
- The printing strip shows each chip as set code + year and is capped at
  `PRINTINGS_CAP` (16) chips for cards with a long print history (Lightning
  Bolt-class staples run 50+), with a "+N more" chip that swaps in the full
  list on click. The current printing is always kept in the visible window
  even if its chronological position falls outside the cap, and is marked
  with `aria-current`, a dot marker and the gradient fill otherwise used for
  "active" chips elsewhere. The heading shows the live total (`fmtInt`).
- Card image: `universe.image(i, 'normal')`, lazy-loaded with a shimmer
  placeholder, a text fallback on `error`, a 3D tilt-on-mousemove effect,
  and a radial glow tinted by colour identity.
- On open, lazily fetches `https://api.scryfall.com/cards/<uuid>` for
  `type_line` / `mana_cost` / `oracle_text` / `flavor_text`. Responses are
  cached in a module-level `Map<uuid, ScryfallCard | null>`; the in-flight
  request is aborted (`AbortController`) if the selection changes before it
  resolves. Failures are swallowed — the richer fields are simply omitted.

### `tooltip.ts` — `mountTooltip(root, universe)`
Hover tooltip: a colour-coded rarity badge, card name, set code, year and
mana value (`universe.col.cmc[i]`, shown as `MV n`, or `—` for the 255
"no mana value" sentinel — lands etc.).
- Reads: `hovered` (visibility + content).
- Writes: none.
- `setAnchor(p)` (returned on the handle, wired to `UIHandles.setHoverAnchor`
  in `index.ts`) just stores the latest screen-space point; a `rAF` loop
  applies it via `transform: translate3d(...)` so a 60Hz anchor stream never
  touches layout. Content (`paint()`) only re-renders on `hovered` index
  changes, not per frame, so the richer field set costs nothing extra on the
  anchor's hot path. Works correctly if the renderer never calls
  `setAnchor` at all — the tooltip simply never becomes visible unless
  `hovered >= 0` too.

### `settings.ts` — `mountSettings(root)`
Collapsible top-right visual settings panel.
- Reads/writes `visual.bloom`, `visual.exposure`, `visual.starSize`,
  `visual.nebula`, `visual.dimFiltered` (sliders), `visual.showNebula`,
  `visual.showLabels`, `visual.motionBlur`, `visual.autoRotate`
  (checkboxes) — all via `store.patchVisual`. Auto-rotate defaults on.
  There is no Grid toggle: `showGrid` was store-only and never drawn.
- Reads: `stats` (fps + visible/total) for the telemetry readout at the
  bottom of the panel. Writes: none for telemetry.
- The `SETTINGS` toggle carries `aria-expanded`/`aria-controls` reflecting
  the panel's open state. The handle also exposes `open()` / `close()` /
  `toggle()` / `isOpen()` so the title screen can open the same panel.
  Below 900px width the panel is inset from the top/bottom chrome the same
  way the filters and card-panel drawers are (see their notes above)
  instead of the old `top:66px` that let it render underneath the search bar.

## Shared helpers

### `dom.ts`
`el()` (typed element builder — the tag literal drives the return type, so
`el('input', …)` already comes back as `HTMLInputElement`), `debounce()`,
`clamp()`, `fmtInt()`, `capitalize()`, `listen()` (an `addEventListener`
that returns its own cleanup function). No store access.

### `brand.ts`
`BRAND`, `BRAND_WORDMARK`, `BRAND_TAGLINE` and `DISCLAIMER` — the
user-facing name, used by the title screen, HUD and (via copy) the HTML
boot overlay.

### `theme.ts`
`MANA_COLOR_HEX` (the five WUBRG colours) and `RARITY_COLOR_HEX` /
`rarityColor()`, shared by `search.ts`, `filters.ts`, `cardPanel.ts` and
`tooltip.ts` so the palette is defined exactly once.

## Styles (`src/styles/*.css`)

One file per component, each imported directly by its module
(`import '../styles/x.css'`):

- `base.css` — tokens (`--mcu-*` custom properties), the `.mcu-root`
  click-through layer, shared panel/chip/pip/segmented-control chrome, the
  corner-bracket motif, `prefers-reduced-motion` handling, a shared
  `:focus-visible` treatment (cyan outline + soft glow — components with
  their own richer focus style, like the search input's border/box-shadow,
  define their own `:focus-visible` rule alongside it instead of using this
  one), and a `max-width: 900px` pass that grows shared chip/segmented/
  checkbox chrome to a real `--mcu-touch` (44px) hit area on phone-width
  viewports.
- `title.css`, `intro.css` (the instructions overlay), `hud.css`,
  `search.css`, `filters.css`, `cardPanel.css`, `tooltip.css`,
  `settings.css` — one per component above. The HTML `#boot` overlay in
  `index.html` is the loading screen; it is not a UI-layer module.
  Each component-specific `max-width: 900px` block handles its own
  touch-target sizing beyond the shared chrome, and — for the filters
  panel, card panel and settings panel — insets the drawer from the fixed
  top chrome (command bar + search) and bottom layout switcher instead of
  the old flush `top:0; bottom:0`, which rendered underneath both (they sit
  at a higher z-index) and clipped the drawer's header and footer.
- `--mcu-text-faint` is `#7c88a3`, not the visually-similar `#5a6379` it
  used to be: that value read at ~3.2:1 against `--mcu-panel-bg`, under the
  4.5:1 WCAG AA floor for the small text it's mostly used for (set names,
  years, hints). The new value reads ~5.5:1 while staying visibly dimmer
  than `--mcu-text-dim`.

Panels that are both fixed-and-centred *and* CSS-animated (the search bar,
the layout switcher) use the CSS `translate` property for centring and
reserve `transform` for the entrance keyframe, so the two don't clobber
each other (they compose independently, unlike two uses of `transform`).
