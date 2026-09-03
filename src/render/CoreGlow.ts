import * as THREE from 'three';

/**
 * The galactic nucleus.
 *
 * Real spirals have a bright bulge, and this one has a reason to: the core is
 * where Alpha, Beta and Unlimited sit, so the oldest cards in the game are
 * literally the light the rest of the galaxy is wound around. The volumetric
 * pass has a bulge term, but tuning it bright enough to read costs density
 * everywhere else — a few additive sprites give the same effect for three draw
 * calls and no marching.
 */

interface Layer {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  baseScale: number;
  baseOpacity: number;
  /** Radians per second; the layers counter-rotate so the core never looks static. */
  spin: number;
}

export class CoreGlow {
  readonly group = new THREE.Group();

  private readonly layers: Layer[] = [];
  private readonly texture: THREE.Texture;
  private strength = 1;
  private target = 1;
  private time = 0;

  constructor() {
    this.texture = radialTexture(256);

    const specs = [
      { scale: 210, opacity: 0.30, color: 0xffe6b8, spin: 0.020 },
      { scale: 120, opacity: 0.34, color: 0xfff1d4, spin: -0.031 },
      { scale: 54, opacity: 0.42, color: 0xffffff, spin: 0.047 },
    ];

    for (const spec of specs) {
      const material = new THREE.SpriteMaterial({
        map: this.texture,
        color: new THREE.Color(spec.color),
        transparent: true,
        opacity: spec.opacity,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(material);
      sprite.scale.setScalar(spec.scale);
      // Behind the stars, in front of the nebula composite.
      sprite.renderOrder = -500;
      this.group.add(sprite);
      this.layers.push({
        sprite, material, baseScale: spec.scale, baseOpacity: spec.opacity, spin: spec.spin,
      });
    }
  }

  /** Eased, so it does not pop when the layout changes. */
  setStrength(v: number): void { this.target = v; }

  update(dt: number): void {
    this.time += dt;
    this.strength += (this.target - this.strength) * (1 - Math.exp(-dt * 2.2));

    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i];
      layer.material.opacity = layer.baseOpacity * this.strength;
      layer.sprite.visible = this.strength > 0.01;
      // A slow breath keeps it alive without reading as a flicker. The rate is
      // per-layer and deliberate — deriving it from `spin` made the period
      // around ninety seconds, which is indistinguishable from static.
      const breathe = 1 + Math.sin(this.time * (0.34 + i * 0.11) + i * 2.1) * 0.028;
      layer.sprite.scale.setScalar(layer.baseScale * breathe);
      layer.sprite.material.rotation = this.time * layer.spin;
    }
  }

  dispose(): void {
    this.texture.dispose();
    for (const layer of this.layers) {
      layer.material.dispose();
      this.group.remove(layer.sprite);
    }
  }
}

/** Soft radial falloff, baked once. */
function radialTexture(size: number): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // Deliberately steep: a linear falloff reads as a flat disc rather than a glow.
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.62)');
  g.addColorStop(0.32, 'rgba(255,255,255,0.20)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.045)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
