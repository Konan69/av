import type { Signals, VoiceSignal } from '../conductor';
import type { WorldSeed } from '../seed';

export type Mode = [number, number, number];
export interface ResonanceParams {
  modeA: Mode;
  modeB: Mode;
  nextModeA: Mode;
  nextModeB: Mode;
  weights: [number, number];
  /** Eased coefficient crossfade; integer spatial frequencies never interpolate. */
  morph: number;
  /** Measured bass level and bass LFO, 0..1. Reserved for bounded accents; never changes nodes. */
  pressure: number;
  /** Own-stem loudness/onsets, 0..1, available for radiance/thickness. */
  excitation: number;
}
const clamp = (n: number, max = 1) => Math.max(0, Math.min(max, Number.isFinite(n) ? n : 0));
const cycle = (m: Mode): Mode => [m[1], m[2], m[0]];

/** Artistic score-to-mode mapping, not an estimate of a physical room's modes.
 * The spatial basis is the separable rigid-cavity pressure eigenfunction
 * cos(nx*x)cos(ny*y)cos(nz*z), in coordinates scaled by pi/cavity length.
 * Integer permutations share the same eigenvalue in a cubic cavity.
 * Background: Feynman I-49 (normal modes and superposition),
 * https://www.feynmanlectures.caltech.edu/I_49.html
 */
export function sectionModes(label: string, seed?: WorldSeed): [Mode, Mode] {
  let mode: Mode = /drop|chorus/i.test(label) ? [2, 3, 4]
    : /build|rise/i.test(label) ? [1, 3, 4]
    : /break|verse/i.test(label) ? [1, 2, 4] : [1, 2, 3];
  // Seed chooses a fixed orientation; it never invents a musical event.
  const rotations = Math.min(2, Math.floor(clamp(seed?.hue ?? 0) * 3));
  for (let i = 0; i < rotations; i++) mode = cycle(mode);
  return [mode, cycle(mode)];
}

function modalWeights(voices: Pick<VoiceSignal,"stem"|"role"|"level">[]): [number,number] {
  const bass = voices.find(v => v.stem === 'bass') ?? voices.find(v => v.role === 'pulse');
  const level = (v?: {level:number}) => clamp(v?.level ?? 0, 1.3) / 1.3;
  // Separate sustained harmony from the strongest audible foreground detail.
  // Averaging all stems diluted both whenever a mostly silent extra was present.
  const harmonic = voices.filter(v => v !== bass && v.role === 'field')
    .reduce((peak,v) => Math.max(peak,level(v)),0);
  const detail = voices.filter(v => v !== bass && v.role !== 'strike' && v.role !== 'field')
    .reduce((peak,v) => Math.max(peak,level(v)),0);
  // A small floor keeps both nodal modes alive without imposing a nearly equal
  // mixture over every passage. Loudness drives shape through their ratio.
  const a = 0.12 + 0.88 * level(bass), b = 0.12 + 0.62 * harmonic + 0.38 * detail;
  const norm=Math.hypot(a,b);return [a/norm,b/norm];
}

export function sampleResonance(signals: Signals, seed?: WorldSeed): ResonanceParams {
  const score=signals.phraseScore;
  const voices=score?score.current.voices.map((voice,i)=>({...voice,level:voice.level+(score.next.voices[i].level-voice.level)*score.blend})):signals.voices;
  const weights=modalWeights(voices);
  const bass=signals.voices.find(v=>v.stem==='bass')??signals.voices.find(v=>v.role==='pulse');
  const level=(v?:VoiceSignal)=>clamp(v?.level??0,1.3)/1.3;
  const depth = clamp(signals.wobbleDepth);
  const measuredWobble = depth * Math.sin(Number.isFinite(signals.wobblePhase) ? signals.wobblePhase : 0);
  const m = clamp(signals.morph);
  const [modeA,modeB] = sectionModes(signals.section.label,seed);
  const [nextModeA,nextModeB] = sectionModes(signals.nextLabel,seed);
  return {
    modeA,modeB,nextModeA,nextModeB,weights,morph:score?(score.sectionTransition?score.blend:0):m*m*(3-2*m),
    pressure:clamp(level(bass)*(0.7+0.3*measuredWobble)),
    excitation:clamp(signals.voices.reduce((peak,v)=>Math.max(peak,0.65*level(v)+0.35*clamp(v.punch)),0)),
  };
}

/** CPU counterpart for field/gradient verification; no rendering or state. */
export function evaluateResonance(p: Mode, params: ResonanceParams): {field:[number,number]; gradientF:Mode; gradientG:Mode} {
  const basis = (k:Mode, point:Mode): [number,Mode] => {
    const c=point.map((v,i)=>Math.cos(k[i]*v)), s=point.map((v,i)=>Math.sin(k[i]*v));
    return [c[0]*c[1]*c[2],[-k[0]*s[0]*c[1]*c[2],-k[1]*c[0]*s[1]*c[2],-k[2]*c[0]*c[1]*s[2]]];
  };
  const field:[number,number]=[0,0],gradientF:Mode=[0,0,0],gradientG:Mode=[0,0,0];
  const w = params.weights;
  for(const [a,b,mix] of [[params.modeA,params.modeB,1-params.morph],[params.nextModeA,params.nextModeB,params.morph]] as [Mode,Mode,number][]){
    const [va,ga]=basis(a,p),[vb,gb]=basis(b,p),[vc,gc]=basis(a,cycle(p)),[vd,gd]=basis(b,cycle(p));
    field[0]+=mix*(w[0]*va+w[1]*vb);field[1]+=mix*(w[1]*vc-w[0]*vd);
    for(let i=0;i<3;i++){
      gradientF[i]+=mix*(w[0]*ga[i]+w[1]*gb[i]);
      // q=(y,z,x): d/dp=(d/dq.z,d/dq.x,d/dq.y).
      const j=(i+2)%3;gradientG[i]+=mix*(w[1]*gc[j]-w[0]*gd[j]);
    }
  }
  return {field,gradientF,gradientG};
}

/** Uniform contract:
 * uModeA/B, uNextModeA/B vec3 = integer mode tuples from sampleResonance.
 * uResWeights vec2 = weights; uResMorph float = morph; uPressure float = pressure.
 * Coordinates are radians per cavity dimension. Apply spatial mirrors/folds BEFORE
 * calling the field; transform gradients back if lighting needs world normals.
 * F=0 and G=0 intersect in 3D nodal filaments. No time/frequency drift is present.
 */
export const resonanceGLSL = /* glsl */ `
uniform vec3 uModeA, uModeB, uNextModeA, uNextModeB;
uniform vec2 uResWeights;
uniform float uResMorph, uPressure;

float resonanceMode(vec3 p,vec3 k) {
  vec3 c=cos(k*p);
  return c.x*c.y*c.z;
}
vec3 resonanceModeGradient(vec3 p,vec3 k) {
  vec3 c=cos(k*p),s=sin(k*p);
  return -k*vec3(s.x*c.y*c.z,c.x*s.y*c.z,c.x*c.y*s.z);
}
vec2 resonancePair(vec3 p,vec3 a,vec3 b,vec2 w) {
  return vec2(w.x*resonanceMode(p,a)+w.y*resonanceMode(p,b),
    w.y*resonanceMode(p.yzx,a)-w.x*resonanceMode(p.yzx,b));
}
vec2 resonanceField(vec3 p) {
  vec2 w=uResWeights;
  vec2 before=resonancePair(p,uModeA,uModeB,w);
  if(uResMorph<=0.00001)return before;
  return mix(before,resonancePair(p,uNextModeA,uNextModeB,w),uResMorph);
}
void resonancePairGradients(vec3 p,vec3 a,vec3 b,vec2 w,out vec3 dF,out vec3 dG) {
  dF=w.x*resonanceModeGradient(p,a)+w.y*resonanceModeGradient(p,b);
  dG=(w.y*resonanceModeGradient(p.yzx,a)-w.x*resonanceModeGradient(p.yzx,b)).zxy;
}
void resonanceGradients(vec3 p,out vec3 dF,out vec3 dG) {
  vec2 w=uResWeights;
  resonancePairGradients(p,uModeA,uModeB,w,dF,dG);
  if(uResMorph<=0.00001)return;
  vec3 nextF,nextG;
  resonancePairGradients(p,uNextModeA,uNextModeB,w,nextF,nextG);
  dF=mix(dF,nextF,uResMorph);dG=mix(dG,nextG,uResMorph);
}
`;
