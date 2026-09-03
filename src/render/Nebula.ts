import * as THREE from 'three';
import nebulaVert from '../shaders/nebula.vert';
import nebulaFrag from '../shaders/nebula.frag';
import { createNoiseVolume } from './noise3d.ts';

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
        uNoise: { value: createNoiseVolume(64) },
      },
      depthTest: false,
      depthWrite: false,
    });
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
  }

  /** Render scale for the volume pass, 0.25 (fast) to 1 (sharp). */
  setQuality(scale: number, steps: number): void {
    this.scale = scale;
    this.marchMaterial.uniforms.uSteps.value = steps;
    this.setSize(this.width, this.height);
  }

  setIntensity(v: number): void { this.marchMaterial.uniforms.uIntensity.value = v; }

  /** Density is eased rather than set, so layout changes do not pop the gas. */
  setDensity(v: number): void { this.targetDensity = v; }
  update(dt: number): void {
    const u = this.marchMaterial.uniforms.uDensity;
    const k = 1 - Math.exp(-dt * 2.2);
    u.value += (this.targetDensity - u.value) * k;
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, time: number): void {
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
    this.marchMaterial.uniforms.uNoise.value?.dispose();
    this.marchMaterial.dispose();
    this.compositeMaterial.dispose();
  }
}
