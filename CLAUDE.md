# Aetherfield — working notes

A WebGL visualisation of all 117,621 printed Magic cards as an explorable
galaxy. See `README.md` for what it is and how to run it.

**Live todo is `handoff.md`.** Read that first on a new session.

## Commands

```bash
npm run dev                          # vite dev server on 127.0.0.1:5173
npm run build                        # tsc --noEmit + vite build
npx tsc --noEmit                     # app typecheck (src/ only)
npx tsc -p tsconfig.tools.json --noEmit   # tools typecheck (Node types)
npm run data:fetch && npm run data:build  # regenerate public/data/
node tools/verify-universe.ts        # assert generated data is sane
node tools/screenshot.mjs --out /tmp/shot.png [--eval "js"]   # headless capture
```

Node 26 runs `.ts` directly, so everything in `tools/` is executed with plain
`node`. Native type stripping does **not** support `enum`, namespaces, or
constructor parameter properties — use `const` objects and `type` aliases there.

## Architectural rules

These are the two invariants that keep the codebase workable. Breaking either
one is how this turns into a tangle:

1. **`src/ui/**` must not import `three` or anything in `src/render/**`.** The
   only channel between the UI and the renderer is `src/core/store.ts`. The UI
   mutates state, the renderer subscribes.
2. **The offline pipeline emits attributes, never positions.** Positions are
   derived in the browser in `src/layout/`. That is what allows six layouts to
   coexist and morph between each other; baking positions offline would kill it.

`src/data/format.ts` is the wire contract shared by `tools/build-universe.ts`
and the browser. Changing a column means bumping `UNIVERSE_FORMAT_VERSION` and
re-running `data:build` — the loader refuses a mismatched version on purpose.

## Things that will bite you

- **Custom GLSL3 shaders need their own fragment output.** three injects
  `gl_FragColor` for GLSL1 but not for a `glslVersion: THREE.GLSL3`
  ShaderMaterial. Declare `layout(location = 0) out vec4 fragColor;` yourself.
  `varying` and `texture()` do work — only the output is missing.
- **`gl_PointSize` is in framebuffer pixels, not CSS pixels.** The starfield's
  `uSizeScale` is computed from `cssHeight * devicePixelRatio`; the picker runs
  at CSS resolution and deliberately keeps its own scale. Sharing one uniform
  between them makes pick targets wrong by a factor of dpr.
- **The spiral twist constant is duplicated.** `ARM_TWIST` in
  `src/shaders/lib/common.glsl` must match `TWIST` in `layouts.ts::galaxy`, or
  the nebula stops following the arms the stars are actually on.
- **Star brightness is energy-conserving.** When a star clamps up to the minimum
  readable pixel size, the vertex shader dims it by the area it got for free.
  Remove that and the far side of the disc becomes a solid white sheet.
- **The pick shader writes disc-relative depth, not camera depth.** `gl_FragDepth
  = distance from the sprite's own centre` makes the depth test resolve to "the
  star whose centre is nearest the cursor". With real camera depth, dense regions
  selected whatever happened to be closest to the eye — you would aim at Black
  Lotus and get whatever floated in front of it. Nothing occludes anything in an
  additively-blended starfield, so camera depth carries no meaning here. This is
  also why `pick.frag` is GLSL3: GLSL1 has no `gl_FragDepth`.
- **Picking reads back synchronously, and should stay that way.** The pick pass
  is scissored to the single pixel under the cursor, so `readPixels` on a 1×1
  target costs microseconds and the stall cannot happen. The async path it
  replaced (`readRenderTargetPixelsAsync`) occasionally neither resolved nor
  rejected; with a single `inFlight` flag one hung read silently blocked every
  later pick and hover simply stopped. It self-healed as soon as the mouse
  moved, which is why it presented as a ~50% test flake with a stationary
  cursor rather than an obvious bug. If picking ever goes async again it needs
  both a stall timeout and a generation tag per request, or that returns.
- **A low-resolution raymarch has to be *reconstructed*, not just stretched.**
  The volume renders at a quarter to a half of canvas resolution, and a plain
  bilinear magnification of that turns every march texel into a visible square
  — the "pixelated nebula" this was reported as. Three things fix it and all
  three are needed: a separable blur at march resolution (the step jitter is
  white noise, and white noise magnifies into speckle), a bicubic B-spline
  reconstruction on the way up (four taps, no overshoot, no texel grid), and
  temporal accumulation (the jitter advances per frame, a still camera
  converges in about a dozen frames and then stops marching entirely).
- **Cost inside `filament()` is paid per step, per ray, per pixel.** Adding a
  four-octave `fbm` there for the inter-arm veil cost about half the march
  again. That did not present as "the nebula is slow": the adaptive ladder
  dropped to its floor, and at that frame rate the *pointer* stopped keeping
  up, so hover and click were what broke in the interaction suite. A single
  `n1()` fetch gives the same broad haze. Before adding anything to that
  function, count the texture fetches.
- **The interaction suite is the frame-budget alarm.** Nothing in it measures
  frame rate directly, but the hover and click checks fail once the app is slow
  enough, and they fail a long way from wherever the cost was added. A run
  that loses the nine pointer checks in a block and nothing else is a
  performance regression, not a picking regression — measure `stats.ms` before
  going anywhere near `Picker`.
- **The nebula caches its march, so a uniform change needs `invalidate()`.**
  `prepareFrame` reuses the last render target whenever the camera has not
  moved, and the composite pass does nothing but blit it. Anything that writes
  a uniform on `marchMaterial` — density, intensity, layout, world scale — must
  therefore mark the cache dirty or it never reaches the screen. This was
  invisible for a long time because `autoRotate` defaults to true and the
  camera never stops; turn it off (a persisted checkbox) and the nebula toggle,
  the intensity slider and the filter-driven density all went dead.
- **A translucent background cannot mask scrolled content.** The intro's sticky
  CTA used `var(--mcu-panel-bg)` (0.78 alpha) and the controls list showed
  straight through it. Anything that has to occlude needs a near-opaque colour,
  even inside an already-frosted panel.
- Exposure is a uniform on the star material, not `renderer.toneMappingExposure`
  — tone mapping happens in the post chain, so the renderer's own is inert.

## Embedding in a host app

Filthy Net Deck ships this site as a built folder in its own `public/aetherfield/`
and shows it in a same-origin iframe. Three things make that work, and each one
looks like a pointless detail until it is missing:

- **`base: './'` in `vite.config.ts`.** The site has to resolve its own assets
  from a subdirectory. A root-absolute `/assets/…` resolves against the *host's*
  origin, where it collides with the host's own bundle. The data loads were
  already document-relative (`fetch('data/universe-meta.json')`), so this is the
  only build change the embed needs — but it also means **no root-absolute paths
  anywhere in `src/`**. Use `import.meta.env.BASE_URL` for anything in `public/`;
  `title.ts` referenced `/mark.svg` and 404'd inside the host.
- **`src/core/embed.ts` is the whole contract.** It forwards outbound links to
  the host (`target="_blank"` does nothing in a Tauri webview — no error, no
  navigation, the Scryfall link is simply dead) and posts a ready/error ping.
  The ping is not decoration: an iframe fires `load` for a 404 page exactly as
  it does for a real one, so from outside there is no other way to tell a
  missing bundle from a slow boot.
- **`?cards=` is a list of *individually* encoded tokens.** One tenth of all
  card names contain a comma — every "Narset, Parter of Veils", which is to say
  every commander — so a list built as `encodeURIComponent(names.join(','))`
  arrives with the separators and the commas inside names both decoded to bare
  commas, and nothing can tell them apart. Producers write
  `names.map(encodeURIComponent).join(',')`; the reader takes the *raw* query
  value (not `URLSearchParams.get`, which decodes too early) and decodes each
  token on its own. A token that fails to resolve is re-split on its commas,
  which is what keeps links from before this convention working.
- **`?cards=` isolates the deck (filter + highlight).** Additive blending of
  117k dimmed points still paints a full galaxy, so highlight-in-place made a
  hundred-card list vanish. The host's `highlight` message is a separate
  overlay — collection, not a deck — and must not overwrite `?cards=`. The
  filter panel's "Show in context" lifts isolation while keeping the cards lit.
- **`?shell=play` skips the title screen.** A host has already asked "do you
  want this?" with the button that opened us. `connectUrlState` only echoes the
  parameter back when it was supplied, so the public site keeps a clean URL.

Everything else — the renderer, the store, the UI layer — is unchanged, and
`isEmbedded()` gates the differences so an ordinary browser visit pays nothing.
The service worker is one of those differences: it belongs to the public site
only, and registering it on the host's origin would quietly cache the host's
assets.

The host is verified against the *built* site, not the dev server, because
`base` and the vendored folder only exist after a build.

## The UI tells the renderer what it is covering

`store.insets` is the third thing the store carries between the two layers, and
it exists because the camera cannot see the DOM. The filter panel measures its
own footprint and writes it; `App.resize()` turns that into a
`camera.setViewOffset` so the layout centres on the space left over, and
`Starfield.frameDistance(freeAspect)` pulls back far enough that it also *fits*
there. Fitting vertically alone is not enough — the bounding sphere still fits
top to bottom with a panel open, so nothing looks wrong from the maths' point
of view while a third of the disc sits underneath it.

**Shift the projection, never the camera or the scene.** `setViewOffset` edits
the projection matrix, so the picker (which renders its pass with this same
camera), the label and billboard projections, and the nebula's ray
reconstruction all follow for free. Move the camera sideways instead and
picking silently disagrees with the screen by exactly the offset — the same
shape of bug as the dpr-scaled pick buffer, and just as invisible in a
screenshot. The interaction suite's "hovered card is the one under the cursor"
is what catches it.

`--mcu-inset-left` carries the same number into CSS, because the layout
switcher has to centre on the free area too; centring it on the canvas put it
on top of the panel, and it wins the z-order.

**`ui/scale.ts` uses `zoom`, not `transform: scale()`.** A transform blurs text
and does not change layout, so the panel would keep reserving its unscaled
width and the reported inset would disagree with what is on screen. The scale
is also gated on `CSS.supports('zoom', …)`: reporting a scale the engine never
applied would push the camera off by that factor.

## Visual tuning

The nebula is the easiest thing to get wrong; it wants to be atmosphere, not
fog. The knobs, in `src/shaders/nebula.frag`: `sigma` (per-step density), the
`accum *` multiplier at the end of the march, and the two `smoothstep` ranges on
`n` and `macro`. Raising density without also sharpening the arm power turns the
whole screen into haze and drowns the stars.

**The noise volume must stay single-octave.** `createNoiseVolume` bakes exactly
one octave, because the shader's `fbm()` already sums four fetches at 1x/2x/4x/8x.
Baking octaves into the texture as well gives ~16 octaves of averaging: every
sample lands near 0.5, the field loses its dynamic range, and the cloud goes
irretrievably soft. It also silently breaks ridged noise, which measures distance
from the field's midpoint and so returns ~1 everywhere on a low-variance field.

**Ridge per octave, never on the finished fbm.** `1 - |2f - 1|` applied to a
summed field peaks at that field's *mean* — its most common value — so it fills
the volume instead of carving it. `ridgedFbm()` ridges each octave and gates the
next by the previous one, which is what leaves crests with empty space between.

**Pick thresholds by measuring, not by screenshot round-trips.** The CPU noise
pipeline is cheap to replicate in a scratch Node script; sample the field a few
tens of thousands of times and read percentiles off it. Over the warped field
`ridgedFbm` sits at p50 0.40 / p85 0.64 / p97 0.80, and the current gate of
0.62..0.86 deliberately lets roughly the top 15% of the volume carry gas.

**Layouts are framed from their bounding sphere, not a per-layout constant.**
`Starfield.frameDistance()` fits the sphere enclosing the computed positions.
Hand-tuned distances were subtly wrong because the *near* side of a tall shape
subtends a far larger angle than its far side — the timeline clipped top and
bottom at a distance that the naive height calculation said was fine.

**A layout only reads if the data actually fills it.** The timeline went through
three designs before working. A vertical helix cannot have a pitch comparable to
its radius across 33 years without becoming absurdly tall, so its coils
overlapped; a continuous outward spiral blurred into a filled disc wherever
years were dense; and concentric rings keyed to *day of year* stayed mostly
empty, because Magic ships in four to six bursts a year rather than continuously.
Ranking cards within their year fills the ring while staying monotone in date.

## Two mana palettes, on purpose

`ui/theme.ts` carries both. `MANA_COLOR_HEX` is the card-frame palette and is
right wherever something stands in for a card. `MANA_UI_HEX` is a saturated set
for chrome on a dark ground, and every colour pip uses it: the frame colours sit
within a few percent of each other in saturation, so five dimmed dots of them
are five identical olive circles, and telling them apart at a glance is the only
thing a pip is for.

## Popularity is per printing, not per card

`popularity` comes from EDHREC rank, which is a property of the *card*, so every
one of Sol Ring's ~100 printings carries the same top-tier score. Anything that
ranks by popularity and then takes the top N will fill its entire budget with
one card unless it deduplicates on `oracleIdx`. Both `StarLabels` and
`CardBillboards` do; the candidate buffers are also sized far larger than the
final count for the same reason, since deduplication happens after scoring.

## Testing

`npm run test:interaction` drives real mouse and keyboard input through Chrome
DevTools against the dev server. It exists because the interesting failures all
live between the input and the store — GPU picking reading the wrong pixel, the
pick buffer being scaled by devicePixelRatio, click-versus-drag disambiguation —
and none of them are visible if you only set store state programmatically. It
caught the picking bug above, which had looked fine in every screenshot.

`App.setQualityTier(n)` pins the adaptive ladder (`-1` resumes adapting). Both
the capture harness and the benchmark need it: a hero image otherwise comes out
soft because the controller dropped two tiers while the camera settled, and two
benchmark scenarios cannot be compared if each ran at a different tier.

Use `tools/screenshot.mjs` to iterate on visuals — it drives the system Chromium
headless against the dev server and reports the WebGL renderer and current fps.
It enters from the title screen by default (`--intro` keeps the title up), and `--eval-file`
runs a script against the page before capturing, which is how the social image is
composed (`npm run og`). Output is JPEG when the path ends in `.jpg`.
