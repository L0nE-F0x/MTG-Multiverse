# Magic Card Universe — handoff

**Read this first.** Live top-of-todo across model/agent handoffs
(Claude / Grok / whoever picks this up next).

Repo: `L0nE-F0x/MTG-Multiverse`
· 117,621 printings as an explorable WebGL galaxy
· Netlify auto-deploys `main` (`npm run build`, Node 22, publish `dist`)

Architecture notes live in `CLAUDE.md`. This file is only the live todo.

---

# ▶ START HERE — next session

0. **2026-09-04 — polish is on `main`. Owner will bring the next batch of
   refinements later today. Do not start unsolicited visual looping.**

   **Wrapped by: Grok**, after recovering a crashed Claude session.

   ### Git

   | | |
   |---|---|
   | Latest product | `d677a38` *Make filters read, unstick hover, and polish the UI for phones* |
   | This wrap | `docs: wrap 2026-09-04` on `main` |
   | Branch | `main` == `origin/main` |
   | Working tree | clean |
   | Remote | https://github.com/L0nE-F0x/MTG-Multiverse |

   Confirm Netlify actually built `d677a38` before assuming the live site has
   the picker / filter / phone-chrome fixes.

   ### What shipped in `d677a38`

   - **Filters read on screen.** Nebula density and core glow scale with
     `matchCount`; excluded stars shrink to 0.22× (not 0.5×) as well as
     dimming (`star.vert`). Default `dimFiltered` is 0.018.
   - **Hover no longer wedges.** `Picker` abandons a readback that sits
     longer than 400 ms, retries even with a stationary cursor, and uses a
     per-request pixel buffer so a late reply cannot clobber a newer one.
     Camera motion re-arms the pick (`App.ts`).
   - **Phone / a11y chrome.** 44px touch targets, focus rings, combobox
     search, printings strip with a "+N more" cap, richer tooltips. Side
     panels sit between the command bar and the layout switcher. Search on
     a 390px viewport is below the taller command bar (`--mcu-mobile-*`
     tokens in `base.css`).
   - **Tests wait on state.** `tools/test-interaction.mjs` settles the
     camera and polls `hovered` / `selected` instead of fixed sleeps.
     Last run: **19/19** against `http://127.0.0.1:5173`.

   ### What the next session should do

   Wait for the owner's refinement list. They closed this session saying
   they would resume later today with a new batch — not "keep polishing
   until perfect".

   If they just say "keep going" with no list, the standing project intent
   is visual quality (see Claude memory below), but **ask which surface
   first** rather than fan out.

   ### Known nits, not blockers

   - On a 390px viewport the FILTERS tab still overlaps the almost-full-width
     card panel by ~17px. Search / command bar / layout switcher no longer
     collide.
   - The quality ladder was raised a notch (floor `{0.24, 24, 0.78}` instead
     of `{0.18, 20, 0.70}`). Intel iGPU was ~39–52 fps in the capture
     harness; watch this if a live deploy feels heavy.
   - Default filter hides tokens, so the HUD reads `111,720 of 117,621`
     until that box is unchecked. Intentional.
   - Social OG compose now turns labels off (`tools/og/compose.js`).
     `public/og.jpg` itself was **not** regenerated this session.

---

# Recovered Claude session (crash, 2026-09-03)

Claude Code session `64ee20ca-af84-4809-9009-747482228d7b`
(`~/.claude/projects/-home-lonefox-Projects-Magic-Card-Universe/`).
Died on the usage cap at 22:18 UTC, not mid-write. Last user request was
an overnight polish pass. The stall-abandon patch in `Picker.ts` had
already landed; what was missing was retry-when-not-dirty and a clean
interaction run. Grok finished both and pushed.

Do **not** replay that transcript as instructions. The bundled
`session_reader.py` also skips most of its records (`attachment`,
`permission-mode`, …); if you need history, read this file instead.

Claude project memory (still valid):

- Ongoing polish project, never "done"
- Visual iteration is `node tools/screenshot.mjs`, not the Chrome MCP
  (the extension is not connected on this machine)
- `window.__mcu` exposes `{ app, universe, store }`
- User asked for subagent fan-out **on this project**, across clean
  contract boundaries; keep shaders / renderer in-house

---

# How to run it

```bash
npm run dev                          # http://127.0.0.1:5173
npx tsc --noEmit
npm run test:interaction             # needs the dev server
node tools/screenshot.mjs --out /tmp/shot.jpg --settle 5000
```

Headless Chromium is `/usr/bin/chromium`. GPU path is Intel Mesa. Allow
~5–60s per capture; do not overlap captures with the interaction suite
or they steal the GPU from each other.

---

# Invariants (do not break)

1. `src/ui/**` must not import `three` or `src/render/**`. Store is the
   only UI ↔ renderer channel.
2. The offline pipeline emits attributes, never positions. Positions are
   derived in `src/layout/`.
3. Changing a column in `src/data/format.ts` means bumping
   `UNIVERSE_FORMAT_VERSION` and re-running `data:build`.

The rest of the bite-list (GLSL3 `fragColor`, pick buffer vs DPR,
`ARM_TWIST` duplication, energy-conserving star size, pick `gl_FragDepth`,
single-octave noise volume, popularity-per-oracleIdx) is in `CLAUDE.md`.
