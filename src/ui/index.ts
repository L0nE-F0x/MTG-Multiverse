/**
 * UI layer entry point. Mounts every overlay component into `root` and wires
 * the renderer's per-frame hover-anchor callback through to the tooltip.
 * The only channel to the rest of the app is `src/core/store.ts`.
 */
import '../styles/base.css';
import type { Universe } from '../data/universe.ts';
import { mountCardPanel } from './cardPanel.ts';
import { mountFilters } from './filters.ts';
import { mountHud } from './hud.ts';
import { mountLoading } from './loading.ts';
import { mountSearch } from './search.ts';
import { mountSettings } from './settings.ts';
import { mountTooltip } from './tooltip.ts';

export interface UIHandles {
  /** Renderer calls this each frame with the screen-space position of the hovered star, or null. */
  setHoverAnchor(p: { x: number; y: number } | null): void;
  destroy(): void;
}

export function mountUI(root: HTMLElement, universe: Universe): UIHandles {
  root.classList.add('mcu-root');

  const loading = mountLoading(root);
  const hud = mountHud(root, universe);
  const search = mountSearch(root, universe);
  const filters = mountFilters(root, universe);
  const cardPanel = mountCardPanel(root, universe);
  const tooltip = mountTooltip(root, universe);
  const settings = mountSettings(root);

  return {
    setHoverAnchor(p) {
      tooltip.setAnchor(p);
    },
    destroy() {
      loading.destroy();
      hud.destroy();
      search.destroy();
      filters.destroy();
      cardPanel.destroy();
      tooltip.destroy();
      settings.destroy();
      root.classList.remove('mcu-root');
    },
  };
}
