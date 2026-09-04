/**
 * Position generators. Every layout maps the same 117k cards into a different
 * spatial argument, and all of them write into a flat Float32Array of xyz so
 * the renderer can morph between any two on the GPU.
 *
 * The guiding rule: nothing here is decorative. If a card is somewhere, the
 * position means something you could read off the screen.
 */
import { COLOR_BIT, TYPE_BIT, releaseDayToYear } from '../data/format.ts';
import type { Universe } from '../data/universe.ts';
import type { LayoutMode } from '../core/store.ts';

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export const GALAXY_RADIUS = 320;

/** Integer hash -> [0,1). Deterministic, so layouts are stable across reloads. */
function hash(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
const hash2 = (n: number, salt: number) => hash(n ^ Math.imul(salt + 1, 0x27d4eb2d));

/** Cheap approximately-normal deviate in roughly [-1.5, 1.5]. */
function gauss(n: number, salt: number): number {
  return (hash2(n, salt) + hash2(n, salt + 101) + hash2(n, salt + 202)) - 1.5;
}

/** The five colours sit on a pentagon in WUBRG order — Magic's own colour wheel. */
const COLOR_ANGLE: Record<number, number> = {
  [COLOR_BIT.W]: 0,
  [COLOR_BIT.U]: TAU / 5,
  [COLOR_BIT.B]: (2 * TAU) / 5,
  [COLOR_BIT.R]: (3 * TAU) / 5,
  [COLOR_BIT.G]: (4 * TAU) / 5,
};

/**
 * Angle and off-plane band for each of the 32 colour identities, resolved once.
 * Mono colours land on their pentagon vertex; a guild lands on the circular
 * mean of its two, which puts Azorius exactly between white and blue. Identities
 * whose vectors cancel (five-colour, and some wedges) get a stable hashed angle
 * instead of an undefined one, and colour count lifts each population onto its
 * own layer so a Golgari card never hides inside the mono-black arm.
 */
const IDENTITY_TABLE: { angle: number; band: number; count: number }[] = (() => {
  const table: { angle: number; band: number; count: number }[] = [];
  for (let mask = 0; mask < 32; mask++) {
    let vx = 0, vy = 0, count = 0;
    for (const bit of [COLOR_BIT.W, COLOR_BIT.U, COLOR_BIT.B, COLOR_BIT.R, COLOR_BIT.G]) {
      if (mask & bit) {
        vx += Math.cos(COLOR_ANGLE[bit]);
        vy += Math.sin(COLOR_ANGLE[bit]);
        count++;
      }
    }
    const mag = Math.hypot(vx, vy);
    const angle = mag < 1e-3 ? hash(mask * 7919) * TAU : Math.atan2(vy, vx);
    // Alternate layers above and below the plane so populations interleave
    // instead of stacking into a wedge.
    const band = count === 0 ? 0 : (count - 1) * (mask % 2 === 0 ? 9 : -9);
    table.push({ angle, band, count });
  }
  return table;
})();

/** Cached per-universe derived orderings the layouts share. */
export class LayoutContext {
  readonly universe: Universe;
  /** Position of each card in chronological order, 0..N-1. */
  readonly chronoRank: Float32Array;
  /** Set index -> position in release order. */
  readonly setOrder: Uint16Array;
  readonly yearMin: number;
  readonly yearMax: number;
  /** Card indices in release order. */
  readonly chronoOrder: Uint32Array;
  /** Position through its own year's releases, 0..1. */
  readonly yearRank: Float32Array;
  /** Rank among priced cards, 0 = most expensive, normalised 0..1; -1 = no price. */
  private priceRankCache: Float32Array | null = null;

  constructor(universe: Universe) {
    this.universe = universe;
    const n = universe.count;
    const day = universe.col.releaseDay;

    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    // Sorting by day alone leaves whole sets in arbitrary internal order, which
    // makes clusters flicker between rebuilds; tie-break on index for stability.
    const sorted = Array.prototype.slice.call(order) as number[];
    sorted.sort((a, b) => day[a] - day[b] || a - b);

    this.chronoRank = new Float32Array(n);
    for (let r = 0; r < n; r++) this.chronoRank[sorted[r]] = r / (n - 1);
    this.chronoOrder = Uint32Array.from(sorted);

    // Position within the card's own year, by release order. Magic ships in
    // four to six bursts a year, so using the raw date as an angle leaves most
    // of a ring empty; ranking within the year spreads it evenly while staying
    // monotone in date, so the angle still means "when during this year".
    const perYearCount = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const y = releaseDayToYear(day[i]);
      perYearCount.set(y, (perYearCount.get(y) ?? 0) + 1);
    }
    this.yearRank = new Float32Array(n);
    const seen = new Map<number, number>();
    for (let r = 0; r < n; r++) {
      const i = sorted[r];
      const y = releaseDayToYear(day[i]);
      const k = seen.get(y) ?? 0;
      seen.set(y, k + 1);
      this.yearRank[i] = k / Math.max(1, perYearCount.get(y)! - 1);
    }

    let yMin = 9999, yMax = 0;
    for (let i = 0; i < n; i++) {
      const y = releaseDayToYear(day[i]);
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
    this.yearMin = yMin;
    this.yearMax = yMax;

    const sets = universe.meta.sets;
    const setIdx = sets.map((_, i) => i);
    setIdx.sort((a, b) => sets[a].released - sets[b].released || a - b);
    this.setOrder = new Uint16Array(sets.length);
    for (let r = 0; r < setIdx.length; r++) this.setOrder[setIdx[r]] = r;
  }

  /**
   * Built on first use: only the price layout needs it, and sorting 112k cards
   * is not worth doing at startup for a view most sessions never open.
   */
  get priceRank(): Float32Array {
    if (this.priceRankCache) return this.priceRankCache;
    const usd = this.universe.col.price;
    const n = this.universe.count;

    const priced: number[] = [];
    for (let i = 0; i < n; i++) if (usd[i] > 0) priced.push(i);
    priced.sort((a, b) => usd[b] - usd[a] || a - b);

    const rank = new Float32Array(n).fill(-1);
    const denom = Math.max(1, priced.length - 1);
    for (let r = 0; r < priced.length; r++) rank[priced[r]] = r / denom;
    this.priceRankCache = rank;
    return rank;
  }
}

export function computeLayout(mode: LayoutMode, ctx: LayoutContext, out: Float32Array): void {
  switch (mode) {
    case 'galaxy': return galaxy(ctx, out);
    case 'timeline': return timeline(ctx, out);
    case 'sets': return sets(ctx, out);
    case 'colorwheel': return colorwheel(ctx, out);
    case 'sphere': return sphere(ctx, out);
    case 'price': return price(ctx, out);
  }
}

/**
 * The default view. Radius is chronological rank under a square root, which
 * spreads equal numbers of cards over equal area — so the disc has even surface
 * density instead of piling up in the modern era where printing exploded.
 * Angle is colour identity, wound into a logarithmic spiral. The result is a
 * barred spiral whose arms are literally the colour pie and whose radius is
 * literally time: Alpha in the core, this year's set at the rim.
 */
function galaxy(ctx: LayoutContext, out: Float32Array): void {
  const { universe, chronoRank } = ctx;
  const n = universe.count;
  const { colorIdentity, typeMask, setIdx, oracleIdx } = universe.col;

  const TWIST = 0.0092;
  const ARM_SIGMA = 0.19;
  const CORE = 30;

  for (let i = 0; i < n; i++) {
    const id = IDENTITY_TABLE[colorIdentity[i] & 31];
    const isLand = (typeMask[i] & TYPE_BIT.land) !== 0;

    // sqrt of rank gives constant surface density; the extra core term keeps a
    // dense bulge rather than a hole at the centre.
    const t = chronoRank[i];
    let r = CORE + (GALAXY_RADIUS - CORE) * Math.sqrt(t);

    let theta: number;
    let thickness: number;

    if (id.count === 0 && !isLand) {
      // Colourless artifacts belong to no arm, so they become the halo: full
      // circle, thick, faintly filling the space between the arms.
      //
      // The angle is keyed to the *card*, not the printing. Hashing the row
      // index instead scattered Sol Ring's 133 printings around the whole
      // circle, which is arbitrary — a coloured card's reprints all share an
      // arm, so a colourless one should share a direction. Now its reprints
      // run outward from the core through the eras that reprinted it, exactly
      // as radius-is-time promises.
      theta = hash2(oracleIdx[i], 11) * TAU;
      thickness = 26 + 0.09 * r;
    } else {
      // A small per-set angular offset makes each set clump slightly inside its
      // arm, so sets read as knots along the spiral.
      const setJitter = (hash(setIdx[i] * 2654435761) - 0.5) * 0.22;
      theta = id.angle + setJitter + gauss(i, 3) * ARM_SIGMA;
      thickness = 7 + 0.028 * r;
      if (isLand) r *= 1.06; // lands ride just outside their arm
    }

    theta += r * TWIST;

    const y = id.band * 0.5 + gauss(i, 7) * thickness;
    const o = i * 3;
    out[o] = Math.cos(theta) * r;
    out[o + 1] = y;
    out[o + 2] = Math.sin(theta) * r;
  }
}

/**
 * Tree rings: one concentric ring per year.
 *
 * Two earlier attempts failed for the same underlying reason — too many turns.
 * A vertical helix could not be given a pitch comparable to its radius over 33
 * years without becoming absurdly tall, and a continuous outward spiral blurred
 * into a filled disc wherever the years were dense, because adjacent turns sit
 * closer together than a single set's own spread.
 *
 * Making the radius depend on the year *discretely* solves it: every card in a
 * year lands on one thin ring, which leaves a clean gap before the next. The
 * result reads immediately, and the widths tell the real story — Alpha is a
 * faint thread near the middle and the modern rings are dense bright bands.
 *
 * Angle is the card's position through that year's releases rather than the
 * raw date: Magic ships in a handful of bursts each year, so a date-based angle
 * leaves most of every ring empty. Ranking within the year fills the circle
 * while staying monotone in date. Height is mana value.
 */
function timeline(ctx: LayoutContext, out: Float32Array): void {
  const { universe, yearRank, yearMin } = ctx;
  const n = universe.count;
  const { cmc, releaseDay } = universe.col;

  const R0 = 40;
  const RING = 22;   // radial gap between year rings

  for (let i = 0; i < n; i++) {
    const year = releaseDayToYear(releaseDay[i]);

    // Thin relative to RING: this gap is the whole point.
    const r = R0 + (year - yearMin) * RING + gauss(i, 13) * 2.2;
    const theta = yearRank[i] * TAU + gauss(i, 23) * 0.010;

    // Height stays small relative to RING; at a larger scale one set's mana
    // spread smears across neighbouring rings and closes the gaps again.
    const mv = cmc[i] === 255 ? 3 : Math.min(cmc[i], 16);
    const y = (mv - 4) * 3.2 + gauss(i, 19) * 1.8;

    const o = i * 3;
    out[o] = Math.cos(theta) * r;
    out[o + 1] = y;
    out[o + 2] = Math.sin(theta) * r;
  }
}

/**
 * Every set becomes its own globular cluster, laid out on a phyllotaxis spiral
 * in release order. Cluster radius follows the cube root of its card count, so
 * volume is proportional to size and a 500-card Commander set genuinely dwarfs
 * a 60-card starter deck.
 */
function sets(ctx: LayoutContext, out: Float32Array): void {
  const { universe, setOrder } = ctx;
  const n = universe.count;
  const setIdxCol = universe.col.setIdx;
  const setList = universe.meta.sets;

  const cx = new Float32Array(setList.length);
  const cy = new Float32Array(setList.length);
  const cz = new Float32Array(setList.length);
  const cr = new Float32Array(setList.length);
  const SPACING = 26;

  for (let s = 0; s < setList.length; s++) {
    const k = setOrder[s];
    const r = SPACING * Math.sqrt(k + 0.5);
    const a = k * GOLDEN_ANGLE;
    cx[s] = Math.cos(a) * r;
    cz[s] = Math.sin(a) * r;
    // Lift by set type so expansions, masters and joke sets separate vertically.
    cy[s] = (hash(s * 9176) - 0.5) * 42 + (setList[s].type % 5) * 16 - 32;
    cr[s] = 3 + 2.1 * Math.cbrt(Math.max(1, setList[s].count));
  }

  for (let i = 0; i < n; i++) {
    const s = setIdxCol[i];
    // Uniform inside the sphere: cube root of the radial sample.
    const u = hash2(i, 23);
    const rad = cr[s] * Math.cbrt(u);
    const phi = Math.acos(2 * hash2(i, 29) - 1);
    const th = hash2(i, 31) * TAU;
    const sp = Math.sin(phi);

    const o = i * 3;
    out[o] = cx[s] + rad * sp * Math.cos(th);
    out[o + 1] = cy[s] + rad * Math.cos(phi);
    out[o + 2] = cz[s] + rad * sp * Math.sin(th);
  }
}

/**
 * The colour pie made literal. Each identity sits at the centroid of its member
 * colours pushed out from the origin, so mono colours occupy five lobes, guilds
 * sit on the edges between them, wedges and shards fill the interior, and
 * colourless collapses to the centre. Height is mana value.
 */
function colorwheel(ctx: LayoutContext, out: Float32Array): void {
  const { universe } = ctx;
  const n = universe.count;
  const { colorIdentity, cmc, typeMask } = universe.col;
  const LOBE = 190;

  for (let i = 0; i < n; i++) {
    const mask = colorIdentity[i] & 31;
    const id = IDENTITY_TABLE[mask];
    const mv = cmc[i] === 255 ? 3 : Math.min(cmc[i], 16);

    let r: number;
    if (id.count === 0) {
      // Wide enough that the colourless population reads as a core rather than
      // the thin bright spike a small radius gave it — mana value spreads these
      // over ~180 units of height, so the radius has to be comparable.
      r = 80 * Math.sqrt(hash2(i, 37));
    } else {
      // Fewer colours sit further out; five-colour cards land near the middle.
      r = LOBE * (1 - (id.count - 1) * 0.17) + gauss(i, 41) * 26;
    }
    const theta = id.angle + gauss(i, 43) * (id.count <= 1 ? 0.34 : 0.2);
    const y = (mv - 4) * 11 + gauss(i, 47) * 7 + ((typeMask[i] & TYPE_BIT.land) !== 0 ? -40 : 0);

    const o = i * 3;
    out[o] = Math.cos(theta) * r;
    out[o + 1] = y;
    out[o + 2] = Math.sin(theta) * r;
  }
}

/** Concentric rarity shells — mythics in a tight bright core, commons as the outer sky. */
function sphere(ctx: LayoutContext, out: Float32Array): void {
  const { universe, chronoRank } = ctx;
  const n = universe.count;
  const { rarity, colorIdentity } = universe.col;
  const SHELL = [300, 232, 168, 104, 136, 136];

  for (let i = 0; i < n; i++) {
    const base = SHELL[rarity[i]] ?? 300;
    const r = base + gauss(i, 53) * 13;
    // Longitude carries colour and latitude carries time, so each shell is
    // still readable rather than being noise on a ball.
    const id = IDENTITY_TABLE[colorIdentity[i] & 31];
    const theta = id.angle + gauss(i, 59) * 0.5;
    const phi = Math.acos(1 - 2 * Math.min(0.999, Math.max(0.001, chronoRank[i] + gauss(i, 61) * 0.03)));
    const sp = Math.sin(phi);

    const o = i * 3;
    out[o] = r * sp * Math.cos(theta);
    out[o + 1] = r * Math.cos(phi);
    out[o + 2] = r * sp * Math.sin(theta);
  }
}

/**
 * Value mountain.
 *
 * Height alone did not work: price is spatially incoherent — a ten-cent common
 * sits beside a five-hundred-dollar rare in the same set — so mapping it to y
 * over the galaxy disc produced a flat sheet with a sparse spray above it, not
 * terrain. Here radius is price *rank* and height is price, which makes height a
 * monotone function of radius: a genuine surface of revolution. The most
 * expensive cards in Magic form the summit, the long cheap tail is the plain,
 * and the colour arms wrap up the slopes. Distance from the peak is now
 * readable as "how expensive".
 */
function price(ctx: LayoutContext, out: Float32Array): void {
  const { universe, priceRank } = ctx;
  const n = universe.count;
  const { colorIdentity, price: usd } = universe.col;
  const PLAIN = GALAXY_RADIUS * 1.04;

  for (let i = 0; i < n; i++) {
    const id = IDENTITY_TABLE[colorIdentity[i] & 31];
    const rank = priceRank[i];

    let r: number;
    let y: number;
    if (rank < 0) {
      // No known price: out on the flat plain beyond the mountain's foot.
      r = PLAIN + hash2(i, 73) * 46;
      y = gauss(i, 71) * 3;
    } else {
      // sqrt of rank gives uniform areal density, so the summit is small in
      // area as well as in population and the peak stays sharp.
      r = 14 + (GALAXY_RADIUS - 14) * Math.sqrt(rank);
      y = Math.log10(1 + usd[i]) * 88 + gauss(i, 71) * 4;
    }

    const theta = id.angle + gauss(i, 67) * 0.3 + r * 0.0092;
    const o = i * 3;
    out[o] = Math.cos(theta) * r;
    out[o + 1] = y - 60;
    out[o + 2] = Math.sin(theta) * r;
  }
}

/**
 * Preferred camera elevation per layout, as the polar angle from +Y. A terrain
 * is unreadable from directly above and a five-lobed wheel is unreadable from
 * the side, so switching layout also reframes the viewing angle.
 */
export function layoutFramePhi(mode: LayoutMode): number {
  switch (mode) {
    case 'galaxy': return 1.07;
    case 'timeline': return 0.72;
    case 'sets': return 1.0;
    case 'colorwheel': return 0.62;
    case 'sphere': return 1.18;
    case 'price': return 1.44;
  }
}

