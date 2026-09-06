/**
 * Colour-pie compass. Click an arm to fly the camera onto it.
 *
 * The wedges are Magic's WUBRG pentagon, the same angles the galaxy layout
 * uses. A heading tick follows the camera so you can see which arm you are
 * looking at without reading the stars.
 */
import { store, type LayoutMode } from '../core/store.ts';
import { COLOR_BIT, type ColorLetter } from '../data/format.ts';
import { COLOR_ANGLE } from '../layout/layouts.ts';
import { el, listen } from './dom.ts';
import { MANA_COLOR_HEX } from './theme.ts';
import '../styles/minimap.css';

const ARMS: { letter: ColorLetter; label: string }[] = [
  { letter: 'W', label: 'White' },
  { letter: 'U', label: 'Blue' },
  { letter: 'B', label: 'Black' },
  { letter: 'R', label: 'Red' },
  { letter: 'G', label: 'Green' },
];

/** Layouts where colour identity is still a spatial axis. */
const COLOUR_LAYOUTS: LayoutMode[] = ['galaxy', 'colorwheel', 'price'];

const svgNS = 'http://www.w3.org/2000/svg';

function annular(a0: number, a1: number, r0: number, r1: number): string {
  const x0i = Math.cos(a0) * r0, y0i = Math.sin(a0) * r0;
  const x0o = Math.cos(a0) * r1, y0o = Math.sin(a0) * r1;
  const x1i = Math.cos(a1) * r0, y1i = Math.sin(a1) * r0;
  const x1o = Math.cos(a1) * r1, y1o = Math.sin(a1) * r1;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return [
    `M ${x0i.toFixed(4)} ${y0i.toFixed(4)}`,
    `L ${x0o.toFixed(4)} ${y0o.toFixed(4)}`,
    `A ${r1} ${r1} 0 ${large} 1 ${x1o.toFixed(4)} ${y1o.toFixed(4)}`,
    `L ${x1i.toFixed(4)} ${y1i.toFixed(4)}`,
    `A ${r0} ${r0} 0 ${large} 0 ${x0i.toFixed(4)} ${y0i.toFixed(4)}`,
    'Z',
  ].join(' ');
}

export function mountMinimap(root: HTMLElement): { destroy(): void } {
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '-1.22 -1.22 2.44 2.44');
  svg.setAttribute('aria-hidden', 'true');

  const ring = document.createElementNS(svgNS, 'circle');
  ring.setAttribute('r', '1.02');
  ring.setAttribute('class', 'mcu-minimap-ring');
  svg.append(ring);

  for (const { letter, label } of ARMS) {
    const a0 = COLOR_ANGLE[COLOR_BIT[letter]]! - Math.PI / 5;
    const a1 = COLOR_ANGLE[COLOR_BIT[letter]]! + Math.PI / 5;
    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('d', annular(a0, a1, 0.34, 1));
    path.setAttribute('fill', MANA_COLOR_HEX[letter] ?? '#888');
    path.setAttribute('data-arm', letter);
    path.setAttribute('data-tip', `Fly to the ${label} arm`);
    path.setAttribute('aria-label', label);
    svg.append(path);

    const mid = COLOR_ANGLE[COLOR_BIT[letter]]!;
    const tx = Math.cos(mid) * 0.68;
    const ty = Math.sin(mid) * 0.68;
    const text = document.createElementNS(svgNS, 'text');
    text.setAttribute('x', tx.toFixed(3));
    text.setAttribute('y', ty.toFixed(3));
    text.setAttribute('class', 'mcu-minimap-letter');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    // Counter-rotate so the letters stay upright after the SVG's -90° turn.
    text.setAttribute('transform', `rotate(90 ${tx.toFixed(3)} ${ty.toFixed(3)})`);
    text.textContent = letter;
    svg.append(text);
  }

  const core = document.createElementNS(svgNS, 'circle');
  core.setAttribute('r', '0.28');
  core.setAttribute('class', 'mcu-minimap-core');
  svg.append(core);

  const needle = document.createElementNS(svgNS, 'polygon');
  needle.setAttribute('points', '0,-1.14 0.07,-0.96 -0.07,-0.96');
  needle.setAttribute('class', 'mcu-minimap-needle');
  svg.append(needle);

  const wrap = el('div', {
    className: 'mcu-minimap',
    attrs: { role: 'group', 'aria-label': 'Colour pie. Click an arm to fly there.' },
  }, [svg]);

  wrap.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const arm = t.closest('[data-arm]')?.getAttribute('data-arm') as ColorLetter | null;
    if (!arm) return;
    store.set('cameraCue', { kind: 'arm', color: arm });
  });

  const floatTip = el('div', {
    className: 'mcu-float-tip',
    attrs: { role: 'tooltip', hidden: '' },
  });
  let tipAnchor: Element | null = null;
  function placeTip(anchor: Element): void {
    const text = anchor.getAttribute('data-tip');
    if (!text) return;
    floatTip.textContent = text;
    floatTip.hidden = false;
    const r = anchor.getBoundingClientRect();
    const tipR = floatTip.getBoundingClientRect();
    let left = r.left - tipR.width - 10;
    if (left < 8) left = r.right + 10;
    let top = r.top + r.height / 2 - tipR.height / 2;
    if (top < 8) top = 8;
    floatTip.style.left = `${left}px`;
    floatTip.style.top = `${top}px`;
  }

  const offTipOver = listen(wrap, 'pointerover', (e) => {
    const a = (e.target as Element | null)?.closest?.('[data-tip]');
    if (!a) return;
    tipAnchor = a;
    placeTip(a);
  });
  const offTipOut = listen(wrap, 'pointerout', (e) => {
    const to = (e as PointerEvent).relatedTarget as Node | null;
    if (tipAnchor && to && (tipAnchor === to || tipAnchor.contains(to))) return;
    floatTip.hidden = true;
    tipAnchor = null;
  });

  root.append(wrap, floatTip);

  function paintHeading(): void {
    // Camera theta 0 sits on +Z; white is +X. π/2 - heading maps the view
    // onto the pie, matching consumeCue's arm flight (`π/2 - world`).
    const deg = ((Math.PI / 2 - store.state.viewHeading) * 180) / Math.PI;
    needle.setAttribute('transform', `rotate(${deg.toFixed(2)})`);
  }

  function paintLayout(): void {
    const colour = COLOUR_LAYOUTS.includes(store.state.layout);
    wrap.classList.toggle('mcu-minimap--muted', !colour);
  }

  function paintShell(): void {
    const hide = store.state.shell !== 'play' || store.state.selected >= 0;
    wrap.classList.toggle('mcu-minimap--hidden', hide);
  }

  paintHeading();
  paintLayout();
  paintShell();
  const offHeading = store.on('viewHeading', paintHeading);
  const offLayout = store.on('layout', paintLayout);
  const offShell = store.on('shell', paintShell);
  const offSelected = store.on('selected', paintShell);

  return {
    destroy() {
      offHeading();
      offLayout();
      offShell();
      offSelected();
      offTipOver();
      offTipOut();
      wrap.remove();
      floatTip.remove();
    },
  };
}
