/**
 * Colour-pie compass. Click an arm to fly the camera onto it.
 */
import { store } from '../core/store.ts';
import { COLOR_BIT, type ColorLetter } from '../data/format.ts';
import { COLOR_ANGLE } from '../layout/layouts.ts';
import { el } from './dom.ts';
import { MANA_COLOR_HEX } from './theme.ts';
import '../styles/minimap.css';

const ARMS: { letter: ColorLetter; label: string }[] = [
  { letter: 'W', label: 'White' },
  { letter: 'U', label: 'Blue' },
  { letter: 'B', label: 'Black' },
  { letter: 'R', label: 'Red' },
  { letter: 'G', label: 'Green' },
];

export function mountMinimap(root: HTMLElement): { destroy(): void } {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '-1.15 -1.15 2.3 2.3');
  svg.setAttribute('aria-hidden', 'true');

  for (const { letter } of ARMS) {
    const a0 = COLOR_ANGLE[COLOR_BIT[letter]]! - Math.PI / 5;
    const a1 = COLOR_ANGLE[COLOR_BIT[letter]]! + Math.PI / 5;
    const path = document.createElementNS(svgNS, 'path');
    const x0 = Math.cos(a0);
    const y0 = Math.sin(a0);
    const x1 = Math.cos(a1);
    const y1 = Math.sin(a1);
    path.setAttribute(
      'd',
      `M 0 0 L ${x0.toFixed(3)} ${y0.toFixed(3)} A 1 1 0 0 1 ${x1.toFixed(3)} ${y1.toFixed(3)} Z`,
    );
    path.setAttribute('fill', MANA_COLOR_HEX[letter] ?? '#888');
    path.setAttribute('data-arm', letter);
    svg.append(path);
  }

  const wrap = el('div', {
    className: 'mcu-minimap',
    attrs: { role: 'group', 'aria-label': 'Colour pie. Click an arm to fly there.' },
  }, [svg]);

  wrap.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const arm = t.getAttribute('data-arm') as ColorLetter | null;
    if (!arm) return;
    store.set('cameraCue', { kind: 'arm', color: arm });
  });

  root.append(wrap);

  const sync = (): void => {
    wrap.classList.toggle('mcu-minimap--hidden', store.state.shell !== 'play');
  };
  sync();
  const off = store.on('shell', sync);

  return {
    destroy() {
      off();
      wrap.remove();
    },
  };
}
