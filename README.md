# Magic Card Universe

Every Magic: The Gathering card ever printed — 117,621 of them — rendered as a
galaxy you can fly through.

Nothing about the layout is decorative. A card's position *is* its data:

| Axis | Means |
| --- | --- |
| Spiral arm (angle) | Colour identity — the five arms are literally the colour pie, in WUBRG order |
| Radius | Release date — Alpha in the core, this year's set at the rim |
| Off-plane layer | Number of colours, so guilds and wedges don't hide inside the mono arms |
| Star size & brightness | Popularity (EDHREC rank), weighted by rarity — Black Lotus is a supergiant |
| Star colour | Blended colour identity; gold mixed in with colour count |
| Halo | Colourless artifacts, which belong to no arm |

Fly in close and the actual card art materialises around you; at middle
distances the most-played cards label themselves, so the landmarks announce
what you are looking at. Hover any star for its name, click it to open the card,
and the URL updates so the view is shareable.

**Controls.** Drag to orbit, right/middle/shift-drag to pan, scroll to zoom.
`WASD` or the arrow keys fly, `Q`/`E` rise and fall, `Shift` moves faster.
`/` or `Ctrl+K` searches, `R` jumps to a random notable card, `F` reframes,
`Esc` closes the card panel.

The volumetric nebula is generated from the *same* spiral function the stars are
placed with, so the gas genuinely follows the arms and is tinted by whichever
colour's arm it is sitting in.

## Running it

```bash
npm install
npm run data:fetch     # ~78 MB from Scryfall's bulk API (skips if current)
npm run data:build     # streams it into public/data/{universe.bin,universe-meta.json}
npm run dev            # http://127.0.0.1:5173
```

`npm run data:build` takes about a minute and produces a 5.8 MB binary plus a
971 KB metadata file. It keeps everything Scryfall lists as a distinct printing,
including cards with no English printing at all (Foreign Black Border,
Rinascimento, Salvat, the Japanese Mystical Archive) under their printed names,
and Secret Lair art cards. Card images are not stored — they are reconstructed from
each card's UUID against Scryfall's CDN and fetched on demand.

Other commands:

```bash
npm run build                       # typecheck + production bundle
node tools/verify-universe.ts       # asserts the generated data is sane
node tools/screenshot.mjs --out shot.png   # headless capture, for iterating on visuals
npm run test:interaction            # drives real mouse/keyboard against the dev server
npm run og                          # regenerate the social preview image
node tools/bench.mjs                # frame-rate benchmark across representative views
```

`npm run dev` must be running for the last two.

## Layouts

Six arrangements, morphed between on the GPU rather than cut:

- **Galaxy** — the default described above.
- **Timeline** — concentric tree rings, one per year; angle is release order within the year, height is mana value.
- **Sets** — every set as its own globular cluster, sized by card count.
- **Colour wheel** — identities at the centroid of their member colours.
- **Sphere** — concentric rarity shells.
- **Price** — a value mountain: radius is price *rank* and height is price, so the summit is the most expensive cards in Magic and the long cheap tail is the plain.

## Architecture

```
src/
  data/format.ts     wire format shared by the pipeline and the browser
  data/universe.ts   loader, filter engine (112k-element hot loop), name search
  core/store.ts      the only seam between UI and renderer
  core/App.ts        renderer setup, frame loop, event wiring
  core/CameraRig.ts  damped orbit rig with inertia
  layout/            the six position generators + the star palette
  render/            starfield, nebula, GPU picker, post chain, noise volume
  shaders/           GLSL, with a shared lib/common.glsl
  core/urlState.ts   ?card= / ?layout= deep links, both directions
  render/CardBillboards.ts  real card art, drawn at the stars when you get close
  render/StarLabels.ts      names for the most-played cards currently in view
  render/CoreGlow.ts        the galactic nucleus
  ui/                overlays; imports the store and nothing else
tools/               offline pipeline + capture harness (Node, run directly)
```

Two rules keep it decoupled:

1. **The UI never imports `three` or `src/render/**`.** It reads and writes
   `src/core/store.ts`; the renderer subscribes to the same store.
2. **The pipeline emits attributes, never positions.** Positions are derived in
   the browser, which is what makes six simultaneous layouts and morphing
   between them possible.

## Performance notes

The whole star field is one draw call. Two position attributes are always
resident and a uniform lerps between them, so a layout change costs one buffer
upload and nothing per frame; filtering uses the same trick with two visibility
attributes so stars crossfade instead of popping.

The nebula raymarch is the most expensive thing in the frame, so it renders at
half resolution into its own target and is composited behind the stars — volume
detail survives a downscale far better than geometry would. Its noise is a
pre-baked 64³ tileable volume rather than analytic FBM, because trilinear
filtering is free and four analytic octaves per step at up to 96 steps is not.

Picking is done on the GPU: the same geometry is redrawn with each index encoded
as a colour, scissored to the single pixel under the cursor, and read back
asynchronously so the main thread never stalls. The pick pass writes
disc-relative depth rather than camera depth, so the star nearest the cursor
wins rather than the one nearest the eye.

Quality adapts automatically over a six-level ladder — the nebula is turned down
first, and only at its floor does the main render resolution drop, because that
hurts the stars. It descends proportionally to how far below target the frame
rate is, so flying into the dense core recovers in a second or two rather than
twenty. `tools/bench.mjs` measures the result; run it against a static
`vite preview` build rather than the dev server, since hot reloads invalidate a
run mid-flight.

## Data

Card data is from [Scryfall](https://scryfall.com)'s bulk API. Card images are
served from Scryfall's CDN and are © Wizards of the Coast; this project stores
neither. Magic: The Gathering is a trademark of Wizards of the Coast, which has
nothing to do with this project.
