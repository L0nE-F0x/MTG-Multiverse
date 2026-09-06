/**
 * The saved-views panel.
 *
 * Naming a view uses an inline field rather than `window.prompt`. wry ships no
 * `WKUIDelegate` text-input panel, so under WKWebView — every macOS build of
 * the host app — `prompt()` resolves to `null` and the button silently does
 * nothing at all. It also sidesteps the wider hazard that a modal dialog
 * blocks the whole webview.
 */
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
  const nameInput = el('input', {
    className: 'mcu-bookmarks-name',
    attrs: {
      type: 'text',
      placeholder: 'Name this view',
      maxlength: 60,
      'aria-label': 'Name this view',
    },
  });
  const confirmBtn = el('button', {
    className: 'mcu-bookmarks-confirm',
    text: 'Save',
    attrs: { type: 'button' },
  });
  const nameRow = el('div', { className: 'mcu-bookmarks-namerow' }, [nameInput, confirmBtn]);
  nameRow.hidden = true;

  const panel = el('div', { className: 'mcu-bookmarks mcu-glass-panel' }, [
    el('div', { className: 'mcu-bookmarks-title', text: 'Saved views' }),
    saveBtn,
    nameRow,
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

  /** Snapshot taken when naming opens, so the camera can keep moving meanwhile. */
  let pending: ReturnType<BookmarkHost['cameraSnapshot']> | null = null;

  const closeNaming = (): void => {
    pending = null;
    nameRow.hidden = true;
    saveBtn.hidden = false;
  };

  const commit = (): void => {
    if (!pending) return;
    const name = nameInput.value.trim() || store.state.layout;
    paint(addBookmark(name, pending));
    closeNaming();
  };

  const offSave = listen(saveBtn, 'click', () => {
    pending = host.cameraSnapshot();
    nameInput.value = store.state.layout;
    nameRow.hidden = false;
    saveBtn.hidden = true;
    nameInput.focus();
    nameInput.select();
  });
  const offConfirm = listen(confirmBtn, 'click', commit);
  const offKeys = listen(nameInput, 'keydown', (ev) => {
    const e = ev as KeyboardEvent;
    // The canvas listens for flight keys on window; typing a view called
    // "Wedge" should not fly the camera across the galaxy.
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeNaming(); }
  });
  const offToggle = listen(toggle, 'click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  });
  const sync = (): void => {
    wrap.classList.toggle('mcu-bookmarks-wrap--hidden', store.state.shell !== 'play');
    if (store.state.shell !== 'play') closeNaming();
  };
  sync();
  const offShell = store.on('shell', sync);

  return {
    destroy() {
      offSave();
      offConfirm();
      offKeys();
      offToggle();
      offShell();
      wrap.remove();
    },
  };
}
