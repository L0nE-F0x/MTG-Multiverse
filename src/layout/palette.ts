/**
 * Star colours. Magic's colour pie is the palette, adjusted for emissive points
 * on black: frame-black is invisible against space so it becomes a violet, and
 * every hue is pushed into the range where additive blending plus ACES tone
 * mapping still holds its colour instead of clipping to white.
 */
import { COLOR_BIT, TYPE_BIT } from '../data/format.ts';

export type RGB = [number, number, number];

const hex = (h: number): RGB => [
  ((h >> 16) & 255) / 255,
  ((h >> 8) & 255) / 255,
  (h & 255) / 255,
];

export const STAR_COLORS = {
  W: hex(0xffeeb0),
  U: hex(0x4aa8ff),
  B: hex(0xa96ff0),
  R: hex(0xff5638),
  G: hex(0x46d972),
  colorless: hex(0xb4cbe6),
  gold: hex(0xffc23d),
  land: hex(0xcf9a63),
} as const;

/** Rarity multiplies brightness — mythics should read as supergiants. */
export const RARITY_LUMINANCE = [0.72, 0.9, 1.18, 1.5, 1.35, 1.35];

/**
 * Colour for one card, blended across its colour identity so a Golgari card is
 * genuinely green-black rather than a flat gold. Gold is mixed in with colour
 * count so three-plus-colour cards still read as the multicolour population.
 */
export function starColor(colorIdentity: number, typeMask: number, out: RGB): RGB {
  let r = 0, g = 0, b = 0, n = 0;
  if (colorIdentity & COLOR_BIT.W) { r += STAR_COLORS.W[0]; g += STAR_COLORS.W[1]; b += STAR_COLORS.W[2]; n++; }
  if (colorIdentity & COLOR_BIT.U) { r += STAR_COLORS.U[0]; g += STAR_COLORS.U[1]; b += STAR_COLORS.U[2]; n++; }
  if (colorIdentity & COLOR_BIT.B) { r += STAR_COLORS.B[0]; g += STAR_COLORS.B[1]; b += STAR_COLORS.B[2]; n++; }
  if (colorIdentity & COLOR_BIT.R) { r += STAR_COLORS.R[0]; g += STAR_COLORS.R[1]; b += STAR_COLORS.R[2]; n++; }
  if (colorIdentity & COLOR_BIT.G) { r += STAR_COLORS.G[0]; g += STAR_COLORS.G[1]; b += STAR_COLORS.G[2]; n++; }

  if (n === 0) {
    const base = typeMask & TYPE_BIT.land ? STAR_COLORS.land : STAR_COLORS.colorless;
    out[0] = base[0]; out[1] = base[1]; out[2] = base[2];
    return out;
  }

  r /= n; g /= n; b /= n;
  if (n > 1) {
    // Averaging two opposed hues desaturates toward grey; pull it back to gold
    // so the multicolour population stays legible as its own thing.
    const t = Math.min(0.62, 0.3 + 0.16 * (n - 1));
    r += (STAR_COLORS.gold[0] - r) * t;
    g += (STAR_COLORS.gold[1] - g) * t;
    b += (STAR_COLORS.gold[2] - b) * t;
  }
  out[0] = r; out[1] = g; out[2] = b;
  return out;
}
