#include ./lib/common.glsl

precision highp float;
precision highp sampler3D;
precision highp sampler2D;

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
uniform float     uWorldScale;
/* 0 galaxy, 1 timeline, 2 sets, 3 colorwheel, 4 sphere, 5 price */
uniform float     uLayout;
uniform float     uBound;
uniform float     uYearMin;
uniform float     uYearCount;
uniform sampler2D uClusterMap;
uniform float     uClusterExtent;

varying vec3 vRay;

layout(location = 0) out vec4 fragColor;

const float R_OUT = 400.0;
const float H_OUT = 120.0;
/* Longest stretch of volume any single ray will integrate. Inside the disc the
   geometric span exceeds 800 units, but transmittance has collapsed long before
   that, so the tail is paid for and never seen. */
const float MAX_RAY = 620.0;

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

float filament(vec3 p) {
  vec3 q = p * uNoiseScale + vec3(uTime * 0.0021, uTime * 0.0035, -uTime * 0.0016);
  q += warpOf(q * 0.62) * uWarp;
  float n = smoothstep(0.62, 0.86, ridgedFbm(q));
  float macro = smoothstep(0.32, 0.74, n1(p * (uNoiseScale * 0.26) + 4.1));
  return n * macro;
}

// Galaxy / price: five-arm spiral. Dust lanes are the point — a 5.2 power
// and a ~2% inter-arm floor leave real dark between WUBRG.
float galaxyDensity(vec3 p, out vec3 tint) {
  float r = length(p.xz);
  float phase = armPhase(p);
  tint = pieColor(phase);
  float arm = pow(0.5 + 0.5 * cos(ARM_COUNT * phase), 5.2);
  float disc  = smoothstep(R_OUT, R_OUT * 0.42, r);
  float bulge = exp(-r * r / (2.0 * 50.0 * 50.0));
  float h     = 16.0 + 0.07 * r;
  float vert  = exp(-(p.y * p.y) / (2.0 * h * h));
  float base = (arm * 0.982 + 0.018) * disc * vert + bulge * vert * 0.85;
  return base * filament(p);
}

// Tree rings: gas on the same year rings the stars sit on.
float timelineDensity(vec3 p, out vec3 tint) {
  float r = length(p.xz);
  tint = pieColor(atan(p.z, p.x) + PI);
  float t = (r - 40.0) / 22.0;
  if (t < -0.5 || t > uYearCount + 0.5) return 0.0;
  float ring = abs(t - floor(t + 0.5));
  float band = smoothstep(0.42, 0.0, ring);
  float vert = exp(-(p.y * p.y) / (2.0 * 28.0 * 28.0));
  return band * vert * filament(p * 0.85) * 1.35;
}

// Baked xz density of every set cluster. Cheap: one texture fetch per step.
float setsDensity(vec3 p, out vec3 tint) {
  tint = pieColor(atan(p.z, p.x) + PI);
  float ext = max(uClusterExtent, 1.0);
  vec2 uv = p.xz / ext * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  float d = texture(uClusterMap, uv).r;
  d = smoothstep(0.18, 0.8, d);
  float vert = exp(-(p.y * p.y) / (2.0 * 22.0 * 22.0));
  return d * vert * (0.35 + 0.4 * filament(p * 0.7));
}

// Five colour lobes, matching the wheel layout.
float wheelDensity(vec3 p, out vec3 tint) {
  float r = length(p.xz);
  float phase = mod(atan(p.z, p.x) + TAU, TAU);
  tint = pieColor(phase);
  float lobe = pow(0.5 + 0.5 * cos(ARM_COUNT * phase), 2.4);
  float disc = smoothstep(230.0, 70.0, r);
  float vert = exp(-(p.y * p.y) / (2.0 * 70.0 * 70.0));
  return (lobe * 0.9 + 0.08) * disc * vert * filament(p);
}

// Rarity shells — mythic core, commons as the outer sky.
float sphereDensity(vec3 p, out vec3 tint) {
  float rr = length(p);
  tint = pieColor(atan(p.z, p.x) + PI);
  float shells[5];
  shells[0] = 104.0; shells[1] = 136.0; shells[2] = 168.0;
  shells[3] = 232.0; shells[4] = 300.0;
  float band = 0.0;
  for (int i = 0; i < 5; i++) {
    band = max(band, smoothstep(16.0, 0.0, abs(rr - shells[i])));
  }
  return band * filament(p * 0.9) * 1.2;
}

float densityAt(vec3 p, out vec3 tint) {
  float lid = uLayout;
  float d;
  if (lid < 0.5) d = galaxyDensity(p, tint);
  else if (lid < 1.5) d = timelineDensity(p, tint);
  else if (lid < 2.5) d = setsDensity(p, tint);
  else if (lid < 3.5) d = wheelDensity(p, tint);
  else if (lid < 4.5) d = sphereDensity(p, tint);
  else d = galaxyDensity(p, tint);
  return d * uDensity;
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
  // March a sphere that encloses the current layout. Density is evaluated in
  // world space against a function that matches that layout (spiral, year
  // rings, set clusters, colour lobes, rarity shells).
  float rad = max(uBound, 80.0) * 1.28;
  float bSph = dot(ro, rd);
  float cSph = dot(ro, ro) - rad * rad;
  float discSph = bSph * bSph - cSph;

  if (uDensity > 0.001 && discSph > 0.0) {
    float sq = sqrt(max(discSph, 0.0));
    float tMin = max(-bSph - sq, 0.0);
    float tMax = -bSph + sq;
    tMax = min(tMax, tMin + MAX_RAY * (rad / R_OUT));

    if (tMax > tMin) {
      float steps = uSteps;
      float dt = (tMax - tMin) / steps;
      // Stable in time: hashing uTime here made the volume sparkle every frame.
      float jitter = hash12(gl_FragCoord.xy);
      float t = tMin + dt * jitter;

      vec3 accum = vec3(0.0);
      float transmittance = 1.0;
      float fadeDist = max(rad * 1.15, 220.0);

      for (int i = 0; i < 96; i++) {
        if (float(i) >= steps || transmittance < 0.035) break;
        vec3 p = ro + rd * t;

        vec3 tint;
        float d = densityAt(p, tint);
        if (d > 0.001) {
          float nearFade = smoothstep(0.0, fadeDist, t);
          float sigma = d * dt * 0.082 * nearFade;
          float rr = length(p);
          vec3 emit = tint * (0.55 + 0.45 * exp(-rr / 160.0));
          // Nucleus white is galaxy-sized, not layout-sized — scaling it with
          // the bounding sphere turned Sets into a white fog bank.
          float coreW = uLayout < 0.5 || uLayout > 4.5 ? 1.55 : 0.15;
          emit += vec3(1.0, 0.87, 0.76) * exp(-rr / 60.0) * coreW;
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
