import { addBookmark, applyBookmark, loadBookmarks, removeBookmark, type Bookmark } from '../core/bookmarks.ts';
import { store } from '../core/store.ts';
import { el, listen } from './dom.ts';
import '../styles/bookmarks.css';

export interface BookmarkHost {
  cameraSnapshot(): { theta: number; phi: number; radius: number; target: [number, number, number] };
}

export function mountBookmarks(root: HTMLElement, host: BookmarkHost): { destroy(): void } {
  const listEl = el('div', { className: 'mcu-bookmarks-list' });
  const saveBtn = el('button', {
    className: 'mcu-bookmarks-save',
    text: 'Save this view',
    attrs: { type: 'button' },
  });
  const panel = el('div', { className: 'mcu-bookmarks mcu-glass-panel' }, [
    el('div', { className: 'mcu-bookmarks-title', text: 'Saved views' }),
    saveBtn,
    listEl,
  ]);
  const toggle = el('button', {
    className: 'mcu-bookmarks-toggle',
    text: 'Views',
    attrs: { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'mcu-bookmarks-panel' },
  });
  panel.id = 'mcu-bookmarks-panel';
  panel.hidden = true;

  const wrap = el('div', { className: 'mcu-bookmarks-wrap' }, [toggle, panel]);
  root.append(wrap);

  function paint(list: Bookmark[]): void {
    listEl.replaceChildren();
    if (list.length === 0) {
      listEl.append(el('p', { className: 'mcu-bookmarks-empty', text: 'No saved views yet.' }));
      return;
    }
    for (const b of list) {
      const go = el('button', { className: 'mcu-bookmarks-go', text: b.name, attrs: { type: 'button' } });
      const del = el('button', { className: 'mcu-bookmarks-del', text: '×', attrs: { type: 'button', 'aria-label': `Delete ${b.name}` } });
      go.addEventListener('click', () => applyBookmark(b));
      del.addEventListener('click', () => paint(removeBookmark(b.id)));
      listEl.append(el('div', { className: 'mcu-bookmarks-row' }, [go, del]));
    }
  }
  paint(loadBookmarks());

  const offSave = listen(saveBtn, 'click', () => {
    const name = window.prompt('Name this view', store.state.layout);
    if (!name) return;
    paint(addBookmark(name, host.cameraSnapshot()));
  });
  const offToggle = listen(toggle, 'click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  });
  const sync = (): void => {
    wrap.classList.toggle('mcu-bookmarks-wrap--hidden', store.state.shell !== 'play');
  };
  sync();
  const offShell = store.on('shell', sync);

  return {
    destroy() {
      offSave();
      offToggle();
      offShell();
      wrap.remove();
    },
  };
}
