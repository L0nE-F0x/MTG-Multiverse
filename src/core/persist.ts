/**
 * Remember the viewer's render settings between visits.
 *
 * This matters far more embedded than it does on the web. A host app unmounts
 * the page the moment you navigate away — the whole document goes, and every
 * slider you moved goes with it. From the outside you only closed a panel, so
 * finding Bloom back at 1.0 reads as the app forgetting, not as a fresh load.
 *
 * Only `visual` is stored. Filters are deliberately excluded: they are a
 * query, not a preference, and returning to a galaxy still hiding four fifths
 * of its cards — with no memory of having asked — is a bug report rather than
 * a convenience. The layout is excluded for the same reason, and because
 * `?layout=` already carries it for anyone who wants a specific view.
 *
 * Nothing here trusts what it reads back. Storage is shared with whatever else
 * lives on this origin (inside a host app, that is the host), it survives
 * across versions, and a hand-edited value should not be able to push the
 * renderer somewhere it cannot draw.
 */
import { defaultVisual, store, type VisualState } from './store.ts';

/** Bump when the shape or a default that old saves would fight changes.
 *  v2: motion blur defaults off — v1 saves kept it on and ghosted the view. */
const KEY = 'aetherfield.settings.v2';

/** Debounce: a slider drag emits far faster than this is worth writing. */
const WRITE_DELAY_MS = 400;

/** Ranges mirror the controls in `ui/settings.ts`. */
const NUMERIC: Record<string, [number, number]> = {
  bloom: [0, 3],
  exposure: [0, 3],
  starSize: [0, 3],
  nebula: [0, 2],
  dimFiltered: [0, 1],
};

const BOOLEAN = ['showNebula', 'showLabels', 'motionBlur', 'autoRotate'] as const;

function clamp(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, value));
}

/**
 * Apply stored settings to the store. Call before the UI mounts, so the
 * settings panel renders the restored values rather than flashing defaults.
 */
export function restoreSettings(): void {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Private windows and "block site data" both throw on access, not on read.
    return;
  }
  if (!raw) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (typeof parsed !== 'object' || parsed === null) return;
  const stored = parsed as Record<string, unknown>;

  const patch: Partial<VisualState> = {};
  for (const [key, [min, max]] of Object.entries(NUMERIC)) {
    const value = clamp(stored[key], min, max);
    if (value !== null) patch[key as keyof VisualState] = value as never;
  }
  for (const key of BOOLEAN) {
    if (typeof stored[key] === 'boolean') patch[key] = stored[key] as never;
  }
  if (Object.keys(patch).length > 0) store.patchVisual(patch);
}

/** Persist `visual` on every change. Returns a disposer. */
export function connectSettingsPersistence(): () => void {
  let queued = 0;

  const write = (): void => {
    queued = 0;
    try {
      localStorage.setItem(KEY, JSON.stringify(store.state.visual));
    } catch {
      // Quota, private mode, or a host that blocks storage. Losing the
      // preference is not worth breaking the frame over.
    }
  };

  const off = store.on('visual', () => {
    if (queued) return;
    queued = window.setTimeout(write, WRITE_DELAY_MS);
  });

  // A host app can tear the document down without warning; flush what is
  // pending rather than losing the last edit before someone navigates away.
  const flush = (): void => {
    if (!queued) return;
    clearTimeout(queued);
    write();
  };
  window.addEventListener('pagehide', flush);

  return () => {
    off();
    flush();
    window.removeEventListener('pagehide', flush);
  };
}

/** Forget stored settings and return the store to defaults. */
export function resetSettings(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored, nothing to clear */
  }
  store.patchVisual(defaultVisual());
}
