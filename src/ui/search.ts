/**
 * Compact name search with a keyboard-navigable results dropdown.
 * `/` or Ctrl+K focuses it from anywhere (unless the user is already
 * typing in another field, or the title screen is up).
 */
import { store } from '../core/store.ts';
import type { Universe } from '../data/universe.ts';
import { debounce, el, listen } from './dom.ts';
import { MANA_COLOR_HEX } from './theme.ts';
import '../styles/search.css';

export interface SearchHandle {
  destroy(): void;
}

export function mountSearch(root: HTMLElement, universe: Universe): SearchHandle {
  const placeholder = `Search ${universe.count.toLocaleString()} cards…`;
  const input = el('input', {
    className: 'mcu-search-input',
    attrs: {
      type: 'text',
      placeholder,
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': 'Search cards',
      role: 'combobox',
      'aria-expanded': 'false',
      'aria-autocomplete': 'list',
      'aria-controls': 'mcu-search-listbox',
    },
  });
  const list = el('div', {
    className: 'mcu-search-results',
    attrs: { role: 'listbox', id: 'mcu-search-listbox' },
  });
  const wrap = el('div', { className: 'mcu-search' }, [
    el('div', { className: 'mcu-search-field' }, [
      el('div', { className: 'mcu-search-icon' }),
      input,
    ]),
    list,
  ]);
  root.append(wrap);

  let active = -1;

  function setOpen(open: boolean): void {
    wrap.classList.toggle('mcu-search--open', open);
    input.setAttribute('aria-expanded', String(open));
    if (!open) {
      active = -1;
      input.removeAttribute('aria-activedescendant');
    }
  }

  function setActive(k: number): void {
    active = k;
    const rows = list.children;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!(row instanceof HTMLElement)) continue;
      row.classList.toggle('mcu-search-row--active', i === k);
      row.setAttribute('aria-selected', String(i === k));
    }
    const row = rows[k];
    if (row instanceof HTMLElement) {
      row.scrollIntoView({ block: 'nearest' });
      input.setAttribute('aria-activedescendant', row.id);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function select(k: number): void {
    const idx = store.state.results[k];
    if (idx === undefined) return;
    store.set('selected', idx);
    setOpen(false);
  }

  function render(): void {
    const results = store.state.results;
    list.innerHTML = '';
    active = -1;
    if (results.length === 0) {
      setOpen(false);
      return;
    }
    setOpen(true);
    for (let k = 0; k < results.length; k++) {
      const idx = results[k]!;
      const pips = el('div', { className: 'mcu-search-pips' });
      for (const c of universe.colorLetters(idx)) {
        const pip = el('span', { className: 'mcu-pip' });
        pip.style.setProperty('--pip-color', MANA_COLOR_HEX[c] ?? '#888');
        pips.append(pip);
      }
      const row = el(
        'div',
        {
          className: 'mcu-search-row',
          attrs: { role: 'option', id: `mcu-search-row-${k}`, 'aria-selected': 'false' },
        },
        [
          el('span', { className: 'mcu-search-name', text: universe.name(idx) }),
          el('span', { className: 'mcu-search-set', text: universe.set(idx).code.toUpperCase() }),
          el('span', {
            className: 'mcu-search-year',
            text: String(universe.released(idx).getUTCFullYear()),
          }),
          pips,
        ],
      );
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        select(k);
      });
      row.addEventListener('mouseenter', () => setActive(k));
      list.append(row);
    }
  }

  const runSearch = debounce((q: string) => {
    const trimmed = q.trim();
    store.set('results', trimmed ? universe.search(trimmed, 40) : new Int32Array(0));
    store.patchFilter({ query: q });
  }, 120);

  const offInput = listen(input, 'input', () => runSearch(input.value));

  const offKeydown = listen(input, 'keydown', (e) => {
    const ev = e as KeyboardEvent;
    const results = store.state.results;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (results.length) setActive((active + 1) % results.length);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (results.length) setActive((active - 1 + results.length) % results.length);
    } else if (ev.key === 'Enter') {
      if (active >= 0) select(active);
      else if (results.length) select(0);
    } else if (ev.key === 'Escape') {
      input.value = '';
      runSearch.cancel();
      store.patchFilter({ query: '' });
      store.set('results', new Int32Array(0));
      setOpen(false);
      input.blur();
    }
  });

  const offOutside = listen(document, 'mousedown', (e) => {
    if (!wrap.contains(e.target as Node)) setOpen(false);
  });

  const offGlobalKey = listen(window, 'keydown', (e) => {
    if (store.state.shell === 'title') return;
    const ev = e as KeyboardEvent;
    const target = ev.target as HTMLElement | null;
    const typing =
      !!target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (ev.key === '/' && !typing) {
      ev.preventDefault();
      input.focus();
    } else if (ev.key.toLowerCase() === 'k' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      input.focus();
      input.select();
    }
  });

  const offResults = store.on('results', render);
  render();

  return {
    destroy() {
      runSearch.cancel();
      offInput();
      offKeydown();
      offOutside();
      offGlobalKey();
      offResults();
      wrap.remove();
    },
  };
}
