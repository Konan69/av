import * as THREE from 'three';

/** Light drawn by a moving beam, like an oscilloscope or a laser show.
 *
 * Every figure is a parametric curve evaluated on the GPU: one instanced quad per segment,
 * endpoints computed from gl_InstanceID, widened in screen space. A segment's light is the
 * beam's energy spread over its length, so where the beam slows (corners, turning points) it
 * burns bright and where it races it thins out — the look of a real scope. Many detuned copies
 * of each curve give it width: a woven sheet instead of a single hairline.
 *
 *   gates     aloboi harmonograph sheets hung across the tunnel: sums of harmonics from the
 *             chord's just ratios, sine / triangle / square waveforms, damped so the figure
 *             nests inward, 16 detuned traces each. The camera flies through them.
 *   creature  a pseudohuasca being: a dihedral mandala of curling tendrils, petals, bead rings
 *             and spokes, facing the viewer, morphing from one form into the next on every hit.
 *
 * Positions are pure functions of the uniforms, so seeking reproduces the frame. */

const beamVertex=(curve:string)=>/* glsl */`
precision highp float;
precision highp int;
in vec3 position;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform vec2 uRes;
uniform float uWidth,uEnergy,uMaxI,uRef,uFog;
uniform int uSegs;
out vec3 vCol;
out vec3 vBeam;
out float vI;
#define TAU 6.28318531
#define PI 3.14159265
${curve}
void main(){
 int seg=gl_InstanceID%uSegs,trace=gl_InstanceID/uSegs;
 float du=1./float(uSegs);
 vec3 p0,p1,c0,c1;float b0,b1;
 curve(float(seg)*du,trace,p0,c0,b0);
 curve(float(seg+1)*du,trace,p1,c1,b1);
 vec4 a=projectionMatrix*viewMatrix*vec4(p0,1.),b=projectionMatrix*viewMatrix*vec4(p1,1.);
 const float near=.06;
 if((a.w<near&&b.w<near)||b0+b1<=1e-4){gl_Position=vec4(0.,0.,2.,1.);vI=0.;vCol=vec3(0.);vBeam=vec3(0.);return;}
 // clip a segment that crosses behind the lens to the near plane
 if(a.w<near)a=mix(a,b,(near-a.w)/(b.w-a.w));
 else if(b.w<near)b=mix(b,a,(near-b.w)/(a.w-b.w));
 vec2 sa=a.xy/a.w*.5*uRes,sb=b.xy/b.w*.5*uRes;
 vec2 d=sb-sa;float len=length(d);
 vec2 dir=len>1e-3?d/len:vec2(1.,0.),nrm=vec2(-dir.y,dir.x);
 // widths are given for a 1080-line screen
 float end=position.x,side=position.y,w=uWidth*uRes.y/1080.*2.5;
 vec4 pc=end<.5?a:b;
 pc.xy+=(nrm*side*w+dir*(end*2.-1.)*w)/(.5*uRes)*pc.w;
 gl_Position=pc;
 vBeam=vec3(end*len+(end*2.-1.)*w,side*w,len);
 vCol=mix(c0,c1,end);
 // constant energy per unit time: where the beam slows (a shorter step in space) it burns
 // brighter. Measured in the world, not on screen, so a distant figure is smaller, not hotter.
 float speed=length(p1-p0)/max(uRef,1e-5);
 vI=min(mix(b0,b1,end)*uEnergy/max(speed,.12),uMaxI)*exp(-max(mix(a.w,b.w,end),0.)*uFog);
}
`;

export const beamFragment=/* glsl */`
precision highp float;
in vec3 vCol;
in vec3 vBeam;
in float vI;
uniform float uWidth;
uniform vec2 uRes;
out vec4 fragColor;
float erfa(float x){return tanh(1.202*x);}
void main(){
 if(vI<=0.)discard;
 float px=uWidth*uRes.y/1080.;
 // a gaussian beam integrated along the segment: consecutive segments sum to an even line
 float across=exp(-vBeam.y*vBeam.y/(px*px));
 float along=.5*(erfa(vBeam.x/px)-erfa((vBeam.x-vBeam.z)/px));
 fragColor=vec4(vCol*across*max(along,0.)*vI,1.);
}
`;

// ---------------------------------------------------------------- harmonograph gates
export const GATES=4,GATE_TRACES=16,GATE_SEGS=1400,HARMONICS=8;
const gateCurve=/* glsl */`
uniform vec3 uAmpA[${HARMONICS}],uAmpB[${HARMONICS}];
uniform vec3 uPhase,uWave;
uniform float uMix,uSpread,uDetune,uDrift,uTime,uDamp,uCycles,uSharp;
uniform mat4 uGate[${GATES}];
uniform vec4 uGateInfo[${GATES}];
uniform vec3 uColA,uColB;
const int TRACES=${GATE_TRACES};
float tri(float x){return 1.-4.*abs(fract(x/TAU+.25)-.5);}
float sqw(float x){return tanh(uSharp*sin(x))/tanh(uSharp);}
float wave(float x){return uWave.x*sin(x)+uWave.y*tri(x)+uWave.z*sqw(x);}
void curve(float u,int trace,out vec3 p,out vec3 col,out float bright){
 int g=trace/TRACES,j=trace-g*TRACES;
 vec4 info=uGateInfo[g];
 if(info.x<=0.){p=vec3(0.);col=vec3(0.);bright=0.;return;}
 float k=(float(j)+.5)/float(TRACES)-.5;
 float t=u*TAU*uCycles;
 // each trace is the same figure slightly detuned and phase-spread: together they weave a sheet
 vec3 ph=uPhase+vec3(0.,1.,1.618)*(uDrift*uTime+uSpread*k+info.y);
 vec3 q=vec3(0.);
 for(int h=0;h<${HARMONICS};h++){
  vec3 amp=mix(uAmpA[h],uAmpB[h],uMix);
  if(dot(amp,amp)<1e-6)continue;
  float f=float(h+1)*(1.+uDetune*k);
  q+=amp*vec3(wave(f*t+ph.x*float(h+1)),wave(f*t+ph.y*float(h+1)),wave(f*t+ph.z*float(h+1)));
 }
 q*=exp(-uDamp*u);
 p=(uGate[g]*vec4(q*vec3(info.z,info.z,info.w),1.)).xyz;
 col=mix(uColA,uColB,clamp(.5+k*1.6,0.,1.));
 bright=info.x;
}
`;

// ---------------------------------------------------------------- the creature
export const STROKES=16,STROKE_SEGS=72,SUBS=3,MAX_FOLD=8;
const creatureCurve=/* glsl */`
uniform vec4 uSA[${STROKES*3}],uSB[${STROKES*3}];
uniform float uFormMix,uOpen,uTime,uSubSpread,uBright;
uniform int uFold;
uniform mat4 uCreature;
uniform vec3 uCol[3];
const int STROKES=${STROKES},SUBS=${SUBS};
void curve(float u,int trace,out vec3 p,out vec3 col,out float bright){
 int sub=trace%SUBS,rest=trace/SUBS,stroke=rest%STROKES,copy=rest/STROKES;
 int turn=copy/2;
 if(turn>=uFold){p=vec3(0.);col=vec3(0.);bright=0.;return;}
 vec4 a0=mix(uSA[stroke*3],uSB[stroke*3],uFormMix);
 vec4 a1=mix(uSA[stroke*3+1],uSB[stroke*3+1],uFormMix);
 vec4 a2=mix(uSA[stroke*3+2],uSB[stroke*3+2],uFormMix);
 float r0=a0.x,len=a0.y,loop=a0.z,th0=a0.w,sweep=a1.x,curl=a1.y,wig=a1.z,wf=a1.w,beads=a2.x,beady=a2.y,zl=a2.z,ci=a2.w;
 float s=float(sub)-1.;
 // Sub-traces: a petal's three are nested outlines, so it reads as a filled blade; any other
 // stroke's three split slightly apart, like detuned oscillators.
 float nest=1.-.32*(s+1.)*loop;
 float r=(r0+len*nest*mix(u,sin(PI*u),loop)*uOpen+wig*sin(wf*PI*u+uTime*3.)*u)*(1.+.025*s*(1.-loop));
 float th=th0+sweep*nest*(u-.5*loop)+curl*u*u*u+s*uSubSpread*(1.-loop);
 // the dihedral group: k turns, each with its mirror image
 float ang=(copy%2==1?-th:th)+float(turn)*TAU/float(uFold);
 vec3 q=vec3(r*sin(ang),r*cos(ang),zl+.35*sin(PI*u)*len*(1.-loop));
 p=(uCreature*vec4(q,1.)).xyz;
 float bead=mix(1.,pow(.5+.5*cos(TAU*beads*u),6.)*2.2,beady);
 // the centre is where every stroke meets: keep it from burning to a white blot
 float hub=len>0.?smoothstep(.05,.35,r):1.;
 bright=bead*hub*(1.-.45*u*(1.-loop))*step(.001,len+r0)*uBright;
 int c=int(clamp(ci+.5,0.,2.));
 // the three sub-traces split like detuned oscillators: warm, true, cool
 col=uCol[c]*mix(vec3(1.),s<0.?vec3(1.3,.7,.7):vec3(.7,.8,1.35),abs(s));
}
`;

export const gateVertex=beamVertex(gateCurve),creatureVertex=beamVertex(creatureCurve);

function segmentGeometry(instances:number){
 const g=new THREE.InstancedBufferGeometry();
 g.setAttribute('position',new THREE.BufferAttribute(new Float32Array([0,-1,0, 0,1,0, 1,-1,0, 1,1,0]),3));
 g.setIndex([0,2,1,1,2,3]);
 g.instanceCount=instances;
 return g;
}
function beamMaterial(vertexShader:string,uniforms:Record<string,THREE.IUniform>){
 return new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,vertexShader,fragmentShader:beamFragment,uniforms,
  transparent:true,depthTest:true,depthWrite:false,blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneFactor});
}

export interface GateState {
 time:number;ampA:THREE.Vector3[];ampB:THREE.Vector3[];mix:number;phase:THREE.Vector3;wave:THREE.Vector3;sharp:number;
 spread:number;detune:number;drift:number;damp:number;cycles:number;width:number;energy:number;ref:number;fog:number;
 colA:THREE.Color;colB:THREE.Color;gates:{matrix:THREE.Matrix4;intensity:number;phase:number;size:number;depth:number}[];
}
export interface CreatureState {
 time:number;strokesA:THREE.Vector4[];strokesB:THREE.Vector4[];formMix:number;fold:number;open:number;subSpread:number;
 matrix:THREE.Matrix4;colors:[THREE.Color,THREE.Color,THREE.Color];width:number;energy:number;bright:number;ref:number;fog:number;
}
export const newStrokes=()=>Array.from({length:STROKES*3},()=>new THREE.Vector4());

export function createBeams(){
 const res={value:new THREE.Vector2(1,1)};
 const gateUniforms={
  uRes:res,uWidth:{value:1.6},uEnergy:{value:.5},uMaxI:{value:1.6},uRef:{value:.1},uFog:{value:.012},uSegs:{value:GATE_SEGS},
  uAmpA:{value:Array.from({length:HARMONICS},()=>new THREE.Vector3())},uAmpB:{value:Array.from({length:HARMONICS},()=>new THREE.Vector3())},
  uPhase:{value:new THREE.Vector3()},uWave:{value:new THREE.Vector3(1,0,0)},uSharp:{value:3},
  uMix:{value:0},uSpread:{value:.2},uDetune:{value:.01},uDrift:{value:.1},uTime:{value:0},uDamp:{value:1},uCycles:{value:6},
  uGate:{value:Array.from({length:GATES},()=>new THREE.Matrix4())},uGateInfo:{value:Array.from({length:GATES},()=>new THREE.Vector4())},
  uColA:{value:new THREE.Color()},uColB:{value:new THREE.Color()},
 };
 const creatureUniforms={
  uRes:res,uWidth:{value:1.4},uEnergy:{value:.5},uMaxI:{value:2},uRef:{value:.03},uFog:{value:.012},uSegs:{value:STROKE_SEGS},
  uSA:{value:newStrokes()},uSB:{value:newStrokes()},uFormMix:{value:1},uOpen:{value:1},uTime:{value:0},uSubSpread:{value:.012},uBright:{value:1},
  uFold:{value:5},uCreature:{value:new THREE.Matrix4()},uCol:{value:[new THREE.Color(),new THREE.Color(),new THREE.Color()]},
 };
 const gateGeometry=segmentGeometry(GATES*GATE_TRACES*GATE_SEGS);
 const creatureGeometry=segmentGeometry(STROKES*SUBS*2*MAX_FOLD*STROKE_SEGS);
 const gateMaterial=beamMaterial(gateVertex,gateUniforms),creatureMaterial=beamMaterial(creatureVertex,creatureUniforms);
 const gates=new THREE.Mesh(gateGeometry,gateMaterial),creature=new THREE.Mesh(creatureGeometry,creatureMaterial);
 for(const [mesh,name] of [[gates,'harmonograph gates'],[creature,'creature']] as const){mesh.frustumCulled=false;mesh.name=name;mesh.renderOrder=10;}

 function updateGates(s:GateState){
  const u=gateUniforms;
  for(let i=0;i<HARMONICS;i++){u.uAmpA.value[i].copy(s.ampA[i]);u.uAmpB.value[i].copy(s.ampB[i]);}
  u.uMix.value=s.mix;u.uPhase.value.copy(s.phase);u.uWave.value.copy(s.wave);u.uSharp.value=s.sharp;
  u.uSpread.value=s.spread;u.uDetune.value=s.detune;u.uDrift.value=s.drift;u.uTime.value=s.time;u.uDamp.value=s.damp;u.uCycles.value=s.cycles;
  u.uWidth.value=s.width;u.uEnergy.value=s.energy;u.uRef.value=s.ref;u.uFog.value=s.fog;u.uColA.value.copy(s.colA);u.uColB.value.copy(s.colB);
  let any=false;
  for(let g=0;g<GATES;g++){
   const gate=s.gates[g];
   if(!gate||gate.intensity<=.001){u.uGateInfo.value[g].set(0,0,0,0);continue;}
   any=true;u.uGate.value[g].copy(gate.matrix);u.uGateInfo.value[g].set(gate.intensity,gate.phase,gate.size,gate.depth);
  }
  gates.visible=any;
 }
 function updateCreature(s:CreatureState){
  const u=creatureUniforms;
  for(let i=0;i<STROKES*3;i++){u.uSA.value[i].copy(s.strokesA[i]);u.uSB.value[i].copy(s.strokesB[i]);}
  u.uFormMix.value=s.formMix;u.uFold.value=Math.max(1,Math.min(MAX_FOLD,Math.round(s.fold)));u.uOpen.value=s.open;u.uTime.value=s.time;
  u.uSubSpread.value=s.subSpread;u.uCreature.value.copy(s.matrix);u.uWidth.value=s.width;u.uEnergy.value=s.energy;u.uBright.value=s.bright;u.uRef.value=s.ref;u.uFog.value=s.fog;
  for(let i=0;i<3;i++)u.uCol.value[i].copy(s.colors[i]);
  creature.visible=s.bright>.001;
 }
 function setResolution(width:number,height:number){res.value.set(width,height);}
 function dispose(){gateGeometry.dispose();creatureGeometry.dispose();gateMaterial.dispose();creatureMaterial.dispose();}
 return {objects:[gates,creature] as THREE.Object3D[],updateGates,updateCreature,setResolution,dispose};
}
