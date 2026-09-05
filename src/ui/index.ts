/**
 * UI layer entry point. Mounts every overlay component into `root` and wires
 * the renderer's per-frame hover-anchor callback through to the tooltip.
 * The only channel to the rest of the app is `src/core/store.ts`.
 */
import '../styles/base.css';
import type { Universe } from '../data/universe.ts';
import { mountBookmarks } from './bookmarks.ts';
import { mountCardPanel } from './cardPanel.ts';
import { mountCinematic } from './cinematic.ts';
import { mountFilters } from './filters.ts';
import { mountHud } from './hud.ts';
import { mountMinimap } from './minimap.ts';
import { mountSearch } from './search.ts';
import { mountSettings } from './settings.ts';
import { mountTitle } from './title.ts';
import { mountTour } from './tour.ts';
import { mountTooltip } from './tooltip.ts';
import { connectUiScale } from './scale.ts';

export interface UIHandles {
  /** Renderer calls this each frame with the screen-space position of the hovered star, or null. */
  setHoverAnchor(p: { x: number; y: number } | null): void;
  enter(): void;
  openTitle(): void;
  openTour(): void;
  destroy(): void;
}

export interface UIHost {
  cameraSnapshot(): { theta: number; phi: number; radius: number; target: [number, number, number] };
}

export function mountUI(root: HTMLElement, universe: Universe, host?: UIHost): UIHandles {
  root.classList.add('mcu-root');

  // Set before anything measures itself. `filters` re-reports its footprint on
  // every scale change, because its on-screen width moves with the zoom.
  const offScale = connectUiScale(root, () => window.dispatchEvent(new Event('resize')));

  const settings = mountSettings(root);
  const play = { enter() {} };
  const tour = mountTour(root, { ensurePlay: () => play.enter() });
  const title = mountTitle(root, universe, {
    toggleSettings: () => settings.toggle(),
    closeSettings: () => settings.close(),
    settingsOpen: () => settings.isOpen(),
    onTour: () => tour.start(),
  });
  play.enter = () => title.enter();
  const hud = mountHud(root, universe, {
    onHome: () => title.open(),
    onHelp: () => tour.start(),
  });
  const search = mountSearch(root, universe);
  const filters = mountFilters(root, universe);
  const cardPanel = mountCardPanel(root, universe);
  const tooltip = mountTooltip(root, universe);
  const minimap = mountMinimap(root);
  const cinematic = mountCinematic(root);
  const bookmarks = mountBookmarks(root, {
    cameraSnapshot: () => host?.cameraSnapshot() ?? { theta: 0, phi: 1.07, radius: 900, target: [0, 0, 0] },
  });

  return {
    setHoverAnchor(p) {
      tooltip.setAnchor(p);
    },
    enter: () => title.enter(),
    openTitle: () => title.open(),
    openTour: () => tour.start(),
    destroy() {
      offScale();
      tour.destroy();
      title.destroy();
      hud.destroy();
      search.destroy();
      filters.destroy();
      cardPanel.destroy();
      tooltip.destroy();
      minimap.destroy();
      cinematic.destroy();
      bookmarks.destroy();
      settings.destroy();
      root.classList.remove('mcu-root');
    },
  };
}
