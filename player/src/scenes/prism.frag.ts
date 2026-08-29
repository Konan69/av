/** PRISM — a raymarched kaleidoscopic IFS. Vortexia's lesson: fold space in
 *  the fragment shader and let the bands drive the fold, not a mesh. Bass
 *  zooms, mids open the fold angle, air sharpens the detail. */
export const prismVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.9999, 1.0);   // screen-space quad
}
`;

export const prismFrag = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec2 uRes;
uniform float uTime;
uniform float uZoom;
uniform float uFold;
uniform float uDetail;
uniform float uSpin;
uniform float uInk;
uniform float uAccentAmount;
uniform vec3 uAccent;
uniform float uPunch;

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// kaleidoscopic IFS: fold, scale, repeat — the mandala as distance field
float map(vec3 p) {
  float scale = 1.85 + 0.25 * uFold;
  vec3 offset = vec3(1.0, 0.62 + 0.3 * uFold, 0.5);
  float d = 1.0;
  for (int i = 0; i < 11; i++) {
    p = abs(p);
    if (p.x < p.y) p.xy = p.yx;
    if (p.x < p.z) p.xz = p.zx;
    if (p.y < p.z) p.yz = p.zy;
    p.xy *= rot(0.22 * uFold + 0.08 * float(i));
    p = p * scale - offset * (scale - 1.0);
    d *= scale;
  }
  return (length(p) - 0.6) / d;
}

void main() {
  vec2 uv = (vUv * 2.0 - 1.0);
  uv.x *= uRes.x / max(1.0, uRes.y);

  vec3 ro = vec3(0.0, 0.0, -3.4 + uZoom);
  vec3 rd = normalize(vec3(uv, 1.5 + 0.5 * uDetail));
  rd.xy *= rot(uSpin);
  ro.xy *= rot(uSpin);

  float t = 0.0;
  float glow = 0.0;
  float hit = 0.0;
  for (int i = 0; i < 72; i++) {
    vec3 p = ro + rd * t;
    float d = map(p);
    glow += 0.016 / (0.02 + abs(d) * 12.0);   // proximity glow reads the folds
    if (d < 0.0012) { hit = 1.0; break; }
    if (t > 9.0) break;
    t += max(d * 0.85, 0.0016);
  }

  float shade = hit * exp(-t * 0.30) + glow * 0.22;
  shade = pow(clamp(shade, 0.0, 1.6), 1.25);
  // white structure, accent only where it is brightest — colour stays scarce
  vec3 col = mix(vec3(1.0), uAccent, clamp((shade - 0.55) * 1.6 * uAccentAmount, 0.0, 0.9));
  float a = clamp(shade * uInk * (0.75 + 0.6 * uPunch), 0.0, 1.0);
  gl_FragColor = vec4(col * a, a);
}
`;
