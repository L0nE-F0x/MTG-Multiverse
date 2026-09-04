/**
 * Guided tour over the live chrome. Started from the title "Tour" button
 * or the HUD "?". UI-only — highlights existing DOM, never imports three.
 */
import { store } from '../core/store.ts';
import { el, listen } from './dom.ts';
import '../styles/tour.css';

export interface TourHandle {
  start(): void;
  stop(): void;
  destroy(): void;
}

export interface TourHost {
  ensurePlay(): void;
}

interface Step {
  title: string;
  body: string;
  target?: () => HTMLElement | null;
  pad?: number;
  before?: () => void;
}

function filtersTarget(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('.mcu-filters--open') ??
    document.querySelector<HTMLElement>('.mcu-filters-tab')
  );
}

const STEPS: Step[] = [
  {
    title: 'Every star is a card',
    body:
      'The five arms are the colour pie, in WUBRG order. Distance from the core is release date — Alpha sits at the centre, this year\'s sets at the rim. Size is how played the card is.',
  },
  {
    title: 'Move through it',
    body:
      'Drag to orbit, scroll or pinch to zoom, right-drag or Shift-drag to pan. WASD flies, Q and E change altitude, Shift goes faster.',
  },
  {
    title: 'Find a card',
    body: 'Press / or click the search field. Type a name, then arrows and Enter pick a result.',
    target: () => document.querySelector('.mcu-search'),
    pad: 10,
  },
  {
    title: 'Narrow the sky',
    body:
      'Colour, type, rarity, format, year, mana value, set. Hover any control for what it does. With nothing selected, everything is visible.',
    target: filtersTarget,
    pad: 8,
    before: () => {
      const tab = document.querySelector<HTMLButtonElement>('.mcu-filters-tab');
      if (tab && !document.querySelector('.mcu-filters--open')) tab.click();
    },
  },
  {
    title: 'Six arrangements',
    body:
      'Galaxy is the default. Timeline, Sets, Colour Wheel, Sphere and Price are the same cards, laid out by a different axis.',
    target: () => document.querySelector('.mcu-layout-switcher'),
    pad: 12,
  },
  {
    title: 'Look closer',
    body:
      'Hover a star for its name. Click to open the card. Fly in and the real art appears. Opening a card threads its printings from the core to the rim.',
  },
  {
    title: "That's the instrument",
    body:
      'Settings is top-right. The wordmark brings you home. The "?" opens this tour again. Esc closes a card. R jumps to a notable one, F reframes the view.',
    target: () => document.querySelector('.mcu-command-bar'),
    pad: 10,
  },
];

export function mountTour(root: HTMLElement, host: TourHost): TourHandle {
  const spot = el('div', { className: 'mcu-tour-spot' });
  const titleEl = el('h2', { className: 'mcu-tour-title' });
  const bodyEl = el('p', { className: 'mcu-tour-body' });
  const stepEl = el('div', { className: 'mcu-tour-step' });
  const skipBtn = el('button', { className: 'mcu-tour-skip', text: 'Skip', attrs: { type: 'button' } });
  const backBtn = el('button', { className: 'mcu-tour-back', text: 'Back', attrs: { type: 'button' } });
  const nextBtn = el('button', { className: 'mcu-tour-next', text: 'Next', attrs: { type: 'button' } });

  const card = el('div', { className: 'mcu-tour-card mcu-glass-panel', attrs: { role: 'dialog', 'aria-modal': 'true' } }, [
    el('div', { className: 'mcu-corner mcu-corner--tl' }),
    el('div', { className: 'mcu-corner mcu-corner--br' }),
    titleEl,
    bodyEl,
    el('div', { className: 'mcu-tour-footer' }, [
      stepEl,
      el('div', { className: 'mcu-tour-actions' }, [skipBtn, backBtn, nextBtn]),
    ]),
  ]);

  const overlay = el(
    'div',
    { className: 'mcu-tour', attrs: { 'aria-hidden': 'true' } },
    [spot, card],
  );
  root.append(overlay);

  let index = 0;
  let active = false;

  function placeCard(target: DOMRect | null): void {
    card.style.left = '';
    card.style.right = '';
    card.style.top = '';
    card.style.bottom = '';
    card.style.transform = '';

    const cw = Math.min(420, window.innerWidth - 32);
    const ch = card.getBoundingClientRect().height || 180;
    const margin = 20;

    if (!target) {
      card.style.left = '50%';
      card.style.top = '50%';
      card.style.transform = 'translate(-50%, -50%)';
      return;
    }

    const spaceBelow = window.innerHeight - target.bottom;
    const spaceAbove = target.top;
    if (spaceBelow >= ch + margin + 16) {
      card.style.left = '50%';
      card.style.top = `${target.bottom + 16}px`;
      card.style.transform = 'translateX(-50%)';
    } else if (spaceAbove >= ch + margin + 16) {
      card.style.left = '50%';
      card.style.bottom = `${window.innerHeight - target.top + 16}px`;
      card.style.transform = 'translateX(-50%)';
    } else {
      card.style.left = '50%';
      card.style.top = '50%';
      card.style.transform = 'translate(-50%, -50%)';
    }

    // Keep the card on-screen horizontally.
    const cr = card.getBoundingClientRect();
    if (cr.left < margin) {
      card.style.left = `${margin + cw / 2}px`;
    } else if (cr.right > window.innerWidth - margin) {
      card.style.left = `${window.innerWidth - margin - cw / 2}px`;
    }
  }

  function paint(): void {
    const step = STEPS[index];
    if (!step) {
      stop();
      return;
    }
    step.before?.();
    titleEl.textContent = step.title;
    bodyEl.textContent = step.body;
    stepEl.textContent = `${index + 1} of ${STEPS.length}`;
    backBtn.disabled = index === 0;
    nextBtn.textContent = index === STEPS.length - 1 ? 'Done' : 'Next';

    const target = step.target?.() ?? null;
    if (target) {
      const r = target.getBoundingClientRect();
      const pad = step.pad ?? 8;
      overlay.classList.remove('mcu-tour--veil');
      spot.classList.add('mcu-tour-spot--on');
      spot.style.left = `${r.left - pad}px`;
      spot.style.top = `${r.top - pad}px`;
      spot.style.width = `${r.width + pad * 2}px`;
      spot.style.height = `${r.height + pad * 2}px`;
      placeCard(r);
    } else {
      overlay.classList.add('mcu-tour--veil');
      spot.classList.remove('mcu-tour-spot--on');
      spot.style.width = '0';
      spot.style.height = '0';
      placeCard(null);
    }
  }

  function show(i: number): void {
    index = Math.max(0, Math.min(STEPS.length - 1, i));
    paint();
    requestAnimationFrame(() => nextBtn.focus());
  }

  function start(): void {
    host.ensurePlay();
    if (active) {
      requestAnimationFrame(() => requestAnimationFrame(() => show(0)));
      return;
    }
    active = true;
    overlay.classList.add('mcu-tour--open');
    overlay.setAttribute('aria-hidden', 'false');
    // Two frames: title class has to drop so chrome is measurable.
    requestAnimationFrame(() => requestAnimationFrame(() => show(0)));
  }

  function stop(): void {
    if (!active) return;
    active = false;
    overlay.classList.remove('mcu-tour--open');
    overlay.setAttribute('aria-hidden', 'true');
    spot.classList.remove('mcu-tour-spot--on');
  }

  const offNext = listen(nextBtn, 'click', () => {
    if (index >= STEPS.length - 1) stop();
    else show(index + 1);
  });
  const offBack = listen(backBtn, 'click', () => show(index - 1));
  const offSkip = listen(skipBtn, 'click', stop);
  const offResize = listen(window, 'resize', () => {
    if (active) paint();
  });
  const offKey = listen(window, 'keydown', (e) => {
    if (!active) return;
    const ev = e as KeyboardEvent;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      stop();
    } else if (ev.key === 'ArrowRight') {
      ev.preventDefault();
      if (index >= STEPS.length - 1) stop();
      else show(index + 1);
    } else if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      show(index - 1);
    }
  });
  const offShell = store.on('shell', (mode) => {
    if (mode === 'title') stop();
  });

  return {
    start,
    stop,
    destroy() {
      offNext();
      offBack();
      offSkip();
      offResize();
      offKey();
      offShell();
      overlay.remove();
    },
  };
}
