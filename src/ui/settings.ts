/**
 * Collapsible top-right visual settings panel: sliders and checkboxes bound
 * to `store.patchVisual`, plus a small fps/visible-count telemetry readout.
 */
import { resetSettings } from '../core/persist.ts';
import { store } from '../core/store.ts';
import { el, listen } from './dom.ts';
import {
  fullscreenSupported,
  isFullscreen,
  onFullscreenChange,
  setFullscreen,
} from './fullscreen.ts';
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
    const row = el('label', { className: 'mcu-settings-row' }, [name, input, value]);
    row.setAttribute('data-tip', tip);
    return row;
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

  /*
   * Fullscreen is not a `visual` setting: the renderer has no opinion on it,
   * and "Reset look" should not drag someone back out of it. It reads and
   * writes the real document state, and follows it when the system's own
   * gesture leaves fullscreen behind our back.
   */
  function fullscreenRow(): HTMLElement | null {
    if (!fullscreenSupported()) return null;
    const input = el('input', { attrs: { type: 'checkbox' } });
    input.checked = isFullscreen();
    input.addEventListener('change', () => void setFullscreen(input.checked));
    disposers.push(
      onFullscreenChange(() => {
        input.checked = isFullscreen();
      }),
    );
    const row = el('label', { className: 'mcu-settings-checkbox-row' }, [
      input,
      document.createTextNode('Fullscreen'),
    ]);
    row.setAttribute(
      'data-tip',
      'Hide the browser and system bars. On a phone this is what removes the clock and battery strip along the top.',
    );
    return row;
  }

  const fullscreenRows = [fullscreenRow()].filter((r): r is HTMLElement => r !== null);

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
      'Soft glow around bright stars. Higher values give a dreamy halo; too high washes the nebula to white.',
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
      'How large each card-star is drawn. Bigger is easier to click; too big turns the disc into a sheet.',
      0, 3, 0.05,
      () => store.state.visual.starSize, (v) => store.patchVisual({ starSize: v }),
    ),
    slider(
      'Nebula intensity',
      'How strongly the coloured gas glows. Independent of Exposure — this is the cloud, not the stars.',
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
    ...fullscreenRows,
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
  /*
   * Word on a desktop, gear on a phone. The three top-left/top-right controls
   * share one row under 900px, and "SETTINGS" at 9px still costs ~86px of it —
   * against a search field with barely 200px to live in, that is the
   * difference between a usable field and a stub. Both are in the DOM and CSS
   * picks; the accessible name comes from `aria-label`, so it does not change
   * with the breakpoint.
   */
  const toggle = el('button', {
    className: 'mcu-settings-toggle',
    attrs: {
      type: 'button',
      'aria-expanded': 'false',
      'aria-controls': 'mcu-settings-panel',
      'aria-label': 'Settings',
    },
  }, [
    el('span', { className: 'mcu-settings-toggle-word', text: 'SETTINGS' }),
  ]);
  toggle.insertAdjacentHTML(
    'afterbegin',
    // Sliders, not a cog: the panel behind this button is five sliders and four
    // checkboxes, and a cog at 20px on a dark ground is a smudge. A rayed
    // circle was the first attempt and read as a brightness control.
    `<svg class="mcu-settings-toggle-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
       <path d="M4 7h16M4 12h16M4 17h16"/>
       <circle cx="9" cy="7" r="2.2"/>
       <circle cx="15.5" cy="12" r="2.2"/>
       <circle cx="8" cy="17" r="2.2"/>
     </svg>`,
  );
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
    const panelR = panel.getBoundingClientRect();
    const r = anchor.getBoundingClientRect();
    // Anchor to the panel's left edge so the box grows away from the sliders
    // even on the first frame, when its width has not been measured yet.
    floatTip.style.left = 'auto';
    floatTip.style.right = `${Math.max(8, window.innerWidth - panelR.left + 12)}px`;
    let top = r.top + r.height / 2 - 28;
    void floatTip.offsetWidth;
    const tipR = floatTip.getBoundingClientRect();
    top = r.top + r.height / 2 - tipR.height / 2;
    if (top < 8) top = 8;
    if (top + tipR.height > window.innerHeight - 8) top = window.innerHeight - tipR.height - 8;
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

  /*
   * How much of the top-right corner this control occupies, in the layout
   * pixels the rest of the chrome is positioned in. Search fills the gap
   * between this and the wordmark card (which publishes the matching
   * `--mcu-topbar-left` from `hud.ts`), and neither width is a constant: this
   * one swaps between a word and an icon at the breakpoint.
   */
  const reportTopBarRight = (): void => {
    const right = parseFloat(getComputedStyle(toggle).right) || 0;
    root.style.setProperty('--mcu-topbar-right', `${Math.round(right + toggle.offsetWidth)}px`);
  };
  reportTopBarRight();
  const toggleObserver = new ResizeObserver(reportTopBarRight);
  toggleObserver.observe(toggle);
  disposers.push(listen(window, 'resize', reportTopBarRight));

  return {
    open() { setOpen(true); },
    close() { setOpen(false); },
    toggle() { setOpen(!panel.classList.contains('mcu-settings--open')); },
    isOpen() { return panel.classList.contains('mcu-settings--open'); },
    destroy() {
      for (const off of disposers) off();
      toggleObserver.disconnect();
      root.style.removeProperty('--mcu-topbar-right');
      toggle.remove();
      panel.remove();
      floatTip.remove();
    },
  };
}
