/**
 * Named views: layout + filter + camera. Visual settings stay in persist.ts.
 *
 * Nothing here trusts what it reads back, for exactly the reason `persist.ts`
 * gives: storage is shared with whatever else lives on this origin — inside a
 * host app, that is the host — it survives across versions, and a hand-edited
 * value should not be able to push the renderer somewhere it cannot draw. An
 * unvalidated `layout` reached `store.set('layout', …)` as a live mode name,
 * and a missing `camera` spread into a cue gave the rig a NaN pose.
 */
import { store, defaultFilter, type FilterState, type LayoutMode } from './store.ts';
import type { ColorLetter, FormatName, TypeName } from '../data/format.ts';

const KEY = 'aetherfield.bookmarks.v1';
const MAX = 12;

const LAYOUTS: LayoutMode[] = ['galaxy', 'timeline', 'sets', 'colorwheel', 'sphere', 'price'];

/** A camera far enough out to see something, whatever the stored pose said. */
const FALLBACK_CAMERA: Bookmark['camera'] = {
  theta: 0, phi: 1.1, radius: 620, target: [0, 0, 0],
};

/**
 * `crypto.randomUUID` needs a secure context, which a host app's webview or a
 * plain-http preview is not always going to be.
 */
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try { return crypto.randomUUID(); } catch { /* insecure context */ }
  }
  return `bm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface Bookmark {
  id: string;
  name: string;
  layout: LayoutMode;
  filter: SerializedFilter;
  camera: { theta: number; phi: number; radius: number; target: [number, number, number] };
}

interface SerializedFilter {
  colors: string[];
  colorMatch: FilterState['colorMatch'];
  includeColorless: boolean;
  types: string[];
  rarities: number[];
  formats: string[];
  sets: number[];
  years: [number, number];
  cmc: [number, number];
  query: string;
  hideReprints: boolean;
  hideDigital: boolean;
  hideTokens: boolean;
}

function serializeFilter(f: FilterState): SerializedFilter {
  return {
    colors: [...f.colors],
    colorMatch: f.colorMatch,
    includeColorless: f.includeColorless,
    types: [...f.types],
    rarities: [...f.rarities],
    formats: [...f.formats],
    sets: [...f.sets],
    years: [...f.years] as [number, number],
    cmc: [...f.cmc] as [number, number],
    query: f.query,
    hideReprints: f.hideReprints,
    hideDigital: f.hideDigital,
    hideTokens: f.hideTokens,
  };
}

function applyFilter(s: SerializedFilter): void {
  const base = defaultFilter();
  store.patchFilter({
    colors: new Set(s.colors as ColorLetter[]),
    colorMatch: s.colorMatch,
    includeColorless: s.includeColorless,
    types: new Set(s.types as TypeName[]),
    rarities: new Set(s.rarities),
    formats: new Set(s.formats as FormatName[]),
    sets: new Set(s.sets),
    years: s.years,
    cmc: s.cmc,
    query: s.query,
    hideReprints: s.hideReprints,
    hideDigital: s.hideDigital,
    hideTokens: s.hideTokens,
    oracles: base.oracles,
  });
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** A stored camera pose, or the fallback if any part of it is unusable. */
function readCamera(value: unknown): Bookmark['camera'] {
  if (typeof value !== 'object' || value === null) return FALLBACK_CAMERA;
  const c = value as Record<string, unknown>;
  const t = c.target;
  if (!isFiniteNumber(c.theta) || !isFiniteNumber(c.phi) || !isFiniteNumber(c.radius)) {
    return FALLBACK_CAMERA;
  }
  if (!Array.isArray(t) || t.length !== 3 || !t.every(isFiniteNumber)) return FALLBACK_CAMERA;
  return {
    theta: c.theta,
    phi: Math.min(Math.PI - 0.01, Math.max(0.01, c.phi)),
    radius: Math.min(20000, Math.max(1, c.radius)),
    target: [t[0], t[1], t[2]] as [number, number, number],
  };
}

/** A stored filter, with every field falling back to the default it belongs to. */
function readFilter(value: unknown): SerializedFilter {
  const base = serializeFilter(defaultFilter());
  if (typeof value !== 'object' || value === null) return base;
  const f = value as Record<string, unknown>;

  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const numbers = (v: unknown): number[] =>
    Array.isArray(v) ? v.filter(isFiniteNumber) : [];
  const pair = (v: unknown, fallback: [number, number]): [number, number] =>
    Array.isArray(v) && v.length === 2 && v.every(isFiniteNumber)
      ? [v[0], v[1]] as [number, number]
      : fallback;
  const bool = (v: unknown, fallback: boolean): boolean =>
    typeof v === 'boolean' ? v : fallback;

  return {
    colors: strings(f.colors),
    colorMatch:
      f.colorMatch === 'any' || f.colorMatch === 'exact' || f.colorMatch === 'subset'
        ? f.colorMatch
        : base.colorMatch,
    includeColorless: bool(f.includeColorless, base.includeColorless),
    types: strings(f.types),
    rarities: numbers(f.rarities),
    formats: strings(f.formats),
    sets: numbers(f.sets),
    years: pair(f.years, base.years),
    cmc: pair(f.cmc, base.cmc),
    query: typeof f.query === 'string' ? f.query : base.query,
    hideReprints: bool(f.hideReprints, base.hideReprints),
    hideDigital: bool(f.hideDigital, base.hideDigital),
    hideTokens: bool(f.hideTokens, base.hideTokens),
  };
}

export function loadBookmarks(): Bookmark[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Private windows and "block site data" throw on access, not on read.
    return [];
  }
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: Bookmark[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const b = entry as Record<string, unknown>;
    if (typeof b.id !== 'string' || typeof b.name !== 'string') continue;
    out.push({
      id: b.id,
      name: b.name,
      layout: (LAYOUTS as string[]).includes(b.layout as string)
        ? (b.layout as LayoutMode)
        : 'galaxy',
      filter: readFilter(b.filter),
      camera: readCamera(b.camera),
    });
    if (out.length >= MAX) break;
  }
  return out;
}

function saveAll(list: Bookmark[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch { /* quota */ }
}

export function addBookmark(
  name: string,
  camera: Bookmark['camera'],
): Bookmark[] {
  const list = loadBookmarks();
  list.unshift({
    id: newId(),
    name: name.trim() || 'Untitled view',
    layout: store.state.layout,
    filter: serializeFilter(store.state.filter),
    camera,
  });
  saveAll(list);
  return list;
}

export function removeBookmark(id: string): Bookmark[] {
  const list = loadBookmarks().filter((b) => b.id !== id);
  saveAll(list);
  return list;
}

export function applyBookmark(b: Bookmark): void {
  store.set('layout', b.layout);
  applyFilter(b.filter);
  store.set('cameraCue', { kind: 'bookmark', ...b.camera });
}
