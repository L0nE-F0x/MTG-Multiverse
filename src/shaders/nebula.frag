#include ./lib/common.glsl

precision highp float;
precision highp sampler3D;

uniform vec3      uCamPos;
uniform float     uTime;
uniform float     uIntensity;
uniform float     uSteps;
uniform float     uNoiseScale;
uniform float     uDensity;
uniform float     uWarp;
uniform float     uStarfield;
uniform vec2      uResolution;
uniform sampler3D uNoise;

varying vec3 vRay;

layout(location = 0) out vec4 fragColor;

const float R_OUT = 400.0;
const float H_OUT = 120.0;

float n1(vec3 p) { return texture(uNoise, p).r; }

float fbm(vec3 p) {
  float f = 0.5000 * texture(uNoise, p).r;
  f     += 0.2500 * texture(uNoise, p * 2.03 + 0.31).r;
  f     += 0.1250 * texture(uNoise, p * 4.01 + 0.77).r;
  f     += 0.0625 * texture(uNoise, p * 8.05 + 0.13).r;
  return f * 1.0667;
}

/**
 * Domain warp: displace the sample point by a low-frequency noise vector before
 * evaluating the cloud. This is what turns isotropic blobs into the stretched,
 * curdled shapes real nebulae have — plain fbm has no directionality at all.
 * Three single-octave fetches, deliberately cheap; the warp only needs to be
 * smooth, not detailed.
 */
vec3 warpOf(vec3 p) {
  return vec3(n1(p + 0.11), n1(p + 5.37), n1(p + 9.71)) - 0.5;
}

/**
 * Ridged multifractal — the thing that actually produces filaments.
 *
 * The ridge has to be taken per octave, not on the finished fbm: `1-|2f-1|` on a
 * summed field peaks at the field's *mean*, which is its most common value, so
 * applying it at the end fills the volume instead of carving it. Taken per
 * octave and gated by the previous one (`prev`), low values suppress all finer
 * detail beneath them, which is what leaves sharp crests with empty space
 * between rather than an even blanket.
 */
float ridgedFbm(vec3 p) {
  float sum = 0.0;
  float amp = 0.55;
  float prev = 1.0;
  vec3 q = p;
  for (int i = 0; i < 4; i++) {
    float n = 1.0 - abs(texture(uNoise, q).r * 2.0 - 1.0);
    n *= n;
    sum += n * amp * prev;
    prev = n;
    amp *= 0.52;
    q = q * 2.07 + 0.19;
  }
  return sum;
}

// Density of the interstellar medium at p, plus the hue that medium glows.
float densityAt(vec3 p, out vec3 tint) {
  float r = length(p.xz);
  float phase = armPhase(p);
  tint = pieColor(phase);

  // The same five-arm spiral the stars sit on, sharpened hard so the gas hugs
  // the arms and the inter-arm gaps stay genuinely dark.
  float arm = pow(0.5 + 0.5 * cos(ARM_COUNT * phase), 3.4);

  float disc  = smoothstep(R_OUT, R_OUT * 0.42, r);
  float bulge = exp(-r * r / (2.0 * 50.0 * 50.0));
  float h     = 16.0 + 0.07 * r;          // the disc flares gently outward
  float vert  = exp(-(p.y * p.y) / (2.0 * h * h));

  float base = (arm * 0.94 + 0.06) * disc * vert + bulge * vert * 0.8;

  vec3 q = p * uNoiseScale + vec3(uTime * 0.0021, uTime * 0.0035, -uTime * 0.0016);
  q += warpOf(q * 0.62) * uWarp;

  // Thresholds measured, not guessed: over the warped field ridgedFbm has
  // p50 0.40 / p85 0.64 / p97 0.80. Gating at 0.62..0.86 lets roughly the top
  // 15% of the volume carry gas, which is what leaves strands with real space
  // between them instead of a filled disc.
  float n = smoothstep(0.62, 0.86, ridgedFbm(q));

  // A coarse modulation carves the big voids so the cloud does not read as
  // uniform fog. One octave is plenty at this frequency.
  float macro = smoothstep(0.32, 0.74, n1(p * (uNoiseScale * 0.26) + 4.1));

  return base * n * macro * uDensity;
}

// Distant fixed stars, sampled on the ray direction so they sit at infinity and
// do not parallax as you fly.
float starLayer(vec3 rd, float density, float size, float seed) {
  vec3 p = rd * density + seed;
  vec3 ip = floor(p);
  vec3 fp = fract(p);
  vec3 rnd = hash33(ip);
  if (rnd.z > 0.955) {
    float d = length(fp - rnd);
    float mag = hash11(rnd.x * 311.7 + seed);
    return smoothstep(size, 0.0, d) * (0.25 + 0.75 * mag * mag);
  }
  return 0.0;
}

void main() {
  vec3 ro = uCamPos;
  vec3 rd = normalize(vRay);

  // --- background ---------------------------------------------------------
  vec3 col = vec3(0.0);
  float s = starLayer(rd, 210.0, 0.052, 0.0)
          + starLayer(rd, 420.0, 0.040, 17.3) * 0.6
          + starLayer(rd, 880.0, 0.032, 41.9) * 0.35;
  // Faint colour temperature variation across the distant field.
  vec3 starTint = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.88, 0.72), hash12(rd.xy * 31.0));
  col += s * starTint * uStarfield;

  // A very dim intergalactic wash so the void is never pure black.
  col += vec3(0.012, 0.016, 0.034) * (0.6 + 0.4 * fbm(rd * 0.9 + 9.0));

  // --- volume -------------------------------------------------------------
  float a = dot(rd.xz, rd.xz);
  float b = 2.0 * dot(ro.xz, rd.xz);
  float c = dot(ro.xz, ro.xz) - R_OUT * R_OUT;
  float disc = b * b - 4.0 * a * c;

  if (uDensity > 0.001 && disc > 0.0 && a > 1e-6) {
    float sq = sqrt(disc);
    float t0 = (-b - sq) / (2.0 * a);
    float t1 = (-b + sq) / (2.0 * a);

    // Slab in y.
    float invY = 1.0 / (abs(rd.y) < 1e-5 ? 1e-5 * sign(rd.y + 1e-9) : rd.y);
    float ty0 = (-H_OUT - ro.y) * invY;
    float ty1 = ( H_OUT - ro.y) * invY;
    if (ty0 > ty1) { float tmp = ty0; ty0 = ty1; ty1 = tmp; }

    float tMin = max(max(t0, ty0), 0.0);
    float tMax = min(t1, ty1);

    if (tMax > tMin) {
      float steps = uSteps;
      float dt = (tMax - tMin) / steps;
      // Jitter the entry point per pixel, otherwise the fixed step size lays
      // down visible concentric shells.
      float jitter = hash12(gl_FragCoord.xy + fract(uTime));
      float t = tMin + dt * jitter;

      vec3 accum = vec3(0.0);
      float transmittance = 1.0;

      for (int i = 0; i < 96; i++) {
        if (float(i) >= steps || transmittance < 0.012) break;
        vec3 p = ro + rd * t;

        vec3 tint;
        float d = densityAt(p, tint);
        if (d > 0.001) {
          // Fade the medium in over the first stretch of the ray. Without this,
          // flying into the disc means every ray crosses hundreds of units of
          // gas right in front of the eye and the whole screen greys out.
          float nearFade = smoothstep(0.0, 540.0, t);
          float sigma = d * dt * 0.082 * nearFade;
          // Emissive medium: hotter and whiter toward the galactic centre.
          float rr = length(p);
          vec3 emit = tint * (0.55 + 0.45 * exp(-rr / 160.0));
          emit += vec3(1.0, 0.87, 0.76) * exp(-rr / 60.0) * 2.2;
          accum += transmittance * emit * sigma;
          transmittance *= exp(-sigma * 1.75);
        }
        t += dt;
      }
      col = col * transmittance + accum * 4.6;
    }
  }

  fragColor = vec4(col * uIntensity, 1.0);
}
