/**
 * Collapsible top-right visual settings panel: sliders and checkboxes bound
 * to `store.patchVisual`, plus a small fps/visible-count telemetry readout.
 */
import { resetSettings } from '../core/persist.ts';
import { store } from '../core/store.ts';
import { el, listen } from './dom.ts';
import '../styles/settings.css';

export interface SettingsHandle {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  destroy(): void;
}

export function mountSettings(root: HTMLElement): SettingsHandle {
  const disposers: (() => void)[] = [];

  function slider(
    label: string,
    tip: string,
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
    const name = el('span', { className: 'mcu-settings-label', text: label });
    name.setAttribute('data-tip', tip);
    return el('label', { className: 'mcu-settings-row' }, [name, input, value]);
  }

  function checkbox(label: string, tip: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
    const input = el('input', { attrs: { type: 'checkbox' } });
    input.checked = get();
    input.addEventListener('change', () => set(input.checked));
    disposers.push(
      store.on('visual', () => {
        input.checked = get();
      }),
    );
    const row = el('label', { className: 'mcu-settings-checkbox-row' }, [
      input,
      document.createTextNode(label),
    ]);
    row.setAttribute('data-tip', tip);
    return row;
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

  const resetBtn = el('button', {
    className: 'mcu-settings-reset',
    text: 'Reset look',
    attrs: { type: 'button' },
  });
  resetBtn.setAttribute('data-tip', 'Return bloom, exposure, star size, nebula and the display toggles to their defaults.');
  resetBtn.addEventListener('click', () => resetSettings());

  const body = el('div', { className: 'mcu-settings-body' }, [
    el('h3', { className: 'mcu-filter-heading', text: 'Rendering' }),
    slider(
      'Bloom',
      'How far bright stars glow. Higher values give a hazy halo; too high washes the nebula to white.',
      0, 3, 0.05,
      () => store.state.visual.bloom, (v) => store.patchVisual({ bloom: v }),
    ),
    slider(
      'Exposure',
      'Overall brightness of the stars. Does not brighten the nebula — that is the intensity slider below.',
      0, 3, 0.05,
      () => store.state.visual.exposure, (v) => store.patchVisual({ exposure: v }),
    ),
    slider(
      'Star size',
      'Sprite scale for every star. Bigger is easier to pick; too big turns the disc into a sheet.',
      0, 3, 0.05,
      () => store.state.visual.starSize, (v) => store.patchVisual({ starSize: v }),
    ),
    slider(
      'Nebula intensity',
      'How strongly the volumetric gas glows. Independent of Exposure — this is the cloud, not the stars.',
      0, 2, 0.05,
      () => store.state.visual.nebula, (v) => store.patchVisual({ nebula: v }),
    ),
    slider(
      'Dim filtered-out',
      'How visible cards that fail the current filter stay. Zero hides them; a little left shows the shape of the rest of Magic.',
      0, 1, 0.01,
      () => store.state.visual.dimFiltered, (v) => store.patchVisual({ dimFiltered: v }),
    ),
    el('h3', { className: 'mcu-filter-heading', text: 'Display' }),
    checkbox(
      'Nebula',
      'The coloured gas that follows the spiral arms. Off is cheaper and a little sharper on the stars.',
      () => store.state.visual.showNebula, (v) => store.patchVisual({ showNebula: v }),
    ),
    checkbox(
      'Labels',
      'Names of the most-played cards currently in view. They fade in as you get closer.',
      () => store.state.visual.showLabels, (v) => store.patchVisual({ showLabels: v }),
    ),
    checkbox(
      'Motion blur',
      'A short trail behind moving stars. Off by default because it smears the labels.',
      () => store.state.visual.motionBlur, (v) => store.patchVisual({ motionBlur: v }),
    ),
    checkbox(
      'Auto-rotate',
      'Slow orbit when you are not flying. Remembered between visits.',
      () => store.state.visual.autoRotate, (v) => store.patchVisual({ autoRotate: v }),
    ),
    resetBtn,
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
  panel.id = 'mcu-settings-panel';
  const toggle = el('button', {
    className: 'mcu-settings-toggle',
    text: 'SETTINGS',
    attrs: {
      type: 'button',
      'aria-expanded': 'false',
      'aria-controls': 'mcu-settings-panel',
    },
  });
  function setOpen(open: boolean): void {
    panel.classList.toggle('mcu-settings--open', open);
    toggle.setAttribute('aria-expanded', String(open));
  }

  toggle.addEventListener('click', () => {
    setOpen(!panel.classList.contains('mcu-settings--open'));
  });

  const floatTip = el('div', {
    className: 'mcu-float-tip',
    attrs: { role: 'tooltip', hidden: '' },
  });
  let tipAnchor: HTMLElement | null = null;
  function placeTip(anchor: HTMLElement): void {
    const text = anchor.getAttribute('data-tip');
    if (!text) return;
    floatTip.textContent = text;
    floatTip.hidden = false;
    void floatTip.offsetWidth;
    const r = anchor.getBoundingClientRect();
    const tipR = floatTip.getBoundingClientRect();
    // Panel lives on the right; prefer the gap to its left.
    let left = r.left - tipR.width - 12;
    if (left < 8) left = Math.min(window.innerWidth - tipR.width - 8, r.right + 10);
    let top = r.top + r.height / 2 - tipR.height / 2;
    if (top < 8) top = 8;
    if (top + tipR.height > window.innerHeight - 8) top = window.innerHeight - tipR.height - 8;
    floatTip.style.left = `${left}px`;
    floatTip.style.top = `${top}px`;
  }
  disposers.push(
    listen(panel, 'pointerover', (e) => {
      const a = (e.target as HTMLElement | null)?.closest?.('[data-tip]');
      if (!(a instanceof HTMLElement) || !panel.contains(a)) return;
      tipAnchor = a;
      placeTip(a);
    }),
    listen(panel, 'pointerout', (e) => {
      const to = (e as PointerEvent).relatedTarget as Node | null;
      if (tipAnchor && to && (tipAnchor === to || tipAnchor.contains(to))) return;
      floatTip.hidden = true;
      tipAnchor = null;
    }),
  );

  root.append(toggle, panel, floatTip);

  return {
    open() { setOpen(true); },
    close() { setOpen(false); },
    toggle() { setOpen(!panel.classList.contains('mcu-settings--open')); },
    isOpen() { return panel.classList.contains('mcu-settings--open'); },
    destroy() {
      for (const off of disposers) off();
      toggle.remove();
      panel.remove();
      floatTip.remove();
    },
  };
}
