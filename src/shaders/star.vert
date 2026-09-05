#include ./lib/common.glsl

uniform float uTime;
uniform float uMorph;        // 0..1 across a layout change
uniform float uFilterMorph;  // 0..1 across a filter change
uniform float uStarSize;
uniform float uDim;          // brightness floor for filtered-out stars
uniform float uSizeScale;    // (viewportHeight * 0.5) / tan(fov/2)
uniform float uMinPixels;
uniform float uHovered;
uniform float uSelected;
uniform float uTwinkle;
uniform float uExposure;
uniform float uHoverOracle;
uniform float uSelectedOracle;
uniform float uNewestSet;
uniform float uFormatBit;
uniform float uHighlightOn;

attribute vec3  aPosB;
attribute vec3  aColor;
attribute float aSize;
attribute float aBright;
attribute float aSeed;
attribute float aVisPrev;
attribute float aVisNext;
attribute float aIndex;
attribute float aOracle;
attribute float aSetIdx;
attribute float aFormatMask;
attribute float aHighlight;

varying vec3  vColor;
varying float vBright;
varying float vSpike;
varying float vHighlight;

void main() {
  // Straight lerp between layouts would slide every star through the origin at
  // once. Bulging the path outward on a sine turns the transition into a warp:
  // the galaxy blooms apart and reassembles.
  vec3 p = mix(position, aPosB, uMorph);
  float swell = sin(uMorph * PI);
  if (swell > 0.001) {
    vec3 dir = normalize(p + vec3(1e-4));
    p += dir * swell * (34.0 + 26.0 * hash11(aSeed * 91.7));
  }

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  float dist = max(-mv.z, 0.001);
  float vis = mix(aVisPrev, aVisNext, uFilterMorph);

  // Arena format focus: illegal cards keep their position but dim like a filter.
  if (uFormatBit > 0.5) {
    float legal = step(0.5, mod(floor(aFormatMask / uFormatBit), 2.0));
    vis *= mix(0.12, 1.0, legal);
  }
  if (uHighlightOn > 0.5) vis *= mix(0.08, 1.0, aHighlight);

  float bright = aBright * mix(uDim, 1.0, vis);
  // Filtered-out stars shrink hard as well as dimming. Brightness alone is not
  // enough: the excluded set usually outnumbers the matching one ten to one, so
  // at half size they still add up to the same galaxy and the filter looks like
  // it did nothing.
  float size = aSize * uStarSize * mix(0.22, 1.0, vis);

  // Twinkle is per-star and slow; without the seed offset the whole field
  // pulses in unison and reads as a flicker bug.
  bright *= 1.0 + uTwinkle * 0.16 * sin(uTime * 1.35 + aSeed * 240.0);

  float wanted = size * uSizeScale / dist;
  float clamped = max(wanted, uMinPixels);

  // Energy conservation: once a star is clamped up to the minimum readable
  // size, dim it by the area we gave it for free. Without this the far side of
  // the disc turns into a solid white sheet.
  bright *= clamp(wanted / clamped, 0.04, 1.0);

  float hovered  = step(abs(aIndex - uHovered), 0.5);
  float selected = step(abs(aIndex - uSelected), 0.5);
  float kinHover = step(abs(aOracle - uHoverOracle), 0.5) * step(0.0, uHoverOracle);
  float kinSel   = step(abs(aOracle - uSelectedOracle), 0.5) * step(0.0, uSelectedOracle);
  vHighlight = max(max(hovered * 0.6, selected), max(kinHover * 0.45, kinSel * 0.7));
  clamped *= 1.0 + vHighlight * 2.2;
  bright *= 1.0 + vHighlight * 2.0;

  // Newest set is a bright knot on the rim — the whole printing, not one star.
  float fresh = step(abs(aSetIdx - uNewestSet), 0.5) * step(0.0, uNewestSet);
  clamped *= 1.0 + fresh * 0.55;
  bright *= 1.0 + fresh * 0.45;

  gl_PointSize = min(clamped, 220.0);

  // Only genuinely bright stars earn diffraction spikes; on everything else
  // they turn the field into a cross-hatch.
  vSpike = smoothstep(2.4, 7.0, wanted) * smoothstep(0.55, 1.6, aBright);
  vColor = aColor;
  vBright = bright * uExposure;
}
