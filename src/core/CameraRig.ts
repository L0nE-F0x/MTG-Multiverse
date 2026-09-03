import * as THREE from 'three';

/**
 * Orbit rig with inertia.
 *
 * Not OrbitControls: the feel of moving through this thing matters more than
 * almost anything else, and the stock controls snap to their goal every frame.
 * Everything here is a damped spring toward a goal value, integrated with an
 * exponential so the smoothing is identical at 30fps and 240fps.
 */

const EPS = 1e-5;
const MIN_PHI = 0.02;
const MAX_PHI = Math.PI - 0.02;

/** Frame-rate independent approach: fraction of the remaining gap to close. */
const approach = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly target = new THREE.Vector3();

  minRadius = 3;
  maxRadius = 4200;
  autoRotate = false;
  autoRotateSpeed = 0.028;

  private readonly element: HTMLElement;
  private readonly goalTarget = new THREE.Vector3();

  private theta = Math.PI * 0.25;
  private phi = Math.PI * 0.34;
  private radius = 900;
  private goalTheta = this.theta;
  private goalPhi = this.phi;
  private goalRadius = this.radius;

  /** Raised briefly during a scripted flight, then relaxed back. */
  private damping = 6.5;
  private goalDamping = 6.5;

  private dragging: 'orbit' | 'pan' | null = null;
  private lastX = 0;
  private lastY = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  private idleSince = performance.now();
  private disposers: (() => void)[] = [];

  constructor(camera: THREE.PerspectiveCamera, element: HTMLElement) {
    this.camera = camera;
    this.element = element;
    this.bind();
    this.applyImmediate();
  }

  /** Seconds since the user last interacted — drives idle auto-rotation. */
  get idleSeconds(): number { return (performance.now() - this.idleSince) / 1000; }

  private bind(): void {
    const el = this.element;
    const on = <K extends keyof HTMLElementEventMap>(
      type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions,
    ) => {
      el.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => el.removeEventListener(type, fn as EventListener));
    };

    on('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.poke();
      if (this.pointers.size === 1) {
        this.dragging = e.button === 2 || e.button === 1 || e.shiftKey ? 'pan' : 'orbit';
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      } else if (this.pointers.size === 2) {
        this.dragging = null;
        this.pinchDistance = this.currentPinch();
      }
    });

    on('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (p) { p.x = e.clientX; p.y = e.clientY; }

      if (this.pointers.size === 2) {
        const d = this.currentPinch();
        if (this.pinchDistance > 0 && d > 0) {
          this.dolly(Math.pow(this.pinchDistance / d, 1.6));
        }
        this.pinchDistance = d;
        this.poke();
        return;
      }
      if (!this.dragging) return;

      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.poke();

      if (this.dragging === 'orbit') {
        // Scale by viewport height so a drag across the screen always sweeps
        // the same angle regardless of window size.
        const k = 2.6 / el.clientHeight;
        this.goalTheta -= dx * k;
        this.goalPhi = clamp(this.goalPhi - dy * k, MIN_PHI, MAX_PHI);
      } else {
        this.pan(dx, dy);
      }
    });

    const end = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchDistance = 0;
      if (this.pointers.size === 0) this.dragging = null;
    };
    on('pointerup', end);
    on('pointercancel', end);
    on('lostpointercapture', end);

    on('wheel', (e) => {
      e.preventDefault();
      this.poke();
      // Normalise across the three deltaMode units browsers report.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      this.dolly(Math.exp(e.deltaY * unit * 0.0011));
    }, { passive: false });

    on('contextmenu', (e) => e.preventDefault());
    on('dblclick', () => this.poke());
  }

  private currentPinch(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private poke(): void { this.idleSince = performance.now(); }

  private dolly(factor: number): void {
    this.goalRadius = clamp(this.goalRadius * factor, this.minRadius, this.maxRadius);
  }

  private pan(dx: number, dy: number): void {
    // Pan speed scales with distance so the world moves the same number of
    // pixels under the cursor whether you are at the rim or inside the core.
    const scale = (2 * this.radius * Math.tan((this.camera.fov * Math.PI) / 360)) / this.element.clientHeight;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    this.goalTarget.addScaledVector(right, -dx * scale);
    this.goalTarget.addScaledVector(up, dy * scale);
  }

  /** Move the orbit centre to `point` and settle at `distance`. */
  flyTo(point: THREE.Vector3, distance: number, snappy = false): void {
    this.goalTarget.copy(point);
    this.goalRadius = clamp(distance, this.minRadius, this.maxRadius);
    this.damping = snappy ? 9 : 2.6;
    this.goalDamping = 6.5;
    this.poke();
  }

  /** Reframe the whole scene without changing viewing angle. */
  frame(distance: number): void {
    this.flyTo(new THREE.Vector3(0, 0, 0), distance);
  }

  /** Reframe elevation only, leaving the user's chosen heading alone. */
  setPhi(phi: number): void {
    this.goalPhi = clamp(phi, MIN_PHI, MAX_PHI);
  }

  setAngles(theta: number, phi: number): void {
    this.goalTheta = theta;
    this.goalPhi = clamp(phi, MIN_PHI, MAX_PHI);
  }

  update(dt: number): void {
    if (this.autoRotate && !this.dragging && this.idleSeconds > 2.5) {
      this.goalTheta += this.autoRotateSpeed * dt;
    }

    this.damping += (this.goalDamping - this.damping) * approach(dt, 1.4);
    const k = approach(dt, this.damping);

    this.theta += (this.goalTheta - this.theta) * k;
    this.phi += (this.goalPhi - this.phi) * k;
    this.radius += (this.goalRadius - this.radius) * k;
    this.target.lerp(this.goalTarget, k);

    this.applyImmediate();
  }

  private applyImmediate(): void {
    const sinPhi = Math.max(EPS, Math.sin(this.phi));
    this.camera.position.set(
      this.target.x + this.radius * sinPhi * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * sinPhi * Math.cos(this.theta),
    );
    this.camera.lookAt(this.target);
    // Near/far track the orbit distance: a fixed near plane either z-fights at
    // the rim or clips the core when you fly inside it.
    this.camera.near = Math.max(0.1, this.radius * 0.002);
    this.camera.far = Math.max(4000, this.radius * 6 + 2500);
    this.camera.updateProjectionMatrix();
  }

  get distance(): number { return this.radius; }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
