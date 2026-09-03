#ifndef MCU_COMMON
#define MCU_COMMON

#define TAU 6.28318530718
#define PI  3.14159265359

// Log-spiral twist, shared with the CPU layout so the nebula follows exactly
// the arms the stars were placed on.
#define ARM_TWIST 0.0092
#define ARM_COUNT 5.0

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// Angular position within the spiral, unwound by the twist. Returns the arm
// phase in [0, TAU) where 0 is the white arm.
float armPhase(vec3 p) {
  float r = length(p.xz);
  float theta = atan(p.z, p.x);
  return mod(theta - r * ARM_TWIST, TAU);
}

// The five colour-pie hues the nebula is tinted with, in WUBRG order.
vec3 pieColor(float phase) {
  float k = phase * (ARM_COUNT / TAU);
  float i = floor(k);
  float f = smoothstep(0.0, 1.0, fract(k));

  vec3 c[5];
  c[0] = vec3(1.00, 0.93, 0.69); // white
  c[1] = vec3(0.29, 0.66, 1.00); // blue
  c[2] = vec3(0.66, 0.43, 0.94); // black -> violet
  c[3] = vec3(1.00, 0.34, 0.22); // red
  c[4] = vec3(0.27, 0.85, 0.45); // green

  int a = int(mod(i, 5.0));
  int b = int(mod(i + 1.0, 5.0));
  return mix(c[a], c[b], f);
}

// ACES-ish filmic curve, applied by the composite so bright cores roll off to
// white instead of clipping to magenta.
vec3 tonemapACES(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

#endif
