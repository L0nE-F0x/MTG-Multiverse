import * as THREE from 'three';
import type { Universe } from '../data/universe.ts';
import type { Starfield } from './Starfield.ts';

/**
 * Names for the notable stars.
 *
 * Fills the gap between the two existing readings of the galaxy: from far out
 * it is a shape, and from close up the card art itself appears — but in between
 * there was no way to tell what you were looking at without hovering. Labelling
 * the most-played cards in view means the landmarks announce themselves.
 *
 * Only ever labels cards from a precomputed popularity shortlist, so the
 * per-tick scan is over a few thousand candidates rather than all 117k.
 */

const MAX_LABELS = 14;
/** Only the most-played cards are ever eligible; nothing else earns a label. */
const SHORTLIST = 4000;
const RESELECT_SECONDS = 0.22;
const FADE_SECONDS = 0.45;

/** Label height as a fraction of viewport height (sprites use non-attenuated scale). */
const LABEL_HEIGHT = 0.030;
const TEX_W = 512;
const TEX_H = 88;
const LABEL_ASPECT = TEX_W / TEX_H;

interface Slot {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  texture: THREE.CanvasTexture;
  ctx: CanvasRenderingContext2D;
  card: number;
  opacity: number;
  targetOpacity: number;
}

export class StarLabels {
  readonly group = new THREE.Group();

  private readonly slots: Slot[] = [];
  private readonly shortlist: Int32Array;
  private readonly camPos = new THREE.Vector3();
  private readonly viewDir = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  /** Oracle ids already labelled this pass; reused to avoid per-tick allocation. */
  private readonly seenOracle = new Set<number>();
  // Deliberately far larger than MAX_LABELS. Deduplication happens after
  // scoring, and a card like Sol Ring contributes a hundred near-identical
  // entries, so a small buffer collapses to only a few distinct names.
  private readonly candIdx = new Int32Array(512);
  private readonly candScore = new Float32Array(512);
  private candCount = 0;

  private sinceSelect = RESELECT_SECONDS;
  private enabled = true;

  constructor(
    private readonly universe: Universe,
    private readonly starfield: Starfield,
    private readonly mask: Uint8Array,
  ) {
    this.shortlist = buildShortlist(universe, SHORTLIST);

    for (let i = 0; i < MAX_LABELS; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = TEX_W;
      canvas.height = TEX_H;
      const ctx = canvas.getContext('2d')!;

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.anisotropy = 4;

      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        // Constant screen size: a label that shrinks with distance is unreadable
        // exactly when you most want it.
        sizeAttenuation: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      sprite.renderOrder = 30; // above stars and card art
      sprite.center.set(0.5, 0);  // anchor below the star, growing upward
      this.group.add(sprite);

      this.slots.push({ sprite, material, texture, ctx, card: -1, opacity: 0, targetOpacity: 0 });
      // Lift the label clear of the star's own glow.
      sprite.center.set(0.5, -0.22);
    }
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) for (const s of this.slots) s.targetOpacity = 0;
  }

  update(dt: number, camera: THREE.PerspectiveCamera, orbitDistance: number): void {
    // Too far and every label overlaps; too close and the card art says it
    // better than any label could.
    const active = this.enabled && orbitDistance > 46 && orbitDistance < 1500;

    camera.getWorldPosition(this.camPos);
    camera.getWorldDirection(this.viewDir);

    this.sinceSelect += dt;
    if (this.sinceSelect >= RESELECT_SECONDS) {
      this.sinceSelect = 0;
      if (active) this.select(camera);
      else this.candCount = 0;
      this.assign();
    }

    for (const slot of this.slots) {
      if (slot.card >= 0 && active) {
        this.starfield.positionOf(slot.card, this.tmp);
        slot.sprite.position.copy(this.tmp);
        slot.targetOpacity = 1;
      } else {
        slot.targetOpacity = 0;
      }

      const k = 1 - Math.exp(-dt / (FADE_SECONDS / 4));
      slot.opacity += (slot.targetOpacity - slot.opacity) * k;
      slot.material.opacity = slot.opacity * 0.92;
      slot.sprite.visible = slot.opacity > 0.006;

      slot.sprite.scale.set(LABEL_HEIGHT * LABEL_ASPECT, LABEL_HEIGHT, 1);

      if (slot.opacity <= 0.006 && slot.targetOpacity === 0 && slot.card >= 0) {
        slot.card = -1;
      }
    }
  }

  /**
   * Pick the most-played visible cards, then drop any whose label would collide
   * with one already accepted. Without the declutter pass the dense core turns
   * into a stack of overlapping names.
   */
  private select(camera: THREE.PerspectiveCamera): void {
    const pop = this.universe.col.popularity;
    const mask = this.mask;
    const { a, b, morph } = this.starfield.positionBuffers;
    const cx = this.camPos.x, cy = this.camPos.y, cz = this.camPos.z;
    const vx = this.viewDir.x, vy = this.viewDir.y, vz = this.viewDir.z;

    this.candCount = 0;
    let worst = -Infinity;
    const cap = this.candIdx.length;

    for (let s = 0; s < this.shortlist.length; s++) {
      const i = this.shortlist[s];
      if (mask[i] === 0) continue;

      const o = i * 3;
      const px = a[o] + (b[o] - a[o]) * morph;
      const py = a[o + 1] + (b[o + 1] - a[o + 1]) * morph;
      const pz = a[o + 2] + (b[o + 2] - a[o + 2]) * morph;
      const dx = px - cx, dy = py - cy, dz = pz - cz;

      // Cheap rejection before the projection maths: behind the camera.
      if (dx * vx + dy * vy + dz * vz <= 0) continue;

      const d2 = dx * dx + dy * dy + dz * dz;
      // Prefer popular, then near. Distance only breaks ties between cards of
      // comparable fame, so landmarks stay stable as the camera drifts.
      const score = pop[i] / 65535 + 1 / (1 + d2 * 0.0004) * 0.25;
      if (this.candCount === cap && score <= worst) continue;

      let at = this.candCount;
      while (at > 0 && this.candScore[at - 1] < score) at--;
      if (at >= cap) continue;
      for (let k = Math.min(this.candCount, cap - 1); k > at; k--) {
        this.candIdx[k] = this.candIdx[k - 1];
        this.candScore[k] = this.candScore[k - 1];
      }
      this.candIdx[at] = i;
      this.candScore[at] = score;
      if (this.candCount < cap) this.candCount++;
      worst = this.candScore[this.candCount - 1];
    }

    // Declutter in screen space, keeping the highest-scoring of any overlap.
    const accepted: number[] = [];
    const rects: { x: number; y: number }[] = [];
    // A label sprite is LABEL_HEIGHT * (TEX_W/TEX_H) * P00 wide in NDC, which
    // works out just over 0.21 at the default field of view — the previous
    // 0.20 threshold let neighbours overlap by a hair.
    const minDx = 0.25;
    const minDy = 0.062;

    // One label per distinct card. Sol Ring has around a hundred printings,
    // each its own star with identical popularity, so without this the label
    // set collapses to four copies of the same handful of names.
    const oracle = this.universe.col.oracleIdx;
    this.seenOracle.clear();

    for (let c = 0; c < this.candCount && accepted.length < MAX_LABELS; c++) {
      const i = this.candIdx[c];
      const o = oracle[i];
      if (this.seenOracle.has(o)) continue;
      this.starfield.positionOf(i, this.tmp).project(camera);
      if (this.tmp.z > 1) continue;
      if (Math.abs(this.tmp.x) > 1.05 || Math.abs(this.tmp.y) > 1.05) continue;

      let clashes = false;
      for (const r of rects) {
        if (Math.abs(r.x - this.tmp.x) < minDx && Math.abs(r.y - this.tmp.y) < minDy) {
          clashes = true;
          break;
        }
      }
      if (clashes) continue;

      rects.push({ x: this.tmp.x, y: this.tmp.y });
      this.seenOracle.add(o);
      accepted.push(i);
    }

    this.candCount = accepted.length;
    for (let i = 0; i < accepted.length; i++) this.candIdx[i] = accepted[i];
  }

  private assign(): void {
    const wanted = new Set<number>();
    for (let i = 0; i < this.candCount; i++) wanted.add(this.candIdx[i]);

    const held = new Set<number>();
    for (const slot of this.slots) {
      if (slot.card >= 0 && wanted.has(slot.card)) held.add(slot.card);
      else if (slot.card >= 0) slot.targetOpacity = 0;
    }

    const free = this.slots.filter((s) => s.card < 0);
    for (let i = 0; i < this.candCount && free.length > 0; i++) {
      const card = this.candIdx[i];
      if (held.has(card)) continue;
      const slot = free.pop()!;
      slot.card = card;
      slot.opacity = 0;
      this.draw(slot, card);
      held.add(card);
    }
  }

  /**
   * Render the card's name into the slot's own canvas.
   *
   * The glyphs are sized to fill the texture rather than floating in it: the
   * sprite is only ~30px tall on screen, so every wasted row of texture is a
   * row of illegibility. Long names shrink to fit and then truncate, because
   * canvas `maxWidth` condenses the font instead, which looks broken.
   */
  private draw(slot: Slot, card: number): void {
    const ctx = slot.ctx;
    const avail = TEX_W - 28;
    let name = this.universe.name(card);

    ctx.clearRect(0, 0, TEX_W, TEX_H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const fontAt = (px: number) =>
      `500 ${px}px ui-sans-serif, Inter, system-ui, -apple-system, sans-serif`;

    let size = 64;
    ctx.font = fontAt(size);
    while (ctx.measureText(name).width > avail && size > 38) {
      size -= 3;
      ctx.font = fontAt(size);
    }
    if (ctx.measureText(name).width > avail) {
      while (name.length > 4 && ctx.measureText(`${name}…`).width > avail) {
        name = name.slice(0, -1);
      }
      name = `${name}…`;
    }

    const cxp = TEX_W / 2;
    const cyp = TEX_H / 2;

    // A dark outline rather than a filled plate: over a starfield a solid
    // background reads as a hole punched in the galaxy.
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(2, 4, 10, 0.95)';
    ctx.lineWidth = 10;
    ctx.strokeText(name, cxp, cyp);

    ctx.fillStyle = 'rgba(236, 246, 255, 0.99)';
    ctx.fillText(name, cxp, cyp);

    slot.texture.needsUpdate = true;
  }

  dispose(): void {
    for (const slot of this.slots) {
      slot.texture.dispose();
      slot.material.dispose();
      this.group.remove(slot.sprite);
    }
  }
}

/** Indices of the `n` most-played cards, most popular first. */
function buildShortlist(universe: Universe, n: number): Int32Array {
  const pop = universe.col.popularity;
  const idx: number[] = [];
  for (let i = 0; i < universe.count; i++) if (pop[i] > 0) idx.push(i);
  idx.sort((a, b) => pop[b] - pop[a]);
  return Int32Array.from(idx.slice(0, n));
}
