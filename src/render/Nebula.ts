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

function dummyClusterMap(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
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
 * The march is the most expensive thing in the frame, so it renders at a
 * fraction of the canvas resolution into its own target and is then blitted
 * behind the stars. Volumetric detail survives the downscale far better than
 * geometry would — the clouds are low-frequency by nature.
 */
export class Nebula {
  readonly compositeMesh: THREE.Mesh;

  private readonly marchScene = new THREE.Scene();
  private readonly marchCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly marchMaterial: THREE.ShaderMaterial;
  private readonly compositeMaterial: THREE.ShaderMaterial;
  private target: THREE.WebGLRenderTarget;
  private scale: number;
  private width = 1;
  private height = 1;
  private targetDensity = 1;
  /**
   * The 1×1 placeholder used until a layout supplies real clusters. Held
   * separately because the uniform stops pointing at it the moment the sets
   * layout is entered, and it was previously never freed.
   */
  private readonly dummyTex: THREE.DataTexture;
  private skipRender = false;
  private lastPose = '';
  private baseSteps = 52;
  /** Set whenever a march uniform changes; see `invalidate`. */
  private dirty = true;
  /**
   * Baked cluster maps, keyed by layout. `setClusterAttribs` is a pure
   * function of the catalogue, so a layout's map never changes within a
   * session and re-baking it on every visit is 128² × 1,049 `exp()` calls on
   * the main thread for an identical result — about three dropped frames.
   */
  private clusterCache = new Map<LayoutMode, { texture: THREE.DataTexture; extent: number }>();

  constructor(scale = 0.5) {
    this.scale = scale;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });

    this.marchMaterial = new THREE.ShaderMaterial({
      vertexShader: nebulaVert,
      fragmentShader: nebulaFrag,
      glslVersion: THREE.GLSL3,
      uniforms: {
        uInvProjection: { value: new THREE.Matrix4() },
        uCameraWorld: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uTime: { value: 0 },
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

    this.compositeMaterial = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: this.target.texture } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 1.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec2 vUv;
        void main() { gl_FragColor = vec4(texture2D(uMap, vUv).rgb, 1.0); }
      `,
      depthTest: false,
      depthWrite: false,
    });

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
    this.target.setSize(w, h);
    this.marchMaterial.uniforms.uResolution.value.set(w, h);
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
    this.marchMaterial.uniforms.uIntensity.value = v;
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
    // cached target does not have yet.
    this.invalidate();
  }

  /**
   * Force the next frame to actually march.
   *
   * `prepareFrame` reuses the last target whenever the camera has not moved,
   * and the composite pass does nothing but blit it — so a uniform changed
   * while the camera is at rest never reaches the screen on its own. With
   * auto-rotate off (a persisted setting) that silently disabled the nebula
   * toggle, the intensity slider and the filter-driven density change.
   */
  invalidate(): void { this.dirty = true; }

  /**
   * Skip the march when the camera has not moved (reuse last target) and cut
   * steps when looking at the whole layout from far away. The composite mesh
   * still draws either way.
   */
  prepareFrame(camera: THREE.PerspectiveCamera, distance: number, bound: number, moving: boolean): void {
    const pose = `${camera.position.x.toFixed(1)}|${camera.position.y.toFixed(1)}|${camera.position.z.toFixed(1)}`;
    this.skipRender = !this.dirty && !moving && pose === this.lastPose;
    this.lastPose = pose;
    const far = distance > bound * 1.85;
    const steps = far ? Math.max(16, Math.round(this.baseSteps * 0.55)) : this.baseSteps;
    this.marchMaterial.uniforms.uSteps.value = steps;
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, time: number): void {
    if (this.skipRender) return;
    this.dirty = false;
    const u = this.marchMaterial.uniforms;
    u.uTime.value = time;
    u.uInvProjection.value.copy(camera.projectionMatrixInverse);
    u.uCameraWorld.value.copy(camera.matrixWorld);
    camera.getWorldPosition(u.uCamPos.value);

    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(this.marchScene, this.marchCamera);
    renderer.setRenderTarget(prevTarget);
  }

  dispose(): void {
    this.target.dispose();
    this.dummyTex.dispose();
    for (const baked of this.clusterCache.values()) baked.texture.dispose();
    this.clusterCache.clear();
    this.marchMaterial.uniforms.uNoise.value?.dispose();
    this.marchMaterial.dispose();
    this.compositeMaterial.dispose();
  }
}
