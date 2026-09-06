import * as THREE from 'three';
import { GALAXY_CORE, GALAXY_RADIUS, type LayoutContext } from '../layout/layouts.ts';
import type { LayoutMode } from '../core/store.ts';

interface Marker {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  world: THREE.Vector3;
}

/** Label texture dimensions; the sprite has to keep this aspect or it stretches. */
const LABEL_W = 320;
const LABEL_H = 64;
const LABEL_ASPECT = LABEL_H / LABEL_W;

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

    for (const era of eras) {
      const r = radiusOfYear(ctx, era.year);
      const tex = labelTexture(era.label);
      const material = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        opacity: 0.9,
      });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(70, 70 * LABEL_ASPECT, 1);
      sprite.position.set(r * 0.92, 28, r * 0.18);
      sprite.renderOrder = 20;
      this.group.add(sprite);
      this.markers.push({ sprite, material, world: sprite.position.clone() });
    }
  }

  setLayout(mode: LayoutMode): void {
    this.target = mode === 'galaxy' ? 1 : 0;
  }

  setEnabled(v: boolean): void { this.enabled = v; }

  update(dt: number, camera: THREE.PerspectiveCamera): void {
    this.opacity += (this.target - this.opacity) * (1 - Math.exp(-dt * 3));
    const show = this.enabled && this.opacity > 0.02;
    this.group.visible = show;
    if (!show) return;
    camera.getWorldPosition(this.camPos);
    for (const m of this.markers) {
      m.material.opacity = 0.82 * this.opacity;
      const d = m.world.distanceTo(this.camPos);
      const s = Math.max(28, Math.min(90, d * 0.08));
      m.sprite.scale.set(s, s * LABEL_ASPECT, 1);
    }
  }

  dispose(): void {
    for (const m of this.markers) {
      m.material.map?.dispose();
      m.material.dispose();
      this.group.remove(m.sprite);
    }
  }
}

function labelTexture(text: string): THREE.CanvasTexture {
  const w = LABEL_W;
  const h = LABEL_H;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  ctx.font = '600 28px ui-sans-serif, Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = 'rgba(220,230,245,0.92)';
  ctx.fillText(text.toUpperCase(), w / 2, h / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
