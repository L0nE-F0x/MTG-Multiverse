/**
 * Tiny reactive store. The single seam between the UI layer and the renderer:
 * the UI only ever mutates state through here, the renderer only ever reads it
 * and subscribes. Neither imports the other.
 */
import type { ColorLetter, FormatName, TypeName } from '../data/format.ts';

export type LayoutMode =
  | 'galaxy'    // spiral arms by colour, radius by release date  (the default)
  | 'timeline'  // helix through time, one coil per year
  | 'sets'      // every set its own globular cluster on a grid
  | 'colorwheel'// five-lobed colour identity wheel
  | 'sphere'    // rarity shells
  | 'price';    // value landscape

export type ColorMatch = 'any' | 'exact' | 'subset';

/** Which shell the UI is showing. The renderer reads this to ignore flight keys. */
export type ShellMode = 'title' | 'play';

export interface FilterState {
  /** Empty set = no colour constraint. */
  colors: Set<ColorLetter>;
  colorMatch: ColorMatch;
  includeColorless: boolean;
  /** Empty set = no constraint, for each of these. */
  types: Set<TypeName>;
  rarities: Set<number>;
  formats: Set<FormatName>;
  sets: Set<number>;
  /** Inclusive year bounds. */
  years: [number, number];
  /** Inclusive mana-value bounds; upper bound of 30 means "and above". */
  cmc: [number, number];
  /** Free-text, matched against card name. */
  query: string;
  hideReprints: boolean;
  hideDigital: boolean;
  hideTokens: boolean;
}

export interface VisualState {
  bloom: number;
  exposure: number;
  starSize: number;
  nebula: number;
  showNebula: boolean;
  showLabels: boolean;
  motionBlur: boolean;
  dimFiltered: number;
  /** 0 = free flight, 1 = orbiting the selection. */
  autoRotate: boolean;
}

/**
 * How much of the canvas the UI panels cover, in CSS pixels.
 *
 * The renderer cannot read the DOM and the UI cannot import three — the store
 * is the only channel between them — so the panels report what they occlude
 * and the camera frames the space that is left. Without this the galaxy
 * centres on the whole canvas and the filter panel sits over its left third,
 * which is exactly how it looked embedded in a host app with a sidebar.
 */
export interface ViewInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Stats {
  fps: number;
  visible: number;
  total: number;
  drawCalls: number;
  ms: number;
}

export interface AppState {
  ready: boolean;
  loadProgress: number;
  loadLabel: string;
  /** Title screen vs the interactive galaxy. Defaults to title so every visit starts there. */
  shell: ShellMode;
  layout: LayoutMode;
  filter: FilterState;
  visual: VisualState;
  /** Card index under the cursor, or -1. */
  hovered: number;
  /** Card index of the opened card, or -1. */
  selected: number;
  /** Result card indices for the current query, most relevant first. */
  results: Int32Array;
  matchCount: number;
  stats: Stats;
  /** Canvas area covered by UI. See ViewInsets. */
  insets: ViewInsets;
}

export function defaultFilter(): FilterState {
  return {
    colors: new Set(),
    colorMatch: 'any',
    includeColorless: false,
    types: new Set(),
    rarities: new Set(),
    formats: new Set(),
    sets: new Set(),
    years: [1993, 2030],
    cmc: [0, 30],
    query: '',
    hideReprints: false,
    hideDigital: false,
    hideTokens: true,
  };
}

export function defaultInsets(): ViewInsets {
  return { left: 0, right: 0, top: 0, bottom: 0 };
}

export function defaultVisual(): VisualState {
  return {
    bloom: 1.0,
    exposure: 1.0,
    starSize: 1.0,
    nebula: 1.0,
    showNebula: true,
    showLabels: true,
    motionBlur: true,
    dimFiltered: 0.018,
    autoRotate: true,
  };
}

type Listener<T> = (value: T, prev: T) => void;

/** Keys of AppState that can be subscribed to individually. */
export type StateKey = keyof AppState;

class Store {
  readonly state: AppState = {
    ready: false,
    loadProgress: 0,
    loadLabel: 'Charting the aether',
    shell: 'title',
    layout: 'galaxy',
    filter: defaultFilter(),
    visual: defaultVisual(),
    hovered: -1,
    selected: -1,
    results: new Int32Array(0),
    matchCount: 0,
    stats: { fps: 0, visible: 0, total: 0, drawCalls: 0, ms: 0 },
    insets: defaultInsets(),
  };

  private listeners = new Map<StateKey, Set<Listener<never>>>();
  private anyListeners = new Set<(keys: StateKey[]) => void>();
  private pending = new Set<StateKey>();
  private flushQueued = false;

  /** Subscribe to one key. Returns an unsubscribe function. */
  on<K extends StateKey>(key: K, fn: Listener<AppState[K]>): () => void {
    let set = this.listeners.get(key);
    if (!set) this.listeners.set(key, (set = new Set()));
    set.add(fn as Listener<never>);
    return () => set!.delete(fn as Listener<never>);
  }

  /** Subscribe to every change; receives the batch of changed keys. */
  onAny(fn: (keys: StateKey[]) => void): () => void {
    this.anyListeners.add(fn);
    return () => this.anyListeners.delete(fn);
  }

  /**
   * Replace a top-level key. Notification is batched to a microtask so a burst
   * of related updates (e.g. filter + results) lands as one repaint.
   */
  set<K extends StateKey>(key: K, value: AppState[K]): void {
    const prev = this.state[key];
    if (prev === value) return;
    this.state[key] = value;
    this.pending.add(key);
    this.queueFlush();
    const set = this.listeners.get(key);
    if (set) for (const fn of set) (fn as Listener<AppState[K]>)(value, prev);
  }

  /** Mutate in place then announce, for the objects we do not want to clone. */
  touch(key: StateKey): void {
    this.pending.add(key);
    this.queueFlush();
    const set = this.listeners.get(key);
    if (set) {
      const v = this.state[key];
      for (const fn of set) (fn as Listener<never>)(v as never, v as never);
    }
  }

  patchFilter(patch: Partial<FilterState>): void {
    Object.assign(this.state.filter, patch);
    this.touch('filter');
  }

  patchVisual(patch: Partial<VisualState>): void {
    Object.assign(this.state.visual, patch);
    this.touch('visual');
  }

  private queueFlush(): void {
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => {
      this.flushQueued = false;
      const keys = [...this.pending];
      this.pending.clear();
      if (keys.length === 0) return;
      for (const fn of this.anyListeners) fn(keys);
    });
  }
}

export const store = new Store();
