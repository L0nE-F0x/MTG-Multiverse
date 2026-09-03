/**
 * The collapsible left-edge filter panel. Every control here writes through
 * `store.patchFilter` (or, for reset, `store.set('filter', ...)`) and reads
 * back `store.state.filter` to stay in sync with external changes.
 */
import { defaultFilter, store } from '../core/store.ts';
import type { ColorMatch } from '../core/store.ts';
import { COLOR_LETTERS, releaseDayToYear } from '../data/format.ts';
import type { ColorLetter, FormatName, TypeName } from '../data/format.ts';
import type { Universe } from '../data/universe.ts';
import { capitalize, el, fmtInt, listen } from './dom.ts';
import { createDualRangeSlider } from './rangeSlider.ts';
import { MANA_COLOR_HEX, rarityColor } from './theme.ts';
import '../styles/filters.css';

export interface FiltersHandle {
  destroy(): void;
}

const TYPE_LIST: TypeName[] = [
  'creature', 'instant', 'sorcery', 'artifact', 'enchantment',
  'land', 'planeswalker', 'battle', 'token', 'legendary',
];

const FORMAT_LIST: FormatName[] = [
  'standard', 'pioneer', 'modern', 'legacy', 'vintage', 'commander', 'pauper',
];

function sectionWrap(title: string, children: (Node | string)[]): HTMLElement {
  return el('section', { className: 'mcu-filter-section' }, [
    el('h3', { className: 'mcu-filter-heading', text: title }),
    ...children,
  ]);
}

export function mountFilters(root: HTMLElement, universe: Universe): FiltersHandle {
  // ---- Colour ---------------------------------------------------------
  const pipButtons = new Map<ColorLetter, HTMLButtonElement>();
  const pipsRow = el('div', { className: 'mcu-color-pips' });
  for (const c of COLOR_LETTERS) {
    const btn = el('button', {
      className: 'mcu-color-pip',
      text: c,
      attrs: { type: 'button', 'aria-label': `Colour ${c}` },
    });
    btn.style.setProperty('--pip-color', MANA_COLOR_HEX[c] ?? '#888');
    btn.addEventListener('click', () => {
      const colors = new Set(store.state.filter.colors);
      if (colors.has(c)) colors.delete(c);
      else colors.add(c);
      store.patchFilter({ colors });
    });
    pipButtons.set(c, btn);
    pipsRow.append(btn);
  }
  const colorlessBtn = el('button', {
    className: 'mcu-toggle-chip',
    text: 'Colourless',
    attrs: { type: 'button' },
  });
  colorlessBtn.addEventListener('click', () => {
    store.patchFilter({ includeColorless: !store.state.filter.includeColorless });
  });

  const modeButtons = new Map<ColorMatch, HTMLButtonElement>();
  const modeSeg = el('div', { className: 'mcu-segmented mcu-segmented--sm' });
  (['any', 'exact', 'subset'] as ColorMatch[]).forEach((m) => {
    const b = el('button', {
      className: 'mcu-segmented-btn',
      text: capitalize(m),
      attrs: { type: 'button' },
    });
    b.addEventListener('click', () => store.patchFilter({ colorMatch: m }));
    modeButtons.set(m, b);
    modeSeg.append(b);
  });

  function paintColor(): void {
    const f = store.state.filter;
    for (const [c, btn] of pipButtons) btn.classList.toggle('mcu-color-pip--active', f.colors.has(c));
    colorlessBtn.classList.toggle('mcu-toggle-chip--active', f.includeColorless);
    for (const [m, b] of modeButtons) b.classList.toggle('mcu-segmented-btn--active', f.colorMatch === m);
  }
  const colorSection = sectionWrap('Colour', [pipsRow, colorlessBtn, modeSeg]);

  // ---- Type -------------------------------------------------------------
  const typeButtons = new Map<TypeName, HTMLButtonElement>();
  const typeRow = el('div', { className: 'mcu-chip-grid' });
  for (const t of TYPE_LIST) {
    const b = el('button', { className: 'mcu-toggle-chip', text: capitalize(t), attrs: { type: 'button' } });
    b.addEventListener('click', () => {
      const types = new Set(store.state.filter.types);
      if (types.has(t)) types.delete(t);
      else types.add(t);
      store.patchFilter({ types });
    });
    typeButtons.set(t, b);
    typeRow.append(b);
  }
  function paintTypes(): void {
    const f = store.state.filter;
    for (const [t, b] of typeButtons) b.classList.toggle('mcu-toggle-chip--active', f.types.has(t));
  }
  const typeSection = sectionWrap('Type', [typeRow]);

  // ---- Rarity -------------------------------------------------------------
  const rarityButtons = new Map<number, HTMLButtonElement>();
  const rarityRow = el('div', { className: 'mcu-chip-grid' });
  universe.meta.rarities.forEach((name, idx) => {
    const b = el('button', {
      className: 'mcu-toggle-chip mcu-toggle-chip--rarity',
      text: capitalize(name),
      attrs: { type: 'button' },
    });
    b.style.setProperty('--rarity-color', rarityColor(name));
    b.addEventListener('click', () => {
      const rarities = new Set(store.state.filter.rarities);
      if (rarities.has(idx)) rarities.delete(idx);
      else rarities.add(idx);
      store.patchFilter({ rarities });
    });
    rarityButtons.set(idx, b);
    rarityRow.append(b);
  });
  function paintRarities(): void {
    const f = store.state.filter;
    for (const [idx, b] of rarityButtons) b.classList.toggle('mcu-toggle-chip--active', f.rarities.has(idx));
  }
  const raritySection = sectionWrap('Rarity', [rarityRow]);

  // ---- Format -------------------------------------------------------------
  const formatButtons = new Map<FormatName, HTMLButtonElement>();
  const formatRow = el('div', { className: 'mcu-chip-grid' });
  for (const fmt of FORMAT_LIST) {
    const b = el('button', { className: 'mcu-toggle-chip', text: capitalize(fmt), attrs: { type: 'button' } });
    b.addEventListener('click', () => {
      const formats = new Set(store.state.filter.formats);
      if (formats.has(fmt)) formats.delete(fmt);
      else formats.add(fmt);
      store.patchFilter({ formats });
    });
    formatButtons.set(fmt, b);
    formatRow.append(b);
  }
  function paintFormats(): void {
    const f = store.state.filter;
    for (const [fmt, b] of formatButtons) b.classList.toggle('mcu-toggle-chip--active', f.formats.has(fmt));
  }
  const formatSection = sectionWrap('Format', [formatRow]);

  // ---- Year range -------------------------------------------------------------
  const maxYear = Math.max(1993, releaseDayToYear(universe.meta.stats.maxReleaseDay));
  const yearSlider = createDualRangeSlider({
    min: 1993,
    max: maxYear,
    value: store.state.filter.years,
    onChange: (years) => store.patchFilter({ years }),
  });
  const yearSection = sectionWrap('Year', [yearSlider.el]);

  // ---- Mana value range -------------------------------------------------------------
  const cmcSlider = createDualRangeSlider({
    min: 0,
    max: 30,
    value: store.state.filter.cmc,
    formatValue: (v) => (v >= 30 ? '30+' : String(v)),
    onChange: (cmc) => store.patchFilter({ cmc }),
  });
  const cmcSection = sectionWrap('Mana value', [cmcSlider.el]);

  // ---- Set picker -------------------------------------------------------------
  const setSearchInput = el('input', {
    className: 'mcu-set-search',
    attrs: { type: 'text', placeholder: 'Filter sets…', autocomplete: 'off' },
  });
  const setCountLabel = el('div', { className: 'mcu-set-count' });
  const setListEl = el('div', { className: 'mcu-set-list' });
  const setRows: { code: string; name: string; idx: number; row: HTMLElement }[] = [];
  universe.meta.sets.forEach((s, idx) => {
    const year = releaseDayToYear(s.released);
    const row = el('div', { className: 'mcu-set-row' }, [
      el('span', { className: 'mcu-set-code', text: s.code.toUpperCase() }),
      el('span', { className: 'mcu-set-name', text: s.name }),
      el('span', { className: 'mcu-set-year', text: String(year) }),
      el('span', { className: 'mcu-set-n', text: fmtInt(s.count) }),
    ]);
    row.addEventListener('click', () => {
      const sets = new Set(store.state.filter.sets);
      if (sets.has(idx)) sets.delete(idx);
      else sets.add(idx);
      store.patchFilter({ sets });
    });
    setRows.push({ code: s.code.toLowerCase(), name: s.name.toLowerCase(), idx, row });
    setListEl.append(row);
  });
  function filterSetRows(): void {
    const q = setSearchInput.value.trim().toLowerCase();
    for (const { code, name, row } of setRows) {
      row.classList.toggle('mcu-set-row--hidden', !(!q || code.includes(q) || name.includes(q)));
    }
  }
  const offSetSearch = listen(setSearchInput, 'input', filterSetRows);
  function paintSets(): void {
    const f = store.state.filter;
    for (const { idx, row } of setRows) row.classList.toggle('mcu-set-row--active', f.sets.has(idx));
    setCountLabel.textContent = f.sets.size ? `${f.sets.size} set${f.sets.size === 1 ? '' : 's'} selected` : 'All sets';
  }
  const setSection = sectionWrap('Sets', [setSearchInput, setCountLabel, setListEl]);

  // ---- Checkboxes -------------------------------------------------------------
  const reprintsCb = el('input', { attrs: { type: 'checkbox' } });
  const digitalCb = el('input', { attrs: { type: 'checkbox' } });
  const tokensCb = el('input', { attrs: { type: 'checkbox' } });
  reprintsCb.addEventListener('change', () => store.patchFilter({ hideReprints: reprintsCb.checked }));
  digitalCb.addEventListener('change', () => store.patchFilter({ hideDigital: digitalCb.checked }));
  tokensCb.addEventListener('change', () => store.patchFilter({ hideTokens: tokensCb.checked }));
  function paintCheckboxes(): void {
    const f = store.state.filter;
    reprintsCb.checked = f.hideReprints;
    digitalCb.checked = f.hideDigital;
    tokensCb.checked = f.hideTokens;
  }
  const optionsSection = sectionWrap('Options', [
    el('label', { className: 'mcu-checkbox-row' }, [reprintsCb, document.createTextNode('Hide reprints')]),
    el('label', { className: 'mcu-checkbox-row' }, [digitalCb, document.createTextNode('Hide digital-only')]),
    el('label', { className: 'mcu-checkbox-row' }, [tokensCb, document.createTextNode('Hide tokens')]),
  ]);

  // ---- Assembly -------------------------------------------------------------
  function paintAll(): void {
    paintColor();
    paintTypes();
    paintRarities();
    paintFormats();
    paintSets();
    paintCheckboxes();
    yearSlider.setValue(store.state.filter.years);
    cmcSlider.setValue(store.state.filter.cmc);
  }
  paintAll();
  const offFilter = store.on('filter', paintAll);

  const resetBtn = el('button', { className: 'mcu-reset-btn', text: 'Reset filters', attrs: { type: 'button' } });
  resetBtn.addEventListener('click', () => store.set('filter', defaultFilter()));

  const header = el('div', { className: 'mcu-filters-header' }, [
    el('h2', { className: 'mcu-panel-title', text: 'Filters' }),
    resetBtn,
  ]);
  const body = el('div', { className: 'mcu-filters-body' }, [
    header, colorSection, typeSection, raritySection, formatSection,
    yearSection, cmcSection, setSection, optionsSection,
  ]);

  const panel = el('aside', { className: 'mcu-filters mcu-glass-panel' }, [
    el('div', { className: 'mcu-corner mcu-corner--tl' }),
    el('div', { className: 'mcu-corner mcu-corner--br' }),
    body,
  ]);
  const tab = el('button', {
    className: 'mcu-filters-tab',
    text: 'FILTERS',
    attrs: { type: 'button', 'aria-label': 'Toggle filters panel' },
  });

  function setOpen(open: boolean): void {
    panel.classList.toggle('mcu-filters--open', open);
    tab.classList.toggle('mcu-filters-tab--hidden', open);
  }
  tab.addEventListener('click', () => setOpen(true));
  const closeBtn = el('button', {
    className: 'mcu-filters-close',
    text: '«',
    attrs: { type: 'button', 'aria-label': 'Collapse filters panel' },
  });
  closeBtn.addEventListener('click', () => setOpen(false));
  header.append(closeBtn);

  setOpen(window.matchMedia('(min-width: 900px)').matches);

  root.append(tab, panel);

  return {
    destroy() {
      offFilter();
      offSetSearch();
      yearSlider.destroy();
      cmcSlider.destroy();
      tab.remove();
      panel.remove();
    },
  };
}
