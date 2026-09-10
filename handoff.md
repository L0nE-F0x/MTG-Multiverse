# Aetherfield — handoff

**Read this first.** Live top-of-todo across model/agent handoffs.

Repo: `L0nE-F0x/MTG-Multiverse`
**Live: https://mtg-multiverse.netlify.app**
· 117,621 printings as an explorable WebGL galaxy
· Netlify auto-deploys `main` (`npm run build`, Node 22, publish `dist`)

Architecture notes live in `CLAUDE.md`. This file is only the live todo.

---

# ▶ START HERE — next session

**2026-09-10 later — skip-intro placement, and the host copy is installable.**

Three things, all shipped:

1. **The skip pill sat on the format row**, on desktop and on a phone. It was
   at a constant `bottom: 96px` and the bottom chrome is not a constant
   height — the layout description is hidden under 900px and the buttons grow
   to a touch target. `hud.ts` now measures the switcher and publishes
   `--mcu-hud-bottom`; the pill floats above that and centres on the free area
   like the switcher does. "· Esc" is dropped on coarse pointers.
2. **`filthy-net-deck.com/aetherfield/` is now PWA-installable**, on Android
   and iOS, the same as the origin. Everything in the manifest is `./`-relative
   and `id` is gone (the spec resolves `id` against the *origin*, so a relative
   one would not have moved); `sw.js` resolves against its own directory and
   refuses anything above its scope; `main.ts` registers with an explicit
   narrow scope; the origin no longer sends `Service-Worker-Allowed: /`; and
   FND's `website/netlify.toml` proxies `/aetherfield/sw.js` instead of 404ing
   it. Verified with `Page.getInstallabilityErrors` (empty) plus a
   `beforeinstallprompt` at both depths, and the fake host root above the
   scope is confirmed uncontrolled. Written up in `CLAUDE.md`.
3. **Vendored into Filthy Net Deck** — see that repo's handoff.

Interaction suite 67/67. One caveat worth remembering: a run with other
Chrome instances and static servers alive on the box lost exactly the nine
pointer checks, which is the documented shape of a *performance* regression.
It was contention, not code. Kill the other browsers before believing that
block.

**2026-09-10 — eye-candy pass: ten items, all shipped. Interaction suite 67/67.**

The reported "pixelated nebulae" were the raymarch being stretched, not the
stars. The volume renders at a quarter to a half of canvas resolution and was
magnified with plain bilinear, so every march texel became a visible square,
and the white-noise step jitter became speckle on top. Fixed by reconstructing
it properly rather than by marching harder.

Galaxy:

1. **Nebula reconstruction.** Separable blur at march resolution, bicubic
   B-spline upsample, one fewer fullscreen pass than the obvious version (the
   vertical blur is folded into the temporal blend).
2. **Temporal accumulation.** The jitter advances one golden-ratio turn per
   frame; a still camera converges over ~14 frames and then stops marching, so
   the standing cost is what the old single-target cache paid.
3. **Gas that reads as mist.** Softer ridge gate plus a broad low-amplitude
   veil, gated by the macro field so the inter-arm dark survives.
4. **Colour grade after tone mapping.** ACES was desaturating the arms to
   cream. Midtone-weighted saturation, split tone, smoothstep S-curve.
5. **The nucleus.** Colour-temperature ramp across four layers, flattened to
   the disc by camera elevation, plus a diffraction glare that holds a fixed
   angular size and fades out as you arrive (it is a lens artefact, not a body).
6. **Star depth.** Size floor raised off one pixel so the far disc is mist
   rather than dots, and mild atmospheric perspective by distance.

Interface:

7. **Filter panel depth** — lit surfaces on the chips, accent rule per section
   heading, staggered arrival.
8. **HUD glass** — specular top edge on the command bar and switcher, breathing
   halo on the active layout, sheen on the wordmark.
9. **Title screen** — era ring labels no longer draw through it (they were only
   disabled on a *change* of shell, and a visit that starts on the title never
   changes it), symmetric wordmark gradient, aperture on Enter, tinted
   secondary buttons.
10. **Motion** — one stagger token drives filters, settings, card panel and
    title; the layout description crossfades instead of swapping mid-morph.

**The thing that cost the most time, written up in `CLAUDE.md`:** the first
version of the veil used a four-octave `fbm` inside `filament()`. That is paid
per step, per ray, per pixel — about half the march again. It did not present
as a slow nebula. The adaptive ladder fell to its floor and the *pointer*
stopped keeping up, so the interaction suite lost nine hover/click checks in a
block, a long way from where the cost was added. If that failure shape appears
again, measure `stats.ms` before touching `Picker`.

Also worth knowing: a later `position: relative` at equal specificity beat
`.mcu-command-bar`'s own `position: fixed` and dropped the bar into normal
flow, stretching it across the whole top of the window. A fixed element is
already a positioned ancestor; it never needed the override.

Open: AUR `filthy-net-deck-bin` still waits on Arch registration. This has not
been vendored into Filthy Net Deck — that needs `npm run aetherfield` there
plus a version bump and a full release. *(Done later the same day: FND
v3.8.2 ships it on all three platforms.)*

**2026-09-06 night — session closed. Nothing in flight.**

FND **v3.7.4** is on Windows, macOS and Linux. Aetherfield live has the look
pass (reprint thread, settings tips, colour pie, arm flights, focus dim, era
ticks, newest-set pulse). Interaction suite **67/67**.

Open: AUR `filthy-net-deck-bin` still waits on Arch registration. No other
todo.

**2026-09-06 — arm flights, focus dim, era ticks, newest-set pulse.**

- Colour-pie click is a 2s swoop along the arm, not a heading snap.
- Selecting a card dims everything that is not that card (or a printing of
  it); other billboards leave. The reprint thread is the thing that reads.
- Era rings + Alpha / Revised / Modern / current-year labels are sized for
  the framed view and sit on one spoke as ticks.
- The newest set pulses on the rim for a few seconds after you enter, then
  matches every other star.

Ships with the second look pass in FND **v3.7.4** (Windows updater, Linux
tarball, macOS dmg rolled). Interaction suite **67/67**.

**2026-09-06 — second look pass (thread, chrome, lighting).**

On top of the Saved-Views strip and the first trail fix:

- Reprint thread is pulled onto the card's mean ray and corner-smoothed, so a
  close-up of Sol Ring is a history, not a scribble. Deselect hides it in the
  same frame. Kin printings no longer grow a cyan ring each — only the opened
  star does.
- Clicking the void actually deselects (interaction suite covers it).
- Settings tips sit in the gap left of the panel, on the whole row, and say
  what Bloom / Exposure / Nebula actually do.
- Colour-pie compass uses saturated WUBRG, hides while a card is open, and
  lives under the card panel in z-order.
- Card panel reports a right inset. Search, Settings and the layout switcher
  slide out of its way; the camera recentres on the space that is left.
- Stars have a tighter core and a faint chromatic spike. Nebula has modest
  forward scatter from the core and slightly darker dust lanes. Core glow is
  less of a white blob.

Interaction suite **61/61**.

**2026-09-06 — printing thread, Saved Views, settings tips, minimap, look.**

- The reprint thread no longer comes back after you dismiss a card and switch
  layout. Deselect clears the points; unsupported layouts hide instantly.
  Clicking the blackness around a star now misses fat pick sprites and
  actually deselects.
- Saved Views is gone. It was a prompt-shaped panel nobody used.
- Settings sliders explain themselves on hover (bloom, exposure, nebula…).
  Reset look puts the defaults back.
- Colour-pie compass is a glass chip with WUBRG letters and a heading tick.
- Look pass: framed nebula no longer marches at 55% steps, public DPR cap
  is 2, bloom sits between “white sheet” and “dry stars”, twinkle is a bit
  more alive. Boot quality starts one rung higher.

**2026-09-06 — the audit's highlight-only deck was the regression. Isolated again.**

v3.7.1 shipped the audit as a "fix" and the galaxy **looked and worked worse**.
The URL/comma round-trip and nebula-invalidate were real. The product change
bundled with them was not: `?cards=` stopped isolating the deck and only dimmed
everyone else to 8% vis. Additive blending of 117k still-on points *is* the
galaxy, so "Show this deck" read as a slightly dirtier sky. FND then posted
the tracker's whole collection over that highlight, so even the dimming was
the wrong cards.

Restored:

- **`?cards=` filters + highlights** (v3.7.0 isolation, v3.7.1 encoding). HUD
  says `N-card deck`. Filter panel has Show in context / Clear.
- Host `highlight` stays overlay-only and is **not** written into `?cards=`.
- DFC front faces resolve (`Bonecrusher Giant` → `Bonecrusher Giant // Stomp`)
  without also pulling art-card doubles (`Sol Ring // Sol Ring`).
- Era labels fanned off one spoke so Alpha/Revised no longer stack.
- Interaction suite **56/56**.

FND side (collection skip, sidebar no-op, Sets `useLocale`) ships in **v3.7.2**.

**2026-09-06 — the v3.7.0 audit is cleared, and FND v3.7.1 ships it.**

Every finding in `AUDIT-2026-09-05.md` is fixed, across both repos, committed
and pushed. **Filthy Net Deck v3.7.1 is released** — signed Windows installer,
macOS dmg, Linux pacman package — so the fixes below are in the vendored
`public/aetherfield/` that FND users actually run, not only on Netlify.

Three that were hurting live users:

- **`?cards=` survives now.** The writer never re-emitted it, so the deck died
  on the first click. v3.7.1 also **highlighted instead of filtering** — that
  was the visual regression; isolation is restored above. The host's
  `highlight` message is a separate collection overlay.
- **The nebula controls work with auto-rotate off.** The march is cached
  between frames, and no uniform change invalidated it, so one persisted
  checkbox killed the nebula toggle, the intensity slider and the
  filter-driven density. `Nebula.invalidate()` is the rule now — see
  `CLAUDE.md`.
- **FND's `additionalBrowserArgs`** replaced wry's defaults wholesale
  (`unwrap_or_else`), re-enabling `msSmartScreenProtection` on Windows in an
  app that sells local-only. Verified in the pinned crate source.

**A bug the audit missed, worth knowing:** `?cards=` was broken for *every
commander*. A tenth of card names contain a comma, the list was built as
`encodeURIComponent(names.join(','))`, and after decoding nothing could tell a
separator from "Narset, Parter of Veils". Both sides now encode per token; the
reader re-splits an unresolved token so already-shared links still work. The
convention is written down in `CLAUDE.md` → *Embedding in a host app*.

Also done: era markers now sit on the rings their cards are actually on (Modern
was out by 19% of the disc radius); bookmarks lost `window.prompt`, which is a
no-op under WKWebView so "Save this view" did nothing at all on macOS, and now
validate what they read back; the cluster map is cached, so a galaxy→sets
switch went 48ms → 14ms.

Interaction suite is **55/55**, up from 36 — the new checks cover `?cards=`,
`?set=`, `?shell=`, the embed message channel, bookmarks and the nebula
controls, which is exactly where these bugs were hiding.

**Still open, deliberately:** FND has four more module-level `t()` call sites in
`Sets.tsx` (219, 610, 766, 777) with the same memo-fragility as the one fixed.
Not touched — out of the audit's scope.

**2026-09-05 — FND v3.7.0 shipped the title screen and deep links.**

Filthy Net Deck v3.7.0 vendors this build. Sidebar opens on the title
(Enter / Tour / Settings). Sets/DeckView still pass `?shell=play`. Install
is hidden when `isEmbedded()`. Cinematic stays skipped in a frame.

Phase 2 (done): filthy-net-deck.com/aetherfield 200-proxies this origin.
No slash-adding 301 (that looped). Service worker still registers only at
origin root and never when framed — do not loosen that.

**2026-09-05 — how this repo reaches Filthy Net Deck. Read before assuming.**

Owner is continuing tonight with other models, and asked whether pushing here
updates the galaxy inside FND. **It does not.**

FND embeds a *vendored copy of this repo's built `dist/`*, at
`public/aetherfield/` inside its app bundle, refreshed by `npm run aetherfield`
in the FND repo. The iframe points at a local path, never at Netlify. So:

- Pushing here updates **only** https://mtg-multiverse.netlify.app.
- Getting a change into FND needs `npm run aetherfield` there, a commit, **and
  a version bump plus a full release** — FND users run installers.
- Renaming or re-domaining this Netlify site therefore **cannot break FND**.
  The only URL-dependent thing here is `%SITE_URL%` in `vite.config.ts`, used
  for `og:`/canonical tags, and Netlify supplies it.

Owner is considering serving this at `filthy-net-deck.com/aetherfield`, either
as a subdomain alias or a Netlify path proxy. Either works untouched, because
`base: './'` makes every asset document-relative — that is exactly why it was
set. Details and the trade-offs of switching FND to load remotely are in FND's
`handoff.md`.

**If FND ever does load this over the network**, `src/core/embed.ts` keeps
working — `postMessage` is cross-origin-safe and it already targets `'*'` — but
the host's message check should gain an origin test. Noted on the FND side too.

**Title screen inside a host:** currently skipped via `?shell=play`. The owner
wants it back for the tour. If it is re-enabled, hide the INSTALL APP button
when `isEmbedded()` — `beforeinstallprompt` never fires in a Tauri webview, so
it is a button that does nothing.

**2026-09-05 — panel-aware framing, persistent settings, overlay scaling.**
Shipped inside Filthy Net Deck v3.6.1. Owner found the galaxy centring on the
whole canvas with its left third under the filter panel, and the layout
switcher sitting on top of that panel. Both now centre on what the panels
leave; see `CLAUDE.md` → *The UI tells the renderer what it is covering*.

`core/persist.ts` stores `visual` only. A host unmounts the document when you
leave the page, so settings reset — which reads as forgetting, not reloading.
Filters and layout are deliberately excluded: a filter is a query, and coming
back to a galaxy hiding four fifths of its cards with no memory of asking is a
bug report.

**Nebula: investigated, deliberately unchanged.** Owner thought it sat left of
the stars. `ARM_TWIST` and `TWIST` both read 0.0092, and every structural term
in `densityAt` is measured from the world origin exactly as the stars are. The
only asymmetry is the noise, sampled with a time-varying offset, so the densest
gas wanders by design. Owner re-checked after the centring fix and agreed. If
this comes up again, measure luminance centroids with the nebula on and off —
do not nudge it.

Interaction suite 36/36 after all of it, picking included.

**2026-09-04 (later) — Aetherfield is now embeddable in a host app.**
Filthy Net Deck (`L0nE-F0x/Filthy-Net-Deck`) shows this site in a sidebar page,
in an iframe over its vendored copy of `dist/`. Contract and rationale are in
`CLAUDE.md` → *Embedding in a host app*; the FND side is documented in that
repo's `docs/AETHERFIELD-EMBED.md`.

What changed here, all gated so the public site is untouched:
`base: './'` in `vite.config.ts` · new `src/core/embed.ts` (outbound-link
bridge + ready/error ping, no-ops unless framed) · `?shell=play` in
`urlState.ts` · `title.ts` uses `BASE_URL` for `mark.svg` instead of `/mark.svg`
· the service worker no longer registers when framed.

Verified against the **built** site, not the dev server — `base` only exists
after a build. Public site: opens on the title screen, no failed requests, no
`shell=` in the URL. Embedded: boots from a subdirectory, skips the title,
posts `ready` with 117,621 cards, forwards outbound links.

**Not done:** the Sets / DeckView deep links (`?set=`, `?cards=`) the owner
parked for later. `filter.sets` and `filter.query` already exist in the store,
so it is a `urlState.ts` vocabulary addition, not a renderer change.


0. **2026-09-04, wrapped.** Owner is tinkering on the live site and will
   report back. Do not start autonomous polish. Wait for their notes.

   ### Git

   | | |
   |---|---|
   | Latest | `309a714` *Make Aetherfield installable and replace instructions with a tour* |
   | Branch | `main` == `origin/main`, working tree clean |
   | Remote | https://github.com/L0nE-F0x/MTG-Multiverse |
   | Live | https://mtg-multiverse.netlify.app |

   CSS class prefix stays `mcu-`. Brand copy lives in `src/ui/brand.ts`.

   ### State

   `npx tsc --noEmit` · `npx tsc -p tsconfig.tools.json --noEmit` ·
   `npm run test:interaction` → **36/36**.

   `public/og.jpg` is the AETHERFIELD social card.

   **Picker: measured, understood, not fully eliminated.** An earlier
   claim in this file that the flake was "gone" was wrong — three clean
   runs is not evidence of absence for something already intermittent,
   and a fourth run failed.

   Hammering the picker directly (24 nudge-away-and-back cycles onto a
   known star) gives **24/24 hits, 0 wrong cards, 0 misses**, so the
   pick pass itself is sound. What remains is that a *single* pointer
   move occasionally does not register — roughly one run in three — and
   any second move recovers it immediately. A real cursor emits a stream
   of pointermove events, so this is close to unobservable in use.

   `tools/test-interaction.mjs` now nudges up to three times, like a hand
   would, and **reports the attempt count** when more than one was
   needed. That deliberately keeps the flake visible rather than papering
   over it: if runs start needing 2-3 nudges routinely, that is a real
   regression and it will say so.

   Three hypotheses about the underlying cause were tried and all three
   were wrong — a hung readback, a stalled `inFlight` flag, and orbit
   angle still drifting after distance and target had settled. The first
   two produced real hardening that is worth keeping (stall-abandon plus
   a per-request generation guard); the third changed nothing. Do not
   assume a fourth guess is right without measuring first: the
   `.pickloop` style harness in the git history for this session is the
   way to get a number.

   Six runs across the two most recent variants: 22/22 every time, with
   two of the six needing a second nudge.

   ### What shipped this pass (newest first)

   - **PWA.** `manifest.webmanifest`, 192/512/maskable icons, production
     service worker (`/sw.js`, registered only in `import.meta.env.PROD`).
     `display: standalone`. iOS: apple-touch-icon + apple-mobile-web-app-capable.
     Landing shows **Install app** only when `beforeinstallprompt` fires.
   - **Tour** replaced the instructions overlay. Seven coach-marks over
     the live chrome. Title **Tour** button and HUD **?** both start it.
     Esc / Skip ends it.
   - **ApexForge credit** on the title footer, linking to
     https://ame-apexforge.org/
   - **Aetherfield rebrand + title screen every visit.** Enter the
     Multiverse / Tour / Settings. `store.shell` is `title` | `play`.
     Star labels suppressed while on the title (canvas-drawn, not DOM).
     Capture harness calls `__mcu.ui.enter()` unless `--intro`.
   - Search sits beside Settings; no Ctrl+K placeholder; no hairline
     under the closed dropdown. Auto-rotate defaults on. Colourless is
     off and disabled until a colour pip is selected. Filter hover tips.
     Grid toggle removed (it never drew anything).
   - The HTML `#boot` overlay is the loader. The old JS `loading.ts`
     overlay is gone.

   - **Printing thread.** Selecting a card draws a line through its
     printings in release order. Because angle is colour identity and
     radius is date, that runs outward from the core — Sol Ring is a
     thread from Alpha to the rim.
   - **Halo angle is now per card, not per printing** (`layouts.ts`).
     This was needed to make the thread work at all: colourless cards
     have no arm, so Sol Ring's 133 printings were scattered around the
     whole circle by a hash of the row index and the thread was a
     scribble. It is also simply more honest. Verified no spoke artefacts
     against the plain galaxy.
   - The thread only draws in layouts where radius encodes time (galaxy,
     price, timeline). Elsewhere it would be a scribble again.

   ### Earlier in this pass

   - **Phone overlap closed.** The card panel covered the filters tab at
     390px (panel reached x=37, tab occupies 10..54). Both edges are now
     anchored, so they stay independent at every width.
   - **`App.setQualityTier(n)`** pins the adaptive ladder (`-1` resumes).
     The capture harness and benchmark both need it — see `CLAUDE.md`.
   - **`public/og.jpg` regenerated**, at pinned max quality. It was stale
     by the nucleus glow, the nebula retune and the star labels.
   - **Deep-link coverage added** to the interaction suite: `?card=` +
     `?layout=` restore correctly, and the URL clears back to defaults.

   - **Social tags were pointing at the wrong hostname.** Netlify sets
     both `URL` (canonical) and `DEPLOY_PRIME_URL` (this deploy's own
     address, `main--<site>.netlify.app` for a branch deploy of main).
     `vite.config.ts` preferred the latter, so the live site advertised
     `og:url`, `og:image` and `rel=canonical` on a host nobody would
     share. Now chosen by `CONTEXT`, so previews still self-reference.
     Found by fetching the deployed page, not by reading the config.

   ### Live deploy verified

   `https://mtg-multiverse.netlify.app` serves the current bundle (asset
   hash matches a local build), `og.jpg` 200s at the canonical host, and
   there are zero `main--` leaks left in the HTML. `/data/universe.bin`
   (5.76 MB) and `universe-meta.json` (971 KB) both serve correctly.

   ### Verified by eye this pass

   Galaxy at 1728×1080 tier 5 (all five arms clearly coloured), the 390px
   phone layout with a card open, and the hover tooltip + card panel +
   star labels together. All good.

### Known nits, not blockers

- **The nebula is slightly thinner than it was on 2026-09-03.** `MAX_RAY`
  (620) and the earlier transmittance cut-off (0.035, was 0.012) were
  performance trades. At full resolution and tier 5 the galaxy still reads
  well, so this was judged an acceptable trade rather than a regression —
  but it is the first thing to revisit if the gas ever looks too sparse.
- OG framing is hand-tuned to `rig.frame(470)` at phi 1.06 for the 1.9:1
  crop. 505 and 600 were both tried and are worse — the disc shrinks into
  dead space. Do not "improve" this without looking at the output.
- Default filter hides tokens and art cards, so the HUD reads
  `111,720 of 117,621` until that box is unchecked. Intentional.
- A capture and the interaction suite will steal the GPU from each other.
  Run them sequentially, and prefer a static `vite preview` build for
  benchmarking — a dev-server hot reload kills a run mid-flight.

### Ideas not yet done

- Fat lines for the printing thread. WebGL ignores `linewidth`, so it is
  a 1px additive line and washes out where it crosses a bright arm.
  `Line2`/`LineMaterial` from three's examples would fix it at the cost of
  extra geometry. The current subtlety is arguably right for an
  annotation, so this is a judgement call, not a defect.
- The trail/motion-blur toggle is off by default and decays fast because
  anything stronger ghosts the star labels illegibly.

---

# How to run it

```bash
npm run dev                          # http://127.0.0.1:5173
npx tsc --noEmit
npm run test:interaction             # needs the dev server
node tools/screenshot.mjs --out /tmp/shot.jpg --settle 5000
node tools/bench.mjs --url http://127.0.0.1:4173/   # against a preview build
npm run og                           # regenerate the social card
```

Headless Chromium is `/usr/bin/chromium`; GPU path is Intel Mesa. Allow
~40–60s per capture. `window.__mcu` exposes `{ app, universe, store }`.

---

# Invariants (do not break)

1. `src/ui/**` must not import `three` or `src/render/**`. The store is the
   only UI ↔ renderer channel.
2. The offline pipeline emits attributes, never positions. Positions are
   derived in `src/layout/`.
3. Changing a column in `src/data/format.ts` means bumping
   `UNIVERSE_FORMAT_VERSION` and re-running `data:build`.

The rest of the bite-list (GLSL3 `fragColor`, pick buffer vs DPR,
`ARM_TWIST` duplication, energy-conserving star size, pick `gl_FragDepth`,
hung async readbacks, single-octave noise volume, popularity per
`oracleIdx`) is in `CLAUDE.md`.
