import * as THREE from 'three';
import { GALAXY_CORE, GALAXY_RADIUS, type LayoutContext } from '../layout/layouts.ts';
import type { LayoutMode } from '../core/store.ts';

interface Marker {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  world: THREE.Vector3;
  ring: THREE.LineLoop;
  ringMaterial: THREE.LineBasicMaterial;
}

/** Label texture dimensions; the sprite has to keep this aspect or it stretches. */
const LABEL_W = 384;
const LABEL_H = 80;
const LABEL_ASPECT = LABEL_H / LABEL_W;
/** Constant screen size (sizeAttenuation off). Matches the star-name labels. */
const SCREEN_W = 0.145;
const SCREEN_H = SCREEN_W * LABEL_ASPECT;

/**
 * One spoke for every era label. Alpha and Revised used to share an azimuth
 * and stack; they now have a radial gap, so a single ruler-ray reads as ticks
 * on the radius-is-time axis instead of four names sprinkled around the disc.
 * 0.62 sits in the gap between white and blue.
 */
const SPOKE = 0.62;

/**
 * Radius of the ring holding the first card released in `year`.
 *
 * It has to be derived the way `layouts.ts::galaxy` derives a card's radius —
 * from `chronoRank`, a percentile over all 117,621 printings — and not from
 * the year's position between the first and last. Magic's print rate is
 * nowhere near flat: by linear year fraction the "Modern" marker landed at
 * r=190 while 2003's cards actually sit at r=129, nearly a fifth of the disc
 * radius out from the ring it was labelling.
 */
function radiusOfYear(ctx: LayoutContext, year: number): number {
  const { chronoOrder, chronoRank, universe } = ctx;
  let t = 1;
  for (let r = 0; r < chronoOrder.length; r++) {
    const i = chronoOrder[r]!;
    if (universe.year[i]! >= year) { t = chronoRank[i]!; break; }
  }
  return GALAXY_CORE + (GALAXY_RADIUS - GALAXY_CORE) * Math.sqrt(Math.max(0, Math.min(1, t)));
}

/**
 * Named eras sitting in the disc so the radius-is-time reading has landmarks.
 * Only drawn in layouts where radius still means time.
 */
export class EraMarkers {
  readonly group = new THREE.Group();
  private readonly markers: Marker[] = [];
  private readonly camPos = new THREE.Vector3();
  private enabled = true;
  private opacity = 1;
  private target = 1;

  constructor(ctx: LayoutContext) {
    // The catalogue's own last year, not the wall clock. Once the runtime year
    // passes the year the data was built, a `new Date()` label names a ring
    // that has no cards on it and every marker drifts against the stars.
    const last = ctx.yearMax;

    const eras: { label: string; year: number }[] = [
      { label: 'Alpha', year: 1993 },
      { label: 'Revised', year: 1994 },
      { label: 'Modern', year: 2003 },
      { label: String(last), year: last },
    ];

    const MIN_GAP = 78;
    let lastR = -Infinity;
    for (let i = 0; i < eras.length; i++) {
      const era = eras[i]!;
      let r = radiusOfYear(ctx, era.year);
      if (r - lastR < MIN_GAP) r = lastR + MIN_GAP;
      lastR = r;

      const tex = labelTexture(era.label);
      const material = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        opacity: 0.9,
        sizeAttenuation: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(SCREEN_W, SCREEN_H, 1);
      // Alternate sides of the spoke so Alpha/Revised never sit on top of
      // each other once the labels are large enough to read from the frame.
      const a = SPOKE + (i % 2 === 0 ? -0.16 : 0.16);
      sprite.position.set(r * Math.cos(a), 26, r * Math.sin(a));
      sprite.renderOrder = 20;
      this.group.add(sprite);

      const { line, material: ringMaterial } = makeRing(r);
      this.group.add(line);
      this.markers.push({
        sprite,
        material,
        world: sprite.position.clone(),
        ring: line,
        ringMaterial,
      });
    }
  }

  setLayout(mode: LayoutMode): void {
    this.target = mode === 'galaxy' ? 1 : 0;
  }

  setEnabled(v: boolean): void { this.enabled = v; }

  update(dt: number, camera: THREE.PerspectiveCamera, orbitDistance = 800): void {
    this.opacity += (this.target - this.opacity) * (1 - Math.exp(-dt * 3));
    const show = this.enabled && this.opacity > 0.02;
    this.group.visible = show;
    if (!show) return;
    camera.getWorldPosition(this.camPos);
    // Rings are the framed-view landmark; up close they become huge circles
    // through the camera and read as a glitch. Labels stay, a bit quieter.
    const ringFade = smoothstep(200, 380, orbitDistance);
    const labelFade = 0.45 + 0.55 * smoothstep(80, 200, orbitDistance);
    for (const m of this.markers) {
      m.material.opacity = 0.92 * this.opacity * labelFade;
      m.ringMaterial.opacity = 0.20 * this.opacity * ringFade;
      m.ring.visible = ringFade > 0.02;
      m.sprite.scale.set(SCREEN_W, SCREEN_H, 1);
    }
  }

  dispose(): void {
    for (const m of this.markers) {
      m.material.map?.dispose();
      m.material.dispose();
      this.group.remove(m.sprite);
      m.ring.geometry.dispose();
      m.ringMaterial.dispose();
      this.group.remove(m.ring);
    }
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function makeRing(radius: number): { line: THREE.LineLoop; material: THREE.LineBasicMaterial } {
  const segs = 160;
  const pos = new Float32Array(segs * 3);
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    pos[i * 3] = Math.cos(a) * radius;
    pos[i * 3 + 1] = 0;
    pos[i * 3 + 2] = Math.sin(a) * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const material = new THREE.LineBasicMaterial({
    color: 0x9bb8e0,
    transparent: true,
    opacity: 0.2,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const line = new THREE.LineLoop(geometry, material);
  line.frustumCulled = false;
  line.renderOrder = 8;
  return { line, material };
}

function labelTexture(text: string): THREE.CanvasTexture {
  const w = LABEL_W;
  const h = LABEL_H;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  ctx.font = '600 40px ui-sans-serif, Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(2, 4, 10, 0.92)';
  ctx.lineWidth = 10;
  ctx.strokeText(text.toUpperCase(), w / 2, h / 2);
  ctx.fillStyle = 'rgba(232, 242, 255, 0.96)';
  ctx.fillText(text.toUpperCase(), w / 2, h / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
