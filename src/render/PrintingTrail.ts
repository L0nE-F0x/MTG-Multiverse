import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
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
 * Colourless artifacts still have thickness — gauss jitter in Y — so a raw
 * polyline through 64 Sol Rings is a scribble up and down the column. The
 * line is pulled toward the card's mean ray and then corner-smoothed, which
 * keeps it visiting the stars without the zigzag.
 *
 * Only ever drawn for the selected card, so it costs nothing until asked for
 * and cannot clutter the general view.
 */

/** Sol Ring has around a hundred printings; past this the line is just noise. */
const MAX_POINTS = 48;
const FADE_SECONDS = 0.28;
/** How far to pull each vertex toward the card's mean ray (0 = raw, 1 = collinear). */
const SPINE_BLEND = 0.46;

export class PrintingTrail {
  readonly line: Line2;

  private readonly positions: Float32Array;
  private readonly smoothed: Float32Array;
  private readonly geometry: LineGeometry;
  private readonly material: LineMaterial;
  private readonly tmp = new THREE.Vector3();

  /** Card indices currently threaded, oldest first. */
  private points: number[] = [];
  /** Selected card, or -1. Kept so a layout switch cannot revive a dismissed thread. */
  private card = -1;
  private opacity = 0;
  private targetOpacity = 0;
  private layoutSupported = true;

  constructor(
    private readonly universe: Universe,
    private readonly starfield: Starfield,
  ) {
    this.positions = new Float32Array(MAX_POINTS * 3);
    this.smoothed = new Float32Array(MAX_POINTS * 3);

    this.geometry = new LineGeometry();
    this.geometry.setPositions(Array.from(this.positions));

    this.material = new LineMaterial({
      color: 0xffffff,
      linewidth: 1.85,
      transparent: true,
      opacity: 0,
      depthTest: false,
      dashed: false,
      worldUnits: false,
    });
    this.material.depthWrite = false;
    this.material.blending = THREE.AdditiveBlending;
    this.material.resolution.set(1, 1);

    this.line = new Line2(this.geometry, this.material);
    this.line.frustumCulled = false;
    this.line.visible = false;
    // Above the stars, below the card art and labels.
    this.line.renderOrder = 15;
  }

  setSize(width: number, height: number): void {
    this.material.resolution.set(Math.max(1, width), Math.max(1, height));
  }

  /**
   * Whether the current layout puts time on the radius. Elsewhere — set
   * clusters, rarity shells — a card's printings are scattered by something
   * other than date, and joining them chronologically draws a scribble across
   * the whole scene rather than a history.
   */
  setLayoutSupported(supported: boolean): void {
    this.layoutSupported = supported;
    if (!supported) {
      // Instant: a fade during the morph would scribble across set clusters.
      this.targetOpacity = 0;
      this.opacity = 0;
      this.line.visible = false;
      return;
    }
    if (this.card >= 0 && this.points.length >= 2) this.targetOpacity = 1;
  }

  /** Pass -1 to clear. */
  setCard(card: number): void {
    if (card < 0) {
      this.card = -1;
      this.points = [];
      this.targetOpacity = 0;
      this.opacity = 0;
      this.line.visible = false;
      return;
    }
    this.card = card;

    const printings = this.universe.printingsOf(card);
    if (printings.length < 2) {
      // A single printing has no history to draw.
      this.points = [];
      this.targetOpacity = 0;
      this.opacity = 0;
      this.line.visible = false;
      return;
    }

    // Keep the ends and thin the middle, so a heavily reprinted card still
    // spans its true range instead of stopping wherever the cap fell.
    this.points = thin(printings, MAX_POINTS);

    const rgb: RGB = [0, 0, 0];
    starColor(this.universe.col.colorIdentity[card], this.universe.col.typeMask[card], rgb);
    // Lifted well above 1: this is additive over a bright field, and the post
    // chain's ACES curve pulls anything subtler back down to invisible.
    this.material.color.setRGB(
      Math.min(1, rgb[0] * 1.25 + 0.22),
      Math.min(1, rgb[1] * 1.25 + 0.22),
      Math.min(1, rgb[2] * 1.25 + 0.22),
    );

    this.targetOpacity = this.layoutSupported ? 1 : 0;
  }

  update(dt: number): void {
    // Drop faster than it appears, so dismissing a card does not leave a ghost
    // hanging over the next layout.
    const tau = this.targetOpacity < this.opacity ? FADE_SECONDS * 0.35 : FADE_SECONDS;
    const k = 1 - Math.exp(-dt / Math.max(tau / 4, 0.02));
    this.opacity += (this.targetOpacity - this.opacity) * k;
    this.material.opacity = this.opacity * 0.78;

    const showing = this.opacity > 0.01 && this.card >= 0 && this.points.length >= 2;
    this.line.visible = showing;
    if (!showing) return;

    // Re-read every frame so the thread follows a layout morph rather than
    // hanging in the positions the cards used to occupy.
    const n = this.points.length;
    let mx = 0;
    let mz = 0;
    for (let i = 0; i < n; i++) {
      this.starfield.positionOf(this.points[i]!, this.tmp);
      this.positions[i * 3] = this.tmp.x;
      this.positions[i * 3 + 1] = this.tmp.y;
      this.positions[i * 3 + 2] = this.tmp.z;
      mx += this.tmp.x;
      mz += this.tmp.z;
    }
    const meanLen = Math.hypot(mx, mz) || 1;
    mx /= meanLen;
    mz /= meanLen;

    for (let i = 0; i < n; i++) {
      const x = this.positions[i * 3]!;
      const y = this.positions[i * 3 + 1]!;
      const z = this.positions[i * 3 + 2]!;
      const r = Math.hypot(x, z);
      this.smoothed[i * 3] = x + (mx * r - x) * SPINE_BLEND;
      this.smoothed[i * 3 + 1] = y;
      this.smoothed[i * 3 + 2] = z + (mz * r - z) * SPINE_BLEND;
    }
    // Three-point average on Y unkinks the vertical jitter without flattening
    // the disc. Ends stay put so the thread still meets the first and last star.
    for (let i = 1; i < n - 1; i++) {
      const y0 = this.smoothed[(i - 1) * 3 + 1]!;
      const y1 = this.smoothed[i * 3 + 1]!;
      const y2 = this.smoothed[(i + 1) * 3 + 1]!;
      this.positions[i * 3] = this.smoothed[i * 3]!;
      this.positions[i * 3 + 1] = y0 * 0.25 + y1 * 0.5 + y2 * 0.25;
      this.positions[i * 3 + 2] = this.smoothed[i * 3 + 2]!;
    }
    this.positions[0] = this.smoothed[0]!;
    this.positions[1] = this.smoothed[1]!;
    this.positions[2] = this.smoothed[2]!;
    const last = (n - 1) * 3;
    this.positions[last] = this.smoothed[last]!;
    this.positions[last + 1] = this.smoothed[last + 1]!;
    this.positions[last + 2] = this.smoothed[last + 2]!;

    const packed = n === MAX_POINTS ? this.positions : this.positions.subarray(0, n * 3);
    this.geometry.setPositions(Array.from(packed));
    this.line.computeLineDistances();
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
  for (let i = 0; i < max; i++) out.push(list[Math.round(i * step)]!);
  return out;
}
