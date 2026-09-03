/**
 * Loads universe.bin / universe-meta.json and exposes the columns as typed
 * arrays, plus the two hot operations everything else depends on: filtering
 * (117k-element tight loop, runs per keystroke) and name search.
 */
import {
  COLOR_BIT, FLAG_BIT, FORMAT_BIT, ID_BYTES, TYPE_BIT,
  imageUrl, releaseDayToDate, releaseDayToYear, uuidFromBytes,
  UNIVERSE_FORMAT_VERSION,
  type ColumnName, type ColumnSpec, type ImageSize, type UniverseMeta,
} from './format.ts';
import type { FilterState } from '../core/store.ts';

const CTOR = {
  u8: Uint8Array, u16: Uint16Array, u32: Uint32Array, f32: Float32Array,
} as const;

type Columns = {
  ids: Uint8Array;
  nameIdx: Uint32Array;
  setIdx: Uint16Array;
  artistIdx: Uint32Array;
  oracleIdx: Uint32Array;
  colorIdentity: Uint8Array;
  colors: Uint8Array;
  typeMask: Uint16Array;
  formatMask: Uint16Array;
  rarity: Uint8Array;
  setTypeIdx: Uint8Array;
  frameIdx: Uint8Array;
  cmc: Uint8Array;
  releaseDay: Uint16Array;
  popularity: Uint16Array;
  price: Float32Array;
  flags: Uint8Array;
};

function view(buf: ArrayBuffer, spec: ColumnSpec) {
  return new CTOR[spec.type](buf, spec.offset, spec.length);
}

export class Universe {
  readonly meta: UniverseMeta;
  readonly count: number;
  readonly col: Columns;
  /** Per-card year, precomputed once; year filtering happens every keystroke. */
  readonly year: Uint16Array;
  /** Lowercased unique names, for search. */
  private readonly lcNames: string[];
  /** Cards sharing a name index, so a search hit can jump to its printings. */
  private nameToCards: Map<number, number[]> | null = null;

  constructor(meta: UniverseMeta, buf: ArrayBuffer) {
    this.meta = meta;
    this.count = meta.count;
    const c = meta.columns;
    this.col = Object.fromEntries(
      (Object.keys(c) as ColumnName[]).map((k) => [k, view(buf, c[k])]),
    ) as unknown as Columns;

    this.year = new Uint16Array(this.count);
    for (let i = 0; i < this.count; i++) this.year[i] = releaseDayToYear(this.col.releaseDay[i]);
    this.lcNames = meta.names.map((n) => n.toLowerCase());
  }

  uuid(i: number): string { return uuidFromBytes(this.col.ids, i); }
  name(i: number): string { return this.meta.names[this.col.nameIdx[i]]; }
  artist(i: number): string { return this.meta.artists[this.col.artistIdx[i]]; }
  set(i: number) { return this.meta.sets[this.col.setIdx[i]]; }
  rarityName(i: number): string { return this.meta.rarities[this.col.rarity[i]]; }
  released(i: number): Date { return releaseDayToDate(this.col.releaseDay[i]); }
  image(i: number, size: ImageSize = 'normal'): string { return imageUrl(this.uuid(i), size); }
  hasFlag(i: number, flag: keyof typeof FLAG_BIT): boolean {
    return (this.col.flags[i] & FLAG_BIT[flag]) !== 0;
  }
  scryfallPage(i: number): string { return `https://scryfall.com/card/${this.uuid(i)}`; }

  /** Colour letters of a card's identity, e.g. ['U','R']. */
  colorLetters(i: number): string[] {
    const m = this.col.colorIdentity[i];
    const out: string[] = [];
    for (const [letter, bit] of Object.entries(COLOR_BIT)) if (m & bit) out.push(letter);
    return out;
  }

  /**
   * Writes 1 into `out` for every card passing the filter, 0 otherwise.
   * Hot path: called on every filter change, so it is a flat typed-array loop
   * with all the branch conditions hoisted out.
   */
  applyFilter(f: FilterState, out: Uint8Array): number {
    const n = this.count;
    const { colorIdentity, typeMask, rarity, formatMask, setIdx, cmc, flags } = this.col;
    const year = this.year;

    let colorMask = 0;
    for (const [letter, bit] of Object.entries(COLOR_BIT)) {
      if (f.colors.has(letter as never)) colorMask |= bit;
    }
    const hasColorFilter = colorMask !== 0;
    const match = f.colorMatch;
    const allowColorless = f.includeColorless;

    let typeReq = 0;
    for (const t of f.types) typeReq |= TYPE_BIT[t];
    let formatReq = 0;
    for (const fmt of f.formats) formatReq |= FORMAT_BIT[fmt];

    const rarityReq = f.rarities.size > 0 ? f.rarities : null;
    const setReq = f.sets.size > 0 ? f.sets : null;
    const [y0, y1] = f.years;
    const [c0, c1] = f.cmc;
    const cmcOpen = c1 >= 30;

    const hideReprints = f.hideReprints;
    const hideDigital = f.hideDigital;
    const hideTokens = f.hideTokens;
    // Art cards are printed objects with no game text; they belong with tokens
    // under the same "things that are not really playable cards" toggle.
    const NON_GAME = TYPE_BIT.token | TYPE_BIT.artSeries;

    // A text query narrows to a name-index set, resolved once up front.
    let nameAllow: Uint8Array | null = null;
    const q = f.query.trim().toLowerCase();
    if (q.length > 0) {
      nameAllow = new Uint8Array(this.meta.names.length);
      const lc = this.lcNames;
      for (let k = 0; k < lc.length; k++) if (lc[k].includes(q)) nameAllow[k] = 1;
    }
    const nameIdx = this.col.nameIdx;

    let pass = 0;
    for (let i = 0; i < n; i++) {
      const fl = flags[i];
      if (hideDigital && fl & FLAG_BIT.digital) { out[i] = 0; continue; }
      if (hideReprints && fl & FLAG_BIT.reprint) { out[i] = 0; continue; }

      const tm = typeMask[i];
      if (hideTokens && tm & NON_GAME) { out[i] = 0; continue; }
      if (typeReq && !(tm & typeReq)) { out[i] = 0; continue; }

      const y = year[i];
      if (y < y0 || y > y1) { out[i] = 0; continue; }

      const mv = cmc[i];
      if (mv !== 255 && (mv < c0 || (!cmcOpen && mv > c1))) { out[i] = 0; continue; }

      if (hasColorFilter) {
        const ci = colorIdentity[i];
        if (ci === 0) {
          if (!allowColorless) { out[i] = 0; continue; }
        } else if (match === 'any') {
          if (!(ci & colorMask)) { out[i] = 0; continue; }
        } else if (match === 'exact') {
          if (ci !== colorMask) { out[i] = 0; continue; }
        } else if (ci & ~colorMask) { out[i] = 0; continue; }
      }

      if (formatReq && !(formatMask[i] & formatReq)) { out[i] = 0; continue; }
      if (rarityReq && !rarityReq.has(rarity[i])) { out[i] = 0; continue; }
      if (setReq && !setReq.has(setIdx[i])) { out[i] = 0; continue; }
      if (nameAllow && !nameAllow[nameIdx[i]]) { out[i] = 0; continue; }

      out[i] = 1;
      pass++;
    }
    return pass;
  }

  /**
   * Name search ranked prefix-first, then word-boundary, then substring.
   * Returns card indices, preferring the most popular printing of each name.
   */
  search(query: string, limit = 40): Int32Array {
    const q = query.trim().toLowerCase();
    if (!q) return new Int32Array(0);
    if (!this.nameToCards) this.buildNameIndex();

    const scored: { nameIdx: number; score: number }[] = [];
    const lc = this.lcNames;
    for (let i = 0; i < lc.length; i++) {
      const name = lc[i];
      const at = name.indexOf(q);
      if (at < 0) continue;
      let score = at === 0 ? 0 : name[at - 1] === ' ' || name[at - 1] === ',' ? 1 : 2;
      score = score * 1000 + Math.min(name.length - q.length, 999);
      scored.push({ nameIdx: i, score });
    }
    scored.sort((a, b) => a.score - b.score);

    const out = new Int32Array(Math.min(limit, scored.length));
    const pop = this.col.popularity;
    for (let k = 0; k < out.length; k++) {
      const cards = this.nameToCards!.get(scored[k].nameIdx)!;
      let best = cards[0];
      for (const c of cards) if (pop[c] > pop[best]) best = c;
      out[k] = best;
    }
    return out;
  }

  /**
   * Index of the card with this Scryfall UUID, or -1.
   *
   * A linear scan rather than a lookup table: building a Map of 117k uuid
   * strings costs several megabytes and this runs at most once per page load,
   * to resolve a shared link.
   */
  indexOfUuid(uuid: string): number {
    const hex = uuid.replace(/-/g, '').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(hex)) return -1;
    const want = new Uint8Array(ID_BYTES);
    for (let i = 0; i < ID_BYTES; i++) want[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);

    const ids = this.col.ids;
    const first = want[0];
    outer: for (let c = 0; c < this.count; c++) {
      const o = c * ID_BYTES;
      if (ids[o] !== first) continue;
      for (let i = 1; i < ID_BYTES; i++) if (ids[o + i] !== want[i]) continue outer;
      return c;
    }
    return -1;
  }

  /** Every printing of the card at index i, oldest first. */
  printingsOf(i: number): number[] {
    if (!this.nameToCards) this.buildNameIndex();
    const cards = this.nameToCards!.get(this.col.nameIdx[i]) ?? [i];
    const day = this.col.releaseDay;
    return [...cards].sort((a, b) => day[a] - day[b]);
  }

  private buildNameIndex(): void {
    const map = new Map<number, number[]>();
    const nameIdx = this.col.nameIdx;
    for (let i = 0; i < this.count; i++) {
      const k = nameIdx[i];
      const list = map.get(k);
      if (list) list.push(i);
      else map.set(k, [i]);
    }
    this.nameToCards = map;
  }
}

export async function loadUniverse(
  onProgress?: (fraction: number, label: string) => void,
): Promise<Universe> {
  onProgress?.(0.02, 'Reading star catalogue');
  const metaRes = await fetch('data/universe-meta.json');
  if (!metaRes.ok) {
    throw new Error(
      'universe-meta.json missing. Run `npm run data:fetch && npm run data:build` first.',
    );
  }
  const meta = (await metaRes.json()) as UniverseMeta;
  if (meta.version !== UNIVERSE_FORMAT_VERSION) {
    throw new Error(
      `Data format v${meta.version} but this build expects v${UNIVERSE_FORMAT_VERSION}. Re-run npm run data:build.`,
    );
  }

  onProgress?.(0.08, 'Downloading star positions');
  const binRes = await fetch('data/universe.bin');
  if (!binRes.ok) throw new Error('universe.bin missing.');

  // Stream so the loading bar reflects reality on a slow connection.
  const total = Number(binRes.headers.get('content-length') ?? 0);
  let buf: ArrayBuffer;
  if (total > 0 && binRes.body) {
    const chunks: Uint8Array[] = [];
    let read = 0;
    const reader = binRes.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      read += value.length;
      onProgress?.(0.08 + 0.62 * (read / total), 'Downloading star positions');
    }
    const merged = new Uint8Array(read);
    let at = 0;
    for (const c of chunks) { merged.set(c, at); at += c.length; }
    buf = merged.buffer;
  } else {
    buf = await binRes.arrayBuffer();
  }

  onProgress?.(0.74, 'Indexing the catalogue');
  const universe = new Universe(meta, buf);
  onProgress?.(0.8, `${universe.count.toLocaleString()} cards charted`);
  return universe;
}

export { ID_BYTES };
