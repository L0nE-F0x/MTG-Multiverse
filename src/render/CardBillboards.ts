import * as THREE from 'three';
import type { Universe } from '../data/universe.ts';
import type { Starfield } from './Starfield.ts';

/**
 * Real card art, rendered in space.
 *
 * Fly close enough to a star and the card it represents materialises there as a
 * billboard. The density makes showing everything impossible — the galaxy disc
 * carries roughly a third of a card per square unit, so a 70-unit radius covers
 * thousands — so the pool is small and candidates are ranked by popularity.
 * That turns the constraint into the feature: the cards that reveal themselves
 * as you move are the ones you would actually recognise.
 */

const MAX_VISIBLE = 48;
/** Textures kept alive after they leave view, so backing up re-shows instantly. */
const TEXTURE_CACHE = 180;
const MAX_CONCURRENT_LOADS = 6;
const RESELECT_SECONDS = 0.18;
const FADE_SECONDS = 0.4;

/** Card aspect: Scryfall "small" is 146x204. */
const CARD_W = 6;
const CARD_H = CARD_W * (204 / 146);

/** Beyond this orbit distance the galaxy reads as a whole and cards are noise. */
const ENABLE_DISTANCE = 240;

interface Slot {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  card: number;
  /** Whether the latest selection still wants this card. See StarLabels. */
  wanted: boolean;
  /** 0..1, eased toward `targetOpacity`. */
  opacity: number;
  targetOpacity: number;
}

export class CardBillboards {
  readonly group = new THREE.Group();

  private readonly slots: Slot[] = [];
  private readonly textures = new Map<number, THREE.Texture>();
  private readonly failed = new Set<number>();
  private readonly loading = new Set<number>();
  private readonly loader = new THREE.TextureLoader();
  private readonly camPos = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();

  /** Scratch for candidate selection, reused to avoid per-frame allocation. */
  private readonly candIdx = new Int32Array(MAX_VISIBLE);
  private readonly candScore = new Float32Array(MAX_VISIBLE);
  private candCount = 0;

  private sinceSelect = RESELECT_SECONDS;
  private enabled = true;

  constructor(
    private readonly universe: Universe,
    private readonly starfield: Starfield,
    /** Live reference to the filter mask; mutated in place by the app. */
    private readonly mask: Uint8Array,
  ) {
    this.loader.setCrossOrigin('anonymous');

    for (let i = 0; i < MAX_VISIBLE; i++) {
      const material = new THREE.SpriteMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
        // The post chain applies ACES after this, which would otherwise crush
        // already-LDR card art to something muddy. Pre-boosting past 1.0 lands
        // it back near its true brightness once the curve has been applied.
        color: new THREE.Color(1.75, 1.75, 1.75),
      });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(CARD_W, CARD_H, 1);
      sprite.visible = false;
      sprite.renderOrder = 20; // above the additive starfield
      this.group.add(sprite);
      this.slots.push({ sprite, material, card: -1, wanted: false, opacity: 0, targetOpacity: 0 });
    }
    this.group.renderOrder = 20;
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) for (const s of this.slots) s.targetOpacity = 0;
  }

  /**
   * Hit-test the visible card art. GPU picking only sees the star sprite, so
   * clicking the face of a billboard used to miss. 48 sprites is cheap.
   *
   * `px`/`py` are CSS pixels from the canvas top-left.
   */
  hitTest(camera: THREE.PerspectiveCamera, px: number, py: number, cssW: number, cssH: number): number {
    this.ndc.set((px / cssW) * 2 - 1, -(py / cssH) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, camera);
    let best = -1;
    let bestDist = Infinity;
    for (const slot of this.slots) {
      if (!slot.sprite.visible || slot.opacity < 0.12 || slot.card < 0) continue;
      const hits = this.raycaster.intersectObject(slot.sprite, false);
      if (hits.length > 0 && hits[0]!.distance < bestDist) {
        bestDist = hits[0]!.distance;
        best = slot.card;
      }
    }
    return best;
  }

  update(
    dt: number,
    camera: THREE.PerspectiveCamera,
    orbitDistance: number,
    hovered: number,
    selected: number,
  ): void {
    const active = this.enabled && orbitDistance < ENABLE_DISTANCE;
    camera.getWorldPosition(this.camPos);

    this.sinceSelect += dt;
    if (this.sinceSelect >= RESELECT_SECONDS) {
      this.sinceSelect = 0;
      if (active) this.select(orbitDistance, hovered, selected);
      else this.candCount = 0;
      this.assign();
    }

    // Radius has to match what select() used, or opacity and membership
    // disagree and cards pop in already faded.
    const radius = this.radiusFor(orbitDistance);
    const fadeStart = radius * 0.62;

    for (const slot of this.slots) {
      if (slot.card >= 0 && active && slot.wanted) {
        this.starfield.positionOf(slot.card, this.tmp);
        slot.sprite.position.copy(this.tmp);
        const d = this.tmp.distanceTo(this.camPos);
        const pinned = slot.card === hovered || slot.card === selected;
        slot.targetOpacity = pinned
          ? 1
          : 1 - THREE.MathUtils.smoothstep(d, fadeStart, radius);
        // Whatever the cursor or the panel is on reads as the subject.
        const scale = pinned ? 1.6 : 1;
        slot.sprite.scale.set(CARD_W * scale, CARD_H * scale, 1);
      } else {
        slot.targetOpacity = 0;
      }

      // Frame-rate independent ease, same approach as the camera rig.
      const k = 1 - Math.exp(-dt / (FADE_SECONDS / 4));
      slot.opacity += (slot.targetOpacity - slot.opacity) * k;
      slot.material.opacity = slot.opacity;
      slot.sprite.visible = slot.opacity > 0.004 && slot.material.map !== null;

      // Release the slot once it has fully faded, so it can take a new card.
      if (slot.opacity <= 0.004 && slot.targetOpacity === 0 && slot.card >= 0) {
        slot.card = -1;
        slot.wanted = false;
        slot.material.map = null;
      }
    }
  }

  private radiusFor(orbitDistance: number): number {
    return THREE.MathUtils.clamp(orbitDistance * 1.9, 42, 190);
  }

  /**
   * Fill the candidate list with the highest-scoring cards inside the radius.
   *
   * A full sort of 117k every tick would be wasteful, so this keeps a small
   * ordered list and tracks the current cut-off: once the list is full, the vast
   * majority of cards fail a single float comparison and cost nothing more.
   */
  private select(orbitDistance: number, hovered: number, selected: number): void {
    const n = this.universe.count;
    const pop = this.universe.col.popularity;
    const mask = this.mask;
    const radius = this.radiusFor(orbitDistance);
    const r2 = radius * radius;
    const cx = this.camPos.x, cy = this.camPos.y, cz = this.camPos.z;

    this.candCount = 0;
    let worst = -Infinity;

    // Flat buffer walk: a Vector3 round-trip per card costs more than the whole
    // rest of this loop at 117k iterations.
    const { a, b, morph } = this.starfield.positionBuffers;

    for (let i = 0; i < n; i++) {
      if (mask[i] === 0) continue;
      const o = i * 3;
      const px = a[o] + (b[o] - a[o]) * morph;
      const py = a[o + 1] + (b[o + 1] - a[o + 1]) * morph;
      const pz = a[o + 2] + (b[o + 2] - a[o + 2]) * morph;
      const dx = px - cx, dy = py - cy, dz = pz - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      if (this.failed.has(i)) continue;

      // Popularity dominates so recognisable cards surface first, with a mild
      // proximity term to stop distant famous cards outranking what is in
      // front of you.
      const score = pop[i] / 65535 + (1 - d2 / r2) * 0.35;
      if (this.candCount === MAX_VISIBLE && score <= worst) continue;
      this.insert(i, score);
      worst = this.candScore[this.candCount - 1];
    }

    // Whatever the cursor or the panel is on always earns a slot.
    for (const pinned of [hovered, selected]) {
      if (pinned >= 0 && !this.failed.has(pinned) && !this.candContains(pinned)) {
        this.insert(pinned, Infinity);
      }
    }
  }

  private candContains(card: number): boolean {
    for (let i = 0; i < this.candCount; i++) if (this.candIdx[i] === card) return true;
    return false;
  }

  /** Insert into the descending-score list, dropping the tail when full. */
  private insert(card: number, score: number): void {
    let at = this.candCount;
    while (at > 0 && this.candScore[at - 1] < score) at--;
    if (at >= MAX_VISIBLE) return;

    const end = Math.min(this.candCount, MAX_VISIBLE - 1);
    for (let i = end; i > at; i--) {
      this.candIdx[i] = this.candIdx[i - 1];
      this.candScore[i] = this.candScore[i - 1];
    }
    this.candIdx[at] = card;
    this.candScore[at] = score;
    if (this.candCount < MAX_VISIBLE) this.candCount++;
  }

  /** Bind candidates to slots, keeping cards that are already on screen put. */
  private assign(): void {
    // Cap each distinct card at one billboard. Popular cards have dozens of
    // printings clustered by era, so the unfiltered ranking happily fills the
    // pool with the same art repeated.
    const oracle = this.universe.col.oracleIdx;
    const seenOracle = new Set<number>();
    const wanted = new Set<number>();
    for (let i = 0; i < this.candCount; i++) {
      const card = this.candIdx[i];
      const o = oracle[card];
      if (seenOracle.has(o)) continue;
      seenOracle.add(o);
      wanted.add(card);
    }

    // Slots showing a card that is still wanted keep it — reassigning would
    // make cards flicker between positions as the ranking shuffles.
    const held = new Set<number>();
    for (const slot of this.slots) {
      slot.wanted = slot.card >= 0 && wanted.has(slot.card);
      if (slot.wanted) held.add(slot.card);
    }

    // Free slots are collected up front rather than re-scanned per candidate.
    // Scanning for `opacity <= 0.004` inside the loop was a bug: a slot
    // assigned earlier in this same pass still has zero opacity, so it matched
    // again and every subsequent candidate overwrote the previous one. Only the
    // last card of each batch survived, which is why most of the pool sat idle.
    const free: Slot[] = [];
    for (const slot of this.slots) if (slot.card < 0) free.push(slot);

    for (let i = 0; i < this.candCount && free.length > 0; i++) {
      const card = this.candIdx[i];
      if (!wanted.has(card) || held.has(card)) continue;
      const tex = this.texture(card);
      if (!tex) continue; // still loading; a later tick will pick it up
      const slot = free.pop()!;
      slot.card = card;
      slot.wanted = true;
      slot.opacity = 0;
      slot.material.map = tex;
      slot.material.needsUpdate = true;
      held.add(card);
    }
  }

  /** Cached texture for a card, kicking off a load on first request. */
  private texture(card: number): THREE.Texture | null {
    const cached = this.textures.get(card);
    if (cached) {
      // Refresh LRU position.
      this.textures.delete(card);
      this.textures.set(card, cached);
      return cached;
    }
    if (this.loading.size < MAX_CONCURRENT_LOADS && !this.loading.has(card)) {
      this.load(card);
    }
    return null;
  }

  private load(card: number): void {
    this.loading.add(card);
    this.loader.load(
      this.universe.image(card, 'small'),
      (tex) => {
        this.loading.delete(card);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.anisotropy = 4;
        this.textures.set(card, tex);
        this.evict();
      },
      undefined,
      () => {
        // Missing art (placeholder printings, some tokens). Do not retry.
        this.loading.delete(card);
        this.failed.add(card);
      },
    );
  }

  private evict(): void {
    if (this.textures.size <= TEXTURE_CACHE) return;
    const live = new Set<number>();
    for (const s of this.slots) if (s.card >= 0) live.add(s.card);

    for (const [card, tex] of this.textures) {
      if (this.textures.size <= TEXTURE_CACHE) break;
      if (live.has(card)) continue; // never evict something on screen
      tex.dispose();
      this.textures.delete(card);
    }
  }

  dispose(): void {
    for (const slot of this.slots) {
      slot.material.dispose();
      this.group.remove(slot.sprite);
    }
    for (const tex of this.textures.values()) tex.dispose();
    this.textures.clear();
  }
}
