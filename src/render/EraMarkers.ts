import * as THREE from 'three';
import { GALAXY_CORE, GALAXY_RADIUS } from '../layout/layouts.ts';
import type { LayoutMode } from '../core/store.ts';
import type { Universe } from '../data/universe.ts';

interface Marker {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  world: THREE.Vector3;
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

  constructor(universe: Universe) {
    let yearMax = 1993;
    for (let i = 0; i < universe.count; i++) yearMax = Math.max(yearMax, universe.year[i]!);
    yearMax = Math.max(yearMax, new Date().getUTCFullYear());
    const yearMin = 1993;
    const now = new Date().getUTCFullYear();

    const eras: { label: string; year: number }[] = [
      { label: 'Alpha', year: 1993 },
      { label: 'Revised', year: 1994 },
      { label: 'Modern', year: 2003 },
      { label: String(now), year: now },
    ];

    for (const era of eras) {
      const t = (era.year - yearMin) / Math.max(1, yearMax - yearMin);
      const r = GALAXY_CORE + (GALAXY_RADIUS - GALAXY_CORE) * Math.sqrt(Math.max(0, Math.min(1, t)));
      const tex = labelTexture(era.label);
      const material = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        opacity: 0.9,
      });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(70, 70 * (64 / 320), 1);
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
      m.sprite.scale.set(s, s * 0.22, 1);
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
  const w = 320;
  const h = 64;
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
