# Magic Card Universe — handoff

**Read this first.** Live top-of-todo across model/agent handoffs.

Repo: `L0nE-F0x/MTG-Multiverse`
· 117,621 printings as an explorable WebGL galaxy
· Netlify auto-deploys `main` (`npm run build`, Node 22, publish `dist`)

Architecture notes live in `CLAUDE.md`. This file is only the live todo.

---

# ▶ START HERE — next session

0. **2026-09-04, second pass.** The owner's standing instruction is a deep
   polish pass ("keep going until it is completely and utterly perfect").
   They interrupted once mid-session and immediately said to continue, so
   treat autonomous polish as authorised until they say otherwise.

   ### Git

   | | |
   |---|---|
   | Latest | `2b1168c` *Close the phone-layout overlap, pin capture quality, refresh the social card* |
   | Branch | `main` == `origin/main`, working tree clean |
   | Remote | https://github.com/L0nE-F0x/MTG-Multiverse |

   ### State: everything green

   `npx tsc --noEmit` · `npx tsc -p tsconfig.tools.json --noEmit` ·
   `npm run build` · `node tools/verify-universe.ts` ·
   `npm run test:interaction` → **22/22**.

   The picker flake is **gone**. Three consecutive clean suite runs since
   the stall-abandon fix; the previous session could not get two in a row.

   ### What shipped this pass

   - **Phone overlap closed.** The card panel covered the filters tab at
     390px (panel reached x=37, tab occupies 10..54). Both edges are now
     anchored, so they stay independent at every width.
   - **`App.setQualityTier(n)`** pins the adaptive ladder (`-1` resumes).
     The capture harness and benchmark both need it — see `CLAUDE.md`.
   - **`public/og.jpg` regenerated**, at pinned max quality. It was stale
     by the nucleus glow, the nebula retune and the star labels.
   - **Deep-link coverage added** to the interaction suite: `?card=` +
     `?layout=` restore correctly, and the URL clears back to defaults.

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

- Constellation lines linking a selected card to its other printings
  across the galaxy. Sketched, never built; risk is visual clutter for a
  card with 100 printings.
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
