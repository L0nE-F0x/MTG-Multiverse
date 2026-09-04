/**
 * The collapsible left-edge filter panel. Every control here writes through
 * `store.patchFilter` (or, for reset, `store.set('filter', ...)`) and reads
 * back `store.state.filter` to stay in sync with external changes.
 */
import { defaultFilter, defaultInsets, store } from '../core/store.ts';
import type { ColorMatch } from '../core/store.ts';
import { COLOR_LETTERS, releaseDayToYear } from '../data/format.ts';
import type { ColorLetter, FormatName, TypeName } from '../data/format.ts';
import type { Universe } from '../data/universe.ts';
import { capitalize, el, fmtInt, listen } from './dom.ts';
import { createDualRangeSlider } from './rangeSlider.ts';
import { uiScale } from './scale.ts';
import { MANA_COLOR_HEX, rarityColor } from './theme.ts';
import '../styles/filters.css';

export interface FiltersHandle {
  destroy(): void;
}

const TYPE_LIST: TypeName[] = [
  'creature', 'instant', 'sorcery', 'artifact', 'enchantment',
  'land', 'planeswalker', 'battle', 'token', 'legendary',
];

const TYPE_TIP = {
  creature: 'Keep creatures.',
  instant: 'Keep instants.',
  sorcery: 'Keep sorceries.',
  artifact: 'Keep artifacts.',
  enchantment: 'Keep enchantments.',
  land: 'Keep lands.',
  planeswalker: 'Keep planeswalkers.',
  battle: 'Keep battles.',
  token: 'Keep token cards.',
  legendary: 'Keep legendary cards.',
} as const;

const FORMAT_LIST: FormatName[] = [
  'standard', 'pioneer', 'modern', 'legacy', 'vintage', 'commander', 'pauper',
];

const COLOR_NAME: Record<ColorLetter, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
};

function tip<T extends HTMLElement>(node: T, text: string): T {
  node.setAttribute('data-tip', text);
  return node;
}

function sectionWrap(title: string, children: (Node | string)[], headingTip?: string): HTMLElement {
  const heading = el('h3', { className: 'mcu-filter-heading', text: title });
  if (headingTip) tip(heading, headingTip);
  return el('section', { className: 'mcu-filter-section' }, [heading, ...children]);
}

export function mountFilters(root: HTMLElement, universe: Universe): FiltersHandle {
  // ---- Colour ---------------------------------------------------------
  const pipButtons = new Map<ColorLetter, HTMLButtonElement>();
  const pipsRow = el('div', { className: 'mcu-color-pips' });
  for (const c of COLOR_LETTERS) {
    const btn = el('button', {
      className: 'mcu-color-pip',
      text: c,
      attrs: { type: 'button', 'aria-label': COLOR_NAME[c], 'aria-pressed': 'false' },
    });
    tip(btn, `${COLOR_NAME[c]} colour identity.`);
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
  const colorlessBtn = tip(
    el('button', {
      className: 'mcu-toggle-chip',
      text: 'Colourless',
      attrs: { type: 'button', 'aria-pressed': 'false' },
    }),
    'Cards with no colour identity — artifacts, most lands, and the like. Only applies once you pick a colour; otherwise they are already visible.',
  );
  colorlessBtn.addEventListener('click', () => {
    store.patchFilter({ includeColorless: !store.state.filter.includeColorless });
  });

  const modeButtons = new Map<ColorMatch, HTMLButtonElement>();
  const modeSeg = el('div', {
    className: 'mcu-segmented mcu-segmented--sm',
    attrs: { role: 'group', 'aria-label': 'Colour match mode' },
  });
  const MATCH_TIP: Record<ColorMatch, string> = {
    any: 'Keep cards that contain any of the selected colours.',
    exact: 'Keep cards whose colour identity is exactly the selected colours.',
    subset: 'Keep cards whose colours all sit among the selected ones — no extras.',
  };
  (['any', 'exact', 'subset'] as ColorMatch[]).forEach((m) => {
    const b = el('button', {
      className: 'mcu-segmented-btn',
      text: capitalize(m),
      attrs: { type: 'button', 'aria-pressed': 'false' },
    });
    tip(b, MATCH_TIP[m]);
    b.addEventListener('click', () => store.patchFilter({ colorMatch: m }));
    modeButtons.set(m, b);
    modeSeg.append(b);
  });

  function paintColor(): void {
    const f = store.state.filter;
    for (const [c, btn] of pipButtons) {
      const active = f.colors.has(c);
      btn.classList.toggle('mcu-color-pip--active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
    const colorActive = f.colors.size > 0;
    colorlessBtn.disabled = !colorActive;
    colorlessBtn.classList.toggle('mcu-toggle-chip--active', colorActive && f.includeColorless);
    colorlessBtn.setAttribute('aria-pressed', String(colorActive && f.includeColorless));
    for (const [m, b] of modeButtons) {
      const active = f.colorMatch === m;
      b.classList.toggle('mcu-segmented-btn--active', active);
      b.setAttribute('aria-pressed', String(active));
    }
  }
  const colorSection = sectionWrap(
    'Colour',
    [pipsRow, colorlessBtn, modeSeg],
    'Select colours to keep. With none selected, every colour is visible.',
  );

  // ---- Type -------------------------------------------------------------
  const typeButtons = new Map<TypeName, HTMLButtonElement>();
  const typeRow = el('div', { className: 'mcu-chip-grid' });
  for (const t of TYPE_LIST) {
    const b = el('button', {
      className: 'mcu-toggle-chip',
      text: capitalize(t),
      attrs: { type: 'button', 'aria-pressed': 'false' },
    });
    tip(b, TYPE_TIP[t as keyof typeof TYPE_TIP] ?? `Keep ${t} cards.`);
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
    for (const [t, b] of typeButtons) {
      const active = f.types.has(t);
      b.classList.toggle('mcu-toggle-chip--active', active);
      b.setAttribute('aria-pressed', String(active));
    }
  }
  const typeSection = sectionWrap(
    'Type',
    [typeRow],
    'With no type selected, every type is visible.',
  );

  // ---- Rarity -------------------------------------------------------------
  const rarityButtons = new Map<number, HTMLButtonElement>();
  const rarityRow = el('div', { className: 'mcu-chip-grid' });
  universe.meta.rarities.forEach((name, idx) => {
    const b = el('button', {
      className: 'mcu-toggle-chip mcu-toggle-chip--rarity',
      text: capitalize(name),
      attrs: { type: 'button', 'aria-pressed': 'false' },
    });
    tip(b, `Keep ${name} printings.`);
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
    for (const [idx, b] of rarityButtons) {
      const active = f.rarities.has(idx);
      b.classList.toggle('mcu-toggle-chip--active', active);
      b.setAttribute('aria-pressed', String(active));
    }
  }
  const raritySection = sectionWrap(
    'Rarity',
    [rarityRow],
    'With no rarity selected, every rarity is visible.',
  );

  // ---- Format -------------------------------------------------------------
  const formatButtons = new Map<FormatName, HTMLButtonElement>();
  const formatRow = el('div', { className: 'mcu-chip-grid' });
  for (const fmt of FORMAT_LIST) {
    const b = el('button', {
      className: 'mcu-toggle-chip',
      text: capitalize(fmt),
      attrs: { type: 'button', 'aria-pressed': 'false' },
    });
    tip(b, `Keep cards legal in ${capitalize(fmt)}.`);
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
    for (const [fmt, b] of formatButtons) {
      const active = f.formats.has(fmt);
      b.classList.toggle('mcu-toggle-chip--active', active);
      b.setAttribute('aria-pressed', String(active));
    }
  }
  const formatSection = sectionWrap(
    'Format',
    [formatRow],
    'With no format selected, legality is ignored.',
  );

  // ---- Year range -------------------------------------------------------------
  const maxYear = Math.max(1993, releaseDayToYear(universe.meta.stats.maxReleaseDay));
  const yearSlider = createDualRangeSlider({
    min: 1993,
    max: maxYear,
    value: store.state.filter.years,
    onChange: (years) => store.patchFilter({ years }),
  });
  const yearSection = sectionWrap(
    'Year',
    [yearSlider.el],
    'Release year of this printing. Alpha is 1993.',
  );

  // ---- Mana value range -------------------------------------------------------------
  const cmcSlider = createDualRangeSlider({
    min: 0,
    max: 30,
    value: store.state.filter.cmc,
    formatValue: (v) => (v >= 30 ? '30+' : String(v)),
    onChange: (cmc) => store.patchFilter({ cmc }),
  });
  const cmcSection = sectionWrap(
    'Mana value',
    [cmcSlider.el],
    'Converted mana cost of this printing. 30+ is anything 30 or more.',
  );

  // ---- Set picker -------------------------------------------------------------
  const setSearchInput = tip(
    el('input', {
      className: 'mcu-set-search',
      attrs: { type: 'text', placeholder: 'Filter sets…', autocomplete: 'off' },
    }),
    'Type a set name or code to narrow this list.',
  );
  const setCountLabel = el('div', { className: 'mcu-set-count' });
  const setListEl = el('div', { className: 'mcu-set-list' });
  const setRows: { code: string; name: string; idx: number; row: HTMLElement }[] = [];
  universe.meta.sets.forEach((s, idx) => {
    const year = releaseDayToYear(s.released);
    const row = el('button', {
      className: 'mcu-set-row',
      attrs: { type: 'button', 'aria-pressed': 'false' },
    }, [
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
    for (const { idx, row } of setRows) {
      const active = f.sets.has(idx);
      row.classList.toggle('mcu-set-row--active', active);
      row.setAttribute('aria-pressed', String(active));
    }
    setCountLabel.textContent = f.sets.size ? `${f.sets.size} set${f.sets.size === 1 ? '' : 's'} selected` : 'All sets';
  }
  const setSection = sectionWrap(
    'Sets',
    [setSearchInput, setCountLabel, setListEl],
    'With no set selected, every set is visible.',
  );

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
    tip(
      el('label', { className: 'mcu-checkbox-row' }, [reprintsCb, document.createTextNode('Hide reprints')]),
      'Hide later printings, keeping the earliest of each card.',
    ),
    tip(
      el('label', { className: 'mcu-checkbox-row' }, [digitalCb, document.createTextNode('Hide digital-only')]),
      'Hide Magic Arena and Magic Online-only printings.',
    ),
    tip(
      el('label', { className: 'mcu-checkbox-row' }, [tokensCb, document.createTextNode('Hide tokens & art cards')]),
      'Hide tokens, emblems, and art cards. On by default.',
    ),
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

  const resetBtn = tip(
    el('button', { className: 'mcu-reset-btn', text: 'Reset filters', attrs: { type: 'button' } }),
    'Return every filter to its default.',
  );
  resetBtn.addEventListener('click', () => store.set('filter', defaultFilter()));

  const header = el('div', { className: 'mcu-filters-header' }, [
    el('h2', { className: 'mcu-panel-title', text: 'Filters' }),
    resetBtn,
  ]);
  const body = el('div', { className: 'mcu-filters-body' }, [
    header, colorSection, typeSection, raritySection, formatSection,
    yearSection, cmcSection, setSection, optionsSection,
  ]);

  const panel = el(
    'aside',
    {
      className: 'mcu-filters mcu-glass-panel',
      attrs: { id: 'mcu-filters-panel', 'aria-label': 'Filters' },
    },
    [
      el('div', { className: 'mcu-corner mcu-corner--tl' }),
      el('div', { className: 'mcu-corner mcu-corner--br' }),
      body,
    ],
  );
  const tab = el('button', {
    className: 'mcu-filters-tab',
    text: 'FILTERS',
    attrs: {
      type: 'button',
      'aria-label': 'Open filters panel',
      'aria-expanded': 'false',
      'aria-controls': 'mcu-filters-panel',
    },
  });

  /**
   * Gutter between the panel's outer edge and the content the camera frames.
   * Small enough that the galaxy does not look banished to one side, large
   * enough that its outermost stars are not tucked under the panel's shadow.
   */
  const INSET_GUTTER = 18;

  /**
   * Tell the renderer how much of the canvas this panel is standing on.
   *
   * Measured rather than hard-coded: the width lives in `filters.css`, and a
   * change there would otherwise silently desync the camera from the panel.
   * `offsetWidth` and the computed `left` are used instead of
   * `getBoundingClientRect()` on purpose — the panel slides in on a transform,
   * and a rect read mid-transition reports wherever the animation currently
   * is, which would make the camera chase the panel across the screen.
   */
  function reportInset(open: boolean): void {
    const element = open ? panel : tab;
    const left = parseFloat(getComputedStyle(element).left) || 0;
    const width = element.offsetWidth;
    // `left` and `offsetWidth` are layout pixels, before the UI zoom; the
    // camera works in the CSS pixels the canvas is actually sized in, so the
    // footprint has to be converted or the inset is wrong by the scale factor.
    const onScreen = (left + width + INSET_GUTTER) * uiScale();
    const next = { ...defaultInsets(), left: Math.round(onScreen) };

    const prev = store.state.insets;
    if (prev.left === next.left) return;
    // The CSS variable is the same number for anything that has to sit in the
    // free area — the layout switcher centres on it.
    root.style.setProperty('--mcu-inset-left', `${next.left}px`);
    store.set('insets', next);
  }

  function setOpen(open: boolean): void {
    panel.classList.toggle('mcu-filters--open', open);
    tab.classList.toggle('mcu-filters-tab--hidden', open);
    tab.setAttribute('aria-expanded', String(open));
    reportInset(open);
  }
  tab.addEventListener('click', () => setOpen(true));
  const closeBtn = tip(
    el('button', {
      className: 'mcu-filters-close',
      text: '«',
      attrs: { type: 'button', 'aria-label': 'Collapse filters panel' },
    }),
    'Collapse the filter panel.',
  );
  closeBtn.addEventListener('click', () => setOpen(false));
  header.append(closeBtn);

  const startOpen = window.matchMedia('(min-width: 900px)').matches;
  setOpen(startOpen);

  // The panel is full-height, so its footprint only changes with the viewport;
  // re-measure on resize so the camera does not keep an inset from a width the
  // window no longer has.
  const offResize = listen(window, 'resize', () =>
    reportInset(panel.classList.contains('mcu-filters--open')),
  );

  const floatTip = el('div', {
    className: 'mcu-float-tip',
    attrs: { role: 'tooltip', hidden: '' },
  });
  let tipAnchor: HTMLElement | null = null;

  function placeTip(anchor: HTMLElement): void {
    const text = anchor.getAttribute('data-tip');
    if (!text) return;
    floatTip.textContent = text;
    floatTip.hidden = false;
    const r = anchor.getBoundingClientRect();
    const tipR = floatTip.getBoundingClientRect();
    let left = r.right + 10;
    let top = r.top + r.height / 2 - tipR.height / 2;
    if (left + tipR.width > window.innerWidth - 8) left = Math.max(8, r.left - tipR.width - 10);
    if (top < 8) top = 8;
    if (top + tipR.height > window.innerHeight - 8) top = window.innerHeight - tipR.height - 8;
    floatTip.style.left = `${left}px`;
    floatTip.style.top = `${top}px`;
  }

  const offTipOver = listen(panel, 'pointerover', (e) => {
    const a = (e.target as HTMLElement | null)?.closest?.('[data-tip]');
    if (!(a instanceof HTMLElement) || !panel.contains(a)) return;
    tipAnchor = a;
    placeTip(a);
  });
  const offTipOut = listen(panel, 'pointerout', (e) => {
    const to = (e as PointerEvent).relatedTarget as Node | null;
    if (tipAnchor && to && (tipAnchor === to || tipAnchor.contains(to))) return;
    floatTip.hidden = true;
    tipAnchor = null;
  });

  root.append(tab, panel, floatTip);

  // Measure only once the panel is actually in the document. `setOpen` runs
  // during construction, before this append, where `offsetWidth` is 0 and the
  // computed `left` is `auto` — so the first report was the gutter alone and
  // the camera never learned the panel was there.
  reportInset(panel.classList.contains('mcu-filters--open'));

  return {
    destroy() {
      offFilter();
      offSetSearch();
      offResize();
      root.style.removeProperty('--mcu-inset-left');
      store.set('insets', defaultInsets());
      offTipOver();
      offTipOut();
      yearSlider.destroy();
      cmcSlider.destroy();
      tab.remove();
      panel.remove();
      floatTip.remove();
    },
  };
}
