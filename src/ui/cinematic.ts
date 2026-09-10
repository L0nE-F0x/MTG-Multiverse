import { store } from '../core/store.ts';
import { el, listen } from './dom.ts';
import '../styles/cinematic.css';

export function mountCinematic(root: HTMLElement): { destroy(): void } {
  /*
   * The keyboard hint is its own element so a touch device can drop it —
   * "· Esc" is instructions for a key a phone has not got, and dropping it
   * is what keeps the pill narrow enough to clear the minimap on a 360px
   * screen. `aria-label` carries the full wording either way.
   */
  const skip = el(
    'button',
    {
      className: 'mcu-cinematic-skip',
      attrs: { type: 'button', 'aria-label': 'Skip the intro flight (Escape)' },
    },
    [
      el('span', { text: 'Skip intro' }),
      el('span', { className: 'mcu-cinematic-skip-key', text: '· Esc' }),
    ],
  );
  root.append(skip);

  const paint = (): void => {
    skip.hidden = !store.state.cinematic;
  };
  paint();
  const off = store.on('cinematic', paint);
  const offClick = listen(skip, 'click', () => store.set('cameraCue', { kind: 'skip-cinematic' }));

  return {
    destroy() {
      off();
      offClick();
      skip.remove();
    },
  };
}
