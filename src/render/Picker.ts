import * as THREE from 'three';
import pickVert from '../shaders/pick.vert';
import pickFrag from '../shaders/pick.frag';
import type { Starfield } from './Starfield.ts';

/**
 * GPU picking for point sprites.
 *
 * Raycasting 117k points on the CPU is hopeless, and the stars are positioned
 * by a vertex shader anyway, so the CPU does not even know where they are.
 * Instead the same geometry is re-drawn with each index encoded as a colour,
 * scissored down to the single pixel under the cursor, and read back
 * asynchronously so the main thread never stalls on the GPU.
 *
 * A readback that never settles used to wedge picking permanently: nothing
 * cleared `inFlight`, so every later pick was skipped and hover simply
 * stopped working. It resolves often enough that this only showed up as an
 * intermittent failure with a stationary cursor. Abandon a stalled read
 * rather than waiting on it forever.
 */
const STALL_MS = 400;

export class Picker {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly material: THREE.ShaderMaterial;
  private readonly points: THREE.Points;
  private inFlight = false;
  private inFlightSince = 0;
  /** Bumped per request so a late reply from an abandoned read is ignored. */
  private generation = 0;
  private warned = false;
  private dirty = false;
  private px = 0;
  private py = 0;

  constructor(starfield: Starfield) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: pickVert,
      fragmentShader: pickFrag,
      glslVersion: THREE.GLSL3, // needs gl_FragDepth, which GLSL1 lacks
      uniforms: {
        uMorph: starfield.material.uniforms.uMorph,
        uFilterMorph: starfield.material.uniforms.uFilterMorph,
        uStarSize: starfield.material.uniforms.uStarSize,
        uSizeScale: { value: 600 },
        uMinPixels: { value: 4.0 },
        uPickRadius: { value: 1.15 },
      },
      depthTest: true,
      depthWrite: true,
      blending: THREE.NoBlending,
    });

    this.points = new THREE.Points(starfield.geometry, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    this.target = new THREE.WebGLRenderTarget(1, 1, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
    });
  }

  /**
   * Picking runs at CSS pixel resolution regardless of device pixel ratio — a
   * retina pick buffer costs memory and buys nothing. That means it needs its
   * own point-size scale, since gl_PointSize is in framebuffer pixels.
   */
  setViewport(width: number, height: number, fovDegrees: number): void {
    this.target.setSize(Math.max(1, width), Math.max(1, height));
    const fov = (fovDegrees * Math.PI) / 180;
    this.material.uniforms.uSizeScale.value = (height * 0.5) / Math.tan(fov / 2);
  }

  /** Queue a pick at CSS pixel coordinates, origin top-left. */
  request(x: number, y: number): void {
    this.px = x;
    this.py = y;
    this.dirty = true;
  }

  /**
   * Runs at most one readback at a time; if the cursor moved again while a read
   * was in flight the newest position simply wins on the next frame.
   */
  poll(
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    onResult: (index: number) => void,
  ): void {
    if (this.inFlight) {
      if (performance.now() - this.inFlightSince <= STALL_MS) return;
      // The outstanding promise is still out there; the generation bump
      // below makes its result a no-op. Retry the last cursor position even
      // if nothing has moved — a hung read with a stationary pointer used
      // to stay hung forever because `dirty` was already false.
      this.inFlight = false;
      this.dirty = true;
    }
    if (!this.dirty) return;

    this.dirty = false;
    this.inFlight = true;
    this.inFlightSince = performance.now();
    const generation = ++this.generation;
    // Each request owns its buffer so a late write from an abandoned read
    // cannot clobber a newer one that is still in flight.
    const pixel = new Uint8Array(4);

    const h = this.target.height;
    const x = Math.max(0, Math.min(this.target.width - 1, Math.round(this.px)));
    // Framebuffer origin is bottom-left; pointer coordinates are top-left.
    const y = Math.max(0, Math.min(h - 1, Math.round(h - this.py)));

    const prevTarget = renderer.getRenderTarget();
    const prevScissorTest = renderer.getScissorTest();
    const prevScissor = new THREE.Vector4();
    renderer.getScissor(prevScissor);

    renderer.setRenderTarget(this.target);
    renderer.setScissorTest(true);
    renderer.setScissor(x, y, 1, 1);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    renderer.render(this.scene, camera);
    renderer.setScissorTest(prevScissorTest);
    renderer.setScissor(prevScissor);
    renderer.setRenderTarget(prevTarget);

    renderer
      .readRenderTargetPixelsAsync(this.target, x, y, 1, 1, pixel)
      .then(() => {
        if (generation !== this.generation) return; // superseded by a newer pick
        const [r, g, b] = pixel;
        const id = r + g * 256 + b * 65536;
        onResult(id - 1); // the shader wrote index+1 so 0 can mean "empty"
      })
      .catch((err: unknown) => {
        // A dropped readback used to be fatal for as long as the pointer stayed
        // still: nothing re-armed `dirty`, so hover remained stale until the
        // mouse moved again. Interactively that self-heals and looks fine,
        // which is exactly why it survived so long — it only showed up as a
        // ~50% flake with a stationary cursor. Re-arm and try again.
        if (generation === this.generation) this.dirty = true;
        if (!this.warned) {
          this.warned = true;
          console.warn('[mcu] pick readback failed, retrying:', err);
        }
      })
      .finally(() => {
        if (generation === this.generation) this.inFlight = false;
      });
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }
}
