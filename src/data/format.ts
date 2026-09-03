/**
 * Wire format shared by the offline pipeline (tools/build-universe.ts) and the
 * browser. Keep this file dependency-free: both sides import it.
 *
 * The pipeline emits two artefacts into public/data/:
 *   universe.bin       concatenated little-endian typed arrays, one per column
 *   universe-meta.json section table + string lookup tables + stats
 *
 * It deliberately emits NO positions. Positions are derived in the browser from
 * these columns so we can hold several layouts at once and morph between them.
 */

export const UNIVERSE_FORMAT_VERSION = 3;

/** Column names, in the order the pipeline writes them. */
export type ColumnName =
  | 'ids'          // Uint8Array,  16 * N  raw UUID bytes -> image URLs + API lookups
  | 'nameIdx'      // Uint32Array,      N  -> meta.names
  | 'setIdx'       // Uint16Array,      N  -> meta.sets
  | 'artistIdx'    // Uint32Array,      N  -> meta.artists
  | 'oracleIdx'    // Uint32Array,      N  -> groups printings of the same card
  | 'colorIdentity'// Uint8Array,       N  bitmask, see COLOR_BIT
  | 'colors'       // Uint8Array,       N  bitmask of cast colors
  | 'typeMask'     // Uint16Array,      N  bitmask, see TYPE_BIT
  | 'formatMask'   // Uint16Array,      N  bitmask, see FORMAT_BIT (legal only)
  | 'rarity'       // Uint8Array,       N  index into meta.rarities
  | 'setTypeIdx'   // Uint8Array,       N  index into meta.setTypes
  | 'frameIdx'     // Uint8Array,       N  index into meta.frames
  | 'cmc'          // Uint8Array,       N  mana value, clamped 0..30, 255 = none
  | 'releaseDay'   // Uint16Array,      N  days since EPOCH_DAY_ZERO
  | 'popularity'   // Uint16Array,      N  0 = unknown, 65535 = most played
  | 'price'        // Float32Array,     N  USD, 0 = unknown
  | 'flags';       // Uint8Array,       N  bitmask, see FLAG_BIT

export type ColumnType = 'u8' | 'u16' | 'u32' | 'f32';

export interface ColumnSpec {
  /** Byte offset into universe.bin. */
  offset: number;
  /** Element count (N, or 16*N for `ids`). */
  length: number;
  type: ColumnType;
}

export interface SetInfo {
  code: string;
  name: string;
  /** Index into meta.setTypes. */
  type: number;
  /** Days since EPOCH_DAY_ZERO of the set's release. */
  released: number;
  /** How many cards in this universe belong to the set. */
  count: number;
}

export interface UniverseMeta {
  version: number;
  generatedAt: string;
  /** Number of cards. */
  count: number;
  columns: Record<ColumnName, ColumnSpec>;
  names: string[];
  sets: SetInfo[];
  artists: string[];
  setTypes: string[];
  frames: string[];
  rarities: string[];
  formats: string[];
  stats: {
    minReleaseDay: number;
    maxReleaseDay: number;
    maxCmc: number;
    maxPrice: number;
    oracleCount: number;
  };
}

/** All columns are little-endian. `ids` is 16 bytes per card. */
export const ID_BYTES = 16;

/** 1993-01-01, the day before Alpha. releaseDay = days since this date. */
export const EPOCH_DAY_ZERO = Date.UTC(1993, 0, 1);
export const MS_PER_DAY = 86_400_000;

export const COLOR_BIT = { W: 1, U: 2, B: 4, R: 8, G: 16 } as const;
export type ColorLetter = keyof typeof COLOR_BIT;
export const COLOR_LETTERS: ColorLetter[] = ['W', 'U', 'B', 'R', 'G'];

export const TYPE_BIT = {
  creature: 1,
  instant: 2,
  sorcery: 4,
  artifact: 8,
  enchantment: 16,
  land: 32,
  planeswalker: 64,
  battle: 128,
  token: 256,
  legendary: 512,
  basic: 1024,
} as const;
export type TypeName = keyof typeof TYPE_BIT;

export const FORMAT_BIT = {
  standard: 1,
  pioneer: 2,
  modern: 4,
  legacy: 8,
  vintage: 16,
  commander: 32,
  pauper: 64,
  brawl: 128,
  historic: 256,
  alchemy: 512,
  penny: 1024,
  oathbreaker: 2048,
} as const;
export type FormatName = keyof typeof FORMAT_BIT;

export const FLAG_BIT = {
  reprint: 1,
  promo: 2,
  digital: 4,
  fullArt: 8,
  hasImage: 16,
  multiface: 32,
  reserved: 64,
  oversized: 128,
} as const;

/** Canonical rarity order; the pipeline must emit indices into this array. */
export const RARITIES = ['common', 'uncommon', 'rare', 'mythic', 'special', 'bonus'] as const;

export function releaseDayToDate(day: number): Date {
  return new Date(EPOCH_DAY_ZERO + day * MS_PER_DAY);
}

export function releaseDayToYear(day: number): number {
  return releaseDayToDate(day).getUTCFullYear();
}

/** Scryfall CDN path is derived from the UUID; no stored URLs needed. */
export type ImageSize = 'small' | 'normal' | 'large' | 'art_crop' | 'border_crop' | 'png';

export function uuidFromBytes(bytes: Uint8Array, cardIndex: number): string {
  const o = cardIndex * ID_BYTES;
  let hex = '';
  for (let i = 0; i < ID_BYTES; i++) hex += bytes[o + i].toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function imageUrl(uuid: string, size: ImageSize = 'normal', face: 'front' | 'back' = 'front'): string {
  const ext = size === 'png' ? 'png' : 'jpg';
  return `https://cards.scryfall.io/${size}/${face}/${uuid[0]}/${uuid[1]}/${uuid}.${ext}`;
}
