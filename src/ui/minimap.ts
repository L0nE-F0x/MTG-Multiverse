/**
 * Colour-pie compass. Click an arm to fly the camera onto it.
 *
 * The wedges sit at `store.armAngles` — where each colour's cards *measure*,
 * not the pentagon they are seeded from. The galaxy's arms are a spiral, so
 * every one of them ends up about 117 degrees around from its base angle, and
 * a pie drawn on the base angles was a compass pointing at the wrong colour.
 *
 * The whole dial is a plain top-down view of the world: SVG +x is world +x,
 * SVG +y (down the screen) is world +z. No CSS rotation, no counter-rotated
 * letters, and the heading tick is simply the camera's own XZ direction, so
 * the tick lands on the wedge whose stars are nearest the camera.
 */
import { store, type LayoutMode } from '../core/store.ts';
import type { ColorLetter } from '../data/format.ts';
import { el, listen } from './dom.ts';
import { MANA_UI_HEX } from './theme.ts';
import '../styles/minimap.css';

const ARMS: { letter: ColorLetter; label: string; fill: string }[] = [
  { letter: 'W', label: 'White', fill: MANA_UI_HEX.W! },
  { letter: 'U', label: 'Blue', fill: MANA_UI_HEX.U! },
  { letter: 'B', label: 'Black', fill: MANA_UI_HEX.B! },
  { letter: 'R', label: 'Red', fill: MANA_UI_HEX.R! },
  { letter: 'G', label: 'Green', fill: MANA_UI_HEX.G! },
];

const TAU = Math.PI * 2;

/** Normalise to [0, TAU). */
function norm(a: number): number {
  return ((a % TAU) + TAU) % TAU;
}

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
  svg.setAttribute('viewBox', '-1.28 -1.28 2.56 2.56');
  svg.setAttribute('aria-hidden', 'true');

  const ring = document.createElementNS(svgNS, 'circle');
  ring.setAttribute('r', '1.08');
  ring.setAttribute('class', 'mcu-minimap-ring');
  svg.append(ring);

  const wedges = new Map<ColorLetter, { path: SVGPathElement; text: SVGTextElement }>();
  for (const { letter, label, fill } of ARMS) {
    const group = document.createElementNS(svgNS, 'g');
    group.setAttribute('data-arm', letter);
    group.setAttribute('data-tip', `Fly to the ${label} arm`);
    group.setAttribute('aria-label', label);
    group.style.cursor = 'pointer';

    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('fill', fill);
    group.append(path);

    const text = document.createElementNS(svgNS, 'text');
    text.setAttribute('class', 'mcu-minimap-letter');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.textContent = letter;
    group.append(text);

    wedges.set(letter, { path, text });
    svg.append(group);
  }

  /**
   * Lay the five wedges out on the measured angles.
   *
   * Boundaries are the midpoints between neighbours rather than a fixed
   * ±36°, so the dial still tiles cleanly if a layout spaces its colours
   * unevenly — and it degenerates to the even pentagon when they are even,
   * which is what the galaxy gives.
   */
  function paintWedges(): void {
    const angles = store.state.armAngles;
    const order = ARMS.map(({ letter }) => ({ letter, angle: norm(angles[letter] ?? 0) }))
      .sort((a, b) => a.angle - b.angle);
    for (let k = 0; k < order.length; k++) {
      const cur = order[k]!;
      const prev = order[(k - 1 + order.length) % order.length]!;
      const next = order[(k + 1) % order.length]!;
      const a0 = cur.angle - norm(cur.angle - prev.angle) / 2;
      const a1 = cur.angle + norm(next.angle - cur.angle) / 2;
      const w = wedges.get(cur.letter);
      if (!w) continue;
      w.path.setAttribute('d', annular(a0, a1, 0.36, 1.0));
      const tx = Math.cos(cur.angle) * 0.70;
      const ty = Math.sin(cur.angle) * 0.70;
      w.text.setAttribute('x', tx.toFixed(3));
      w.text.setAttribute('y', ty.toFixed(3));
    }
  }

  const core = document.createElementNS(svgNS, 'circle');
  core.setAttribute('r', '0.30');
  core.setAttribute('class', 'mcu-minimap-core');
  svg.append(core);

  // Points along +x at rotation 0, so the transform below is the camera's
  // world XZ angle with no offset to get wrong.
  const needle = document.createElementNS(svgNS, 'polygon');
  needle.setAttribute('points', '1.20,0 0.98,0.085 0.98,-0.085');
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
    void floatTip.offsetWidth;
    const r = wrap.getBoundingClientRect();
    const tipR = floatTip.getBoundingClientRect();
    let left = r.left - tipR.width - 12;
    if (left < 8) left = r.right + 10;
    let top = r.top + r.height / 2 - tipR.height / 2;
    if (top < 8) top = 8;
    if (top + tipR.height > window.innerHeight - 8) top = window.innerHeight - tipR.height - 8;
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
    // The rig puts the camera at (sin θ, ·, cos θ), so its world XZ angle is
    // π/2 - θ. The dial is world XZ, so that number is the rotation directly —
    // and it is the same expression `playArmFlight` inverts to aim, which is
    // what keeps the tick on the wedge you clicked.
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
    if (hide) {
      floatTip.hidden = true;
      tipAnchor = null;
    }
  }

  paintWedges();
  paintHeading();
  paintLayout();
  paintShell();
  const offArms = store.on('armAngles', paintWedges);
  const offHeading = store.on('viewHeading', paintHeading);
  const offLayout = store.on('layout', paintLayout);
  const offShell = store.on('shell', paintShell);
  const offSelected = store.on('selected', paintShell);

  return {
    destroy() {
      offArms();
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
