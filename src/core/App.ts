import * as THREE from 'three';
import { CameraRig } from './CameraRig.ts';
import { store, type LayoutMode, type VisualState } from './store.ts';
import { Starfield } from '../render/Starfield.ts';
import { Nebula } from '../render/Nebula.ts';
import { Picker } from '../render/Picker.ts';
import { createPostChain, type PostChain } from '../render/post.ts';
import type { Universe } from '../data/universe.ts';

const FOV = 55;
const CLICK_SLOP_PX = 5;

/**
 * Nebula render tiers, cheapest first. The raymarch dominates the frame, so
 * this is the only knob worth turning automatically — the star field itself is
 * one draw call and costs the same at any quality.
 */
const NEBULA_TIERS = [
  { scale: 0.22, steps: 24 },
  { scale: 0.32, steps: 34 },
  { scale: 0.42, steps: 44 },
  { scale: 0.5, steps: 52 },
];
const TOP_TIER = NEBULA_TIERS.length - 1;

export interface AppOptions {
  /** Screen position of the hovered star, for the tooltip. */
  onHoverAnchor?: (p: { x: number; y: number } | null) => void;
}

export class App {
  readonly rig: CameraRig;
  readonly starfield: Starfield;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly nebula: Nebula;
  private readonly picker: Picker;
  private readonly post: PostChain;
  private readonly universe: Universe;
  private readonly canvas: HTMLCanvasElement;
  private readonly options: AppOptions;

  private readonly mask: Uint8Array;
  private readonly tmpVec = new THREE.Vector3();
  private readonly clock = new THREE.Clock();

  private raf = 0;
  private running = false;
  private pointerDown = { x: 0, y: 0, t: 0 };
  private pointerInside = false;
  private frames = 0;
  private fpsAccum = 0;
  private filterQueued = false;
  private tier = TOP_TIER;
  private tierCooldown = 0;
  private disposers: (() => void)[] = [];

  constructor(canvas: HTMLCanvasElement, universe: Universe, options: AppOptions = {}) {
    this.canvas = canvas;
    this.universe = universe;
    this.options = options;
    this.mask = new Uint8Array(universe.count).fill(1);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // the post chain and the star profile handle edges
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.toneMapping = THREE.NoToneMapping; // ACES happens in the post chain
    this.renderer.autoClear = true;

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 8000);
    this.rig = new CameraRig(this.camera, canvas);

    this.starfield = new Starfield(universe);
    this.nebula = new Nebula(0.5);
    this.picker = new Picker(this.starfield);

    this.scene.add(this.nebula.compositeMesh);
    this.scene.add(this.starfield.points);

    this.post = createPostChain(this.renderer, this.scene, this.camera);

    this.bindEvents();
    this.bindStore();
    this.resize();
    // Frame after resize so the starfield knows the real field of view. The rig
    // starts wider than this and eases in, which reads as a deliberate arrival.
    this.rig.frame(this.starfield.frameDistance());
    this.rig.setPhi(this.starfield.framePhi());
    this.applyVisual(store.state.visual);
    this.applyFilter();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private bindEvents(): void {
    const add = <T extends Event>(
      el: EventTarget, type: string, fn: (e: T) => void, opts?: AddEventListenerOptions,
    ) => {
      el.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => el.removeEventListener(type, fn as EventListener));
    };

    add<PointerEvent>(this.canvas, 'pointermove', (e) => {
      this.pointerInside = true;
      const r = this.canvas.getBoundingClientRect();
      this.picker.request(e.clientX - r.left, e.clientY - r.top);
    });

    add<PointerEvent>(this.canvas, 'pointerleave', () => {
      this.pointerInside = false;
      store.set('hovered', -1);
      this.options.onHoverAnchor?.(null);
    });

    add<PointerEvent>(this.canvas, 'pointerdown', (e) => {
      this.pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() };
    });

    add<PointerEvent>(this.canvas, 'pointerup', (e) => {
      // Only treat it as a click if the pointer barely moved; otherwise this is
      // the end of an orbit drag and selecting would be infuriating.
      const moved = Math.hypot(e.clientX - this.pointerDown.x, e.clientY - this.pointerDown.y);
      if (moved > CLICK_SLOP_PX || performance.now() - this.pointerDown.t > 700) return;
      const hovered = store.state.hovered;
      store.set('selected', hovered);
    });

    add<KeyboardEvent>(window, 'keydown', (e) => {
      if (e.key === 'Escape') store.set('selected', -1);
    });

    add<Event>(window, 'resize', () => this.resize());

    add<Event>(this.canvas, 'webglcontextlost', (e) => {
      e.preventDefault();
      this.stop();
      store.set('loadLabel', 'Graphics context lost — reload to continue');
    });
  }

  private bindStore(): void {
    this.disposers.push(
      store.on('layout', (mode) => this.applyLayout(mode)),
      store.on('filter', () => {
        // Coalesce bursts of filter edits into one pass per frame; a slider drag
        // fires far faster than the 112k-element scan needs to run.
        if (this.filterQueued) return;
        this.filterQueued = true;
        requestAnimationFrame(() => {
          this.filterQueued = false;
          this.applyFilter();
        });
      }),
      store.on('visual', (v) => this.applyVisual(v)),
      store.on('selected', (i) => this.applySelection(i)),
    );
  }

  private applyLayout(mode: LayoutMode): void {
    this.starfield.setLayout(mode);
    // Reframe only if the user is looking at the whole thing; if they are down
    // among the stars, leave them where they are.
    if (this.rig.distance > 260) {
      this.rig.frame(this.starfield.frameDistance());
      this.rig.setPhi(this.starfield.framePhi());
    }
    this.applyNebulaDensity();
  }

  /**
   * The nebula volume is shaped like the galaxy disc, so it only makes sense
   * for the layouts that use that footprint. Elsewhere it drops to a faint
   * ambient haze rather than sitting there as a disc the stars have left.
   */
  private applyNebulaDensity(): void {
    if (!store.state.visual.showNebula) { this.nebula.setDensity(0); return; }
    const mode = store.state.layout;
    const strength = mode === 'galaxy' ? 1 : mode === 'price' ? 0.8 : 0.09;
    this.nebula.setDensity(strength);
  }

  private applyFilter(): void {
    const count = this.universe.applyFilter(store.state.filter, this.mask);
    this.starfield.setVisibility(this.mask);
    store.set('matchCount', count);
  }

  private applyVisual(v: VisualState): void {
    const u = this.starfield.material.uniforms;
    u.uStarSize.value = v.starSize;
    u.uDim.value = v.dimFiltered;
    u.uExposure.value = v.exposure;

    this.post.setBloom(v.bloom);
    this.post.setTrails(v.motionBlur);
    this.nebula.setIntensity(v.nebula);
    this.applyNebulaDensity();
    this.rig.autoRotate = v.autoRotate;
  }

  private applySelection(i: number): void {
    this.starfield.material.uniforms.uSelected.value = i;
    if (i < 0) return;
    this.starfield.positionOf(i, this.tmpVec);
    // Always close the distance on select, so picking a search result on the
    // far rim actually takes you there rather than nudging the pivot.
    this.rig.flyTo(this.tmpVec, Math.min(this.rig.distance, 120));
  }

  private resize(): void {
    const cssW = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const cssH = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(cssW, cssH, false);
    this.camera.aspect = cssW / cssH;
    this.camera.updateProjectionMatrix();

    this.post.setSize(cssW, cssH);
    this.nebula.setSize(cssW * dpr, cssH * dpr);
    // gl_PointSize is in framebuffer pixels, so the starfield scales by dpr;
    // the picker deliberately does not.
    this.starfield.setViewport(cssH * dpr, FOV);
    this.picker.setViewport(cssW, cssH, FOV);
  }

  private frame(): void {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const time = this.clock.elapsedTime;

    this.rig.update(dt);
    this.starfield.update(dt, time);
    this.nebula.update(dt);

    this.nebula.render(this.renderer, this.camera, time);
    this.post.composer.render(dt);

    this.picker.poll(this.renderer, this.camera, (index) => {
      const valid = index >= 0 && index < this.universe.count && this.pointerInside;
      const next = valid ? index : -1;
      if (next !== store.state.hovered) {
        store.set('hovered', next);
        this.starfield.material.uniforms.uHovered.value = next;
      }
    });

    this.updateHoverAnchor();
    this.updateStats(dt);
  }

  private updateHoverAnchor(): void {
    const cb = this.options.onHoverAnchor;
    if (!cb) return;
    const i = store.state.hovered;
    if (i < 0) { cb(null); return; }

    this.starfield.positionOf(i, this.tmpVec).project(this.camera);
    if (this.tmpVec.z > 1) { cb(null); return; } // behind the camera
    const r = this.canvas.getBoundingClientRect();
    cb({
      x: r.left + ((this.tmpVec.x + 1) / 2) * r.width,
      y: r.top + ((1 - this.tmpVec.y) / 2) * r.height,
    });
  }

  private updateStats(dt: number): void {
    this.frames++;
    this.fpsAccum += dt;
    if (this.fpsAccum < 0.4) return;

    const window = this.fpsAccum;
    const fps = Math.round(this.frames / window);
    store.set('stats', {
      fps,
      visible: store.state.matchCount,
      total: this.universe.count,
      drawCalls: this.renderer.info.render.calls,
      ms: +((window / this.frames) * 1000).toFixed(2),
    });
    this.frames = 0;
    this.fpsAccum = 0;
    this.adaptQuality(fps, window);
  }

  /**
   * Walk the nebula quality tiers to hold a usable frame rate. Stepping down is
   * eager and stepping up is reluctant, with a long cooldown after each move, so
   * a machine sitting near the boundary settles instead of oscillating between
   * two tiers every second.
   */
  private adaptQuality(fps: number, elapsed: number): void {
    this.tierCooldown = Math.max(0, this.tierCooldown - elapsed);
    if (this.tierCooldown > 0) return;
    // A morph or a filter crossfade briefly costs extra; do not down-rank on it.
    if (this.starfield.isMorphing) return;

    if (fps < 38 && this.tier > 0) {
      this.tier--;
      this.tierCooldown = 4;
    } else if (fps > 58 && this.tier < TOP_TIER) {
      this.tier++;
      this.tierCooldown = 9;
    } else {
      return;
    }
    const t = NEBULA_TIERS[this.tier];
    this.nebula.setQuality(t.scale, t.steps);
  }

  dispose(): void {
    this.stop();
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.rig.dispose();
    this.starfield.dispose();
    this.nebula.dispose();
    this.picker.dispose();
    this.post.dispose();
    this.renderer.dispose();
  }
}
