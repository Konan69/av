import * as THREE from 'three';

/** The raymarched universe: one continuous flight through kaleidoscopic fractal architecture.
 *
 * Three families of 3D kaleidoscope fill all of space, repeating without end:
 *   0 hypersponge  a Menger sponge folded in four dimensions and sliced by w, which keeps moving
 *   1 kleinian     a pseudo-Kleinian limit set: bridges, pipes and chambers without end
 *   2 cathedral    a Menger variant with offset folds: columns, galleries, stair-like terraces
 * A tunnel is carved along a gently winding path, and the camera flies down it toward the
 * creature, a being of branching light folded by a polyhedral symmetry group, which lights the
 * architecture ahead. Every edge of the structure is neon; the edges split into detuned red,
 * green and blue copies as the music widens (uDetune), and their light bleeds into the air.
 *
 * The raymarch runs at a fraction of the screen resolution and a composite quad writes its
 * colour and depth into the main scene. Output is linear HDR. */

export const FAMILY = {hypersponge:0,kleinian:1,cathedral:2} as const;
export const FAMILY_NAMES = ['hypersponge','kleinian','cathedral'] as const;
/** The shape of the empty space the flight passes through, which the fractal fills everywhere else. */
export const PLACE = {tunnel:0,landscape:1,strata:2,islands:3,chambers:4} as const;
export const PLACE_NAMES = ['tunnel','landscape','strata','islands','chambers'] as const;

/** The flight path's lateral offset at depth z; the shader evaluates the same curve. */
export function pathAt(z:number,a:THREE.Vector4,f:THREE.Vector4,target=new THREE.Vector2()){
 return target.set(a.x*Math.sin(z*f.x)+a.y*Math.sin(z*f.y+1.3),a.z*Math.sin(z*f.z+.7)+a.w*Math.cos(z*f.w));
}

const vertexShader=/* glsl */`
in vec3 position;
void main(){gl_Position=vec4(position.xy,0.,1.);}
`;

export const universeFragment=/* glsl */`
precision highp float;
precision highp int;
out vec4 fragColor;

uniform vec2 uRes;
uniform vec3 uCamPos;
uniform mat3 uCamRot;
uniform float uTanFov;
uniform mat4 uViewProj;
uniform float uTime,uBeats;
uniform int uZero;

uniform vec4 uPathA,uPathF;
uniform float uTunnelR,uCellA,uCellB;
uniform float uPlaceA,uPlaceB,uHeightA,uHeightB,uTubeA,uTubeB,uSky;
uniform float uFamA,uFamB,uMorph;
uniform vec4 uVarA,uVarB;
uniform float uW;
uniform vec3 uRot;
uniform float uDetune,uEdge,uHaze;
uniform float uTwist,uRoll,uRings,uCymatic;
uniform vec4 uModes;
uniform float uModeMix;
uniform vec3 uHue,uHue2,uAccent;
uniform float uFlex,uHit,uPulse,uPulseAmp,uFog,uLens,uSpectrum;

uniform vec3 uEPos;
uniform float uEScale,uEYaw,uEFolds,uEOpen,uEGlow,uLight;
uniform vec4 uF0,uF1,uF2;
uniform vec3 uECol,uECol2;

#define PI 3.14159265
#define TAU 6.28318531

mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,s,-s,c);}
float hash13(vec3 p3){p3=fract(p3*.1031);p3+=dot(p3,p3.zyx+31.32);return fract((p3.x+p3.y)*p3.z);}
float vnoise(vec3 p){
 vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(mix(hash13(i),hash13(i+vec3(1,0,0)),f.x),mix(hash13(i+vec3(0,1,0)),hash13(i+vec3(1,1,0)),f.x),f.y),
  mix(mix(hash13(i+vec3(0,0,1)),hash13(i+vec3(1,0,1)),f.x),mix(hash13(i+vec3(0,1,1)),hash13(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float sdSeg(vec3 p,vec3 a,vec3 b){vec3 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*h);}
vec3 spectrum(float h){return clamp(abs(mod(h*6.+vec3(0.,4.,2.),6.)-3.)-1.,0.,1.);}
float mid3(vec3 a){return max(min(a.x,a.y),min(max(a.x,a.y),a.z));}

// ---------------------------------------------------------------- the creature
// A mandala of branching tendrils. Space is folded bilaterally and n ways around the core, and in
// each wedge one tree grows outward: a curved stem that forks at its tip, again and again, each
// generation smaller. uF0 = (stem length, bend, fork spread, shrink), uF1 = (twist out of plane,
// root offset, tip curl, crown), uF2 = (thickness, spikes, core ring, phase).
// trap = generation of the nearest branch (0 core .. 1 tips).
float tree(vec3 q,float L,out float trap){
 float d=1e9,s=1.;trap=0.;
 for(int i=0;i<6;i++){
  vec3 c=q;
  c.y-=uF0.y*c.x*c.x/max(L,.1)*.5;                 // bend the stem
  c.y+=uF1.z*smoothstep(.5*L,L,c.x)*(c.x-.5*L)*1.5; // curl toward the tip
  float h=clamp(c.x/L,0.,1.);
  float stem=length(c-vec3(h*L,0.,0.))-uF2.x*(1.-.55*h);
  // fine spikes along the stem, like hairs on an insect leg
  float sx=(fract(c.x*5./L+uF2.w)-.5)*L/5.;
  float spike=length(vec3(sx,max(abs(c.y)-uF2.y*.2*(1.-.6*h),0.),c.z))-.01;
  spike=max(spike,max(-c.x,c.x-L));
  stem=min(stem,spike);
  float dd=stem/s*.8;
  if(dd<d){d=dd;trap=float(i)/5.;}
  // fork: move to the tip, mirror, spread, shrink
  q.x-=L;
  q.y=abs(q.y);
  q.xy*=rot(-uF0.z);
  q.xz*=rot(uF1.x);
  q.z=abs(q.z)-.05*uF1.w;
  q*=uF0.w;s*=uF0.w;
 }
 return d;
}
// A true 3D kaleidoscope: space folds into one fundamental domain of a regular polyhedron's
// symmetry group (tetrahedral, octahedral or icosahedral: 24, 48 or 120 mirror images), after
// Knighty's polyhedral folding. Trees grow toward the polyhedron's vertices; the crown grows
// toward its face centres; a thin wire traces its edges.
float entity(vec3 p,out float trap){
 trap=0.;
 vec3 q=(p-uEPos)/uEScale;
 float bound=length(q)-3.4;
 if(bound>.4)return bound*uEScale;
 q.xz*=rot(uEYaw);q.yz*=rot(.55+.2*sin(uEYaw*.7));
 float cospin=cos(PI/uEFolds),scospin=sqrt(max(.75-cospin*cospin,0.));
 vec3 nc=vec3(-.5,-cospin,scospin);
 for(int i=0;i<5;i++){q.xy=abs(q.xy);q-=2.*min(0.,dot(q,nc))*nc;}
 vec3 pab=vec3(0.,0.,1.),pbc=normalize(vec3(scospin,0.,.5)),pca=normalize(vec3(0.,scospin,cospin));
 // the core: a pupil and the polyhedron's edges
 float R=uF2.z*1.6+.25;
 float d=length(q)-.09;
 d=min(d,sdSeg(q,pab*R,pbc*R*dot(pab,pbc))-.018);
 float ta,tb;
 vec3 up=vec3(0.,1.,0.),y1=normalize(cross(up,pab)),z1=cross(pab,y1);
 vec3 qa=vec3(dot(q,pab),dot(q,y1),dot(q,z1));qa.x-=uF1.y*uEOpen;
 float da=tree(qa,uF0.x*uEOpen,ta);
 if(da<d){d=da;trap=ta;}
 if(uF1.w>.3){
  vec3 y2=normalize(cross(vec3(1.,0.,0.),pca)),z2=cross(pca,y2);
  vec3 qb=vec3(dot(q,pca),dot(q,y2),dot(q,z2));qb.x-=(uF1.y+.3)*uEOpen;
  float db=tree(qb*1.25,uF0.x*.8*uEOpen,tb)/1.25;
  if(db<d){d=db;trap=.35+.65*tb;}
 }
 return d*uEScale;
}

// ---------------------------------------------------------------- the worlds

// ---------------------------------------------------------------- the flight
vec2 path(float z){
 return vec2(uPathA.x*sin(z*uPathF.x)+uPathA.y*sin(z*uPathF.y+1.3),uPathA.z*sin(z*uPathF.z+.7)+uPathA.w*cos(z*uPathF.w));
}

// ---------------------------------------------------------------- the architecture
// Each family returns the distance to its surface in metres; edge.x is the distance to the
// nearest coarse edge and edge.y to the nearest fine edge, also in metres. dt detunes the folds.

// A Menger sponge folded in four dimensions and sliced at w: as w moves the whole structure
// turns through a dimension we cannot see, so its rooms open, close and slide into each other.
float hypersponge(vec3 p,vec4 v,float dt,float cell,out vec2 edge){
 // w swings through the sponge and back (outside [-1, 1] the slice would be empty)
 vec4 q=vec4(p/cell,.92*sin(uW));
 q.xyz=mod(q.xyz+1.,2.)-1.;
 float s=1.,off=1.+.1*v.y,coarse=1e9;
 for(int i=0;i<4;i++){
  q=abs(q);
  if(q.x<q.y)q.xy=q.yx;
  if(q.z<q.w)q.zw=q.wz;
  if(q.x<q.z)q.xz=q.zx;
  if(q.y<q.w)q.yw=q.wy;
  if(q.y<q.z)q.yz=q.zy;
  q.xy*=rot(uRot.y+dt);q.zw*=rot(uRot.z-dt*.5);
  q=q*3.-2.*off;
  if(q.w<-off)q.w+=2.*off;
  if(q.z<-off)q.z+=2.*off;
  s*=3.;
  if(i==1)coarse=(1.-mid3(abs(q.xyz)))/s;
 }
 vec4 b=abs(q)-1.;
 float d=(length(max(b,0.))+min(max(max(b.x,b.y),max(b.z,b.w)),0.))/s*cell;
 edge=vec2(abs(coarse),abs(1.-mid3(abs(q.xyz)))/s)*cell;
 return d;
}

// A pseudo-Kleinian limit set (after Knighty): box folds and sphere inversions that never
// settle, an alien megastructure of bridges, pipes and chambers. The tile is mirror-symmetric in
// every axis, so repeating it by reflection is seamless: a kaleidoscope of the limit set.
float kleinian(vec3 p,vec4 v,float dt,float cell,out vec2 edge){
 // coarser than the other families: its detail is finer, and finer than a pixel reads as noise
 const float S=1.85;
 cell*=1.8;
 vec3 q=(mod(p/cell+1.,2.)-1.)*S;
 vec3 C=vec3(.92436,.90756,.92436)*(1.+.06*(v.xyz-.5));
 float k=1.,size=1.+.08*v.w;
 for(int i=0;i<7;i++){
  q=2.*clamp(q,-C,C)-q;
  float r=max(size/dot(q,q),1.);
  q*=r;k*=r;
  if(i==0)q.xy*=rot(uRot.y*.5+dt);
 }
 float rxy=length(q.xy);
 float d=max(rxy-.92784,abs(rxy*q.z)/length(q))/k;
 float w=cell/S;
 // its detail is finer than any line could be, so it carries no neon edges: it stays dark and
 // organic, lit by the creature, the cymatic figure and the beams that pass through it
 edge=vec2(1e3);
 return d*w;
}

// A cathedral: Menger folds with offset centres, so the holes become arches and galleries.
float cathedral(vec3 p,vec4 v,float dt,float cell,out vec2 edge){
 vec3 q=mod(p/cell+1.,2.)-1.;
 float s=1.,coarse=1e9;
 vec3 off=vec3(1.,1.+.3*v.x,.6+.5*v.y);
 for(int i=0;i<4;i++){
  q=abs(q);
  if(q.x<q.y)q.xy=q.yx;
  if(q.x<q.z)q.xz=q.zx;
  if(q.y<q.z)q.yz=q.zy;
  q.yz*=rot(uRot.y*.6+dt);
  q=q*3.-2.*off;
  if(q.z<-off.z)q.z+=2.*off.z;
  s*=3.;
  if(i==1)coarse=(1.-mid3(abs(q)))/s;
 }
 vec3 b=abs(q)-1.;
 float d=(length(max(b,0.))+min(max(b.x,max(b.y,b.z)),0.))/s*cell;
 edge=vec2(abs(coarse),abs(1.-mid3(abs(q)))/s)*cell;
 return d;
}

float family(float id,vec3 p,vec4 v,float dt,float cell,out vec2 edge){
 if(id<.5)return hypersponge(p,v,dt,cell,edge);
 if(id<1.5)return kleinian(p,v,dt,cell,edge);
 return cathedral(p,v,dt,cell,edge);
}

// Cymatic frames: nested rings down the tunnel whose outline is a vibrating circular membrane,
// r(θ) = R(1 + a cos mθ + b cos 2mθ), with m from the chord; each frame is turned a little
// further than the last, so they spiral like a staircase into the distance.
float rings(vec3 p,float dt,out vec2 edge){
 vec2 c=p.xy-path(p.z);
 float spacing=4.2;
 float idx=floor(p.z/spacing+.5),z=p.z-idx*spacing;
 float ang=atan(c.y,c.x)+idx*.22+uRot.y*1.5;
 float r=length(c);
 // integer lobe counts never interpolate: the outlines of the old and new chord crossfade
 float wobA=.16*cos(uModes.x*ang+dt*6.)+.07*cos(2.*uModes.x*ang-uBeats*.5);
 float wobB=.16*cos(uModes.z*ang+dt*6.)+.07*cos(2.*uModes.z*ang-uBeats*.5);
 float R=uTunnelR*1.25*(1.+mix(wobA,wobB,uModeMix))*(1.+.1*uFlex);
 // a thin wire of light, like a scope trace strung across the tunnel
 float a=.007*uTunnelR,b=.007*spacing;
 float dr=abs(r-R)-a,dz=abs(z)-b;
 float rim=length(vec2(dr,dz));
 edge=vec2(rim,rim*1.6);
 return max(dr,dz)*.55;
}

// The empty space of each place (negative inside it). R is the tube radius, H the place's height.
//   tunnel     a tube along the path, widening into a chamber around the creature (a hall when R is large)
//   landscape  everything below the flight: a fractal city seen from above, open sky over it
//   strata     a floor and a ceiling: flying between two layers of the structure
//   islands    open space; the structure survives only in floating pieces, mirrored either side
//   chambers   the tunnel opens every 90 m into a great round room
float freeSpace(float id,vec3 p,vec2 local,float R,float H){
 float dz=(p.z-uEPos.z)/(4.*uEScale);
 float tube=length(local)-R*(1.+.12*uFlex)*(1.+.55*exp(-dz*dz));
 if(id<.5)return tube;
 if(id<1.5)return -H-local.y;
 if(id<2.5)return abs(local.y)-H;
 if(id<3.5){
  // two rows either side: flat mesas close by, great floating masses further out
  float cell=floor((p.z+22.)/44.),cell2=floor((p.z+45.)/90.);
  vec3 c=vec3(abs(local.x)-21.,local.y-14.*(hash13(vec3(cell,3.,1.))-.5),mod(p.z+22.,44.)-22.);
  c.y*=1.7;
  float near=(length(c)-9.-6.*hash13(vec3(cell,7.,2.)))/1.7;
  vec3 c2=vec3(abs(local.x)-52.,local.y-30.*(hash13(vec3(cell2,5.,3.))-.3),mod(p.z+45.,90.)-45.);
  float farther=length(c2)-20.-10.*hash13(vec3(cell2,9.,4.));
  return min(tube,-min(near,farther));
 }
 float zc=mod(p.z+45.,90.)-45.;
 return min(tube,length(vec3(local,zc))-H);
}

// The world: two families blended while one melts into the next, twisted into a vortex around
// the flight path, the cymatic frames threaded through it, the tunnel carved out, and room left
// around the creature. A uniform-zero loop keeps ANGLE from inlining the families twice.
float gRing=0.; // set by map: 1 where the nearest surface is a cymatic frame
float map(vec3 p,float dt,out vec2 edge){
 float d=0.;edge=vec2(0.);float wsum=0.;gRing=0.;
 vec2 axis=path(p.z),local=p.xy-axis;
 float rr=length(local);
 // the vortex is anchored at the camera, so changing its rate never flings the far world around
 vec3 q=vec3(axis+local*rot((p.z-uCamPos.z)*uTwist+uRoll),p.z);
 for(int k=uZero;k<2;k++){
  float w=k==0?1.-uMorph:uMorph;
  if(w<=.001)continue;
  vec2 e;
  // each scene keeps its own cell size; a morph crossfades the two fields, it never rescales space
  d+=w*family(k==0?uFamA:uFamB,q,k==0?uVarA:uVarB,dt,k==0?uCellA:uCellB,e);
  edge+=w*e;wsum+=w;
 }
 d/=max(wsum,1e-3);edge/=max(wsum,1e-3);
 d/=1.+abs(uTwist)*rr;
 if(uRings>.01){vec2 er;float dr=rings(p,dt,er);if(dr<d){d=dr;edge=er*.5;gRing=1.;}}
 // carve the place: when one place melts into the next, the empty space itself morphs
 // (a tunnel's walls fall away into open sky, a floor rises into a ceiling)
 float fa=freeSpace(uPlaceA,p,local,uTubeA,uHeightA);
 float fb=uMorph>.001?freeSpace(uPlaceB,p,local,uTubeB,uHeightB):fa;
 d=max(d,-mix(fa,fb,uMorph));
 return d;
}
vec3 normalAt(vec3 p,float e){
 vec3 n=vec3(0.);vec2 ed;
 for(int i=uZero;i<4;i++){
  vec3 k=.5773*(2.*vec3(float(((i+3)>>1)&1),float((i>>1)&1),float(i&1))-1.);
  n+=k*map(p+k*e,0.,ed);
 }
 return normalize(n);
}
float occlusion(vec3 p,vec3 n){
 float o=0.,s=1.;vec2 ed;
 for(int i=uZero;i<4;i++){
  float h=.08+.35*float(i);
  o+=(h-map(p+n*h,0.,ed))*s;s*=.6;
 }
 return clamp(1.-o*.9,0.,1.);
}

// ---------------------------------------------------------------- sky
// Open places look out into space: a nebula in the section's colours, a glow along the horizon, stars.
vec3 sky(vec3 rd){
 float n=vnoise(rd*2.5+vec3(0.,0.,uTime*.01))*.65+vnoise(rd*6.1)*.35;
 vec3 neb=mix(uHue2,uHue,n)*pow(n,2.5)*.4;
 float horizon=exp(-abs(rd.y)*5.)*.16;
 vec3 q=rd*420.;float h=hash13(floor(q));
 float star=step(.9965,h)*max(0.,1.-length(fract(q)-.5)*2.2)*(.6+2.*fract(h*91.7));
 return neb+mix(uHue,uAccent,.3)*horizon+vec3(star);
}

// ---------------------------------------------------------------- light
vec3 lightCol(){return uECol*uLight;}
float inscatter(vec3 ro,vec3 rd,vec3 L,float T){
 vec3 q=ro-L;float b=dot(rd,q),c=dot(q,q);float h=sqrt(max(c-b*b,1e-4));
 return (atan((T+b)/h)-atan(b/h))/h;
}
// Neon colour at a point: the section's palette running into a spectrum along the flight.
vec3 neonTint(vec3 p){
 vec3 spec=spectrum(fract(p.z*.012+uTime*.03+uSpectrum));
 return mix(mix(uHue,uHue2,.5+.5*sin(p.z*.05+uBeats*.25)),spec,.35);
}
float lineOf(float d,float width){return exp(-d*d/(width*width));}

// Chladni figure on the walls, in tunnel coordinates (angle around the path, distance along it):
// the free-plate superposition cos(mθ)cos(k s) - cos(nθ)cos(k' s); its nodal lines glow.
float plate(float th,float s,float m,float n){return (cos(m*th)*cos(n*s)-cos(n*th)*cos(m*s))/(length(vec2(m,n))*1.4);}
float chladni(vec3 p){
 vec2 c=p.xy-path(p.z);
 float th=atan(c.y,c.x),s=p.z*.35;
 // the chord's pair of modes; on a chord change the old figure's coefficients fade into the new
 return abs(mix(plate(th,s,uModes.x,uModes.y),plate(th,s,uModes.z,uModes.w),uModeMix));
}

vec3 shade(vec3 p,vec3 n,vec3 rd,vec2 edge,float t,float ring,out float refl){
 float along=abs(p.z-uEPos.z);
 float wave=exp(-abs(along-uPulse)*.9)*uPulseAmp;
 // the cymatic frames are wires of light, not metal: no reflection, their own colour
 if(ring>.5){refl=0.;return neonTint(p)*uEdge*(1.2+3.*wave);}
 vec3 L=uEPos-p;float dl=length(L);L/=dl;
 vec3 lc=lightCol()/(1.+.06*dl*dl);
 float dif=max(dot(n,L),0.);
 float spe=pow(max(dot(n,normalize(L-rd)),0.),60.);
 float fres=pow(1.-max(dot(-rd,n),0.),4.);
 float ao=occlusion(p,n);
 refl=.12+.55*fres;
 // Edges with width: the coarse lines are wide and bright, the fine lines thin; with detune the
 // red and blue copies come from folds turned slightly either way, like detuned oscillators.
 float w=max(.02,t*.0028)*(1.+.8*uFlex);
 vec2 eR=edge,eB=edge;
 if(uDetune>.001){map(p,uDetune,eR);map(p,-uDetune,eB);}
 vec3 lines=vec3(
  lineOf(eR.x,w*2.2)*1.3+lineOf(eR.y,w)*.7,
  lineOf(edge.x,w*2.2)*1.3+lineOf(edge.y,w)*.7,
  lineOf(eB.x,w*2.2)*1.3+lineOf(eB.y,w)*.7);
 vec3 tint=neonTint(p);
 // the walls are dark, tinted metal: the creature's light glints off them, the neon edges do the rest
 vec3 col=lc*(dif*.16+spe*1.)*mix(vec3(.14),tint*.4,.7)*ao;
 col+=tint*lines*uEdge*(.55+2.6*wave)*(.35+.65*ao);
 if(uCymatic>.01)col+=mix(uAccent,tint,.4)*lineOf(chladni(p),.045+.02*uFlex)*uCymatic*(.4+1.6*wave)*ao;
 col+=tint*.004*ao;
 return col;
}

// March the world, gathering the creature's glow and the neon light that bleeds from the edges.
float march(vec3 ro,inout vec3 rd,float tmax,int steps,out vec2 edge,out vec3 pos,inout vec3 glow){
 float t=.05;vec3 p=ro+rd*t;edge=vec2(1e3);
 for(int i=0;i<180;i++){
  if(i>=steps)break;
  // the raymarched being is optional: when the beam creature stands in for it, only its light remains
  float tr=0.,de=1e3;if(uEGlow>0.)de=entity(p,tr);
  vec2 ed;float dw=map(p,0.,ed);
  float w=max(.005,t*.0013);
  float h=min(dw,max(de*.7,w*1.2));
  vec3 ec=mix(uECol,uECol2,smoothstep(.2,1.,tr));
  ec=mix(ec*1.3+vec3(.12)*length(ec),ec,smoothstep(0.,.3,tr));
  glow+=ec*(exp(-de*de/(w*w))*1.3+exp(-de*14.)*.008)*uEGlow*min(h,.3)/max(w*8.,.04);
  // neon haze: light scattered by the air right beside every lit edge
  // (not around the frames: there it would swell their rims into fat tubes)
  float near=exp(-dw*2.5)*(lineOf(ed.x,.35)+.5*lineOf(ed.y,.18))*(1.-.9*gRing);
  glow+=neonTint(p)*near*uHaze*min(h,.5)*(1.-smoothstep(10.,60.,t));
  if(dw<.0012*t){edge=ed;pos=p;return t;}
  if(uLens>0.){vec3 toE=uEPos-p;float r2=max(dot(toE,toE),9.);rd=normalize(rd+toE*inversesqrt(r2)*uLens*min(h,2.)/r2);}
  p+=rd*h;t+=h;
  if(t>tmax)break;
 }
 pos=p;edge=vec2(1e3);
 return -1.;
}

void main(){
 vec2 uv=(gl_FragCoord.xy-.5*uRes)/uRes.y;
 vec3 rd=normalize(uCamRot*vec3(uv*2.*uTanFov,-1.));
 vec3 ro=uCamPos;
 vec3 col=vec3(0.),through=vec3(1.);
 float dist=1e4;
 vec3 fogCol=mix(uHue,uHue2,.5)*.006;
 for(int bounce=uZero;bounce<2;bounce++){
  vec3 glow=vec3(0.);vec2 edge;vec3 p;
  float tmax=bounce==0?110.:40.;
  float t=march(ro,rd,tmax,bounce==0?170:70,edge,p,glow);
  float ring=gRing;
  bool hit=t>0.;
  float tt=hit?t:tmax;
  // haze thins into sky in the open places; the far end of the march fades into it, never pops
  vec3 far=uSky>.01?mix(fogCol,sky(rd),uSky):fogCol;
  vec3 c=far;float refl=0.;vec3 n=vec3(0.,1.,0.);
  if(hit){n=normalAt(p,.0012*t+.001);c=shade(p,n,rd,edge,t,ring,refl);if(bounce==0)dist=t;
   c=mix(c,far,max(1.-exp(-t*uFog),smoothstep(tmax*.55,tmax,t)));}
  c+=lightCol()*inscatter(ro,rd,uEPos,tt)*uFog*.1;
  glow/=1.+.3*max(glow.r,max(glow.g,glow.b));
  col+=through*(c+glow);
  if(!hit||refl<.02||bounce==1)break;
  through*=refl*vec3(.8,.85,1.);
  vec3 rr=reflect(rd,n);
  rr=normalize(rr+.035*vec3(vnoise(p*4.)-.5,vnoise(p*4.+7.)-.5,vnoise(p*4.+13.)-.5));
  ro=p+n*.02;rd=rr;
 }
 // a soft ceiling that keeps the hue: bright neon saturates to its colour instead of burning white
 col=max(col,0.);float m=max(col.r,max(col.g,col.b));col*=1./(1.+.18*m*m);
 fragColor=vec4(col,dist);
}
`;

const compositeFragment=/* glsl */`
precision highp float;
uniform sampler2D tUniverse;
uniform vec2 uRes;
uniform vec3 uCamPos;
uniform mat3 uCamRot;
uniform float uTanFov;
uniform mat4 uViewProj;
out vec4 fragColor;
void main(){
 vec4 u=texture(tUniverse,gl_FragCoord.xy/uRes);
 // distance is never filtered: blending a surface with the sky sentinel would put it behind the far plane
 u.a=texelFetch(tUniverse,ivec2(gl_FragCoord.xy/uRes*vec2(textureSize(tUniverse,0))),0).a;
 vec2 uv=(gl_FragCoord.xy-.5*uRes)/uRes.y;
 vec3 rd=normalize(uCamRot*vec3(uv*2.*uTanFov,-1.));
 float depth=1.;
 if(u.a<5e3){vec4 c=uViewProj*vec4(uCamPos+rd*u.a,1.);depth=clamp(c.z/c.w*.5+.5,0.,1.);}
 fragColor=vec4(u.rgb,1.);
 gl_FragDepth=depth;
}
`;
export {compositeFragment};

export interface EntityState {
 position:THREE.Vector3;scale:number;yaw:number;folds:number;open:number;glow:number;light:number;
 form:[THREE.Vector4,THREE.Vector4,THREE.Vector4];color:THREE.Color;tip:THREE.Color;
}
export interface UniverseState {
 time:number;beats:number;
 pathA:THREE.Vector4;pathF:THREE.Vector4;tunnel:number;cellA:number;cellB:number;
 placeA:number;placeB:number;heightA:number;heightB:number;tubeA:number;tubeB:number;sky:number;
 familyA:number;familyB:number;morph:number;varA:THREE.Vector4;varB:THREE.Vector4;
 w:number;rot:THREE.Vector3;detune:number;edge:number;haze:number;spectrum:number;
 twist:number;roll:number;rings:number;cymatic:number;modes:THREE.Vector4;modeMix:number;
 hue:THREE.Color;hue2:THREE.Color;accent:THREE.Color;
 flex:number;hit:number;pulse:number;pulseAmp:number;fog:number;lens:number;
 entity:EntityState;
}

/** The raymarch runs at a fraction of the screen resolution (it is by far the heaviest pass);
 * a full-resolution composite quad then puts its colour and its depth into the main scene. */
export function createUniverse(){
 const uniforms={
  uRes:{value:new THREE.Vector2(1,1)},uCamPos:{value:new THREE.Vector3()},uCamRot:{value:new THREE.Matrix3()},
  uTanFov:{value:Math.tan(THREE.MathUtils.degToRad(30))},uViewProj:{value:new THREE.Matrix4()},
  uTime:{value:0},uBeats:{value:0},uZero:{value:0},
  uPathA:{value:new THREE.Vector4()},uPathF:{value:new THREE.Vector4()},uTunnelR:{value:3},uCellA:{value:10},uCellB:{value:10},
  uPlaceA:{value:0},uPlaceB:{value:0},uHeightA:{value:6},uHeightB:{value:6},uTubeA:{value:3},uTubeB:{value:3},uSky:{value:0},
  uFamA:{value:0},uFamB:{value:0},uMorph:{value:0},uVarA:{value:new THREE.Vector4()},uVarB:{value:new THREE.Vector4()},
  uW:{value:0},uRot:{value:new THREE.Vector3()},uDetune:{value:0},uEdge:{value:1},uHaze:{value:.02},uSpectrum:{value:0},
  uTwist:{value:0},uRoll:{value:0},uRings:{value:0},uCymatic:{value:0},uModes:{value:new THREE.Vector4(4,5,4,5)},uModeMix:{value:0},
  uHue:{value:new THREE.Color()},uHue2:{value:new THREE.Color()},uAccent:{value:new THREE.Color()},
  uFlex:{value:0},uHit:{value:0},uPulse:{value:0},uPulseAmp:{value:0},uFog:{value:.02},uLens:{value:0},
  uEPos:{value:new THREE.Vector3()},uEScale:{value:1},uEYaw:{value:0},uEFolds:{value:5},uEOpen:{value:1},uEGlow:{value:1},uLight:{value:1},
  uF0:{value:new THREE.Vector4(.6,.4,.3,1.45)},uF1:{value:new THREE.Vector4(.3,.2,.1,.8)},uF2:{value:new THREE.Vector4(.03,.4,0,0)},
  uECol:{value:new THREE.Color()},uECol2:{value:new THREE.Color()},
 };
 const quad=new THREE.PlaneGeometry(2,2);
 const material=new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,vertexShader,fragmentShader:universeFragment,uniforms,depthTest:false,depthWrite:false});
 const marchMesh=new THREE.Mesh(quad,material);marchMesh.frustumCulled=false;
 const marchScene=new THREE.Scene();marchScene.add(marchMesh);
 const marchCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
 const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:false,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});
 const u=uniforms;
 const compositeUniforms={tUniverse:{value:target.texture},uRes:{value:new THREE.Vector2(1,1)},uCamPos:u.uCamPos,uCamRot:u.uCamRot,uTanFov:u.uTanFov,uViewProj:u.uViewProj};
 const composite=new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,vertexShader,fragmentShader:compositeFragment,uniforms:compositeUniforms,
  depthTest:true,depthWrite:true,depthFunc:THREE.AlwaysDepth});
 const mesh=new THREE.Mesh(quad,composite);
 mesh.frustumCulled=false;mesh.renderOrder=-1000;mesh.name='universe';
 let scale=.5;
 function update(s:UniverseState){
  u.uTime.value=s.time;u.uBeats.value=s.beats;
  u.uPathA.value.copy(s.pathA);u.uPathF.value.copy(s.pathF);u.uTunnelR.value=s.tunnel;u.uCellA.value=s.cellA;u.uCellB.value=s.cellB;
  u.uPlaceA.value=s.placeA;u.uPlaceB.value=s.placeB;u.uHeightA.value=s.heightA;u.uHeightB.value=s.heightB;u.uTubeA.value=s.tubeA;u.uTubeB.value=s.tubeB;u.uSky.value=s.sky;
  u.uFamA.value=s.familyA;u.uFamB.value=s.familyB;u.uMorph.value=s.morph;u.uVarA.value.copy(s.varA);u.uVarB.value.copy(s.varB);
  u.uW.value=s.w;u.uRot.value.copy(s.rot);u.uDetune.value=s.detune;u.uEdge.value=s.edge;u.uHaze.value=s.haze;u.uSpectrum.value=s.spectrum;
  u.uTwist.value=s.twist;u.uRoll.value=s.roll;u.uRings.value=s.rings;u.uCymatic.value=s.cymatic;u.uModes.value.copy(s.modes);u.uModeMix.value=s.modeMix;
  u.uHue.value.copy(s.hue);u.uHue2.value.copy(s.hue2);u.uAccent.value.copy(s.accent);
  u.uFlex.value=s.flex;u.uHit.value=s.hit;u.uPulse.value=s.pulse;u.uPulseAmp.value=s.pulseAmp;u.uFog.value=s.fog;u.uLens.value=s.lens;
  const e=s.entity;
  u.uEPos.value.copy(e.position);u.uEScale.value=e.scale;u.uEYaw.value=e.yaw;u.uEFolds.value=e.folds;u.uEOpen.value=e.open;
  u.uEGlow.value=e.glow;u.uLight.value=e.light;
  u.uF0.value.copy(e.form[0]);u.uF1.value.copy(e.form[1]);u.uF2.value.copy(e.form[2]);
  u.uECol.value.copy(e.color);u.uECol2.value.copy(e.tip);
 }
 const viewProj=new THREE.Matrix4();
 /** March the world for this camera into the low-resolution target. Call before the main render. */
 function march(renderer:THREE.WebGLRenderer,camera:THREE.PerspectiveCamera,width:number,height:number){
  camera.updateMatrixWorld();
  const w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale));
  if(target.width!==w||target.height!==h)target.setSize(w,h);
  u.uRes.value.set(w,h);compositeUniforms.uRes.value.set(width,height);
  u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
  u.uCamRot.value.setFromMatrix4(camera.matrixWorld);
  u.uTanFov.value=Math.tan(THREE.MathUtils.degToRad(camera.fov)/2);
  viewProj.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);u.uViewProj.value.copy(viewProj);
  const previous=renderer.getRenderTarget();
  renderer.setRenderTarget(target);renderer.render(marchScene,marchCamera);renderer.setRenderTarget(previous);
 }
 function dispose(){quad.dispose();material.dispose();composite.dispose();target.dispose();}
 return {objects:[mesh] as THREE.Object3D[],uniforms,update,march,dispose,
  get scale(){return scale;},set scale(v:number){scale=Math.max(.2,Math.min(1,v));}};
}
