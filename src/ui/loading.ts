/**
 * Full-screen boot-sequence overlay. Reads `loadProgress` / `loadLabel` and
 * fades out once `ready` flips true.
 */
import { store } from '../core/store.ts';
import { el, listen } from './dom.ts';
import '../styles/loading.css';

export interface LoadingHandle {
  destroy(): void;
}

export function mountLoading(root: HTMLElement): LoadingHandle {
  const bar = el('div', { className: 'mcu-loading-bar-fill' });
  const barTrack = el('div', { className: 'mcu-loading-bar-track' }, [bar]);
  const label = el('div', { className: 'mcu-loading-label', text: store.state.loadLabel });
  const pct = el('div', { className: 'mcu-loading-pct' });

  const overlay = el(
    'div',
    { className: 'mcu-loading', attrs: { role: 'status', 'aria-live': 'polite' } },
    [
      el('div', { className: 'mcu-loading-noise' }),
      el('div', { className: 'mcu-loading-scan' }),
      el('div', { className: 'mcu-loading-center' }, [
        el('div', { className: 'mcu-loading-wordmark', text: 'MAGIC CARD UNIVERSE' }),
        el('div', { className: 'mcu-loading-sub', text: 'INSTRUMENT BOOT SEQUENCE' }),
        barTrack,
        el('div', { className: 'mcu-loading-meta' }, [label, pct]),
      ]),
    ],
  );
  root.append(overlay);

  function paintProgress(p: number): void {
    const clamped = Math.max(0, Math.min(1, p));
    bar.style.width = `${(clamped * 100).toFixed(1)}%`;
    pct.textContent = `${Math.round(clamped * 100)}%`;
  }
  paintProgress(store.state.loadProgress);

  let removed = false;
  function remove(): void {
    if (removed) return;
    removed = true;
    overlay.classList.add('mcu-loading--out');
    const finish = (): void => overlay.remove();
    listen(overlay, 'transitionend', finish, { once: true });
    setTimeout(finish, 900);
  }

  const offProgress = store.on('loadProgress', paintProgress);
  const offLabel = store.on('loadLabel', (v) => {
    label.textContent = v;
  });
  const offReady = store.on('ready', (v) => {
    if (v) remove();
  });

  if (store.state.ready) remove();

  return {
    destroy() {
      offProgress();
      offLabel();
      offReady();
      overlay.remove();
    },
  };
}
