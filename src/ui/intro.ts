/**
 * Landing / introduction overlay. Appears the first time the galaxy becomes
 * ready (`store.state.ready`), stays reachable afterwards through the HUD's
 * "?" control, and never blocks the renderer — the galaxy is the hero and
 * keeps turning (via `visual.autoRotate`) behind a frosted glass panel.
 */
import { store } from '../core/store.ts';
import type { Universe } from '../data/universe.ts';
import { el, fmtInt, listen } from './dom.ts';
import '../styles/intro.css';

export interface IntroHandle {
  /** Reopens the overlay. Wired to the HUD's "?" control. */
  open(): void;
  destroy(): void;
}

const SEEN_KEY = 'mcu.introSeen';

function hasSeenIntro(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markIntroSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Privacy mode / storage disabled — nothing we can do, just re-show next time.
  }
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

export function mountIntro(root: HTMLElement, universe: Universe): IntroHandle {
  const enterBtn = el('button', {
    className: 'mcu-intro-enter',
    text: 'Enter the universe',
    attrs: { type: 'button' },
  });

  const footer = el('div', { className: 'mcu-intro-footer' }, [
    enterBtn,
    el('div', { className: 'mcu-intro-hint' }, [
      document.createTextNode('Press '),
      kbd('Esc'),
      document.createTextNode(' anytime, or reopen this from the '),
      el('span', { className: 'mcu-intro-hint-mark', text: '?' }),
      document.createTextNode(' in the corner.'),
    ]),
  ]);

  const whatSection = section(1, 'What this is', [
    el('p', { className: 'mcu-intro-body' }, [
      document.createTextNode('Every Magic: The Gathering card ever printed — '),
      el('strong', { className: 'mcu-intro-count', text: fmtInt(universe.count) }),
      document.createTextNode(
        ' of them so far — rendered as a single explorable galaxy. Every star out there is a real card.',
      ),
    ]),
  ]);

  const howSection = section(2, 'How to read it', [
    el('p', { className: 'mcu-intro-body' }, [
      document.createTextNode('Position is data, not decoration. Nothing is placed at random.'),
    ]),
    defList([
      {
        term: ['Spiral arm ', el('span', { className: 'mcu-intro-term-sub', text: '(angle)' })],
        desc: "Colour identity — the five arms are literally the colour pie, in WUBRG order.",
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
  ]);

  const controlsSection = section(3, 'Controls', [
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
      { term: [kbd('Esc')], desc: 'Close the card panel.' },
    ]),
    el('p', { className: 'mcu-intro-body' }, [
      document.createTextNode(
        'Six layouts wait along the bottom edge, filters live on the left, visual settings sit top-right. ' +
          'Fly in close on any star and its actual card art materialises around you.',
      ),
    ]),
  ]);

  const panel = el(
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
        el('div', { className: 'mcu-intro-wordmark', text: 'MAGIC CARD UNIVERSE', attrs: { id: 'mcu-intro-title' } }),
        el('div', { className: 'mcu-intro-tagline', text: 'Every card. One galaxy.' }),
        whatSection,
        howSection,
        controlsSection,
        footer,
      ]),
    ],
  );

  const overlay = el('div', { className: 'mcu-intro', attrs: { 'aria-hidden': 'true' } }, [panel]);
  root.append(overlay);

  let isOpen = false;
  let lastFocused: HTMLElement | null = null;

  function open(): void {
    if (isOpen) return;
    isOpen = true;
    lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overlay.classList.add('mcu-intro--open');
    overlay.setAttribute('aria-hidden', 'false');
    store.patchVisual({ autoRotate: true });
    requestAnimationFrame(() => enterBtn.focus());
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    overlay.classList.remove('mcu-intro--open');
    overlay.setAttribute('aria-hidden', 'true');
    store.patchVisual({ autoRotate: false });
    markIntroSeen();
    lastFocused?.focus();
    lastFocused = null;
  }

  function maybeAutoOpen(): void {
    if (!hasSeenIntro()) open();
  }

  if (store.state.ready) maybeAutoOpen();
  const offReady = store.on('ready', (ready) => {
    if (ready) maybeAutoOpen();
  });

  const offEnter = listen(enterBtn, 'click', close);
  const offBackdrop = listen(overlay, 'mousedown', (e) => {
    if (e.target === overlay) close();
  });
  const offEscape = listen(window, 'keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape' && isOpen) close();
  });

  return {
    open,
    destroy() {
      offReady();
      offEnter();
      offBackdrop();
      offEscape();
      if (isOpen) store.patchVisual({ autoRotate: false });
      overlay.remove();
    },
  };
}
