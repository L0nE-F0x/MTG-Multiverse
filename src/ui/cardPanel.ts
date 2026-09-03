/**
 * Right-edge card detail panel. Opens when `store.state.selected >= 0`.
 * Local dataset fields render immediately; richer text (type line, mana
 * cost, oracle text, flavour text) is fetched lazily from the Scryfall API,
 * cached by uuid, and aborted if the selection changes mid-flight.
 */
import { store } from '../core/store.ts';
import { FORMAT_BIT } from '../data/format.ts';
import type { Universe } from '../data/universe.ts';
import { capitalize, el, listen } from './dom.ts';
import { MANA_COLOR_HEX } from './theme.ts';
import '../styles/cardPanel.css';

export interface CardPanelHandle {
  destroy(): void;
}

interface ScryfallCard {
  type_line?: string;
  mana_cost?: string;
  oracle_text?: string;
  flavor_text?: string;
}

const scryCache = new Map<string, ScryfallCard | null>();

function attachTilt(container: HTMLElement, target: HTMLElement): () => void {
  function onMove(e: Event): void {
    const ev = e as MouseEvent;
    const r = container.getBoundingClientRect();
    const px = (ev.clientX - r.left) / r.width;
    const py = (ev.clientY - r.top) / r.height;
    const rx = (py - 0.5) * -12;
    const ry = (px - 0.5) * 12;
    target.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) scale(1.02)`;
  }
  function onLeave(): void {
    target.style.transform = 'rotateX(0deg) rotateY(0deg) scale(1)';
  }
  const offMove = listen(container, 'mousemove', onMove);
  const offLeave = listen(container, 'mouseleave', onLeave);
  return () => {
    offMove();
    offLeave();
  };
}

function buildImage(universe: Universe, i: number): { frame: HTMLElement; cleanup: () => void } {
  const img = el('img', {
    className: 'mcu-card-image',
    attrs: { alt: universe.name(i), loading: 'lazy' },
    style: { opacity: '0' },
  });
  const shimmer = el('div', { className: 'mcu-card-image-shimmer' });
  const fallback = el('div', { className: 'mcu-card-image-fallback', text: 'IMAGE UNAVAILABLE' });
  fallback.style.display = 'none';
  const frame = el('div', { className: 'mcu-card-image-frame' }, [shimmer, img, fallback]);

  img.addEventListener('load', () => {
    img.style.opacity = '1';
    shimmer.remove();
  });
  img.addEventListener('error', () => {
    img.style.display = 'none';
    shimmer.remove();
    fallback.style.display = 'flex';
  });
  img.src = universe.image(i, 'normal');

  const cleanup = attachTilt(frame, img);
  return { frame, cleanup };
}

function buildPrintings(universe: Universe, i: number): HTMLElement {
  const strip = el('div', { className: 'mcu-printings-strip' });
  for (const p of universe.printingsOf(i)) {
    const chip = el('button', {
      className: 'mcu-printing-chip',
      text: universe.set(p).code.toUpperCase(),
      attrs: { type: 'button', title: universe.set(p).name },
    });
    if (p === i) chip.classList.add('mcu-printing-chip--current');
    chip.addEventListener('click', () => store.set('selected', p));
    strip.append(chip);
  }
  return strip;
}

let inFlight: AbortController | null = null;

async function fetchScryfall(universe: Universe, i: number, onData: (c: ScryfallCard) => void): Promise<void> {
  const uuid = universe.uuid(i);
  if (scryCache.has(uuid)) {
    const cached = scryCache.get(uuid);
    if (cached) onData(cached);
    return;
  }
  inFlight?.abort();
  const ac = new AbortController();
  inFlight = ac;
  try {
    const res = await fetch(`https://api.scryfall.com/cards/${uuid}`, { signal: ac.signal });
    if (!res.ok) {
      scryCache.set(uuid, null);
      return;
    }
    const data = (await res.json()) as ScryfallCard;
    scryCache.set(uuid, data);
    if (!ac.signal.aborted) onData(data);
  } catch {
    // Network failure or abort: leave the richer fields out.
  }
}

export function mountCardPanel(root: HTMLElement, universe: Universe): CardPanelHandle {
  const panel = el('aside', { className: 'mcu-card-panel mcu-glass-panel' });
  root.append(panel);

  let cleanupTilt: (() => void) | null = null;

  function close(): void {
    store.set('selected', -1);
  }

  function render(i: number): void {
    cleanupTilt?.();
    cleanupTilt = null;
    inFlight?.abort();
    panel.innerHTML = '';
    if (i < 0) {
      panel.classList.remove('mcu-card-panel--open');
      return;
    }
    panel.classList.add('mcu-card-panel--open');

    const closeBtn = el('button', {
      className: 'mcu-card-close',
      text: '✕',
      attrs: { type: 'button', 'aria-label': 'Close card detail' },
    });
    closeBtn.addEventListener('click', close);

    const { frame: imgFrame, cleanup } = buildImage(universe, i);
    cleanupTilt = cleanup;

    const colors = universe.colorLetters(i);
    const glow = colors.length ? colors.map((c) => MANA_COLOR_HEX[c] ?? '#5ee7ff') : ['#5ee7ff', '#a56bff'];
    imgFrame.style.setProperty('--glow-1', glow[0]!);
    imgFrame.style.setProperty('--glow-2', glow[glow.length - 1]!);

    const setInfo = universe.set(i);
    const year = universe.released(i).getUTCFullYear();
    const rarity = universe.rarityName(i);
    const price = universe.col.price[i] ?? 0;

    const pipsRow = el('div', { className: 'mcu-card-pips' });
    if (colors.length) {
      for (const c of colors) {
        const pip = el('span', { className: 'mcu-pip' });
        pip.style.setProperty('--pip-color', MANA_COLOR_HEX[c] ?? '#888');
        pipsRow.append(pip);
      }
    } else {
      pipsRow.append(el('span', { className: 'mcu-card-colorless', text: 'Colourless' }));
    }

    const legalityRow = el('div', { className: 'mcu-legality-grid' });
    for (const fmt of Object.keys(FORMAT_BIT) as (keyof typeof FORMAT_BIT)[]) {
      if (universe.col.formatMask[i]! & FORMAT_BIT[fmt]) {
        legalityRow.append(el('span', { className: 'mcu-legality-badge', text: fmt }));
      }
    }

    const infoRows = el('div', { className: 'mcu-card-info' }, [
      el('div', { className: 'mcu-card-name', text: universe.name(i) }),
      el('div', {
        className: 'mcu-card-set-line',
        text: `${setInfo.name} (${setInfo.code.toUpperCase()}) · ${year}`,
      }),
      el('div', { className: `mcu-card-rarity mcu-card-rarity--${rarity}`, text: capitalize(rarity) }),
      el('div', { className: 'mcu-card-artist', text: `Illustrated by ${universe.artist(i)}` }),
      pipsRow,
    ]);
    if (price > 0) infoRows.append(el('div', { className: 'mcu-card-price', text: `$${price.toFixed(2)}` }));
    infoRows.append(legalityRow);

    const oracleBox = el('div', { className: 'mcu-card-oracle mcu-card-oracle--loading' });
    infoRows.append(oracleBox);

    const printStrip = buildPrintings(universe, i);
    const link = el('a', {
      className: 'mcu-card-link',
      text: 'View on Scryfall ↗',
      attrs: { href: universe.scryfallPage(i), target: '_blank', rel: 'noopener noreferrer' },
    });

    panel.append(
      closeBtn,
      el('div', { className: 'mcu-corner mcu-corner--tl' }),
      el('div', { className: 'mcu-corner mcu-corner--br' }),
      imgFrame,
      infoRows,
      el('h3', { className: 'mcu-panel-heading', text: 'Every printing' }),
      printStrip,
      link,
    );

    void fetchScryfall(universe, i, (data) => {
      if (store.state.selected !== i) return;
      oracleBox.classList.remove('mcu-card-oracle--loading');
      if (data.type_line) oracleBox.append(el('div', { className: 'mcu-card-typeline', text: data.type_line }));
      if (data.mana_cost) oracleBox.append(el('div', { className: 'mcu-card-manacost', text: data.mana_cost }));
      if (data.oracle_text) oracleBox.append(el('div', { className: 'mcu-card-oracletext', text: data.oracle_text }));
      if (data.flavor_text) oracleBox.append(el('div', { className: 'mcu-card-flavortext', text: data.flavor_text }));
    });
  }

  if (store.state.selected >= 0) render(store.state.selected);
  const offSelected = store.on('selected', render);
  const offEscape = listen(window, 'keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape' && store.state.selected >= 0) close();
  });

  return {
    destroy() {
      offSelected();
      offEscape();
      cleanupTilt?.();
      inFlight?.abort();
      panel.remove();
    },
  };
}
