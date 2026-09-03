/**
 * Static HUD chrome: the top-left wordmark + live match count, and the
 * bottom-centre layout-mode switcher.
 */
import { store } from '../core/store.ts';
import type { LayoutMode } from '../core/store.ts';
import type { Universe } from '../data/universe.ts';
import { el, fmtInt } from './dom.ts';
import '../styles/hud.css';

export interface HudHandle {
  destroy(): void;
}

const LAYOUTS: { mode: LayoutMode; label: string; desc: string }[] = [
  { mode: 'galaxy', label: 'Galaxy', desc: 'Spiral arms by colour, radius by release date' },
  { mode: 'timeline', label: 'Timeline', desc: 'One ring per year; angle is release order within it, height is mana value' },
  { mode: 'sets', label: 'Sets', desc: 'Every set its own globular cluster on a grid' },
  { mode: 'colorwheel', label: 'Colour Wheel', desc: 'Five-lobed colour identity wheel' },
  { mode: 'sphere', label: 'Sphere', desc: 'Rarity shells' },
  { mode: 'price', label: 'Price', desc: 'Value landscape' },
];

export function mountHud(root: HTMLElement, universe: Universe): HudHandle {
  // ---- Command bar --------------------------------------------------
  const countN = el('span', { className: 'mcu-command-count-n' });
  const commandBar = el('div', { className: 'mcu-command-bar' }, [
    el('div', { className: 'mcu-wordmark', text: 'MAGIC CARD UNIVERSE' }),
    el('div', { className: 'mcu-command-count' }, [
      countN,
      document.createTextNode(' of '),
      el('span', { className: 'mcu-command-count-total', text: fmtInt(universe.count) }),
      document.createTextNode(' stars visible'),
    ]),
  ]);
  root.append(commandBar);

  function paintCount(): void {
    countN.textContent = fmtInt(store.state.matchCount);
  }
  paintCount();
  const offMatch = store.on('matchCount', paintCount);

  // ---- Layout switcher ------------------------------------------------
  const descEl = el('div', { className: 'mcu-layout-desc' });
  const buttons = new Map<LayoutMode, HTMLButtonElement>();
  const segmented = el('div', { className: 'mcu-layout-segmented' });
  for (const { mode, label } of LAYOUTS) {
    const btn = el('button', {
      className: 'mcu-layout-btn',
      text: label,
      attrs: { type: 'button' },
    });
    btn.addEventListener('click', () => store.set('layout', mode));
    buttons.set(mode, btn);
    segmented.append(btn);
  }
  const switcherInner = el('div', { className: 'mcu-layout-switcher-inner' }, [segmented, descEl]);
  const switcher = el('div', { className: 'mcu-layout-switcher' }, [switcherInner]);
  root.append(switcher);

  function paintLayout(): void {
    const current = store.state.layout;
    for (const [mode, btn] of buttons) btn.classList.toggle('mcu-layout-btn--active', mode === current);
    descEl.textContent = LAYOUTS.find((l) => l.mode === current)?.desc ?? '';
  }
  paintLayout();
  const offLayout = store.on('layout', paintLayout);

  return {
    destroy() {
      offMatch();
      offLayout();
      commandBar.remove();
      switcher.remove();
    },
  };
}
