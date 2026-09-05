import { store } from '../core/store.ts';
import { el, listen } from './dom.ts';
import '../styles/cinematic.css';

export function mountCinematic(root: HTMLElement): { destroy(): void } {
  const skip = el('button', {
    className: 'mcu-cinematic-skip',
    text: 'Skip intro · Esc',
    attrs: { type: 'button' },
  });
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
