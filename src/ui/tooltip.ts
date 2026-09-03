/**
 * Small hover tooltip that follows the renderer-supplied screen-space
 * anchor. Positioned via `transform: translate3d` inside a rAF loop so it
 * never triggers layout — `pointer-events: none` throughout.
 */
import { store } from '../core/store.ts';
import type { Universe } from '../data/universe.ts';
import { el } from './dom.ts';
import '../styles/tooltip.css';

export interface TooltipHandle {
  setAnchor(p: { x: number; y: number } | null): void;
  destroy(): void;
}

export function mountTooltip(root: HTMLElement, universe: Universe): TooltipHandle {
  const nameEl = el('span', { className: 'mcu-tooltip-name' });
  const setEl = el('span', { className: 'mcu-tooltip-set' });
  const tip = el('div', { className: 'mcu-tooltip' }, [nameEl, setEl]);
  root.append(tip);

  let anchor: { x: number; y: number } | null = null;
  let rafId = 0;
  let destroyed = false;

  function loop(): void {
    if (destroyed) return;
    if (anchor && store.state.hovered >= 0) {
      tip.style.transform = `translate3d(${anchor.x + 16}px, ${anchor.y + 16}px, 0)`;
    }
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);

  function paint(hovered: number): void {
    if (hovered < 0) {
      tip.classList.remove('mcu-tooltip--visible');
      return;
    }
    nameEl.textContent = universe.name(hovered);
    setEl.textContent = universe.set(hovered).code.toUpperCase();
    tip.classList.add('mcu-tooltip--visible');
  }
  paint(store.state.hovered);
  const offHovered = store.on('hovered', paint);

  return {
    setAnchor(p) {
      anchor = p;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(rafId);
      offHovered();
      tip.remove();
    },
  };
}
