uniform float uMorph;
uniform float uFilterMorph;
uniform float uStarSize;
uniform float uSizeScale;
uniform float uMinPixels;
uniform float uPickRadius;

attribute vec3  aPosB;
attribute float aSize;
attribute float aVisPrev;
attribute float aVisNext;
attribute float aIndex;

varying float vId;
varying float vVisible;

void main() {
  vec3 p = mix(position, aPosB, uMorph);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  float dist = max(-mv.z, 0.001);
  float vis = mix(aVisPrev, aVisNext, uFilterMorph);
  float wanted = aSize * uStarSize * uSizeScale / dist;

  // Pick targets are inflated to a comfortable minimum so a one-pixel star at
  // the rim is still clickable, but filtered-out stars shrink away so you
  // cannot grab something you cannot see.
  gl_PointSize = clamp(max(wanted, uMinPixels) * uPickRadius, 4.0, 220.0);
  vId = aIndex;
  vVisible = vis;
}
