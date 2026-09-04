import * as THREE from 'three';
import starVert from '../shaders/star.vert';
import starFrag from '../shaders/star.frag';
import { computeLayout, LayoutContext, layoutFramePhi } from '../layout/layouts.ts';
import { RARITY_LUMINANCE, starColor, type RGB } from '../layout/palette.ts';
import type { Universe } from '../data/universe.ts';
import type { LayoutMode } from '../core/store.ts';

/** Distance from the origin to the furthest point, over a flat xyz array. */
function boundingRadius(xyz: Float32Array): number {
  let maxSq = 0;
  for (let i = 0; i < xyz.length; i += 3) {
    const d = xyz[i] * xyz[i] + xyz[i + 1] * xyz[i + 1] + xyz[i + 2] * xyz[i + 2];
    if (d > maxSq) maxSq = d;
  }
  return Math.sqrt(maxSq);
}

const MORPH_SECONDS = 1.5;
const FILTER_SECONDS = 0.3;

/**
 * All 117k cards in a single draw call.
 *
 * Two position attributes are always resident and a uniform lerps between them,
 * so switching layout costs one buffer upload and then nothing per frame. The
 * same trick handles filtering: rather than re-uploading a visibility buffer
 * every frame to animate a fade, two visibility attributes crossfade under a
 * uniform.
 */
export class Starfield {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  readonly geometry: THREE.BufferGeometry;
  readonly ctx: LayoutContext;

  private readonly posA: Float32Array;
  private readonly posB: Float32Array;
  private readonly visPrev: Uint8Array;
  private readonly visNext: Uint8Array;
  private readonly scratch: Float32Array;

  /** Radius of the sphere enclosing the current layout, centred on the origin. */
  private boundRadius = 1;
  private fovDegrees = 55;
  private morph = 1;
  private morphing = false;
  private filterMorph = 1;
  private layout: LayoutMode = 'galaxy';

  constructor(universe: Universe) {
    this.ctx = new LayoutContext(universe);
    const n = universe.count;

    this.posA = new Float32Array(n * 3);
    this.posB = new Float32Array(n * 3);
    this.scratch = new Float32Array(n * 3);
    computeLayout('galaxy', this.ctx, this.posA);
    this.posB.set(this.posA);
    this.boundRadius = boundingRadius(this.posA);

    const color = new Uint8Array(n * 3);
    const size = new Float32Array(n);
    const bright = new Float32Array(n);
    const seed = new Float32Array(n);
    const index = new Float32Array(n);
    this.visPrev = new Uint8Array(n).fill(255);
    this.visNext = new Uint8Array(n).fill(255);

    const { colorIdentity, typeMask, rarity, popularity } = universe.col;
    const rgb: RGB = [0, 0, 0];

    for (let i = 0; i < n; i++) {
      starColor(colorIdentity[i], typeMask[i], rgb);
      color[i * 3] = Math.round(rgb[0] * 255);
      color[i * 3 + 1] = Math.round(rgb[1] * 255);
      color[i * 3 + 2] = Math.round(rgb[2] * 255);

      // Popularity drives size and brightness on a strong curve so the handful
      // of genuinely famous cards read as supergiants against the bulk.
      const pop = popularity[i] / 65535;
      const lum = RARITY_LUMINANCE[rarity[i]] ?? 1;
      size[i] = (0.42 + 2.15 * Math.pow(pop, 1.5)) * Math.sqrt(lum);
      bright[i] = (0.30 + 0.95 * Math.pow(pop, 1.25)) * lum;
      seed[i] = Math.random();
      index[i] = i;
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.posA, 3));
    g.setAttribute('aPosB', new THREE.BufferAttribute(this.posB, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(color, 3, true));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aIndex', new THREE.BufferAttribute(index, 1));
    g.setAttribute('aVisPrev', new THREE.BufferAttribute(this.visPrev, 1, true));
    g.setAttribute('aVisNext', new THREE.BufferAttribute(this.visNext, 1, true));
    this.geometry = g;

    this.material = new THREE.ShaderMaterial({
      vertexShader: starVert,
      fragmentShader: starFrag,
      uniforms: {
        uTime: { value: 0 },
        uMorph: { value: 1 },
        uFilterMorph: { value: 1 },
        uStarSize: { value: 1 },
        uDim: { value: 0.06 },
        uSizeScale: { value: 600 },
        uMinPixels: { value: 1.05 },
        uHovered: { value: -1 },
        uSelected: { value: -1 },
        uTwinkle: { value: 1 },
        uExposure: { value: 1 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  get isMorphing(): boolean { return this.morphing; }

  /**
   * Distance at which the whole layout fits the vertical field of view.
   *
   * This used to be a hand-tuned constant per layout, which was quietly wrong:
   * the *near* side of a tall shape subtends a much larger angle than its far
   * side, so the timeline helix clipped top and bottom at a distance that the
   * naive height calculation said was fine. Fitting the bounding sphere is
   * exact, needs no per-layout tuning, and stays correct if a layout changes.
   */
  /**
   * Distance at which the whole layout fits on screen.
   *
   * `freeAspect` is the width-to-height ratio of the canvas area the UI panels
   * are *not* covering. Vertical fit alone is not enough once something wide
   * like the filter panel is open: the bounding sphere still fits top to
   * bottom, so nothing looks wrong, while a third of the disc sits under the
   * panel. Fitting the narrower of the two axes pulls back far enough that the
   * layout clears the panel instead. Omit it and only the vertical fit
   * applies, which is the old behaviour on an unobstructed canvas.
   */
  frameDistance(freeAspect?: number): number {
    const halfFov = (this.fovDegrees * Math.PI) / 360;
    const vertical = this.boundRadius / Math.sin(halfFov);
    if (freeAspect === undefined || !Number.isFinite(freeAspect) || freeAspect <= 0) {
      return vertical * 1.04;
    }
    // Half-angle subtended by the free width, from the vertical half-angle.
    const halfFovFree = Math.atan(freeAspect * Math.tan(halfFov));
    const horizontal = this.boundRadius / Math.sin(halfFovFree);
    return Math.max(vertical, horizontal) * 1.04;
  }
  framePhi(): number { return layoutFramePhi(this.layout); }

  setLayout(mode: LayoutMode): void {
    if (mode === this.layout && !this.morphing) return;

    // Freeze wherever the in-flight morph currently is, so a layout change
    // during a transition starts from what is on screen rather than snapping.
    if (this.morphing) {
      const t = this.morph;
      for (let i = 0; i < this.posA.length; i++) {
        this.posA[i] += (this.posB[i] - this.posA[i]) * t;
      }
    } else {
      this.posA.set(this.posB);
    }

    this.layout = mode;
    computeLayout(mode, this.ctx, this.scratch);
    this.posB.set(this.scratch);
    this.boundRadius = boundingRadius(this.scratch);

    this.geometry.getAttribute('position').needsUpdate = true;
    this.geometry.getAttribute('aPosB').needsUpdate = true;
    this.morph = 0;
    this.morphing = true;
    this.material.uniforms.uMorph.value = 0;
  }

  /** `mask[i] === 1` for cards passing the current filter. Crossfades in. */
  setVisibility(mask: Uint8Array): void {
    // Bake the in-flight crossfade into `prev` so a fast series of keystrokes
    // does not snap back to a stale visibility state.
    const t = this.filterMorph;
    if (t < 1) {
      for (let i = 0; i < this.visPrev.length; i++) {
        this.visPrev[i] = Math.round(this.visPrev[i] + (this.visNext[i] - this.visPrev[i]) * t);
      }
    } else {
      this.visPrev.set(this.visNext);
    }
    for (let i = 0; i < mask.length; i++) this.visNext[i] = mask[i] ? 255 : 0;

    this.geometry.getAttribute('aVisPrev').needsUpdate = true;
    this.geometry.getAttribute('aVisNext').needsUpdate = true;
    this.filterMorph = 0;
    this.material.uniforms.uFilterMorph.value = 0;
  }

  /**
   * Raw position buffers, for bulk scans that cannot afford a call per card.
   * `positionOf` is the right API for single lookups; this exists because the
   * billboard selector walks all 117k every tick and the per-call overhead
   * showed up.
   */
  get positionBuffers(): { a: Float32Array; b: Float32Array; morph: number } {
    return { a: this.posA, b: this.posB, morph: this.morph };
  }

  /** Current world position of a card, accounting for an in-flight morph. */
  positionOf(i: number, out: THREE.Vector3): THREE.Vector3 {
    const o = i * 3;
    const t = this.morph;
    out.set(
      this.posA[o] + (this.posB[o] - this.posA[o]) * t,
      this.posA[o + 1] + (this.posB[o + 1] - this.posA[o + 1]) * t,
      this.posA[o + 2] + (this.posB[o + 2] - this.posA[o + 2]) * t,
    );
    return out;
  }

  setViewport(height: number, fovDegrees: number): void {
    this.fovDegrees = fovDegrees;
    const fov = (fovDegrees * Math.PI) / 180;
    this.material.uniforms.uSizeScale.value = (height * 0.5) / Math.tan(fov / 2);
  }

  update(dt: number, time: number): void {
    const u = this.material.uniforms;
    u.uTime.value = time;

    if (this.morphing) {
      this.morph = Math.min(1, this.morph + dt / MORPH_SECONDS);
      // Smootherstep: zero velocity and zero acceleration at both ends, so the
      // warp starts and settles without a visible kick.
      const t = this.morph;
      u.uMorph.value = t * t * t * (t * (t * 6 - 15) + 10);
      if (this.morph >= 1) {
        this.morphing = false;
        this.posA.set(this.posB);
        this.geometry.getAttribute('position').needsUpdate = true;
        this.morph = 1;
        u.uMorph.value = 1;
      }
    }

    if (this.filterMorph < 1) {
      this.filterMorph = Math.min(1, this.filterMorph + dt / FILTER_SECONDS);
      const t = this.filterMorph;
      u.uFilterMorph.value = t * t * (3 - 2 * t);
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
