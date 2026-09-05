import * as THREE from 'three';
import { CameraRig } from './CameraRig.ts';
import { store, type CameraCue, type LayoutMode, type VisualState } from './store.ts';
import { Starfield } from '../render/Starfield.ts';
import { Nebula } from '../render/Nebula.ts';
import { Picker } from '../render/Picker.ts';
import { CardBillboards } from '../render/CardBillboards.ts';
import { StarLabels } from '../render/StarLabels.ts';
import { CoreGlow } from '../render/CoreGlow.ts';
import { PrintingTrail } from '../render/PrintingTrail.ts';
import { EraMarkers } from '../render/EraMarkers.ts';
import { createPostChain, type PostChain } from '../render/post.ts';
import { isEmbedded } from './embed.ts';
import { skipCinematic } from './urlState.ts';
import { COLOR_BIT, FORMAT_BIT } from '../data/format.ts';
import { COLOR_ANGLE, setClusterAttribs } from '../layout/layouts.ts';
import type { Universe } from '../data/universe.ts';

const FOV = 55;
const CLICK_SLOP_PX = 5;

/**
 * Quality ladder, cheapest first.
 *
 * The raymarch dominates, so the nebula is turned down first. Only once it is
 * at its floor does the ladder start reducing the main render resolution —
 * that hurts the stars, which are the whole point, so it is the last resort
 * rather than the first.
 */
const QUALITY_LEVELS = [
  { nebulaScale: 0.24, steps: 24, renderScale: 0.78 },
  { nebulaScale: 0.28, steps: 28, renderScale: 0.88 },
  { nebulaScale: 0.34, steps: 32, renderScale: 0.95 },
  { nebulaScale: 0.40, steps: 38, renderScale: 1.0 },
  { nebulaScale: 0.46, steps: 46, renderScale: 1.0 },
  { nebulaScale: 0.52, steps: 54, renderScale: 1.0 },
];
const TOP_TIER = QUALITY_LEVELS.length - 1;

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
  private readonly billboards: CardBillboards;
  private readonly labels: StarLabels;
  private readonly coreGlow = new CoreGlow();
  private readonly printingTrail: PrintingTrail;
  private readonly eraMarkers: EraMarkers;
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
  private lastPointer = { x: 0, y: 0 };
  /** Camera pose at the last pick, so motion can re-arm one. */
  private lastPickPose = '';
  private frames = 0;
  private fpsAccum = 0;
  private filterQueued = false;
  private tier = TOP_TIER;
  private pinnedTier = false;
  private renderScale = 1;
  private tierCooldown = 0;
  private disposers: (() => void)[] = [];
  /** Galaxy layout's bounding radius, captured at boot. Other layouts scale the nebula against this. */
  private galaxyBound = 1;
  private worldScale = 1;
  private targetWorldScale = 1;
  /** Last time a camera-driven pick was queued. Pointer moves stay immediate. */
  private lastCameraPick = 0;

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

    this.billboards = new CardBillboards(universe, this.starfield, this.mask);
    this.labels = new StarLabels(universe, this.starfield, this.mask);
    this.printingTrail = new PrintingTrail(universe, this.starfield);
    this.eraMarkers = new EraMarkers(universe);

    this.scene.add(this.nebula.compositeMesh);
    this.scene.add(this.starfield.points);
    this.scene.add(this.billboards.group);
    this.scene.add(this.labels.group);
    this.scene.add(this.coreGlow.group);
    this.scene.add(this.eraMarkers.group);
    this.scene.add(this.printingTrail.line);

    this.post = createPostChain(this.renderer, this.scene, this.camera);

    this.bindEvents();
    this.bindStore();
    this.galaxyBound = Math.max(1, this.starfield.boundingRadius);
    this.nebula.setLayout('galaxy', {
      bound: this.galaxyBound,
      yearMin: this.starfield.ctx.yearMin,
      yearMax: this.starfield.ctx.yearMax,
    });
    // Start below the top of the ladder and climb if the machine has headroom.
    // Booting at max raymarch cost made the first few seconds of flight the
    // heaviest, which is exactly when a host webview looks like it "can't run
    // this". Embedded views (Tauri) start one step lower still.
    this.tier = isEmbedded() ? 1 : 2;
    this.resize();
    this.applyQuality();

    // Cinematic arrival: start far enough out that the galaxy is a distant
    // smudge, then ease in. The low seeded damping relaxes back to normal over
    // the next second, so the approach starts slow and gathers pace instead of
    // sliding in at a constant rate.
    const framed = this.framedDistance();
    this.rig.setPhi(this.starfield.framePhi());
    this.rig.setRadius(framed * 3.4);
    this.rig.flyTo(new THREE.Vector3(0, 0, 0), framed, 0.62);
    this.applyVisual(store.state.visual);
    this.applyFilter();
    this.applyHighlight();
  }

  /** Current quality tier, 0 (cheapest) to TOP_TIER. Diagnostics only. */
  get qualityTier(): number { return this.tier; }

  /**
   * Pin the quality ladder, or pass -1 to resume adapting.
   *
   * The capture harness and the benchmark both need a fixed quality to produce
   * comparable output: a hero image should not come out soft because the
   * controller happened to drop two tiers while the camera was settling, and a
   * benchmark scenario cannot be compared against another that ran at a
   * different tier.
   */
  setQualityTier(tier: number): void {
    this.pinnedTier = tier >= 0;
    if (!this.pinnedTier) return;
    this.tier = Math.max(0, Math.min(TOP_TIER, Math.round(tier)));
    this.applyQuality();
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
      this.lastPointer = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.picker.request(this.lastPointer.x, this.lastPointer.y);
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
      if (store.state.shell === 'title') return;
      if (e.key === 'Escape') {
        if (this.rig.isCinematic) {
          this.rig.skipCinematic();
          store.set('cinematic', false);
          return;
        }
        store.set('selected', -1);
        return;
      }

      // Never steal keys from a text field.
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toLowerCase();
      if (key === 'r') { e.preventDefault(); this.selectRandomCard(); }
      else if (key === 'f' || key === 'home') { e.preventDefault(); this.resetView(); }
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
      store.on('hovered', (i) => {
        this.starfield.setHoverOracle(i >= 0 ? this.universe.col.oracleIdx[i]! : -1);
      }),
      store.on('formatFocus', (fmt) => {
        this.starfield.setFormatBit(fmt ? FORMAT_BIT[fmt] : 0);
      }),
      store.on('highlightOracles', () => this.applyHighlight()),
      store.on('cameraCue', (cue) => this.consumeCue(cue)),
      store.on('shell', (mode) => {
        this.rig.setInputEnabled(mode === 'play');
        this.labels.setEnabled(store.state.visual.showLabels && mode === 'play');
        this.eraMarkers.setEnabled(mode === 'play');
        const automated = navigator.webdriver === true;
        if (mode === 'play' && !skipCinematic && !isEmbedded() && !automated) {
          this.rig.playCinematic(this.framedDistance(), this.starfield.framePhi(), 45);
          store.set('cinematic', true);
        }
        if (mode === 'title') {
          this.rig.skipCinematic();
          store.set('cinematic', false);
        }
      }),
      // Collapsing the filter panel hands back a third of the width. Re-offset
      // the projection and re-fit, so the layout drifts out to fill the space
      // instead of staying hunched to one side of a canvas that grew.
      store.on('insets', () => {
        this.resize();
        // Only when they are looking at the whole thing — someone flying among
        // the stars did not ask to be yanked back out because a panel moved.
        if (this.rig.distance > 260) this.rig.frame(this.framedDistance());
      }),
    );
    this.rig.setInputEnabled(store.state.shell === 'play');
  }

  /** Frame the whole current layout again, without changing the heading. */
  resetView(): void {
    store.set('selected', -1);
    this.rig.frame(this.framedDistance());
    this.rig.setPhi(this.starfield.framePhi());
  }

  /**
   * Jump to a random card, biased toward ones worth arriving at.
   *
   * A uniform pick over 117k lands on an obscure reprint almost every time,
   * which makes the feature feel broken rather than serendipitous. Sampling
   * from cards that pass the current filter and weighting by popularity keeps
   * it surprising but rewarding.
   */
  private selectRandomCard(): void {
    const pop = this.universe.col.popularity;
    const n = this.universe.count;
    let best = -1;
    let bestScore = -1;

    // Reservoir of random tries rather than building a weighted table: this
    // runs on a keypress, so a handful of samples is cheaper and good enough.
    for (let tries = 0; tries < 64; tries++) {
      const i = (Math.random() * n) | 0;
      if (this.mask[i] === 0) continue;
      const score = (pop[i] / 65535) * Math.random();
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best >= 0) store.set('selected', best);
  }

  private applyLayout(mode: LayoutMode): void {
    this.starfield.setLayout(mode);
    this.targetWorldScale = this.starfield.boundingRadius / this.galaxyBound;
    this.eraMarkers.setLayout(mode);
    this.nebula.setLayout(mode, {
      bound: this.starfield.boundingRadius,
      yearMin: this.starfield.ctx.yearMin,
      yearMax: this.starfield.ctx.yearMax,
      clusters: mode === 'sets' ? setClusterAttribs(this.starfield.ctx) : undefined,
    });
    // Reframe only if the user is looking at the whole thing; if they are down
    // among the stars, leave them where they are.
    if (this.rig.distance > 260) {
      this.rig.frame(this.framedDistance());
      this.rig.setPhi(this.starfield.framePhi());
    }
    this.applyNebulaDensity();
    // Only galaxy, price and the year rings put time on the radius.
    this.printingTrail.setLayoutSupported(
      mode === 'galaxy' || mode === 'price' || mode === 'timeline',
    );
  }

  /**
   * The nebula volume is shaped like the galaxy disc, so it only makes sense
   * for the layouts that use that footprint. Elsewhere it drops to a faint
   * ambient haze rather than sitting there as a disc the stars have left.
   */
  private applyNebulaDensity(): void {
    if (!store.state.visual.showNebula) {
      this.nebula.setDensity(0);
      this.coreGlow.setStrength(0);
      return;
    }
    const mode = store.state.layout;
    // The colourful disc is the nicest thing in the picture; keep it present
    // in every layout, scaled to that layout's size. Galaxy stays the densest.
    const layout =
      mode === 'galaxy' ? 1 :
      mode === 'sets' ? 0.42 :
      mode === 'timeline' ? 0.7 :
      0.75;
    const core = mode === 'galaxy' ? 1 : 0.45;

    // Linear in the visible fraction, with a floor so a narrow filter still
    // leaves the galaxy's shape faintly legible rather than cutting to black.
    const fraction = this.universe.count > 0
      ? store.state.matchCount / this.universe.count
      : 1;
    const populated = 0.12 + 0.88 * fraction;

    this.nebula.setDensity(layout * populated);
    this.coreGlow.setStrength(core * populated);
  }

  private applyFilter(): void {
    const count = this.universe.applyFilter(store.state.filter, this.mask);
    this.starfield.setVisibility(this.mask);
    store.set('matchCount', count);
    // The gas stands for the population, so it has to thin with it. Leaving it
    // at full strength made filtering look broken: the stars dimmed correctly
    // but the nebula kept painting the same bright five-armed galaxy over them,
    // so narrowing 117k cards down to 13k changed almost nothing on screen.
    this.applyNebulaDensity();
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
    this.labels.setEnabled(v.showLabels && store.state.shell === 'play');
  }

  private applyHighlight(): void {
    const wanted = store.state.highlightOracles;
    if (wanted.size === 0) {
      this.starfield.setHighlight(null);
      return;
    }
    const mask = new Uint8Array(this.universe.count);
    const oracles = this.universe.col.oracleIdx;
    for (let i = 0; i < this.universe.count; i++) {
      if (wanted.has(oracles[i]!)) mask[i] = 255;
    }
    this.starfield.setHighlight(mask);
  }

  private consumeCue(cue: CameraCue | null): void {
    if (!cue) return;
    if (cue.kind === 'skip-cinematic') {
      this.rig.skipCinematic();
      store.set('cinematic', false);
    } else if (cue.kind === 'cinematic') {
      this.rig.playCinematic(this.framedDistance(), this.starfield.framePhi(), 45);
      store.set('cinematic', true);
    } else if (cue.kind === 'bookmark') {
      this.rig.restore(cue);
    } else if (cue.kind === 'arm') {
      const world = COLOR_ANGLE[COLOR_BIT[cue.color]] ?? 0;
      this.rig.setAngles(Math.PI / 2 - world, this.starfield.framePhi());
      this.rig.frame(this.framedDistance());
    }
    store.set('cameraCue', null);
  }

  private applySelection(i: number): void {
    this.starfield.material.uniforms.uSelected.value = i;
    this.printingTrail.setCard(i);
    if (i < 0) {
      this.starfield.setSelectedOracle(-1);
      return;
    }
    this.starfield.setSelectedOracle(this.universe.col.oracleIdx[i]!);
    this.starfield.positionOf(i, this.tmpVec);
    // Always close the distance on select, so picking a search result on the
    // far rim actually takes you there rather than nudging the pivot.
    // Damping 1.45 is a long, readable flight — search "flies you there".
    this.rig.flyTo(this.tmpVec, Math.min(this.rig.distance, 120), 1.45);
  }

  /**
   * Canvas size in CSS pixels, and the slice of it the UI is not covering.
   */
  private viewport(): { cssW: number; cssH: number; freeW: number; insetLeft: number } {
    const cssW = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const cssH = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const { left, right } = store.state.insets;
    // Never let a panel claim so much that the remaining strip is unusable —
    // a mis-measured inset should degrade the framing, not erase the view.
    const insetLeft = Math.min(left, cssW * 0.5);
    const freeW = Math.max(1, cssW - insetLeft - Math.min(right, cssW * 0.25));
    return { cssW, cssH, freeW, insetLeft };
  }

  /** Distance that fits the layout into the space the UI leaves. */
  private framedDistance(): number {
    const { cssH, freeW } = this.viewport();
    return this.starfield.frameDistance(freeW / cssH);
  }

  private resize(): void {
    const { cssW, cssH, insetLeft } = this.viewport();
    // Host webviews (Tauri) often sit on a retina panel and an iGPU at once.
    // Capping DPR there cuts fill-rate without touching the public site.
    const dprCap = isEmbedded() ? 1.25 : 1.5;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap) * this.renderScale;

    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(cssW, cssH, false);
    this.camera.aspect = cssW / cssH;

    /*
     * Slide the whole image over by half of what the panels cover, so the
     * layout sits in the middle of the space that is actually visible.
     *
     * `setViewOffset` rather than moving the camera or the scene: it edits the
     * projection matrix, so everything that reads the camera follows for free
     * — the picker (which renders the pick pass with this same camera), the
     * label and billboard projections, and the nebula's ray directions. Move
     * the camera sideways instead and the picker silently disagrees with the
     * screen by the offset, which is the same class of bug as the dpr-scaled
     * pick buffer.
     *
     * A negative offsetX shifts the frustum left, which puts the content
     * right. Width and height match the full size, so this is a pure shift
     * with no change of scale.
     */
    if (insetLeft > 0.5) {
      this.camera.setViewOffset(cssW, cssH, -insetLeft / 2, 0, cssW, cssH);
    } else {
      this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();

    this.post.setSize(cssW, cssH);
    this.nebula.setSize(cssW * dpr, cssH * dpr);
    this.printingTrail.setSize(cssW, cssH);
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
    this.worldScale += (this.targetWorldScale - this.worldScale) * (1 - Math.exp(-dt * 2.2));
    this.nebula.setWorldScale(this.worldScale);
    this.coreGlow.setWorldScale(Math.min(1.25, this.worldScale));
    this.nebula.update(dt);

    this.billboards.update(
      dt, this.camera, this.rig.distance, store.state.hovered, store.state.selected,
    );
    this.labels.update(dt, this.camera, this.rig.distance);
    this.coreGlow.update(dt);
    this.eraMarkers.update(dt, this.camera);
    this.printingTrail.update(dt);

    const moving = this.rig.idleSeconds < 0.35 || this.starfield.isMorphing || this.rig.isCinematic;
    this.nebula.prepareFrame(this.camera, this.rig.distance, this.starfield.boundingRadius, moving);
    this.nebula.render(this.renderer, this.camera, time);
    if (store.state.cinematic && !this.rig.isCinematic) store.set('cinematic', false);
    this.post.composer.render(dt);

    // Re-pick when the camera moves, not only when the pointer does. The star
    // under a stationary cursor genuinely changes as you orbit, and this also
    // gives a dropped readback a natural second chance.
    if (this.pointerInside) {
      const pose = `${this.rig.distance.toFixed(1)}|${this.rig.target.x.toFixed(1)},${this.rig.target.y.toFixed(1)},${this.rig.target.z.toFixed(1)}|${this.camera.position.x.toFixed(1)},${this.camera.position.y.toFixed(1)},${this.camera.position.z.toFixed(1)}`;
      if (pose !== this.lastPickPose) {
        // Auto-rotate plus a pointer sitting over the canvas used to re-pick
        // every frame — a second 117k-vertex pass, scissored or not. Pointer
        // moves still pick immediately; camera-only picks settle at ~14 Hz.
        const now = performance.now();
        if (now - this.lastCameraPick > 100) {
          this.lastPickPose = pose;
          this.lastCameraPick = now;
          this.picker.request(this.lastPointer.x, this.lastPointer.y);
        }
      }
    }

    if (this.pointerInside) {
      const { cssW, cssH } = this.viewport();
      const billboard = this.billboards.hitTest(
        this.camera, this.lastPointer.x, this.lastPointer.y, cssW, cssH,
      );
      if (billboard >= 0) {
        if (billboard !== store.state.hovered) {
          store.set('hovered', billboard);
          this.starfield.material.uniforms.uHovered.value = billboard;
        }
      } else {
        this.picker.poll(this.renderer, this.camera, (index) => {
          const valid = index >= 0 && index < this.universe.count;
          const next = valid ? index : -1;
          if (next !== store.state.hovered) {
            store.set('hovered', next);
            this.starfield.material.uniforms.uHovered.value = next;
          }
        });
      }
    }

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
    if (this.pinnedTier) return;
    this.tierCooldown = Math.max(0, this.tierCooldown - elapsed);
    if (this.tierCooldown > 0) return;
    // A morph or a filter crossfade briefly costs extra; do not down-rank on it.
    if (this.starfield.isMorphing) return;

    if (fps < 42 && this.tier > 0) {
      // Drop proportionally to the shortfall. Stepping one level at a time with
      // a long cooldown meant that flying into the dense core — the single
      // heaviest thing you can do — took the better part of twenty seconds to
      // recover from, which is exactly when it is most noticeable.
      const deficit = 42 - fps;
      const steps = deficit > 16 ? 3 : deficit > 8 ? 2 : 1;
      this.tier = Math.max(0, this.tier - steps);
      this.tierCooldown = 1.6;
    } else if (fps > 58 && this.tier < TOP_TIER) {
      // Climbing back up stays deliberate, so a machine sitting near the
      // boundary settles instead of oscillating between two levels.
      this.tier++;
      this.tierCooldown = 9;
    } else {
      return;
    }
    this.applyQuality();
  }

  private applyQuality(): void {
    const level = QUALITY_LEVELS[this.tier];
    this.nebula.setQuality(level.nebulaScale, level.steps);
    if (level.renderScale !== this.renderScale) {
      this.renderScale = level.renderScale;
      this.resize();
    }
  }

  dispose(): void {
    this.stop();
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.rig.dispose();
    this.starfield.dispose();
    this.nebula.dispose();
    this.picker.dispose();
    this.billboards.dispose();
    this.labels.dispose();
    this.coreGlow.dispose();
    this.eraMarkers.dispose();
    this.printingTrail.dispose();
    this.post.dispose();
    this.renderer.dispose();
  }
}
