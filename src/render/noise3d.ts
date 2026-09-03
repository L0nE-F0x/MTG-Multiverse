import * as THREE from 'three';

/**
 * A tileable 3D value-noise volume, baked once at startup.
 *
 * The nebula raymarcher needs four noise octaves per sample and does that up to
 * 96 times per pixel. Evaluating noise analytically at that rate costs more than
 * the rest of the frame put together, so the octaves are pre-baked into a
 * volume and the GPU's trilinear filter does the interpolation for free.
 */

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Deterministic lattice value in [0,1), wrapping at `period` so the result tiles. */
function lattice(x: number, y: number, z: number, period: number, seed: number): number {
  const xi = ((x % period) + period) % period;
  const yi = ((y % period) + period) % period;
  const zi = ((z % period) + period) % period;
  let h = Math.imul(xi + 1, 0x27d4eb2d) ^ Math.imul(yi + 1, 0x165667b1) ^ Math.imul(zi + 1, 0x9e3779b9) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, z: number, period: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const fx = fade(x - x0), fy = fade(y - y0), fz = fade(z - z0);

  const c000 = lattice(x0, y0, z0, period, seed);
  const c100 = lattice(x0 + 1, y0, z0, period, seed);
  const c010 = lattice(x0, y0 + 1, z0, period, seed);
  const c110 = lattice(x0 + 1, y0 + 1, z0, period, seed);
  const c001 = lattice(x0, y0, z0 + 1, period, seed);
  const c101 = lattice(x0 + 1, y0, z0 + 1, period, seed);
  const c011 = lattice(x0, y0 + 1, z0 + 1, period, seed);
  const c111 = lattice(x0 + 1, y0 + 1, z0 + 1, period, seed);

  const x00 = c000 + (c100 - c000) * fx;
  const x10 = c010 + (c110 - c010) * fx;
  const x01 = c001 + (c101 - c001) * fx;
  const x11 = c011 + (c111 - c011) * fx;
  const y0i = x00 + (x10 - x00) * fy;
  const y1i = x01 + (x11 - x01) * fy;
  return y0i + (y1i - y0i) * fz;
}

export function createNoiseVolume(size = 64): THREE.Data3DTexture {
  const data = new Uint8Array(size * size * size);

  // Deliberately ONE octave.
  //
  // Baking several octaves in here was a mistake: the shader already builds its
  // fbm from four fetches at 1x/2x/4x/8x, so a pre-summed texture gave roughly
  // sixteen octaves of averaging. The result had almost no variance — every
  // sample sat near 0.5 — which is why the nebula read as soft cotton and why
  // ridged noise, which keys off the distance from the field's midpoint, had
  // nothing to bite on. A single octave restores the dynamic range the shader
  // expects to work with.
  const PERIOD = 8;
  const scale = PERIOD / size;

  let i = 0;
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = valueNoise(x * scale, y * scale, z * scale, PERIOD, 13);
        data[i++] = Math.max(0, Math.min(255, Math.round(v * 255)));
      }
    }
  }

  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}
