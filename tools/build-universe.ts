#!/usr/bin/env node
/**
 * Builds public/data/universe.bin + public/data/universe-meta.json from the
 * Scryfall "default_cards" bulk dump at data/raw/default-cards.jsonl.gz.
 *
 * Streams the (gzip-compressed) JSONL file line by line so the ~450MB of
 * decompressed JSON never lives in memory at once -- only the derived typed
 * arrays and small string lookup tables do.
 *
 * Run with: node --max-old-space-size=6144 tools/build-universe.ts
 */

import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { createGunzip } from 'node:zlib';

import {
  COLOR_BIT,
  EPOCH_DAY_ZERO,
  FLAG_BIT,
  FORMAT_BIT,
  ID_BYTES,
  MS_PER_DAY,
  RARITIES,
  TYPE_BIT,
  UNIVERSE_FORMAT_VERSION,
} from '../src/data/format.ts';
import type { ColumnName, ColumnSpec, ColumnType, SetInfo, UniverseMeta } from '../src/data/format.ts';

// --- Paths ------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '..');
const RAW_PATH = path.join(ROOT, 'data/raw/default-cards.jsonl.gz');
const OUT_DIR = path.join(ROOT, 'public/data');
const BIN_PATH = path.join(OUT_DIR, 'universe.bin');
const META_PATH = path.join(OUT_DIR, 'universe-meta.json');

// The raw dump has 117,621 lines; give ourselves headroom without the dump
// growing so much between runs that we'd silently truncate.
const CAPACITY = 130_000;

// --- Host sanity check --------------------------------------------------
// We write column bytes straight out of typed-array backing buffers. Every
// real deployment target (x86_64 / arm64, browser or Node) is little-endian,
// but assert it so a future exotic host fails loudly instead of emitting a
// silently-corrupt universe.bin.
{
  const probe = new Uint32Array([0x01020304]);
  const isLittleEndian = new Uint8Array(probe.buffer)[0] === 0x04;
  if (!isLittleEndian) {
    throw new Error('build-universe.ts must run on a little-endian host');
  }
}

// --- Small helpers --------------------------------------------------

function alignUp4(x: number): number {
  return (x + 3) & ~3;
}

function byteSizeOfType(t: ColumnType): number {
  switch (t) {
    case 'u8':
      return 1;
    case 'u16':
      return 2;
    case 'u32':
      return 4;
    case 'f32':
      return 4;
  }
}

/** Dedupe-and-index a string into (map, arr), returning its stable index. */
function intern(map: Map<string, number>, arr: string[], v: string): number {
  let i = map.get(v);
  if (i === undefined) {
    i = arr.length;
    arr.push(v);
    map.set(v, i);
  }
  return i;
}

/** Days since EPOCH_DAY_ZERO for a "YYYY-MM-DD" string, or null if absent/invalid. */
function releaseDayRaw(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  const t = Date.UTC(y, mo - 1, da);
  if (Number.isNaN(t)) return null;
  return Math.round((t - EPOCH_DAY_ZERO) / MS_PER_DAY);
}

function colorMaskFrom(list: readonly string[] | null | undefined): number {
  if (!list) return 0;
  let m = 0;
  for (const c of list) {
    const bit = (COLOR_BIT as Record<string, number>)[c];
    if (bit) m |= bit;
  }
  return m;
}

const TYPE_WORD_BITS: Array<[RegExp, number]> = [
  [/\bcreature\b/, TYPE_BIT.creature],
  [/\binstant\b/, TYPE_BIT.instant],
  [/\bsorcery\b/, TYPE_BIT.sorcery],
  [/\bartifact\b/, TYPE_BIT.artifact],
  [/\benchantment\b/, TYPE_BIT.enchantment],
  [/\bland\b/, TYPE_BIT.land],
  [/\bplaneswalker\b/, TYPE_BIT.planeswalker],
  [/\bbattle\b/, TYPE_BIT.battle],
  [/\blegendary\b/, TYPE_BIT.legendary],
  [/\bbasic\b/, TYPE_BIT.basic],
];

function typeMaskFor(typeLine: string, layout: string): number {
  const lower = (typeLine || '').toLowerCase();
  let m = 0;
  for (const [re, bit] of TYPE_WORD_BITS) {
    if (re.test(lower)) m |= bit;
  }
  if (layout === 'art_series') {
    // Secret Lair / set-booster art cards: printed objects with no game
    // type_line ("Card" / "Card // Card"). They get their own bit and are
    // never tokens, regardless of what the (non-game) type_line says.
    return m | TYPE_BIT.artSeries;
  }
  const isTokenLayout = layout === 'token' || layout === 'double_faced_token' || layout === 'emblem';
  if (isTokenLayout || /^\s*token\b/i.test(typeLine || '')) {
    m |= TYPE_BIT.token;
  }
  return m;
}

const FORMAT_NAMES = Object.keys(FORMAT_BIT) as Array<keyof typeof FORMAT_BIT>;

function formatMaskFor(legalities: Record<string, string> | undefined): number {
  if (!legalities) return 0;
  let m = 0;
  for (const fname of FORMAT_NAMES) {
    const status = legalities[fname];
    if (status === 'legal') m |= FORMAT_BIT[fname];
    else if (fname === 'vintage' && status === 'restricted') m |= FORMAT_BIT[fname];
  }
  return m;
}

const RARITY_INDEX = new Map<string, number>(RARITIES.map((r, i) => [r, i]));
const COMMON_RARITY_INDEX = RARITY_INDEX.get('common')!;
function rarityIndexFor(r: string | null | undefined): number {
  if (!r) return COMMON_RARITY_INDEX;
  return RARITY_INDEX.get(r) ?? COMMON_RARITY_INDEX;
}

function cmcFor(raw: number | null | undefined): number {
  if (raw === null || raw === undefined) return 255;
  const r = Math.round(raw);
  if (Number.isNaN(r)) return 255;
  return Math.max(0, Math.min(30, r));
}

/**
 * The name to intern for this card. `card.name` is always the English
 * Oracle name (Scryfall's canonical identity), even for printings that have
 * no English release. For those, `printed_name` (or per-face printed_name
 * for multi-faced cards) carries the actual name as printed on the card, in
 * its own language -- which is what a card with no English printing should
 * be searchable by. English rows sometimes carry a `printed_name` too (e.g.
 * Universes Beyond crossover flavor names), but that's a different name for
 * the same English card, not a translation, so English always keeps
 * `card.name`.
 */
function resolveName(card: RawCard): string {
  if (card.lang !== 'en') {
    if (card.printed_name) return card.printed_name;
    const faces = card.card_faces;
    if (Array.isArray(faces) && faces.some((f) => f.printed_name)) {
      return faces.map((f) => f.printed_name ?? f.name ?? '').join(' // ');
    }
  }
  return card.name ?? '';
}

function priceFor(prices: Record<string, string | null> | undefined | null): number {
  if (!prices) return 0;
  let v = prices.usd != null ? parseFloat(prices.usd) : NaN;
  if (!Number.isFinite(v)) {
    v = prices.usd_foil != null ? parseFloat(prices.usd_foil) : NaN;
  }
  return Number.isFinite(v) ? v : 0;
}

interface CardFace {
  name?: string;
  printed_name?: string;
  colors?: string[];
  image_uris?: Record<string, string>;
  oracle_id?: string;
}

interface RawCard {
  object: string;
  id: string;
  oracle_id?: string;
  name: string;
  printed_name?: string;
  lang: string;
  layout: string;
  released_at?: string;
  set: string;
  set_name: string;
  set_type: string;
  artist?: string;
  frame?: string;
  cmc?: number | null;
  type_line?: string;
  colors?: string[];
  color_identity?: string[];
  card_faces?: CardFace[];
  legalities?: Record<string, string>;
  rarity?: string;
  edhrec_rank?: number | null;
  prices?: Record<string, string | null>;
  reprint?: boolean;
  promo?: boolean;
  digital?: boolean;
  full_art?: boolean;
  image_status?: string;
  reserved?: boolean;
  oversized?: boolean;
}

// --- Interning tables -------------------------------------------------

const nameMap = new Map<string, number>();
const names: string[] = [];
const artistMap = new Map<string, number>();
const artists: string[] = [];
const setTypeMap = new Map<string, number>();
const setTypes: string[] = [];
const frameMap = new Map<string, number>();
const frames: string[] = [];

// oracle_id -> dense group index. Not exposed in meta.json (the format
// contract has no `oracles` table) -- it exists purely to give oracleIdx
// stable small integers and to derive meta.stats.oracleCount.
const oracleMap = new Map<string, number>();

interface SetAcc {
  code: string;
  name: string;
  type: number;
  released: number;
  count: number;
}
const setMap = new Map<string, number>();
const sets: SetAcc[] = [];

function updateSet(code: string, name: string, setType: string, rawDay: number | null): number {
  let idx = setMap.get(code);
  if (idx === undefined) {
    const typeIdx = intern(setTypeMap, setTypes, setType || 'other');
    idx = sets.length;
    sets.push({
      code,
      name: name || code,
      type: typeIdx,
      released: rawDay === null ? Number.MAX_SAFE_INTEGER : rawDay,
      count: 0,
    });
    setMap.set(code, idx);
  } else if (rawDay !== null && rawDay < sets[idx]!.released) {
    sets[idx]!.released = rawDay;
  }
  sets[idx]!.count++;
  return idx;
}

// --- Preallocated typed-array columns ----------------------------------

const ids = new Uint8Array(CAPACITY * ID_BYTES);
const nameIdxCol = new Uint32Array(CAPACITY);
const setIdxCol = new Uint16Array(CAPACITY);
const artistIdxCol = new Uint32Array(CAPACITY);
const oracleIdxCol = new Uint32Array(CAPACITY);
const colorIdentityCol = new Uint8Array(CAPACITY);
const colorsCol = new Uint8Array(CAPACITY);
const typeMaskCol = new Uint16Array(CAPACITY);
const formatMaskCol = new Uint16Array(CAPACITY);
const rarityCol = new Uint8Array(CAPACITY);
const setTypeIdxCol = new Uint8Array(CAPACITY);
const frameIdxCol = new Uint8Array(CAPACITY);
const cmcCol = new Uint8Array(CAPACITY);
const releaseDayCol = new Uint16Array(CAPACITY);
const priceCol = new Float32Array(CAPACITY);
const flagsCol = new Uint8Array(CAPACITY);
// Raw edhrec_rank per kept card (-1 = unknown); reduced to `popularity` after
// the whole stream has been seen, since the mapping depends on the global
// distribution of ranks.
const rawRankCol = new Int32Array(CAPACITY).fill(-1);

let n = 0;

// --- Stream the dump ----------------------------------------------------

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  const fileStream = createReadStream(RAW_PATH);
  const gunzip = createGunzip();
  fileStream.pipe(gunzip);
  const rl = createInterface({ input: gunzip, crlfDelay: Infinity });

  let totalLines = 0;
  let droppedObj = 0;
  let droppedParseErr = 0;
  // Not dropped -- these two categories are real, distinct cards. Counted
  // separately purely so the summary stays auditable.
  let keptArtSeries = 0;
  let keptForeignOnly = 0;

  let minReleaseDay = Number.POSITIVE_INFINITY;
  let maxReleaseDay = 0;
  let maxCmcSeen = 0;
  let maxPriceSeen = 0;

  for await (const line of rl) {
    if (!line) continue;
    totalLines++;

    let card: RawCard;
    try {
      card = JSON.parse(line) as RawCard;
    } catch {
      droppedParseErr++;
      continue;
    }

    if (card.object !== 'card') {
      droppedObj++;
      continue;
    }
    if (card.layout === 'art_series') keptArtSeries++;
    if (card.lang !== 'en') keptForeignOnly++;

    if (n >= CAPACITY) {
      throw new Error(`CAPACITY (${CAPACITY}) exceeded at line ${totalLines}; raise it and re-run`);
    }

    const i = n;

    // ids: parse UUID -> 16 raw bytes
    const hex = card.id.replace(/-/g, '');
    const idBuf = Buffer.from(hex, 'hex');
    ids.set(idBuf, i * ID_BYTES);

    // nameIdx / artistIdx
    nameIdxCol[i] = intern(nameMap, names, resolveName(card));
    artistIdxCol[i] = intern(artistMap, artists, card.artist ?? '');

    // oracleIdx (fallback chain for the handful of reversible_card rows that
    // carry oracle_id only on their faces)
    const oid = card.oracle_id ?? card.card_faces?.[0]?.oracle_id ?? card.id;
    let ogroup = oracleMap.get(oid);
    if (ogroup === undefined) {
      ogroup = oracleMap.size;
      oracleMap.set(oid, ogroup);
    }
    oracleIdxCol[i] = ogroup;

    // releaseDay
    const rawDay = releaseDayRaw(card.released_at);
    const clampedDay = rawDay === null ? 0 : Math.max(0, Math.min(65535, rawDay));
    releaseDayCol[i] = clampedDay;
    if (rawDay !== null) {
      if (clampedDay < minReleaseDay) minReleaseDay = clampedDay;
      if (clampedDay > maxReleaseDay) maxReleaseDay = clampedDay;
    }

    // setIdx / setTypeIdx
    const sIdx = updateSet(card.set, card.set_name, card.set_type, rawDay);
    setIdxCol[i] = sIdx;
    setTypeIdxCol[i] = sets[sIdx]!.type;

    // frameIdx
    frameIdxCol[i] = intern(frameMap, frames, card.frame ?? 'unknown');

    // colors (union card_faces when absent at top level) / colorIdentity
    let cardColors = card.colors;
    if (!cardColors && Array.isArray(card.card_faces)) {
      const s = new Set<string>();
      for (const f of card.card_faces) {
        if (Array.isArray(f.colors)) for (const c of f.colors) s.add(c);
      }
      cardColors = [...s];
    }
    colorsCol[i] = colorMaskFrom(cardColors);
    colorIdentityCol[i] = colorMaskFrom(card.color_identity);

    // typeMask / formatMask / rarity
    typeMaskCol[i] = typeMaskFor(card.type_line ?? '', card.layout ?? '');
    formatMaskCol[i] = formatMaskFor(card.legalities);
    rarityCol[i] = rarityIndexFor(card.rarity);

    // cmc
    const cmcV = cmcFor(card.cmc);
    cmcCol[i] = cmcV;
    if (cmcV !== 255 && cmcV > maxCmcSeen) maxCmcSeen = cmcV;

    // price
    const priceV = priceFor(card.prices);
    priceCol[i] = priceV;
    if (priceV > maxPriceSeen) maxPriceSeen = priceV;

    // flags
    const faceImgCount = Array.isArray(card.card_faces)
      ? card.card_faces.filter((f) => f.image_uris).length
      : 0;
    let f = 0;
    if (card.reprint) f |= FLAG_BIT.reprint;
    if (card.promo) f |= FLAG_BIT.promo;
    if (card.digital) f |= FLAG_BIT.digital;
    if (card.full_art) f |= FLAG_BIT.fullArt;
    if (card.image_status === 'highres_scan' || card.image_status === 'lowres') f |= FLAG_BIT.hasImage;
    if (faceImgCount >= 2) f |= FLAG_BIT.multiface;
    if (card.reserved) f |= FLAG_BIT.reserved;
    if (card.oversized) f |= FLAG_BIT.oversized;
    flagsCol[i] = f;

    // popularity input, resolved after the full distribution is known
    rawRankCol[i] = card.edhrec_rank === null || card.edhrec_rank === undefined ? -1 : card.edhrec_rank;

    n++;
  }

  process.stderr.write(
    `Read ${totalLines.toLocaleString()} lines: kept ${n.toLocaleString()} ` +
      `(of which art_series ${keptArtSeries.toLocaleString()}, foreign-only ${keptForeignOnly.toLocaleString()}), ` +
      `dropped non-card ${droppedObj}, parse errors ${droppedParseErr}\n`,
  );

  // --- popularity: rank-based mapping over the *observed* distinct ranks --
  // (not a raw linear scale of the edhrec_rank magnitude, which is long-tailed
  // and would leave most of the 0..65535 range unused near the popular end).
  const popularity = new Uint16Array(n);
  {
    const distinctSet = new Set<number>();
    for (let i = 0; i < n; i++) {
      const r = rawRankCol[i]!;
      if (r >= 0) distinctSet.add(r);
    }
    const distinct = Array.from(distinctSet).sort((a, b) => a - b);
    const maxPos = distinct.length - 1;
    const rankPos = new Map<number, number>();
    distinct.forEach((r, idx) => rankPos.set(r, idx));
    for (let i = 0; i < n; i++) {
      const r = rawRankCol[i]!;
      if (r < 0) {
        popularity[i] = 0;
        continue;
      }
      const pos = rankPos.get(r)!;
      const pct = maxPos === 0 ? 0 : pos / maxPos; // 0 = most popular, 1 = least popular
      popularity[i] = Math.round(1 + 65534 * (1 - pct));
    }
  }

  // finalize set release days (clamp, resolve any never-dated sentinel)
  for (const s of sets) {
    if (s.released === Number.MAX_SAFE_INTEGER) s.released = 0;
    s.released = Math.max(0, Math.min(65535, s.released));
  }

  if (minReleaseDay === Number.POSITIVE_INFINITY) minReleaseDay = 0;

  // --- Assemble the .bin ------------------------------------------------

  const colOrder: ColumnName[] = [
    'ids',
    'nameIdx',
    'setIdx',
    'artistIdx',
    'oracleIdx',
    'colorIdentity',
    'colors',
    'typeMask',
    'formatMask',
    'rarity',
    'setTypeIdx',
    'frameIdx',
    'cmc',
    'releaseDay',
    'popularity',
    'price',
    'flags',
  ];

  const typeOf: Record<ColumnName, ColumnType> = {
    ids: 'u8',
    nameIdx: 'u32',
    setIdx: 'u16',
    artistIdx: 'u32',
    oracleIdx: 'u32',
    colorIdentity: 'u8',
    colors: 'u8',
    typeMask: 'u16',
    formatMask: 'u16',
    rarity: 'u8',
    setTypeIdx: 'u8',
    frameIdx: 'u8',
    cmc: 'u8',
    releaseDay: 'u16',
    popularity: 'u16',
    price: 'f32',
    flags: 'u8',
  };

  type TypedView = Uint8Array | Uint16Array | Uint32Array | Float32Array;
  const viewsByName: Record<ColumnName, TypedView> = {
    ids: ids.subarray(0, n * ID_BYTES),
    nameIdx: nameIdxCol.subarray(0, n),
    setIdx: setIdxCol.subarray(0, n),
    artistIdx: artistIdxCol.subarray(0, n),
    oracleIdx: oracleIdxCol.subarray(0, n),
    colorIdentity: colorIdentityCol.subarray(0, n),
    colors: colorsCol.subarray(0, n),
    typeMask: typeMaskCol.subarray(0, n),
    formatMask: formatMaskCol.subarray(0, n),
    rarity: rarityCol.subarray(0, n),
    setTypeIdx: setTypeIdxCol.subarray(0, n),
    frameIdx: frameIdxCol.subarray(0, n),
    cmc: cmcCol.subarray(0, n),
    releaseDay: releaseDayCol.subarray(0, n),
    popularity: popularity.subarray(0, n),
    price: priceCol.subarray(0, n),
    flags: flagsCol.subarray(0, n),
  };

  const parts: Buffer[] = [];
  let offset = 0;
  const columns = {} as Record<ColumnName, ColumnSpec>;
  const columnByteSizes: Array<[ColumnName, number]> = [];

  for (const name of colOrder) {
    const view = viewsByName[name];
    const byteLen = view.byteLength;
    const buf = Buffer.from(view.buffer, view.byteOffset, byteLen);
    columns[name] = { offset, length: view.length, type: typeOf[name] };
    parts.push(buf);
    offset += byteLen;
    columnByteSizes.push([name, byteLen]);

    const pad = alignUp4(offset) - offset;
    if (pad > 0) {
      parts.push(Buffer.alloc(pad));
      offset += pad;
    }
  }

  const finalBuffer = Buffer.concat(parts, offset);

  const meta: UniverseMeta = {
    version: UNIVERSE_FORMAT_VERSION,
    generatedAt: new Date().toISOString(),
    count: n,
    columns,
    names,
    sets: sets.map((s): SetInfo => ({ code: s.code, name: s.name, type: s.type, released: s.released, count: s.count })),
    artists,
    setTypes,
    frames,
    rarities: [...RARITIES],
    formats: FORMAT_NAMES as string[],
    stats: {
      minReleaseDay,
      maxReleaseDay,
      maxCmc: maxCmcSeen,
      maxPrice: maxPriceSeen,
      oracleCount: oracleMap.size,
    },
  };

  await writeFile(BIN_PATH, finalBuffer);
  const metaJson = JSON.stringify(meta);
  await writeFile(META_PATH, metaJson);

  // --- Summary ------------------------------------------------------

  const minYear = 1993 + Math.floor(minReleaseDay / 365.2425);
  const maxYear = 1993 + Math.floor(maxReleaseDay / 365.2425);

  process.stderr.write('\n--- universe build summary ---\n');
  process.stderr.write(`cards:            ${n.toLocaleString()}\n`);
  process.stderr.write(`  of which art_series (kept, artSeries bit set): ${keptArtSeries.toLocaleString()}\n`);
  process.stderr.write(`  of which foreign-only printings (kept):        ${keptForeignOnly.toLocaleString()}\n`);
  process.stderr.write(`unique names:     ${names.length.toLocaleString()}\n`);
  process.stderr.write(`unique artists:   ${artists.length.toLocaleString()}\n`);
  process.stderr.write(`unique sets:      ${sets.length.toLocaleString()}\n`);
  process.stderr.write(`unique frames:    ${frames.length.toLocaleString()}\n`);
  process.stderr.write(`unique oracle ids:${oracleMap.size.toLocaleString()}\n`);
  process.stderr.write(`year range (approx): ${minYear} - ${maxYear}\n`);
  process.stderr.write('\ncolumn sizes:\n');
  for (const [name, byteLen] of columnByteSizes) {
    process.stderr.write(`  ${name.padEnd(14)} ${byteLen.toLocaleString().padStart(12)} bytes\n`);
  }
  process.stderr.write(`\nuniverse.bin:      ${finalBuffer.byteLength.toLocaleString()} bytes\n`);
  process.stderr.write(`universe-meta.json:${Buffer.byteLength(metaJson).toLocaleString()} bytes\n`);
  process.stderr.write(`\nWrote ${BIN_PATH}\nWrote ${META_PATH}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
