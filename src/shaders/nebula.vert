varying vec3 vRay;

uniform mat4 uInvProjection;
uniform mat4 uCameraWorld;

void main() {
  // Unproject this pixel's NDC onto the near plane in view space; the vector
  // from the eye to that point is the ray direction for the raymarch.
  vec4 near = uInvProjection * vec4(position.xy, -1.0, 1.0);
  vRay = mat3(uCameraWorld) * (near.xyz / near.w);
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
