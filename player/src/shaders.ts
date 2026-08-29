/**
 * All GLSL for the instrument, kept apart from React so it can be compiled and
 * validated offline (see probe-shaders.ts -> glslangValidator).
 */

export const N_RIP = 8;
export const FLOOR_R = 15;

/* ── shared shader chunk: the four shapes and the surface function ────────── */
export const shapeChunk = /* glsl */ `
uniform int uKindA;
uniform int uKindB;
uniform float uMorph;
uniform float uPetals;
uniform float uBands[5];
uniform float uWobPhase;
uniform float uWobDepth;
uniform float uPhase;
uniform float uPunch;

float shapeR(int kind, float th, float petals) {
  if (kind == 0) return 1.0;
  if (kind == 1) return 1.0 + 0.34 * cos(petals * th);
  if (kind == 2) return 1.0 + 0.55 * pow(abs(cos(petals * th * 0.5)), 8.0);
  return 1.0 + 0.30 * (th / 6.28318530718);
}

// radius of the vessel at angle th, height level 0..1
float vesselR(float th, float level) {
  float shp = mix(shapeR(uKindA, th, uPetals), shapeR(uKindB, th, uPetals), uMorph);
  // silhouette: widest at the waist, tapering at both ends
  float silh = 0.42 + 0.85 * sin(3.14159265 * level);
  // each band owns a horizontal zone of the body
  float zone = clamp(level * 4.0, 0.0, 3.999);
  int zi = int(floor(zone));
  float b = uBands[0];
  if (zi == 1) b = uBands[1];
  else if (zi == 2) b = uBands[2];
  else if (zi == 3) b = uBands[3];
  silh *= 1.0 + 0.30 * b + 0.22 * uPunch;
  float wob = uWobDepth * 0.16 * sin(uWobPhase + 4.0 * th + level * 6.0);
  return shp * silh + wob;
}
`;

export const vesselVert = /* glsl */ `
${shapeChunk}
uniform float uHeight;
uniform float uScale;
varying float vGlow;
void main() {
  float th = position.x;
  float level = position.y;
  float r = vesselR(th, level) * uScale;
  vec3 p = vec3(cos(th) * r, (level - 0.5) * uHeight, sin(th) * r);
  // rim emphasis: the waist and the crown read brighter
  vGlow = 0.55 + 0.45 * sin(3.14159265 * level) + 0.5 * uPunch;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

export const inkFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uInk;
varying float vGlow;
void main() {
  float a = clamp(uInk * vGlow, 0.0, 1.0);
  gl_FragColor = vec4(uColor * (0.55 + 0.45 * a), a);
}
`;

export const occluderFrag = /* glsl */ `
void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); }
`;

export const shellVert = /* glsl */ `
${shapeChunk}
uniform float uHeight;
uniform float uScale;
uniform float uSpread;
uniform float uSize;
varying float vGlow;
void main() {
  float th = position.x;
  float level = position.y;
  float jitter = position.z;               // 0..1, how far outside the skin
  float r = (vesselR(th, level) * uScale) * (1.0 + uSpread * jitter);
  vec3 p = vec3(cos(th) * r, (level - 0.5) * uHeight * (1.0 + 0.35 * jitter), sin(th) * r);
  vGlow = 0.35 + 0.65 * (1.0 - jitter);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize * (12.0 / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;

export const shellFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uInk;
varying float vGlow;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  if (dot(d, d) > 0.25) discard;           // round dots, hard edged
  gl_FragColor = vec4(uColor, clamp(uInk * vGlow, 0.0, 1.0));
}
`;

export const floorVert = /* glsl */ `
uniform float uV[6];
uniform float uPhase;
uniform float uAmp;
uniform vec3 uRip[${N_RIP}];
varying float vH;
varying float vR;
void main() {
  vec2 xy = position.xy;
  float r = length(xy);
  float th = atan(xy.y, xy.x);
  float h = 0.0;
  for (int i = 0; i < 6; i++) {
    float m = 3.0 + float(i) * 2.0;
    float k = 5.0 + float(i) * 3.2;
    h += uV[i] * 0.30 * cos(m * th + float(i) * 1.3) * sin(k * r * 0.30 + uPhase * 0.25);
  }
  for (int i = 0; i < ${N_RIP}; i++) {
    float age = uRip[i].x;
    float s = uRip[i].y;
    if (s <= 0.0) continue;
    float dr = r - 6.0 * age;
    h += s * 0.55 * exp(-2.2 * age) * exp(-dr * dr * 2.0);
  }
  h *= uAmp;
  vH = h;
  vR = r;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.x, position.y, h, 1.0);
}
`;

export const floorFrag = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uAccent;
uniform float uInk;
uniform float uAccentAmount;
varying float vH;
varying float vR;
void main() {
  float fade = smoothstep(${FLOOR_R.toFixed(1)}, ${(FLOOR_R * 0.35).toFixed(1)}, vR);
  float a = abs(vH);
  // crests take the accent, the flat plate stays white — colour stays scarce
  vec3 col = mix(uColor, uAccent, clamp(a * 1.6 * uAccentAmount, 0.0, 0.85));
  float alpha = fade * uInk * (0.10 + min(a * 1.3, 0.85));
  gl_FragColor = vec4(col, alpha);
}
`;

