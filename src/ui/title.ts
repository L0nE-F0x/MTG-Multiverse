/**
 * Title screen shown after boot, every visit, and again from the HUD wordmark.
 * The galaxy keeps turning behind it. Instructions is a separate overlay;
 * Settings is the existing panel, opened via the host callbacks.
 */
import { store } from '../core/store.ts';
import type { Universe } from '../data/universe.ts';
import { BRAND_TAGLINE, BRAND_WORDMARK, DISCLAIMER } from './brand.ts';
import { el, fmtInt, listen } from './dom.ts';
import { MANA_COLOR_HEX } from './theme.ts';
import '../styles/title.css';
import '../styles/intro.css';

export interface TitleHandle {
  open(): void;
  enter(): void;
  openHelp(): void;
  destroy(): void;
}

export interface TitleHost {
  toggleSettings(): void;
  closeSettings(): void;
  settingsOpen(): boolean;
}

function kbd(label: string): HTMLElement {
  return el('kbd', { className: 'mcu-kbd', text: label });
}

interface DefRow {
  term: (Node | string)[];
  desc: string;
}

function defList(rows: DefRow[]): HTMLElement {
  const dl = el('dl', { className: 'mcu-intro-dl' });
  for (const { term, desc } of rows) {
    dl.append(el('dt', {}, term), el('dd', { text: desc }));
  }
  return dl;
}

function section(index: number, heading: string, children: (Node | string)[]): HTMLElement {
  return el('section', { className: `mcu-intro-section mcu-intro-section--${index}` }, [
    el('h2', { className: 'mcu-intro-heading', text: heading }),
    ...children,
  ]);
}

function manaPips(className: string): HTMLElement {
  const row = el('div', { className });
  for (const c of ['W', 'U', 'B', 'R', 'G'] as const) {
    const pip = el('span', { className: 'mcu-title-pip' });
    const hex = MANA_COLOR_HEX[c] ?? '#888';
    pip.style.background = hex;
    pip.style.color = hex;
    row.append(pip);
  }
  return row;
}

export function mountTitle(root: HTMLElement, universe: Universe, host: TitleHost): TitleHandle {
  const enterBtn = el('button', {
    className: 'mcu-title-enter',
    text: 'Enter the Multiverse',
    attrs: { type: 'button' },
  });
  const helpBtn = el('button', {
    className: 'mcu-title-btn',
    text: 'Instructions',
    attrs: { type: 'button' },
  });
  const settingsBtn = el('button', {
    className: 'mcu-title-btn',
    text: 'Settings',
    attrs: { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'mcu-settings-panel' },
  });

  const mark = el('img', {
    className: 'mcu-title-mark',
    attrs: { src: '/mark.svg', alt: '', width: '120', height: '120' },
  });

  const overlay = el(
    'div',
    {
      className: 'mcu-title',
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'mcu-title-wordmark',
        'aria-hidden': 'true',
      },
    },
    [
      el('div', { className: 'mcu-title-vignette' }),
      el('div', { className: 'mcu-title-center' }, [
        mark,
        el('h1', {
          className: 'mcu-title-wordmark',
          text: BRAND_WORDMARK,
          attrs: { id: 'mcu-title-wordmark' },
        }),
        manaPips('mcu-title-pips'),
        el('p', { className: 'mcu-title-tagline', text: BRAND_TAGLINE }),
        el('p', {
          className: 'mcu-title-count',
          text: `${fmtInt(universe.count)} printings`,
        }),
        el('div', { className: 'mcu-title-actions' }, [
          enterBtn,
          el('div', { className: 'mcu-title-secondary' }, [helpBtn, settingsBtn]),
        ]),
      ]),
      el('p', { className: 'mcu-title-disclaimer', text: DISCLAIMER }),
    ],
  );
  root.append(overlay);

  const backBtn = el('button', {
    className: 'mcu-intro-back',
    text: 'Back',
    attrs: { type: 'button' },
  });

  const helpPanel = el(
    'div',
    {
      className: 'mcu-intro-panel mcu-glass-panel',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mcu-intro-title' },
    },
    [
      el('div', { className: 'mcu-corner mcu-corner--tl' }),
      el('div', { className: 'mcu-corner mcu-corner--tr' }),
      el('div', { className: 'mcu-corner mcu-corner--bl' }),
      el('div', { className: 'mcu-corner mcu-corner--br' }),
      el('div', { className: 'mcu-intro-scroll' }, [
        el('div', {
          className: 'mcu-intro-wordmark',
          text: BRAND_WORDMARK,
          attrs: { id: 'mcu-intro-title' },
        }),
        el('div', { className: 'mcu-intro-tagline', text: BRAND_TAGLINE }),
        section(1, 'What this is', [
          el('p', { className: 'mcu-intro-body' }, [
            document.createTextNode('Every Magic: The Gathering card ever printed — '),
            el('strong', { className: 'mcu-intro-count', text: fmtInt(universe.count) }),
            document.createTextNode(
              ' of them so far — rendered as a single explorable galaxy. Every star out there is a real card.',
            ),
          ]),
        ]),
        section(2, 'How to read it', [
          el('p', { className: 'mcu-intro-body' }, [
            document.createTextNode('Position is data, not decoration. Nothing is placed at random.'),
          ]),
          defList([
            {
              term: ['Spiral arm ', el('span', { className: 'mcu-intro-term-sub', text: '(angle)' })],
              desc: 'Colour identity — the five arms are literally the colour pie, in WUBRG order.',
            },
            {
              term: ['Distance from centre'],
              desc: 'Release date — Alpha sits at the core, the newest set sits out at the rim.',
            },
            {
              term: ['Star size & brightness'],
              desc: 'How played the card is (its EDHREC rank), weighted by rarity.',
            },
            {
              term: ['Star colour'],
              desc: 'Blended colour identity — gold for multicolour cards.',
            },
            {
              term: ['The halo'],
              desc: 'Colourless artifacts, which belong to no arm.',
            },
            {
              term: ['The nebula'],
              desc: "Follows the same spiral, tinted by whichever colour's arm it sits in.",
            },
          ]),
        ]),
        section(3, 'Controls', [
          defList([
            { term: ['Drag'], desc: 'Orbit the galaxy.' },
            {
              term: ['Right-drag, middle-drag, or ', kbd('Shift'), ' + drag'],
              desc: 'Pan.',
            },
            { term: ['Scroll or pinch'], desc: 'Zoom.' },
            { term: ['Hover a star'], desc: 'See its name.' },
            { term: ['Click a star'], desc: 'Open the card.' },
            {
              term: [kbd('/'), ' or ', kbd('Ctrl'), ' + ', kbd('K')],
              desc: 'Search — arrows and Enter pick a result.',
            },
            {
              term: [kbd('W'), kbd('A'), kbd('S'), kbd('D'), ' or arrows'],
              desc: 'Fly. Q and E change altitude, Shift moves faster.',
            },
            { term: [kbd('R')], desc: 'Jump to a random notable card.' },
            { term: [kbd('F')], desc: 'Reframe the whole layout.' },
            { term: [kbd('Esc')], desc: 'Close the card panel.' },
          ]),
          el('p', { className: 'mcu-intro-body' }, [
            document.createTextNode(
              'Fly close and the real card art appears; opening a card threads its ' +
                'printings from the core to the rim.',
            ),
          ]),
        ]),
      ]),
      el('div', { className: 'mcu-intro-footer' }, [backBtn]),
    ],
  );

  const helpOverlay = el('div', { className: 'mcu-intro', attrs: { 'aria-hidden': 'true' } }, [helpPanel]);
  root.append(helpOverlay);

  let titleOpen = false;
  let helpOpen = false;
  let lastFocused: HTMLElement | null = null;
  let savedAutoRotate = false;

  function syncRoot(): void {
    root.classList.toggle('mcu-root--title', titleOpen);
  }

  function syncSettingsBtn(): void {
    settingsBtn.setAttribute('aria-expanded', String(host.settingsOpen()));
  }

  function setTitleOpen(open: boolean): void {
    if (titleOpen === open) {
      syncRoot();
      return;
    }
    titleOpen = open;
    overlay.classList.toggle('mcu-title--open', open);
    overlay.setAttribute('aria-hidden', open ? 'false' : 'true');
    syncRoot();
    if (open) {
      savedAutoRotate = store.state.visual.autoRotate;
      store.patchVisual({ autoRotate: true });
      if (store.state.shell !== 'title') store.set('shell', 'title');
      requestAnimationFrame(() => enterBtn.focus());
    } else {
      store.patchVisual({ autoRotate: savedAutoRotate });
      if (store.state.shell !== 'play') store.set('shell', 'play');
    }
  }

  function setHelpOpen(open: boolean): void {
    if (helpOpen === open) return;
    helpOpen = open;
    helpOverlay.classList.toggle('mcu-intro--open', open);
    helpOverlay.setAttribute('aria-hidden', open ? 'false' : 'true');
    overlay.classList.toggle('mcu-title--help', open && titleOpen);
    if (open) {
      lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      requestAnimationFrame(() => backBtn.focus());
    } else {
      lastFocused?.focus();
      lastFocused = null;
    }
  }

  function open(): void {
    host.closeSettings();
    setHelpOpen(false);
    setTitleOpen(true);
  }

  function enter(): void {
    host.closeSettings();
    setHelpOpen(false);
    setTitleOpen(false);
  }

  function openHelp(): void {
    host.closeSettings();
    setHelpOpen(true);
  }

  const offEnter = listen(enterBtn, 'click', enter);
  const offHelp = listen(helpBtn, 'click', () => openHelp());
  const offSettings = listen(settingsBtn, 'click', () => {
    host.toggleSettings();
    syncSettingsBtn();
  });
  const offBack = listen(backBtn, 'click', () => setHelpOpen(false));
  const offHelpBackdrop = listen(helpOverlay, 'mousedown', (e) => {
    if (e.target === helpOverlay) setHelpOpen(false);
  });

  function helpFocusable(): HTMLElement[] {
    return [...helpPanel.querySelectorAll<HTMLElement>('a[href], button, input, [tabindex]')].filter(
      (node) => !node.hasAttribute('disabled') && node.tabIndex !== -1,
    );
  }

  const offKeydown = listen(window, 'keydown', (e) => {
    const ev = e as KeyboardEvent;
    if (helpOpen) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        setHelpOpen(false);
        return;
      }
      if (ev.key !== 'Tab') return;
      const items = helpFocusable();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (ev.shiftKey ? active === first || !helpPanel.contains(active) : active === last) {
        ev.preventDefault();
        (ev.shiftKey ? last : first).focus();
      }
      return;
    }

    if (!titleOpen) return;

    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (host.settingsOpen()) {
        host.closeSettings();
        syncSettingsBtn();
      }
    }
  });

  const offShell = store.on('shell', (mode) => {
    if (mode === 'play') {
      host.closeSettings();
      setHelpOpen(false);
      if (titleOpen) setTitleOpen(false);
    } else if (mode === 'title' && !titleOpen) {
      setTitleOpen(true);
    }
  });

  const offVisual = store.on('visual', syncSettingsBtn);

  // Every visit: the title is the first thing after boot. Open immediately so
  // the boot overlay fading out reveals it over the already-turning galaxy.
  setTitleOpen(true);

  return {
    open,
    enter,
    openHelp,
    destroy() {
      offEnter();
      offHelp();
      offSettings();
      offBack();
      offHelpBackdrop();
      offKeydown();
      offShell();
      offVisual();
      if (titleOpen) store.patchVisual({ autoRotate: savedAutoRotate });
      if (store.state.shell === 'title') store.set('shell', 'play');
      overlay.remove();
      helpOverlay.remove();
      root.classList.remove('mcu-root--title');
    },
  };
}
