#!/usr/bin/env node
/**
 * Sanity-checks public/data/universe.bin + universe-meta.json.
 *
 * Run with: node tools/verify-universe.ts
 * Exits non-zero if any assertion fails.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  COLOR_BIT,
  COLOR_LETTERS,
  FLAG_BIT,
  FORMAT_BIT,
  ID_BYTES,
  RARITIES,
  TYPE_BIT,
  UNIVERSE_FORMAT_VERSION,
  imageUrl,
  releaseDayToYear,
  uuidFromBytes,
} from '../src/data/format.ts';
import type { ColumnName, ColumnSpec, ColumnType, UniverseMeta } from '../src/data/format.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const BIN_PATH = path.join(ROOT, 'public/data/universe.bin');
const META_PATH = path.join(ROOT, 'public/data/universe-meta.json');

let failures = 0;
function fail(msg: string): void {
  failures++;
  console.error(`FAIL: ${msg}`);
}
function check(cond: boolean, msg: string): void {
  if (!cond) fail(msg);
}

const BYTE_SIZE: Record<ColumnType, number> = { u8: 1, u16: 2, u32: 4, f32: 4 };

async function main(): Promise<void> {
  const metaRaw = await readFile(META_PATH, 'utf8');
  const meta = JSON.parse(metaRaw) as UniverseMeta;
  const bin = await readFile(BIN_PATH);

  console.log(
    `Loaded universe: version=${meta.version} count=${meta.count.toLocaleString()} ` +
      `bin=${bin.byteLength.toLocaleString()} bytes meta=${Buffer.byteLength(metaRaw).toLocaleString()} bytes`,
  );

  check(meta.version === UNIVERSE_FORMAT_VERSION, `meta.version ${meta.version} !== UNIVERSE_FORMAT_VERSION ${UNIVERSE_FORMAT_VERSION}`);

  const N = meta.count;
  check(N > 0, 'meta.count is not positive');
  // The raw Scryfall default_cards dump this pipeline is built from has
  // 117,621 lines, all `object: "card"`; none are dropped (art_series and
  // foreign-only-printing rows are kept, not filtered out).
  check(N === 117_621, `expected exactly 117,621 cards (raw dump line count, none dropped), got ${N}`);

  // --- 1. Column offsets: bounds, 4-byte alignment, no overlap -----------

  const colEntries = Object.entries(meta.columns) as Array<[ColumnName, ColumnSpec]>;
  check(colEntries.length === 17, `expected 17 columns, found ${colEntries.length}`);

  const spans = colEntries.map(([name, spec]) => {
    const byteLen = spec.length * BYTE_SIZE[spec.type];
    return { name, offset: spec.offset, byteLen, end: spec.offset + byteLen };
  });
  for (const s of spans) {
    check(s.offset % 4 === 0, `column ${s.name}: offset ${s.offset} is not 4-byte aligned`);
    check(
      s.offset >= 0 && s.end <= bin.byteLength,
      `column ${s.name}: span [${s.offset}, ${s.end}) exceeds file size ${bin.byteLength}`,
    );
  }
  const sorted = [...spans].sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < sorted.length; i++) {
    check(
      sorted[i]!.offset >= sorted[i - 1]!.end,
      `column ${sorted[i]!.name} (offset ${sorted[i]!.offset}) overlaps ${sorted[i - 1]!.name} (ends ${sorted[i - 1]!.end})`,
    );
  }
  // ids column length is byte count (16*N); every other column's length is N.
  check(meta.columns.ids.length === N * ID_BYTES, `ids.length ${meta.columns.ids.length} !== N*ID_BYTES (${N * ID_BYTES})`);
  for (const name of colEntries.map(([n]) => n)) {
    if (name === 'ids') continue;
    check(meta.columns[name].length === N, `${name}.length ${meta.columns[name].length} !== N (${N})`);
  }

  // --- 2. Column accessors ------------------------------------------------

  function colU8(name: ColumnName) {
    const s = meta.columns[name];
    return (i: number) => bin.readUInt8(s.offset + i);
  }
  function colU16(name: ColumnName) {
    const s = meta.columns[name];
    return (i: number) => bin.readUInt16LE(s.offset + i * 2);
  }
  function colU32(name: ColumnName) {
    const s = meta.columns[name];
    return (i: number) => bin.readUInt32LE(s.offset + i * 4);
  }
  function colF32(name: ColumnName) {
    const s = meta.columns[name];
    return (i: number) => bin.readFloatLE(s.offset + i * 4);
  }
  function idBytes(i: number): Uint8Array {
    const s = meta.columns.ids;
    return bin.subarray(s.offset + i * ID_BYTES, s.offset + (i + 1) * ID_BYTES);
  }

  const readName = colU32('nameIdx');
  const readSet = colU16('setIdx');
  const readArtist = colU32('artistIdx');
  const readOracle = colU32('oracleIdx');
  const readColorIdentity = colU8('colorIdentity');
  const readColors = colU8('colors');
  const readTypeMask = colU16('typeMask');
  const readFormatMask = colU16('formatMask');
  const readRarity = colU8('rarity');
  const readSetTypeIdx = colU8('setTypeIdx');
  const readFrameIdx = colU8('frameIdx');
  const readCmc = colU8('cmc');
  const readReleaseDay = colU16('releaseDay');
  const readPopularity = colU16('popularity');
  const readPrice = colF32('price');
  const readFlags = colU8('flags');

  // --- 3. Index columns are in range of their lookup tables ---------------

  let badName = 0,
    badArtist = 0,
    badSet = 0,
    badSetType = 0,
    badFrame = 0,
    badRarity = 0,
    badOracle = 0,
    badFormatBits = 0,
    badTypeBits = 0,
    badFlagBits = 0;

  const KNOWN_FORMAT_BITS = Object.values(FORMAT_BIT).reduce((a, b) => a | b, 0);
  const KNOWN_TYPE_BITS = Object.values(TYPE_BIT).reduce((a, b) => a | b, 0);
  const KNOWN_FLAG_BITS = Object.values(FLAG_BIT).reduce((a, b) => a | b, 0);

  const yearCounts = new Map<number, number>();
  const colorIdentityCounts = new Map<number, number>();

  for (let i = 0; i < N; i++) {
    if (readName(i) >= meta.names.length) badName++;
    if (readArtist(i) >= meta.artists.length) badArtist++;
    if (readSet(i) >= meta.sets.length) badSet++;
    if (readSetTypeIdx(i) >= meta.setTypes.length) badSetType++;
    if (readFrameIdx(i) >= meta.frames.length) badFrame++;
    if (readRarity(i) >= meta.rarities.length) badRarity++;
    if (readOracle(i) >= meta.stats.oracleCount) badOracle++;
    if ((readFormatMask(i) & ~KNOWN_FORMAT_BITS) !== 0) badFormatBits++;
    if ((readTypeMask(i) & ~KNOWN_TYPE_BITS) !== 0) badTypeBits++;
    if ((readFlags(i) & ~KNOWN_FLAG_BITS) !== 0) badFlagBits++;

    const year = releaseDayToYear(readReleaseDay(i));
    yearCounts.set(year, (yearCounts.get(year) ?? 0) + 1);
    const ci = readColorIdentity(i);
    colorIdentityCounts.set(ci, (colorIdentityCounts.get(ci) ?? 0) + 1);
  }

  check(badName === 0, `${badName} rows have out-of-range nameIdx`);
  check(badArtist === 0, `${badArtist} rows have out-of-range artistIdx`);
  check(badSet === 0, `${badSet} rows have out-of-range setIdx`);
  check(badSetType === 0, `${badSetType} rows have out-of-range setTypeIdx`);
  check(badFrame === 0, `${badFrame} rows have out-of-range frameIdx`);
  check(badRarity === 0, `${badRarity} rows have out-of-range rarity`);
  check(badOracle === 0, `${badOracle} rows have out-of-range oracleIdx (>= oracleCount ${meta.stats.oracleCount})`);
  check(badFormatBits === 0, `${badFormatBits} rows have unknown bits set in formatMask`);
  check(badTypeBits === 0, `${badTypeBits} rows have unknown bits set in typeMask`);
  check(badFlagBits === 0, `${badFlagBits} rows have unknown bits set in flags`);

  // setIdx -> sets[].type must itself be in range of setTypes
  let badSetsType = 0;
  for (const s of meta.sets) {
    if (s.type < 0 || s.type >= meta.setTypes.length) badSetsType++;
  }
  check(badSetsType === 0, `${badSetsType} meta.sets entries have out-of-range .type`);

  // --- 4. Round-trip a few known cards ------------------------------------

  function colorLetters(mask: number): string {
    const letters = COLOR_LETTERS.filter((l) => (mask & COLOR_BIT[l]) !== 0).join('');
    return letters || 'C';
  }

  function decode(i: number) {
    const uuid = uuidFromBytes(idBytes(i), 0);
    const set = meta.sets[readSet(i)];
    return {
      i,
      uuid,
      name: meta.names[readName(i)],
      set: set?.code,
      setName: set?.name,
      artist: meta.artists[readArtist(i)],
      rarity: meta.rarities[readRarity(i)],
      frame: meta.frames[readFrameIdx(i)],
      cmc: readCmc(i),
      releaseDay: readReleaseDay(i),
      year: releaseDayToYear(readReleaseDay(i)),
      colorIdentity: colorLetters(readColorIdentity(i)),
      colors: colorLetters(readColors(i)),
      popularity: readPopularity(i),
      price: readPrice(i),
      typeMask: readTypeMask(i),
      flags: readFlags(i),
      imageUrl: imageUrl(uuid, 'normal'),
    };
  }

  function findByUuid(uuid: string): number {
    const target = Buffer.from(uuid.replace(/-/g, ''), 'hex');
    const s = meta.columns.ids;
    for (let i = 0; i < N; i++) {
      const off = s.offset + i * ID_BYTES;
      if (target.compare(bin, off, off + ID_BYTES) === 0) return i;
    }
    return -1;
  }

  function findFirstByName(name: string): number {
    const idx = meta.names.indexOf(name);
    if (idx === -1) return -1;
    for (let i = 0; i < N; i++) if (readName(i) === idx) return i;
    return -1;
  }

  console.log('\n--- spot checks ---');

  // Black Lotus, Vintage Masters printing
  const lotusUuid = 'bd8fa327-dd41-4737-8f19-2cf5eb1f7cdd';
  const lotusIdx = findByUuid(lotusUuid);
  check(lotusIdx !== -1, `Black Lotus (${lotusUuid}) not found in universe`);
  if (lotusIdx !== -1) {
    const d = decode(lotusIdx);
    console.log('Black Lotus:', d);
    check(d.name === 'Black Lotus', `Black Lotus: name is "${d.name}"`);
    check((d.typeMask & TYPE_BIT.artifact) !== 0, 'Black Lotus: expected artifact type bit');
    check(d.colorIdentity === 'C', `Black Lotus: expected colorless identity, got ${d.colorIdentity}`);
    check(d.cmc === 0, `Black Lotus: expected cmc 0, got ${d.cmc}`);
  }

  // Lightning Bolt (any printing)
  const boltIdx = findFirstByName('Lightning Bolt');
  check(boltIdx !== -1, 'Lightning Bolt not found in universe');
  if (boltIdx !== -1) {
    const d = decode(boltIdx);
    console.log('Lightning Bolt:', d);
    check(d.colors.includes('R'), `Lightning Bolt: expected red in colors, got ${d.colors}`);
    check(d.cmc === 1, `Lightning Bolt: expected cmc 1, got ${d.cmc}`);
    check((d.typeMask & TYPE_BIT.instant) !== 0, 'Lightning Bolt: expected instant type bit');
  }

  // Sol Ring (any printing)
  const solRingIdx = findFirstByName('Sol Ring');
  check(solRingIdx !== -1, 'Sol Ring not found in universe');
  if (solRingIdx !== -1) {
    const d = decode(solRingIdx);
    console.log('Sol Ring:', d);
    check((d.typeMask & TYPE_BIT.artifact) !== 0, 'Sol Ring: expected artifact type bit');
    check(d.cmc === 1, `Sol Ring: expected cmc 1, got ${d.cmc}`);
  }

  // Basic Island (any printing)
  const islandIdx = findFirstByName('Island');
  check(islandIdx !== -1, 'Island not found in universe');
  if (islandIdx !== -1) {
    const d = decode(islandIdx);
    console.log('Island:', d);
    check((d.typeMask & TYPE_BIT.land) !== 0, 'Island: expected land type bit');
    check((d.typeMask & TYPE_BIT.basic) !== 0, 'Island: expected basic type bit');
    check(d.colors === 'C', `Island: expected no cast colors (it has no mana cost), got ${d.colors}`);
    check(d.colorIdentity === 'U', `Island: expected blue color identity (taps for U), got ${d.colorIdentity}`);
  }

  // --- 4b. Foreign-only printings and art-series cards --------------------
  // Scryfall's default_cards dump carries one row per printing in English,
  // or in the printed language when a card has NO English printing at all.
  // Those non-English rows, and art_series (Secret Lair / set-booster art
  // card) rows, are real distinct printed cards and must be present -- the
  // universe must NOT be built as if every card is English or has a game
  // type_line.

  // Foreign Black Border (fbb) -- French Island, printed_name "Ile" must be
  // interned as-is (not the English Oracle name "Island").
  const fbbIdx = findByUuid('001eb913-2afe-4d7d-89a1-7c35de92d702');
  check(fbbIdx !== -1, 'fbb Island (French, no English printing) not found in universe');
  if (fbbIdx !== -1) {
    const d = decode(fbbIdx);
    console.log('fbb (Foreign Black Border) Island:', d);
    check(d.set === 'fbb', `fbb Island: expected set "fbb", got "${d.set}"`);
    check(d.name === 'Ile', `fbb Island: expected French printed_name "Ile", got "${d.name}"`);
    check((d.typeMask & TYPE_BIT.land) !== 0, 'fbb Island: expected land type bit');
  }

  // Rinascimento (rin) -- Italian-exclusive reprint set, printed_name carries
  // the actual Italian name and must be interned as-is (not the English name).
  const rinIdx = findByUuid('00fe59e8-d1ab-4f74-a7f4-a8feca3705ee');
  check(rinIdx !== -1, "Rinascimento Urza's Power Plant not found in universe");
  if (rinIdx !== -1) {
    const d = decode(rinIdx);
    console.log('rin (Rinascimento) Centrale Energetica di Urza:', d);
    check(d.set === 'rin', `rin card: expected set "rin", got "${d.set}"`);
    check(
      d.name === 'Centrale Energetica di Urza',
      `rin card: expected Italian printed_name "Centrale Energetica di Urza", got "${d.name}"`,
    );
  }

  // Secrets of Strixhaven Mystical Archive (soa) -- Japanese-exclusive
  // printed_name, non-Latin script interned exactly as-is.
  const soaIdx = findByUuid('00f97ece-f7c5-4ae9-b680-40f2cbbed22c');
  check(soaIdx !== -1, 'soa Crop Rotation (Japanese) not found in universe');
  if (soaIdx !== -1) {
    const d = decode(soaIdx);
    console.log('soa (Mystical Archive) 輪作:', d);
    check(d.set === 'soa', `soa card: expected set "soa", got "${d.set}"`);
    check(d.name === '輪作', `soa card: expected Japanese printed_name "輪作", got "${d.name}"`);
  }

  // An art_series card: physically printed (Secret Lair / set booster art
  // card), must carry the artSeries type bit, and since its type_line is a
  // non-game "Card" / "Card // Card" it must have NO other game type bits
  // (in particular not `token`, a distinct category) -- typeMask consisting
  // of exactly one bit is expected and fine, not a defect.
  const artIdx = findByUuid('000225fc-9bc3-4eb3-905e-02c19c873b0b');
  check(artIdx !== -1, 'art_series card (Fell Beast\'s Shriek) not found in universe');
  if (artIdx !== -1) {
    const d = decode(artIdx);
    console.log("art_series Fell Beast's Shriek:", d);
    check((d.typeMask & TYPE_BIT.artSeries) !== 0, 'art_series card: expected artSeries type bit');
    check((d.typeMask & TYPE_BIT.token) === 0, 'art_series card: must NOT have the token bit set');
    check(
      (d.typeMask & ~TYPE_BIT.artSeries) === 0,
      `art_series card: expected no other type bits set alongside artSeries, got mask ${d.typeMask}`,
    );
  }

  // Aggregate: art_series cards are a known, fixed count in this dump (they
  // are kept, not dropped) and every one of them must carry the artSeries
  // bit -- and nothing outside that count should carry it.
  let artSeriesBitCount = 0;
  let artSeriesWithTokenBit = 0;
  for (let i = 0; i < N; i++) {
    const mask = readTypeMask(i);
    if ((mask & TYPE_BIT.artSeries) !== 0) {
      artSeriesBitCount++;
      if ((mask & TYPE_BIT.token) !== 0) artSeriesWithTokenBit++;
    }
  }
  check(artSeriesBitCount === 2650, `expected exactly 2,650 cards with the artSeries bit set, got ${artSeriesBitCount}`);
  check(artSeriesWithTokenBit === 0, `${artSeriesWithTokenBit} art_series cards incorrectly also have the token bit set`);

  // --- 5. Distributions -----------------------------------------------

  console.log('\n--- cards per year ---');
  for (const year of [...yearCounts.keys()].sort((a, b) => a - b)) {
    console.log(`  ${year}: ${yearCounts.get(year)!.toLocaleString()}`);
  }

  console.log('\n--- cards per color identity ---');
  const ciRows = [...colorIdentityCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [mask, count] of ciRows) {
    console.log(`  ${colorLetters(mask).padEnd(6)} ${count.toLocaleString()}`);
  }

  // --- 6. stats sanity -----------------------------------------------

  check(meta.stats.minReleaseDay >= 0, 'stats.minReleaseDay negative');
  check(meta.stats.maxReleaseDay >= meta.stats.minReleaseDay, 'stats.maxReleaseDay < minReleaseDay');
  check(meta.stats.maxCmc >= 0 && meta.stats.maxCmc <= 30, `stats.maxCmc out of expected range: ${meta.stats.maxCmc}`);
  check(meta.stats.maxPrice >= 0, 'stats.maxPrice negative');
  check(meta.stats.oracleCount > 0 && meta.stats.oracleCount <= N, `stats.oracleCount implausible: ${meta.stats.oracleCount}`);
  check(meta.rarities.length === RARITIES.length, 'meta.rarities does not match RARITIES contract');

  // sets[].count should sum to N
  const setCountSum = meta.sets.reduce((a, s) => a + s.count, 0);
  check(setCountSum === N, `sum of meta.sets[].count (${setCountSum}) !== card count (${N})`);

  console.log(`\n--- ${failures === 0 ? 'PASS' : 'FAIL'} (${failures} failure${failures === 1 ? '' : 's'}) ---`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
