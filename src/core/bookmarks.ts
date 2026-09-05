/**
 * Named views: layout + filter + camera. Visual settings stay in persist.ts.
 */
import { store, defaultFilter, type FilterState, type LayoutMode } from './store.ts';
import type { ColorLetter, FormatName, TypeName } from '../data/format.ts';

const KEY = 'aetherfield.bookmarks.v1';
const MAX = 12;

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

export function loadBookmarks(): Bookmark[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((b) => b && typeof b.id === 'string' && typeof b.name === 'string') as Bookmark[];
  } catch {
    return [];
  }
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
    id: crypto.randomUUID(),
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
