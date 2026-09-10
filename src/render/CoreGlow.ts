import * as THREE from 'three';

/**
 * The galactic nucleus.
 *
 * Real spirals have a bright bulge, and this one has a reason to: the core is
 * where Alpha, Beta and Unlimited sit, so the oldest cards in the game are
 * literally the light the rest of the galaxy is wound around. The volumetric
 * pass has a bulge term, but tuning it bright enough to read costs density
 * everywhere else — a few additive sprites give the same effect for four draw
 * calls and no marching.
 *
 * Two things stop it from being a white blob:
 *
 *  - **The layers are a colour temperature ramp, not one colour at four
 *    sizes.** Additive blending sums them, so a wide amber layer under a narrow
 *    near-white one produces a hot white centre that grades out through gold to
 *    a dust-coloured halo on its own. Four copies of the same cream sprite can
 *    only ever produce cream.
 *  - **The bulge is flattened to the disc.** A camera-facing sprite is a circle
 *    from every angle, which reads as a lens artefact pasted over the galaxy
 *    rather than a body sitting in it. Squashing it by the camera's elevation
 *    makes it an ellipse that closes up as you drop to the disc plane, exactly
 *    as the disc around it does.
 */

interface Layer {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  baseScale: number;
  baseOpacity: number;
  /** Radians per second; the layers counter-rotate so the core never looks static. */
  spin: number;
  /** 0 = stays circular (the glare), 1 = flattens fully with the disc. */
  flatten: number;
}

export class CoreGlow {
  readonly group = new THREE.Group();

  private readonly layers: Layer[] = [];
  private readonly texture: THREE.Texture;
  private readonly glareTexture: THREE.Texture;
  private strength = 1;
  private target = 1;
  private time = 0;
  private worldScale = 1;
  /** Vertical squash from the camera's elevation, eased so orbiting is smooth. */
  private squash = 1;
  /** How point-like the nucleus is from here: 1 far away, 0 once you are in it. */
  private pointness = 1;
  private readonly viewDir = new THREE.Vector3();
  private readonly here = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private glareDist = 600;

  constructor() {
    this.texture = radialTexture(256);
    this.glareTexture = glareTexture(256);

    const specs = [
      // Widest and coolest: the dust-lit outskirts of the bulge.
      { scale: 214, opacity: 0.15, color: 0xff8a3c, spin: 0.020, flatten: 1, glare: false },
      { scale: 124, opacity: 0.21, color: 0xffc070, spin: -0.031, flatten: 1, glare: false },
      { scale: 58, opacity: 0.30, color: 0xffe9c2, spin: 0.047, flatten: 0.72, glare: false },
      // The hot centre. Small and bright, so bloom picks it up as a highlight
      // rather than smearing the whole bulge into a sheet.
      { scale: 21, opacity: 0.46, color: 0xfffaf0, spin: -0.062, flatten: 0.35, glare: false },
      // Diffraction glare. Screen-aligned and very faint; it is the thing that
      // says "this is bright" without adding any more area to the blob.
          { scale: 0.40, opacity: 0.30, color: 0xffd9a8, spin: 0.006, flatten: 0, glare: true },
    ];

    for (const spec of specs) {
      const material = new THREE.SpriteMaterial({
        map: spec.glare ? this.glareTexture : this.texture,
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
        sprite,
        material,
        baseScale: spec.scale,
        baseOpacity: spec.opacity,
        spin: spec.spin,
        flatten: spec.flatten,
      });
    }
  }

  /** Eased, so it does not pop when the layout changes. */
  setStrength(v: number): void { this.target = v; }

  /** Uniform scale relative to the galaxy layout (1 = galaxy). */
  setWorldScale(v: number): void { this.worldScale = Math.max(0.05, v); }

  update(dt: number, camera?: THREE.Camera): void {
    this.time += dt;
    this.strength += (this.target - this.strength) * (1 - Math.exp(-dt * 2.2));

    if (camera) {
      camera.getWorldDirection(this.viewDir);
      // |y| of the view direction is the sine of the camera's elevation above
      // the disc, which is exactly the foreshortening the disc itself gets.
      // Floored well short of zero: a bulge that collapses to a line edge-on is
      // physically right and visually a bug report.
      const want = 0.34 + 0.66 * Math.abs(this.viewDir.y);
      this.squash += (want - this.squash) * (1 - Math.exp(-dt * 3.4));

      // A glare is a property of the lens, not of the galaxy, so it belongs at
      // a fixed size on screen and it only exists while its source is small
      // enough to count as a point. Left as a world-scaled sprite it grew into
      // an eight-pointed star across the whole frame as you flew in, which is
      // the one place a real one would have disappeared.
      this.group.getWorldPosition(this.here);
      const camDist = camera.getWorldPosition(this.scratch).distanceTo(this.here);
      this.glareDist = camDist;
      this.pointness = THREE.MathUtils.clamp(
        (camDist - 130 * this.worldScale) / (430 * this.worldScale), 0, 1,
      );
    }

    for (let i = 0; i < this.layers.length; i++) {
      const layer = this.layers[i];
      layer.sprite.visible = this.strength > 0.01;
      // Slow breath on scale and opacity — readable as living, not a flicker.
      const breathe = 1 + Math.sin(this.time * (0.38 + i * 0.11) + i * 2.1) * 0.075;
      const pulse = 1 + Math.sin(this.time * 0.31 + i) * 0.08;
      // The glare's "scale" is a fraction of the camera distance, so it holds
      // the same angular size; every other layer is in world units.
      const glare = layer.flatten === 0;
      const s = glare
        ? layer.baseScale * this.glareDist * breathe
        : layer.baseScale * this.worldScale * breathe;
      const fade = glare ? this.pointness * this.pointness : 1;
      layer.material.opacity = layer.baseOpacity * this.strength * pulse * fade;
      layer.sprite.visible = layer.sprite.visible && fade > 0.004;
      layer.sprite.scale.set(s, s * (1 - layer.flatten * (1 - this.squash)), 1);
      layer.sprite.material.rotation = this.time * layer.spin;
    }
  }

  dispose(): void {
    this.texture.dispose();
    this.glareTexture.dispose();
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

/**
 * Diffraction glare, built from the same profile the star fragment shader uses
 * for its spikes so the nucleus and the giants around it agree about what a
 * bright highlight looks like.
 *
 * Drawn per-pixel rather than as canvas geometry: a filled diamond has a hard
 * linear edge across the bar, which at a third of the screen wide is plainly a
 * drawn shape. A gaussian cross-section has no edge to find.
 */
function glareTexture(size: number): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const inv = 2 / size;

  for (let y = 0; y < size; y++) {
    const uy = (y + 0.5) * inv - 1;
    for (let x = 0; x < size; x++) {
      const ux = (x + 0.5) * inv - 1;
      const ax = Math.abs(ux);
      const ay = Math.abs(uy);
      const h = Math.exp(-ay * ay * 340) * Math.exp(-ax * 2.6);
      const v = Math.exp(-ax * ax * 340) * Math.exp(-ay * 2.6);
      const dx = Math.abs((ux + uy) * 0.7071);
      const dy = Math.abs((ux - uy) * 0.7071);
      const d1 = Math.exp(-dx * dx * 900) * Math.exp(-dy * 3.4);
      const d2 = Math.exp(-dy * dy * 900) * Math.exp(-dx * 3.4);
      const a = Math.min(1, h + v * 0.78 + (d1 + d2) * 0.3);
      const o = (y * size + x) * 4;
      img.data[o] = 255;
      img.data[o + 1] = 255;
      img.data[o + 2] = 255;
      img.data[o + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
