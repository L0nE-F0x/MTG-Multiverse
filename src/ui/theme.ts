/**
 * Colour constants shared by the filter panel, search results and card
 * panel, so the same mana/rarity palette is defined exactly once.
 */

/** Real MTG mana colours, keyed by colour letter. */
export const MANA_COLOR_HEX: Record<string, string> = {
  W: '#f8f6d8',
  U: '#c1d7e9',
  B: '#bab1ab',
  R: '#e49977',
  G: '#9bd3ae',
};

/**
 * The same five colours, saturated for use as UI chrome on a dark ground.
 *
 * `MANA_COLOR_HEX` above is the card-frame palette, and it is right wherever
 * something is standing in for a card. As a set of dots on a near-black panel
 * it is not: those hues sit within a few percent of each other in saturation,
 * so dimming them for an inactive state left five muddy circles nobody could
 * tell apart. This set trades frame accuracy for being legible at a glance,
 * which is the entire job of a colour pip. The colour-pie compass was already
 * carrying its own private copy of exactly these values.
 */
export const MANA_UI_HEX: Record<string, string> = {
  W: '#f3e2a0',
  U: '#4aa8ff',
  B: '#9a6ae8',
  R: '#ff5a3c',
  G: '#3dce74',
};

/** Rarity name -> accent colour. Falls back to the violet accent for names not listed. */
export const RARITY_COLOR_HEX: Record<string, string> = {
  common: '#7d828f',
  uncommon: '#b0b0b0',
  rare: '#d4af37',
  mythic: '#e35b1c',
  special: '#a56bff',
  bonus: '#5ee7ff',
};

export function rarityColor(name: string): string {
  return RARITY_COLOR_HEX[name] ?? '#a56bff';
}
