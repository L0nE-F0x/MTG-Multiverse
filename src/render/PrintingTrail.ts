import * as THREE from 'three';
import { starColor, type RGB } from '../layout/palette.ts';
import type { Universe } from '../data/universe.ts';
import type { Starfield } from './Starfield.ts';

/**
 * A thread through every printing of the selected card, in release order.
 *
 * This works because of how the galaxy is built rather than in spite of it:
 * angle is colour identity and radius is release date, and every printing of a
 * card shares its colour identity. So the printings of one card all sit on the
 * *same arm* at different radii, and joining them chronologically draws a line
 * running outward from the core — the card's own history, traced through the
 * eras that reprinted it. A card printed once is a dot; Sol Ring is a thread
 * from Alpha to the rim.
 *
 * That premise very nearly failed for the cards it matters most for. The most
 * heavily reprinted cards are disproportionately colourless artifacts — Sol
 * Ring, Arcane Signet, Command Tower — and colourless cards have no arm, so
 * they were being scattered around the full circle by a hash of the row index.
 * Sol Ring's 133 printings drew a scribble across the entire galaxy. The halo
 * angle in `layouts.ts` is now keyed to `oracleIdx` rather than the printing,
 * which gives a colourless card one direction of its own and makes this read.
 *
 * Only ever drawn for the selected card, so it costs nothing until asked for
 * and cannot clutter the general view.
 */

/** Sol Ring has around a hundred printings; past this the line is just noise. */
const MAX_POINTS = 64;
const FADE_SECONDS = 0.5;

export class PrintingTrail {
  readonly line: THREE.Line;

  private readonly positions: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.LineBasicMaterial;
  private readonly tmp = new THREE.Vector3();

  /** Card indices currently threaded, oldest first. */
  private points: number[] = [];
  private opacity = 0;
  private targetOpacity = 0;
  private layoutSupported = true;

  constructor(
    private readonly universe: Universe,
    private readonly starfield: Starfield,
  ) {
    this.positions = new Float32Array(MAX_POINTS * 3);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.LineBasicMaterial({
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.line = new THREE.Line(this.geometry, this.material);
    this.line.frustumCulled = false;
    this.line.visible = false;
    // Above the stars, below the card art and labels.
    this.line.renderOrder = 15;
  }

  /**
   * Whether the current layout puts time on the radius. Elsewhere — set
   * clusters, rarity shells — a card's printings are scattered by something
   * other than date, and joining them chronologically draws a scribble across
   * the whole scene rather than a history.
   */
  setLayoutSupported(supported: boolean): void {
    this.layoutSupported = supported;
    if (!supported) this.targetOpacity = 0;
    else if (this.points.length >= 2) this.targetOpacity = 1;
  }

  /** Pass -1 to clear. */
  setCard(card: number): void {
    if (card < 0) {
      this.targetOpacity = 0;
      return;
    }

    const printings = this.universe.printingsOf(card);
    if (printings.length < 2) {
      // A single printing has no history to draw.
      this.points = [];
      this.targetOpacity = 0;
      return;
    }

    // Keep the ends and thin the middle, so a heavily reprinted card still
    // spans its true range instead of stopping wherever the cap fell.
    this.points = thin(printings, MAX_POINTS);

    const rgb: RGB = [0, 0, 0];
    starColor(this.universe.col.colorIdentity[card], this.universe.col.typeMask[card], rgb);
    // Lifted well above 1: this is additive over a bright field, and the post
    // chain's ACES curve pulls anything subtler back down to invisible.
    this.material.color.setRGB(rgb[0] * 2.0, rgb[1] * 2.0, rgb[2] * 2.0);

    this.targetOpacity = this.layoutSupported ? 1 : 0;
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt / (FADE_SECONDS / 4));
    this.opacity += (this.targetOpacity - this.opacity) * k;
    this.material.opacity = this.opacity * 0.7;

    const showing = this.opacity > 0.01 && this.points.length >= 2;
    this.line.visible = showing;
    if (!showing) {
      if (this.targetOpacity === 0) this.geometry.setDrawRange(0, 0);
      return;
    }

    // Re-read every frame so the thread follows a layout morph rather than
    // hanging in the positions the cards used to occupy.
    for (let i = 0; i < this.points.length; i++) {
      this.starfield.positionOf(this.points[i], this.tmp);
      this.positions[i * 3] = this.tmp.x;
      this.positions[i * 3 + 1] = this.tmp.y;
      this.positions[i * 3 + 2] = this.tmp.z;
    }
    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.setDrawRange(0, this.points.length);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Evenly sample `list` down to at most `max` entries, always keeping both ends. */
function thin(list: number[], max: number): number[] {
  if (list.length <= max) return list;
  const out: number[] = [];
  const step = (list.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(list[Math.round(i * step)]);
  return out;
}
