/**
 * Collapsible top-right visual settings panel: sliders and checkboxes bound
 * to `store.patchVisual`, plus a small fps/visible-count telemetry readout.
 */
import { store } from '../core/store.ts';
import { el } from './dom.ts';
import '../styles/settings.css';

export interface SettingsHandle {
  destroy(): void;
}

export function mountSettings(root: HTMLElement): SettingsHandle {
  const disposers: (() => void)[] = [];

  function slider(
    label: string,
    min: number,
    max: number,
    step: number,
    get: () => number,
    set: (v: number) => void,
    fmt: (v: number) => string = (v) => v.toFixed(2),
  ): HTMLElement {
    const input = el('input', {
      attrs: { type: 'range', min: String(min), max: String(max), step: String(step) },
    });
    const value = el('span', { className: 'mcu-settings-value' });
    input.value = String(get());
    value.textContent = fmt(get());
    input.addEventListener('input', () => {
      const v = Number(input.value);
      set(v);
      value.textContent = fmt(v);
    });
    disposers.push(
      store.on('visual', () => {
        input.value = String(get());
        value.textContent = fmt(get());
      }),
    );
    return el('label', { className: 'mcu-settings-row' }, [
      el('span', { className: 'mcu-settings-label', text: label }),
      input,
      value,
    ]);
  }

  function checkbox(label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
    const input = el('input', { attrs: { type: 'checkbox' } });
    input.checked = get();
    input.addEventListener('change', () => set(input.checked));
    disposers.push(
      store.on('visual', () => {
        input.checked = get();
      }),
    );
    return el('label', { className: 'mcu-settings-checkbox-row' }, [input, document.createTextNode(label)]);
  }

  const fpsEl = el('span', { className: 'mcu-telemetry-fps' });
  const visEl = el('span', { className: 'mcu-telemetry-visible' });
  function paintStats(): void {
    const s = store.state.stats;
    fpsEl.textContent = s.fps.toFixed(0);
    visEl.textContent = `${s.visible.toLocaleString()} / ${s.total.toLocaleString()}`;
  }
  paintStats();
  disposers.push(store.on('stats', paintStats));

  const body = el('div', { className: 'mcu-settings-body' }, [
    el('h3', { className: 'mcu-filter-heading', text: 'Rendering' }),
    slider('Bloom', 0, 3, 0.05, () => store.state.visual.bloom, (v) => store.patchVisual({ bloom: v })),
    slider('Exposure', 0, 3, 0.05, () => store.state.visual.exposure, (v) => store.patchVisual({ exposure: v })),
    slider('Star size', 0, 3, 0.05, () => store.state.visual.starSize, (v) => store.patchVisual({ starSize: v })),
    slider('Nebula intensity', 0, 2, 0.05, () => store.state.visual.nebula, (v) => store.patchVisual({ nebula: v })),
    slider(
      'Dim filtered-out',
      0,
      1,
      0.01,
      () => store.state.visual.dimFiltered,
      (v) => store.patchVisual({ dimFiltered: v }),
    ),
    el('h3', { className: 'mcu-filter-heading', text: 'Display' }),
    checkbox('Nebula', () => store.state.visual.showNebula, (v) => store.patchVisual({ showNebula: v })),
    checkbox('Labels', () => store.state.visual.showLabels, (v) => store.patchVisual({ showLabels: v })),
    checkbox('Grid', () => store.state.visual.showGrid, (v) => store.patchVisual({ showGrid: v })),
    checkbox('Motion blur', () => store.state.visual.motionBlur, (v) => store.patchVisual({ motionBlur: v })),
    checkbox('Auto-rotate', () => store.state.visual.autoRotate, (v) => store.patchVisual({ autoRotate: v })),
    el('h3', { className: 'mcu-filter-heading', text: 'Telemetry' }),
    el('div', { className: 'mcu-telemetry' }, [
      el('div', {}, [document.createTextNode('FPS '), fpsEl]),
      el('div', {}, [document.createTextNode('VISIBLE '), visEl]),
    ]),
  ]);

  const panel = el('div', { className: 'mcu-settings mcu-glass-panel' }, [
    el('div', { className: 'mcu-corner mcu-corner--tl' }),
    el('div', { className: 'mcu-corner mcu-corner--br' }),
    body,
  ]);
  const toggle = el('button', { className: 'mcu-settings-toggle', text: 'SETTINGS', attrs: { type: 'button' } });
  toggle.addEventListener('click', () => panel.classList.toggle('mcu-settings--open'));

  root.append(toggle, panel);

  return {
    destroy() {
      for (const off of disposers) off();
      toggle.remove();
      panel.remove();
    },
  };
}
