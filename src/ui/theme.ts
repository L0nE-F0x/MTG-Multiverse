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
