#include ./lib/common.glsl

varying vec3  vColor;
varying float vBright;
varying float vSpike;
varying float vHighlight;

void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float d2 = dot(uv, uv);
  if (d2 > 1.0) discard;
  float d = sqrt(d2);

  // Three-part profile: a tight gaussian core, a wide inverse-power halo, and
  // optional spikes. The halo is what makes a point sprite read as a star
  // rather than a disc.
  float core = exp(-d2 * 17.0);
  float halo = pow(max(0.0, 1.0 - d), 3.5) * 0.42;

  float spikes = 0.0;
  if (vSpike > 0.001) {
    vec2 a = abs(uv);
    float h = exp(-a.y * a.y * 340.0) * exp(-a.x * 2.6);
    float v = exp(-a.x * a.x * 340.0) * exp(-a.y * 2.6);
    vec2 dg = abs(vec2(uv.x + uv.y, uv.x - uv.y) * 0.7071);
    float d1 = exp(-dg.x * dg.x * 900.0) * exp(-dg.y * 3.4);
    float d2s = exp(-dg.y * dg.y * 900.0) * exp(-dg.x * 3.4);
    spikes = (h + v + (d1 + d2s) * 0.35) * vSpike * 0.5;
  }

  float intensity = core + halo + spikes;
  vec3 col = vColor * intensity;

  // The very centre of a bright star saturates toward white, the way a real
  // overexposed highlight does. Keeps hue in the wings, loses it in the core.
  col += vec3(1.0) * core * core * 0.55;
  col *= vBright;

  if (vHighlight > 0.001) {
    float ring = smoothstep(0.80, 0.90, d) * (1.0 - smoothstep(0.93, 1.0, d));
    col += vec3(0.55, 0.9, 1.0) * ring * vHighlight * 3.5;
  }

  gl_FragColor = vec4(col, 1.0);
}
