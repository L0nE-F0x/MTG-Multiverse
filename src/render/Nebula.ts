import * as THREE from 'three';
import nebulaVert from '../shaders/nebula.vert';
import nebulaFrag from '../shaders/nebula.frag';
import { createNoiseVolume } from './noise3d.ts';
import type { LayoutMode } from '../core/store.ts';

const LAYOUT_ID: Record<LayoutMode, number> = {
  galaxy: 0,
  timeline: 1,
  sets: 2,
  colorwheel: 3,
  sphere: 4,
  price: 5,
};

/**
 * Frames of history the volume is allowed to converge over while the camera is
 * at rest. Past this it stops marching entirely and the composite blits the
 * settled image, which is what the old single-target cache did for every frame.
 */
const SETTLE_FRAMES = 14;

const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

function dummyClusterMap(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function lowResTarget(): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(1, 1, {
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

/** Bake set-cluster Gaussians into an xz density map the raymarcher can sample. */
export function bakeClusterMap(centers: Float32Array, size = 128): { texture: THREE.DataTexture; extent: number } {
  const n = (centers.length / 4) | 0;
  let extent = 1;
  for (let i = 0; i < n; i++) {
    const x = centers[i * 4]!;
    const z = centers[i * 4 + 2]!;
    const r = centers[i * 4 + 3]!;
    extent = Math.max(extent, Math.hypot(x, z) + r * 2.4);
  }
  const data = new Float32Array(size * size * 4);
  const inv = 1 / size;
  for (let y = 0; y < size; y++) {
    const wz = (y * inv * 2 - 1) * extent;
    for (let x = 0; x < size; x++) {
      const wx = (x * inv * 2 - 1) * extent;
      let acc = 0;
      for (let i = 0; i < n; i++) {
        const cx = centers[i * 4]!;
        const cz = centers[i * 4 + 2]!;
        const cr = Math.max(1.8, centers[i * 4 + 3]!);
        const d2 = (wx - cx) * (wx - cx) + (wz - cz) * (wz - cz);
        const s = cr * cr;
        if (d2 < s * 4) acc = Math.max(acc, Math.exp(-d2 / (s * 0.55)));
      }
      const o = (y * size + x) * 4;
      data[o] = acc > 0.22 ? Math.min(1, acc) : 0;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  return { texture, extent };
}

/**
 * Raymarched volumetric background: interstellar gas plus the distant fixed
 * stars, in one pass.
 *
 * The march is the most expensive thing in the frame, so it runs at a fraction
 * of the canvas resolution and is reconstructed on the way back up. That
 * reconstruction is not optional decoration — it is what separates "gas" from
 * "blocks":
 *
 *  - **Bilinear magnification of a raymarch looks quantised.** Every march
 *    texel covers two to four screen pixels at the tiers this actually runs at,
 *    and a bilinear tap turns each one into a visible square with hard seams
 *    along the texel grid. A bicubic B-spline reconstruction costs four taps
 *    and removes the grid entirely.
 *  - **The step jitter is white noise, and white noise magnifies into
 *    speckle.** Offsetting each ray by `hash(gl_FragCoord)` is what stops the
 *    march banding, but at half resolution the dither itself becomes the
 *    texture you see. A small separable blur at march resolution costs two
 *    low-res passes and takes it out.
 *  - **Averaging frames is cheaper than adding steps.** The jitter advances per
 *    frame and the result accumulates, so a still camera converges to a clean
 *    integral over `SETTLE_FRAMES` and then stops marching altogether. That is
 *    the same standing cost the old single-cached-target path had, for a far
 *    better image, and it is why the step counts can stay modest.
 */
export class Nebula {
  readonly compositeMesh: THREE.Mesh;

  private readonly marchScene = new THREE.Scene();
  private readonly marchCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly marchMaterial: THREE.ShaderMaterial;
  private readonly blurMaterial: THREE.ShaderMaterial;
  private readonly blendMaterial: THREE.ShaderMaterial;
  private readonly compositeMaterial: THREE.ShaderMaterial;

  /** Where the raw march lands, and the ping-pong partner the blur bounces off. */
  private march = lowResTarget();
  private blurAux = lowResTarget();
  /** Converged history, ping-ponged because a pass cannot read and write one target. */
  private accum: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] = [lowResTarget(), lowResTarget()];
  private accumRead = 0;

  /** Fullscreen triangle-ish quad reused by every low-res pass. */
  private readonly passScene = new THREE.Scene();
  private readonly passMesh: THREE.Mesh;

  private scale: number;
  private width = 1;
  private height = 1;
  private targetDensity = 1;
  private readonly dummyTex: THREE.DataTexture;
  private skipRender = false;
  private lastPose = new THREE.Vector3();
  private hasPose = false;
  private lastQuantisedPose = '';
  private motion = 1;
  private baseSteps = 52;
  private frame = 0;
  private settled = 0;
  /** Set whenever a march uniform changes; see `invalidate`. */
  private dirty = true;
  private clusterCache = new Map<LayoutMode, { texture: THREE.DataTexture; extent: number }>();

  constructor(scale = 0.5) {
    this.scale = scale;

    this.marchMaterial = new THREE.ShaderMaterial({
      vertexShader: nebulaVert,
      fragmentShader: nebulaFrag,
      glslVersion: THREE.GLSL3,
      uniforms: {
        uInvProjection: { value: new THREE.Matrix4() },
        uCameraWorld: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uFrame: { value: 0 },
        uIntensity: { value: 1 },
        uSteps: { value: 52 },
        uNoiseScale: { value: 0.0042 },
        uDensity: { value: 1 },
        uWarp: { value: 0.85 },
        uStarfield: { value: 1 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uWorldScale: { value: 1 },
        uLayout: { value: 0 },
        uBound: { value: 360 },
        uYearMin: { value: 1993 },
        uYearCount: { value: 33 },
        uClusterMap: { value: dummyClusterMap() },
        uClusterExtent: { value: 1 },
        uNoise: { value: createNoiseVolume(64) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.dummyTex = this.marchMaterial.uniforms.uClusterMap.value as THREE.DataTexture;
    this.marchScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.marchMaterial));

    // Separable Gaussian at march resolution. Radius is in texels, so it costs
    // the same blur in march-space at every quality tier — which is what we
    // want, because the point is to erase the step dither, not to soften the
    // cloud by a fixed number of screen pixels.
    this.blurMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: null },
        uDirection: { value: new THREE.Vector2(1, 0) },
        uTexel: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform vec2 uDirection;
        uniform vec2 uTexel;
        varying vec2 vUv;
        void main() {
          vec2 d = uDirection * uTexel;
          vec3 c = texture2D(uMap, vUv).rgb * 0.38774;
          c += texture2D(uMap, vUv + d).rgb * 0.24477;
          c += texture2D(uMap, vUv - d).rgb * 0.24477;
          c += texture2D(uMap, vUv + d * 2.0).rgb * 0.06136;
          c += texture2D(uMap, vUv - d * 2.0).rgb * 0.06136;
          gl_FragColor = vec4(c, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    // The vertical half of the blur is folded into the blend rather than run as
    // its own pass. Every one of these is a fullscreen draw at march
    // resolution, and the volume pass is already the most expensive thing in
    // the frame — three of them on top of the march was enough to pull the
    // adaptive ladder down a rung, which costs more image quality than the
    // separate pass was ever going to buy.
    this.blendMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uCurrent: { value: null },
        uHistory: { value: null },
        uAlpha: { value: 1 },
        uTexel: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D uCurrent;
        uniform sampler2D uHistory;
        uniform float uAlpha;
        uniform vec2 uTexel;
        varying vec2 vUv;
        void main() {
          vec2 d = vec2(0.0, uTexel.y);
          vec3 cur = texture2D(uCurrent, vUv).rgb * 0.38774;
          cur += texture2D(uCurrent, vUv + d).rgb * 0.24477;
          cur += texture2D(uCurrent, vUv - d).rgb * 0.24477;
          cur += texture2D(uCurrent, vUv + d * 2.0).rgb * 0.06136;
          cur += texture2D(uCurrent, vUv - d * 2.0).rgb * 0.06136;
          vec3 hist = texture2D(uHistory, vUv).rgb;
          gl_FragColor = vec4(mix(hist, cur, uAlpha), 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    this.compositeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: this.accum[0].texture },
        uTexSize: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 1.0, 1.0);
        }
      `,
      // Bicubic B-spline reconstruction, folded into four bilinear taps. The
      // B-spline basis is chosen over Catmull-Rom deliberately: it never
      // overshoots, and a smooth-but-soft magnification is exactly right for a
      // volume that is low-frequency to begin with.
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform vec2 uTexSize;
        varying vec2 vUv;

        vec3 bicubic(sampler2D tex, vec2 uv, vec2 texSize) {
          vec2 invSize = 1.0 / texSize;
          vec2 c = uv * texSize - 0.5;
          vec2 f = fract(c);
          c = floor(c);

          vec2 w0 = (1.0 / 6.0) * (((-f + 3.0) * f - 3.0) * f + 1.0);
          vec2 w1 = (1.0 / 6.0) * ((3.0 * f - 6.0) * f * f + 4.0);
          vec2 w2 = (1.0 / 6.0) * (((-3.0 * f + 3.0) * f + 3.0) * f + 1.0);
          vec2 w3 = (1.0 / 6.0) * (f * f * f);

          vec2 s0 = w0 + w1;
          vec2 s1 = w2 + w3;
          vec2 o0 = (c + w1 / s0 - 0.5) * invSize;
          vec2 o1 = (c + w3 / s1 + 1.5) * invSize;

          vec3 a = texture2D(tex, vec2(o0.x, o0.y)).rgb;
          vec3 b = texture2D(tex, vec2(o1.x, o0.y)).rgb;
          vec3 cc = texture2D(tex, vec2(o0.x, o1.y)).rgb;
          vec3 d = texture2D(tex, vec2(o1.x, o1.y)).rgb;

          return mix(mix(b, a, s0.x), mix(d, cc, s0.x), s0.y);
        }

        void main() {
          gl_FragColor = vec4(bicubic(uMap, vUv, uTexSize), 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    this.passMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMaterial);
    this.passMesh.frustumCulled = false;
    this.passScene.add(this.passMesh);

    this.compositeMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compositeMaterial);
    this.compositeMesh.frustumCulled = false;
    // Drawn before the stars, which then add their light on top of it.
    this.compositeMesh.renderOrder = -1000;
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;

    // Clamp to an absolute pixel budget as well as the relative scale. On a
    // retina panel the drawing buffer is already 4x a 1x display, and the
    // volume is low-frequency enough that resolving it at that size buys
    // nothing but cost.
    let scale = this.scale;
    const budget = 1_150_000;
    const pixels = width * height * scale * scale;
    if (pixels > budget) scale *= Math.sqrt(budget / pixels);

    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    if (this.march.width === w && this.march.height === h) return;

    this.march.setSize(w, h);
    this.blurAux.setSize(w, h);
    this.accum[0].setSize(w, h);
    this.accum[1].setSize(w, h);

    this.marchMaterial.uniforms.uResolution.value.set(w, h);
    this.blurMaterial.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.blendMaterial.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.compositeMaterial.uniforms.uTexSize.value.set(w, h);
    this.invalidate();
  }

  /** Render scale for the volume pass, 0.25 (fast) to 1 (sharp). */
  setQuality(scale: number, steps: number): void {
    this.scale = scale;
    this.baseSteps = steps;
    this.marchMaterial.uniforms.uSteps.value = steps;
    this.setSize(this.width, this.height);
    this.invalidate();
  }

  setLayout(
    mode: LayoutMode,
    opts: { bound: number; yearMin?: number; yearMax?: number; clusters?: Float32Array },
  ): void {
    this.marchMaterial.uniforms.uLayout.value = LAYOUT_ID[mode];
    this.marchMaterial.uniforms.uBound.value = Math.max(80, opts.bound);
    if (opts.yearMin !== undefined) this.marchMaterial.uniforms.uYearMin.value = opts.yearMin;
    if (opts.yearMax !== undefined && opts.yearMin !== undefined) {
      this.marchMaterial.uniforms.uYearCount.value = Math.max(1, opts.yearMax - opts.yearMin);
    }
    if (opts.clusters && opts.clusters.length >= 4) {
      let baked = this.clusterCache.get(mode);
      if (!baked) {
        baked = bakeClusterMap(opts.clusters);
        this.clusterCache.set(mode, baked);
      }
      this.marchMaterial.uniforms.uClusterMap.value = baked.texture;
      this.marchMaterial.uniforms.uClusterExtent.value = baked.extent;
    }
    this.invalidate();
  }

  setIntensity(v: number): void {
    const u = this.marchMaterial.uniforms.uIntensity;
    if (u.value === v) return;
    u.value = v;
    this.invalidate();
  }

  /** Uniform scale of the disc relative to the galaxy layout (1 = galaxy). */
  setWorldScale(v: number): void {
    const next = Math.max(0.05, v);
    const u = this.marchMaterial.uniforms.uWorldScale;
    if (u.value === next) return;
    u.value = next;
    this.invalidate();
  }

  /** Density is eased rather than set, so layout changes do not pop the gas. */
  setDensity(v: number): void {
    if (this.targetDensity === v) return;
    this.targetDensity = v;
    this.invalidate();
  }

  update(dt: number): void {
    const u = this.marchMaterial.uniforms.uDensity;
    const gap = this.targetDensity - u.value;
    if (Math.abs(gap) < 1e-4) {
      u.value = this.targetDensity;
      return;
    }
    u.value += gap * (1 - Math.exp(-dt * 2.2));
    // The ease runs over many frames, and every one of them is a uniform the
    // settled history does not have yet.
    this.invalidate();
  }

  /**
   * Force the volume to march again and drop its history.
   *
   * A settled volume stops marching entirely, and the composite pass does
   * nothing but reconstruct the accumulated target — so a uniform changed while
   * the camera is at rest never reaches the screen on its own. With auto-rotate
   * off (a persisted setting) that silently disabled the nebula toggle, the
   * intensity slider and the filter-driven density change.
   */
  invalidate(): void {
    this.dirty = true;
    this.settled = 0;
  }

  /**
   * Decide whether this frame marches, how hard, and how much history it keeps.
   *
   * Three states: the camera moved (short history, so the gas does not smear
   * behind the move), the camera is at rest and still converging (history
   * lengthens each frame, averaging the jitter away), or it has converged and
   * the whole volume pass is skipped.
   */
  prepareFrame(camera: THREE.PerspectiveCamera, distance: number, bound: number, moving: boolean): void {
    const pos = camera.position;
    // First call has no previous pose to measure against. Seeding `lastPose`
    // with a sentinel instead made `travel` infinite, and infinity survives the
    // decay below forever — the volume then never settles and marches every
    // frame, which is the entire cost this class exists to avoid.
    const travel = this.hasPose ? this.lastPose.distanceTo(pos) / Math.max(bound, 1) : 0;
    this.lastPose.copy(pos);
    this.hasPose = true;
    // Smoothed, so one slow frame in the middle of a drag does not read as a
    // stop and snap the history long.
    this.motion = Math.max(travel * 40, this.motion * 0.72);

    /*
     * Stillness is decided on a pose quantised to a tenth of a unit, not on a
     * raw distance threshold. Damping is asymptotic, so a camera nobody is
     * touching keeps moving by ever-smaller amounts indefinitely and an exact
     * threshold is met only by luck. The quantised comparison is what the
     * single-target cache used before this class accumulated, and it is the
     * behaviour the interaction suite's cache check is written against.
     */
    const pose = `${pos.x.toFixed(1)}|${pos.y.toFixed(1)}|${pos.z.toFixed(1)}`;
    const still = !moving && pose === this.lastQuantisedPose;
    this.lastQuantisedPose = pose;
    if (!still || this.dirty) this.settled = 0;
    this.skipRender = still && !this.dirty && this.settled >= SETTLE_FRAMES;

    // Framed distance is ~2.25x the bound, so 1.85 treated the default view as
    // "far" and marched at 55% steps — the hero shot was the softest one.
    const far = distance > bound * 2.6;
    const steps = far ? Math.max(16, Math.round(this.baseSteps * 0.55)) : this.baseSteps;
    this.marchMaterial.uniforms.uSteps.value = steps;
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, time: number): void {
    if (this.skipRender) return;

    const reset = this.dirty;
    this.dirty = false;
    this.frame++;

    const u = this.marchMaterial.uniforms;
    u.uTime.value = time;
    u.uFrame.value = this.frame;
    u.uInvProjection.value.copy(camera.projectionMatrixInverse);
    u.uCameraWorld.value.copy(camera.matrixWorld);
    camera.getWorldPosition(u.uCamPos.value);

    const prevTarget = renderer.getRenderTarget();

    // 1. March.
    renderer.setRenderTarget(this.march);
    renderer.render(this.marchScene, this.marchCamera);

    // 2. Horizontal half of the denoise.
    this.passMesh.material = this.blurMaterial;
    this.blurMaterial.uniforms.uMap.value = this.march.texture;
    this.blurMaterial.uniforms.uDirection.value.set(1, 0);
    renderer.setRenderTarget(this.blurAux);
    renderer.render(this.passScene, this.marchCamera);

    // 3. Vertical half + accumulate, in one draw. A reset takes the current frame whole; a moving camera
    // keeps a short tail; a still one lengthens the average every frame.
    const write = 1 - this.accumRead;
    let alpha: number;
    if (reset) {
      alpha = 1;
    } else if (this.motion > 0.02) {
      alpha = THREE.MathUtils.clamp(0.42 + this.motion * 0.9, 0.42, 1);
    } else {
      this.settled++;
      alpha = Math.max(1 / (this.settled + 1), 0.08);
    }

    this.passMesh.material = this.blendMaterial;
    this.blendMaterial.uniforms.uCurrent.value = this.blurAux.texture;
    this.blendMaterial.uniforms.uHistory.value = this.accum[this.accumRead].texture;
    this.blendMaterial.uniforms.uAlpha.value = alpha;
    renderer.setRenderTarget(this.accum[write]);
    renderer.render(this.passScene, this.marchCamera);

    this.accumRead = write;
    this.compositeMaterial.uniforms.uMap.value = this.accum[write].texture;

    renderer.setRenderTarget(prevTarget);
  }

  dispose(): void {
    this.march.dispose();
    this.blurAux.dispose();
    this.accum[0].dispose();
    this.accum[1].dispose();
    this.dummyTex.dispose();
    for (const baked of this.clusterCache.values()) baked.texture.dispose();
    this.clusterCache.clear();
    this.marchMaterial.uniforms.uNoise.value?.dispose();
    this.marchMaterial.dispose();
    this.blurMaterial.dispose();
    this.blendMaterial.dispose();
    this.compositeMaterial.dispose();
  }
}
