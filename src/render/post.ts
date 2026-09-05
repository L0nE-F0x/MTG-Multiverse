import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  KernelSize,
  NoiseEffect,
  Pass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';

/**
 * Persistence-of-vision trail.
 *
 * Blends each frame over a decaying copy of the last one, which turns fast
 * camera moves into star streaks. Deliberately biased toward the brighter of
 * the two samples rather than a straight lerp, so the nebula does not smear
 * into mud while the stars still leave a tail.
 */
class TrailPass extends Pass {
  private accumulation: THREE.WebGLRenderTarget;
  private readonly blendMaterial: THREE.ShaderMaterial;
  private readonly copyMaterial: THREE.ShaderMaterial;

  constructor(amount = 0.45) {
    super('TrailPass');
    this.needsSwap = true;

    this.accumulation = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });

    this.blendMaterial = new THREE.ShaderMaterial({
      uniforms: {
        inputBuffer: { value: null },
        tPrevious: { value: this.accumulation.texture },
        uAmount: { value: amount },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D inputBuffer;
        uniform sampler2D tPrevious;
        uniform float uAmount;
        varying vec2 vUv;
        void main() {
          vec3 current = texture2D(inputBuffer, vUv).rgb;
          vec3 previous = texture2D(tPrevious, vUv).rgb * uAmount;
          // max() keeps the trail bright where the star was and lets the dark
          // background recover immediately, which a lerp would not do.
          gl_FragColor = vec4(max(current, previous), 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    this.copyMaterial = new THREE.ShaderMaterial({
      uniforms: { inputBuffer: { value: null } },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D inputBuffer;
        varying vec2 vUv;
        void main() { gl_FragColor = texture2D(inputBuffer, vUv); }
      `,
      depthTest: false,
      depthWrite: false,
    });
  }

  setAmount(v: number): void {
    this.blendMaterial.uniforms.uAmount.value = v;
  }

  override setSize(width: number, height: number): void {
    this.accumulation.setSize(width, height);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget,
    outputBuffer: THREE.WebGLRenderTarget,
  ): void {
    this.blendMaterial.uniforms.inputBuffer.value = inputBuffer.texture;
    this.fullscreenMaterial = this.blendMaterial;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);

    // Keep what we just produced as next frame's history.
    this.copyMaterial.uniforms.inputBuffer.value = this.renderToScreen
      ? inputBuffer.texture
      : outputBuffer.texture;
    this.fullscreenMaterial = this.copyMaterial;
    renderer.setRenderTarget(this.accumulation);
    renderer.render(this.scene, this.camera);
  }

  override dispose(): void {
    this.accumulation.dispose();
    this.blendMaterial.dispose();
    this.copyMaterial.dispose();
    super.dispose();
  }
}

const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export interface PostChain {
  composer: EffectComposer;
  setBloom(intensity: number): void;
  setExposure(v: number): void;
  setTrails(enabled: boolean): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

export function createPostChain(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): PostChain {
  // Half float throughout: the star field is genuinely HDR — bright cores sit
  // far above 1.0 — and an 8-bit intermediate would clip them to flat white
  // before bloom ever sees them.
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
  composer.addPass(new RenderPass(scene, camera));

  // 0.45 decays to nothing within a few frames. Anything stronger ghosts the
  // star labels into unreadable smears, which reads as a rendering fault rather
  // than a deliberate effect.
  const trail = new TrailPass(0.45);
  trail.enabled = false;
  composer.addPass(trail);

  const bloom = new BloomEffect({
    blendFunction: BlendFunction.ADD,
    intensity: 1.05,
    // 0.12 bloomed the nebula itself, so the inner arms clipped to a white
    // sheet the moment they overlapped a bright star. Stars still bloom;
    // the gas keeps its colour.
    luminanceThreshold: 0.42,
    luminanceSmoothing: 0.22,
    mipmapBlur: true,
    radius: 0.74,
    kernelSize: KernelSize.LARGE,
  });

  const chromatic = new ChromaticAberrationEffect({
    offset: new THREE.Vector2(0.00032, 0.00032),
    radialModulation: true,
    modulationOffset: 0.42,
  });

  const vignette = new VignetteEffect({ offset: 0.26, darkness: 0.66 });

  const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: true });
  grain.blendMode.opacity.value = 0.028;

  const toneMapping = new ToneMappingEffect({
    mode: ToneMappingMode.ACES_FILMIC,
    resolution: 256,
    whitePoint: 6.5,
    middleGrey: 0.40,
  });

  // One pass: the library merges these into a single fragment shader.
  composer.addPass(new EffectPass(camera, bloom, chromatic, vignette, grain, toneMapping));

  return {
    composer,
    setBloom: (v) => { bloom.intensity = v * 1.05; },
    setExposure: (v) => { renderer.toneMappingExposure = v; },
    setTrails: (enabled) => { trail.enabled = enabled; },
    setSize: (w, h) => composer.setSize(w, h),
    dispose: () => composer.dispose(),
  };
}
