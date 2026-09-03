precision highp float;

in float vId;
in float vVisible;

layout(location = 0) out vec4 fragColor;

void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float d = length(uv);
  if (d > 1.0) discard;
  if (vVisible < 0.5) discard;

  // Depth is distance from the sprite's own centre, NOT distance from the
  // camera.
  //
  // Depth-testing on real distance meant that in a dense region the star
  // nearest the camera won, even when the cursor was dead on top of a
  // different one — you would aim at Black Lotus and select whatever happened
  // to be floating in front of it. The starfield is additively blended and
  // nothing occludes anything, so camera depth is not meaningful here anyway.
  // Writing disc-relative distance instead makes the depth test resolve to
  // "the star whose centre is closest to the cursor", which is what aiming
  // means to a person.
  gl_FragDepth = clamp(d, 0.0, 1.0);

  // Index packed into 24 bits of RGB; 0 is reserved for "nothing here", so the
  // id is written offset by one.
  float id = vId + 1.0;
  float r = mod(id, 256.0);
  float g = mod(floor(id / 256.0), 256.0);
  float b = mod(floor(id / 65536.0), 256.0);
  fragColor = vec4(r / 255.0, g / 255.0, b / 255.0, 1.0);
}
