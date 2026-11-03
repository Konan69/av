import * as THREE from 'three';

/** Particles that give the air depth: dust that drifts through every world (parallax tells the
 * eye how far things are) and sparks the creature throws on each drum hit. Every position is a
 * pure function of track time and hit index, so seeking reproduces the frame. */

const DUST=6000,SPARKS=420;

export const moteVertex=/* glsl */`
precision highp float;
in vec3 position;
in vec4 aSeed;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 uCam,uEntity;
uniform float uTime,uMode,uAge,uHit,uSpread,uSize,uResY,uWarp,uSpin;
out float vFade;
out float vHue;
void main(){
 vec3 p;float fade;
 if(uMode<.5){
  // dust: a 60 m cube of motes wrapped around the camera, drifting and streaming on the warp
  vec3 drift=vec3(sin(aSeed.w*6.28)*.12,.05+.08*aSeed.x,cos(aSeed.w*6.28)*.12);
  vec3 q=position+drift*uTime+vec3(0.,0.,uWarp);
  p=uCam+mod(q-uCam+30.,60.)-30.;
  float de=length(p-uEntity);
  fade=(.25+2.5/(1.+de*de*.08))*(1.-smoothstep(12.,30.,length(p-uCam)));
 } else {
  // sparks: a mirrored burst from the creature, one pattern per hit
  vec3 dir=normalize(position);
  float c=cos(uSpin),s=sin(uSpin);dir.xz=mat2(c,s,-s,c)*dir.xz;c=cos(uSpin*1.7);s=sin(uSpin*1.7);dir.yz=mat2(c,s,-s,c)*dir.yz;
  float speed=(1.5+5.*aSeed.x)*uSpread;
  float a=uAge;
  p=uEntity+dir*speed*a*(1.-.25*a)+vec3(0.,-1.2*a*a,0.);
  if(aSeed.y>.5)p.x=2.*uEntity.x-p.x;
  fade=exp(-a*(2.5+3.*aSeed.z))*uHit;
 }
 vec4 mv=modelViewMatrix*vec4(p,1.);
 gl_Position=projectionMatrix*mv;
 float size=uSize*(uMode<.5?(.6+aSeed.z):(1.+2.*aSeed.w));
 gl_PointSize=clamp(size*uResY/max(-mv.z,.1),1.,64.);
 vFade=fade;vHue=aSeed.w;
}
`;
export const moteFragment=/* glsl */`
precision highp float;
in float vFade;
in float vHue;
uniform vec3 uColor,uColor2;
out vec4 fragColor;
void main(){
 vec2 c=gl_PointCoord-.5;float r=dot(c,c)*4.;
 float disc=exp(-r*4.);
 fragColor=vec4(mix(uColor,uColor2,vHue)*disc*vFade,1.);
}
`;

function points(count:number,seed:number,sphere:boolean){
 const rng=(()=>{let a=seed>>>0;return()=>{a=(a+0x6d2b79f5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};})();
 const position=new Float32Array(count*3),seeds=new Float32Array(count*4);
 for(let i=0;i<count;i++){
  if(sphere){const u=rng()*2-1,a=rng()*Math.PI*2,r=Math.sqrt(1-u*u);position.set([r*Math.cos(a),u,r*Math.sin(a)],i*3);}
  else position.set([rng()*60-30,rng()*60-30,rng()*60-30],i*3);
  seeds.set([rng(),rng(),rng(),rng()],i*4);
 }
 const g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.BufferAttribute(position,3));
 g.setAttribute('aSeed',new THREE.BufferAttribute(seeds,4));
 return g;
}

export interface MoteState {
 time:number;camera:THREE.Vector3;entity:THREE.Vector3;warp:number;dust:number;
 hitAge:number;hit:number;spread:number;spin:number;color:THREE.Color;color2:THREE.Color;accent:THREE.Color;
}

export function createMotes(seed:number){
 const make=(mode:number,count:number,sphere:boolean,size:number)=>{
  const geometry=points(count,seed+mode*977,sphere);
  const material=new THREE.RawShaderMaterial({
   glslVersion:THREE.GLSL3,vertexShader:moteVertex,fragmentShader:moteFragment,
   uniforms:{uCam:{value:new THREE.Vector3()},uEntity:{value:new THREE.Vector3()},uTime:{value:0},uMode:{value:mode},uAge:{value:0},
    uHit:{value:0},uSpread:{value:1},uSize:{value:size},uResY:{value:1000},uWarp:{value:0},uSpin:{value:0},uColor:{value:new THREE.Color()},uColor2:{value:new THREE.Color()}},
   transparent:true,depthTest:true,depthWrite:false,blending:THREE.AdditiveBlending,
  });
  const object=new THREE.Points(geometry,material);object.frustumCulled=false;object.name=mode?'sparks':'dust';
  return object;
 };
 const dust=make(0,DUST,false,.035),sparks=make(1,SPARKS,true,.03);
 function update(s:MoteState){
  const d=dust.material.uniforms,k=sparks.material.uniforms;
  d.uCam.value.copy(s.camera);d.uEntity.value.copy(s.entity);d.uTime.value=s.time;d.uWarp.value=s.warp;
  d.uColor.value.copy(s.color).multiplyScalar(.35*s.dust);d.uColor2.value.setRGB(.5,.5,.55).multiplyScalar(s.dust);
  k.uCam.value.copy(s.camera);k.uEntity.value.copy(s.entity);k.uAge.value=s.hitAge;k.uHit.value=s.hit;k.uSpread.value=s.spread;k.uSpin.value=s.spin;
  k.uColor.value.copy(s.accent).multiplyScalar(2.2);k.uColor2.value.copy(s.color2).multiplyScalar(2.2);
  sparks.visible=s.hit>.01&&s.hitAge<2;
 }
 function setResolution(height:number){dust.material.uniforms.uResY.value=height;sparks.material.uniforms.uResY.value=height;}
 function dispose(){for(const o of [dust,sparks]){o.geometry.dispose();o.material.dispose();}}
 return {objects:[dust,sparks] as THREE.Object3D[],update,setResolution,dispose};
}
