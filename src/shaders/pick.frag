varying float vId;
varying float vVisible;

void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  if (dot(uv, uv) > 1.0) discard;
  if (vVisible < 0.5) discard;

  // Index packed into 24 bits of RGB; 0 is reserved for "nothing here", so the
  // id is written offset by one.
  float id = vId + 1.0;
  float r = mod(id, 256.0);
  float g = mod(floor(id / 256.0), 256.0);
  float b = mod(floor(id / 65536.0), 256.0);
  gl_FragColor = vec4(r / 255.0, g / 255.0, b / 255.0, 1.0);
}
