# Aetherfield — handoff

**Read this first.** Live top-of-todo across model/agent handoffs.

Repo: `L0nE-F0x/MTG-Multiverse`
**Live: https://mtg-multiverse.netlify.app**
· 117,621 printings as an explorable WebGL galaxy
· Netlify auto-deploys `main` (`npm run build`, Node 22, publish `dist`)

Architecture notes live in `CLAUDE.md`. This file is only the live todo.

---

# ▶ START HERE — next session

0. **2026-09-04, Aetherfield shipped.** Rebrand + title screen on `main`.
   Next slice is **filter polish** (and other in-galaxy fine detail).

   ### Git

   | | |
   |---|---|
   | Latest | this commit — *Rename to Aetherfield and add a title screen* |
   | Branch | `main` |
   | Remote | https://github.com/L0nE-F0x/MTG-Multiverse |

   CSS class prefix stays `mcu-`. Brand copy lives in `src/ui/brand.ts`.

   ### State

   `npx tsc --noEmit` · `npx tsc -p tsconfig.tools.json --noEmit` ·
   `npm run test:interaction` → **37/37**.

   `npm run og` regenerated `public/og.jpg` as AETHERFIELD.

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

   - **Aetherfield.** Loading boot, title screen, HUD, OG, meta tags.
     Title shows **every visit**. Three buttons: Enter the Multiverse,
     Instructions, Settings. Tiny Wizards disclaimer at the bottom.
     HUD wordmark returns home; "?" opens instructions without leaving
     play. `store.shell` is `title` | `play` so WASD/`/` cannot fire
     through the menu. Star labels are suppressed while `shell ===
     'title'` (they are canvas-drawn, not DOM). Capture harness calls
     `__mcu.ui.enter()` unless `--intro`.
   - The HTML `#boot` overlay is the loader (five-arm mark + wordmark +
     pips). The old JS `loading.ts` overlay is gone; it sat under `#boot`
     and never showed.

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
- On a phone the Instructions panel's Controls section is below the
  fold. First-time visitors now see the title screen instead, so this is
  even less of a first-run problem. Left alone; shortening it would
  cost the desktop reading.
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
