/**
 * Scale the overlay UI to the size of the window it is in.
 *
 * Every panel in `src/styles/` is laid out in fixed pixels, which quietly
 * assumes one screen. On a high-density laptop running at 100% the filter
 * panel and its labels shrink to a postage stamp; in a small embedded pane
 * they eat a third of the width and leave the galaxy nowhere to go. Neither
 * is a CSS bug — they are the same 280px on very different screens.
 *
 * So the UI is scaled by how much room there actually is, and the scale is
 * clamped hard at both ends: below ~0.85 the labels stop being readable, above
 * ~1.25 the panels start crowding the thing they are meant to frame.
 *
 * `zoom` rather than `transform: scale()` on purpose. A transform would give
 * blurred text and, worse, would not change layout — the panel would still
 * reserve its unscaled width, so the camera inset (see `filters.ts`) would
 * disagree with what is on screen. `zoom` changes layout, so everything
 * downstream stays honest.
 */

/** Window the fixed pixel sizes were designed against. */
const BASE_W = 1600;
const BASE_H = 950;

const MIN_SCALE = 0.85;
const MAX_SCALE = 1.25;

let current = 1;

/**
 * `zoom` is old and widely implemented, but it is not universal. If the engine
 * ignores it, the UI simply stays at its designed size — the failure mode is
 * "no scaling", which is exactly what shipped before this existed. What must
 * not happen is reporting a scale nobody applied: `filters.ts` multiplies its
 * footprint by it, so a phantom scale would push the camera off by that
 * factor. Hence the support check gates the number, not just the style.
 */
const ZOOM_SUPPORTED =
  typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
    ? CSS.supports('zoom', '1.1')
    : false;

export function computeUiScale(width: number, height: number): number {
  // The smaller ratio wins: growing to fit the wide axis of a short window
  // would push the panels off the bottom.
  const raw = Math.min(width / BASE_W, height / BASE_H);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw));
}

/** The scale currently applied. Callers converting layout px to on-screen px need it. */
export function uiScale(): number {
  return current;
}

/**
 * Keep `root` scaled to the viewport. Returns a disposer.
 *
 * `onChange` fires after the scale is applied, so anything that measures the
 * DOM re-measures against the new size rather than the old one.
 */
export function connectUiScale(root: HTMLElement, onChange: () => void): () => void {
  const apply = (): void => {
    const next = ZOOM_SUPPORTED ? computeUiScale(window.innerWidth, window.innerHeight) : 1;
    if (Math.abs(next - current) < 0.001) return;
    current = next;
    root.style.setProperty('--mcu-ui-scale', String(next));
    // Exactly 1 leaves no zoom in the tree at all, which keeps the common case
    // free of any coordinate-space subtlety.
    root.style.zoom = next === 1 ? '' : String(next);
    onChange();
  };

  apply();
  window.addEventListener('resize', apply);
  return () => {
    window.removeEventListener('resize', apply);
    root.style.removeProperty('--mcu-ui-scale');
    root.style.zoom = '';
    current = 1;
  };
}
