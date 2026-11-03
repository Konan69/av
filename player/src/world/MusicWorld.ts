import * as THREE from 'three';
import type {Signals} from '../conductor';
import type {WorldSeed} from '../seed';
import {sampleResonance} from './resonance';
import {sectionLook,blendLook} from './palette';
import {createUniverse,pathAt,FAMILY_NAMES,PLACE_NAMES,type UniverseState} from './universe';
import {createMotes} from './motes';
import {sceneAt,creatureAt,shotAt,rng,hashOf,flightTable,flightAt,type Mood,type ShotKind,type Timeline} from './director';
import {createBeams,GATES,GATE_SEGS,HARMONICS,STROKE_SEGS,newStrokes,type GateState,type CreatureState} from './beams';
import {createPost} from './post';

export interface WorldControls {punch:number;bass:number;detail:number;glow:number}
export interface MusicWorldOptions {seed?:WorldSeed;labels?:string[];timeline?:Timeline}
const defaults:WorldControls={punch:1,bass:1,detail:1,glow:1};
const TAU=Math.PI*2;
const clamp=(v:number,max=1)=>Math.max(0,Math.min(max,Number.isFinite(v)?v:0));
const ease=(v:number)=>{const x=clamp(v);return x*x*(3-2*x);};
const smooth=(a:number,b:number,v:number)=>ease((v-a)/(b-a));
const wrap=(h:number)=>((h%1)+1)%1;
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;

const LENS:Record<Mood,number>={calm:.04,rise:.06,peak:.12,dream:.1};
const AHEAD:Record<Mood,number>={calm:13,rise:12,peak:11,dream:14};
// scope waveforms (sine, triangle, square): smooth in calm passages, woven and hard-cornered in drops
const WAVE:Record<Mood,[number,number,number]>={calm:[1,0,0],dream:[.65,.35,0],rise:[.25,.75,0],peak:[.15,.35,.5]};
const GATE_SPACING=26;
const mixHue=(a:number,b:number,t:number)=>{let d=b-a;if(d>.5)d-=1;if(d<-.5)d+=1;return wrap(a+d*t);};

/** A chord's just ratios as a harmonograph: harmonic a drives x, b drives y, c drives the depth,
 * each axis with a little of the next ratio woven in. Integer harmonics never interpolate; a chord
 * change crossfades these weights over a shared fundamental. */
function harmonics(ratios:[number,number,number]|undefined,out:THREE.Vector3[]){
 for(const v of out)v.set(0,0,0);
 let [a,b,c]=ratios??[2,3,4];
 while(Math.max(a,b,c)>HARMONICS){a=Math.max(1,Math.round(a/2));b=Math.max(1,Math.round(b/2));c=Math.max(1,Math.round(c/2));}
 out[a-1].x+=1;out[b-1].x+=.3;
 out[b-1].y+=1;out[c-1].y+=.25;
 out[c-1].z+=1;out[a-1].z+=.2;
 let sx=0,sy=0,sz=0;for(const v of out){sx+=v.x;sy+=v.y;sz+=v.z;}
 for(const v of out)v.set(v.x/sx,v.y/sy,v.z/sz);
}

/** A chord's figure ratios as a Chladni mode pair (m, n): the first two just-intonation
 * frequencies, halved until they fit, never equal (equal modes cancel to nothing). */
function modePair(ratios:[number,number,number]|undefined,shift:number):[number,number]{
 if(!ratios)return [4,5];
 let a=ratios[shift%2],b=ratios[shift%2+1];
 while(a>8||b>8){a=Math.max(1,Math.round(a/2));b=Math.max(1,Math.round(b/2));}
 if(a<3){const k=Math.ceil(3/a);a*=k;b*=k;while(b>9)b-=a;}
 if(b===a)b=a+1;
 return [a,b];
}

/** A flight through kaleidoscopic fractal architecture, directed by the music.
 *
 * The camera flies down a tunnel carved through endless 3D and 4D kaleidoscopes, through
 * harmonograph sheets drawn by a detuned scope beam, toward a creature of light — a mirrored
 * mandala of curling tendrils — that lights the way and becomes a new being on every hit.
 *
 *   section / 8-bar block   -> the architecture (hypersponge, kleinian, cathedral), its cell size,
 *                              vortex twist and cymatic layers; each block melts into the next
 *                              over its last bar or two
 *   section energy          -> flight speed: a buildup accelerates into the drop
 *   harmony                 -> the harmonograph gates, the Chladni figure on the walls and the lobes
 *                              of the ring frames, all from the chord's just-intonation ratios
 *   drums                   -> the creature's form (one per hit in a drop), the surge on the kick,
 *                              the light wave down the tunnel, sparks
 *   bass                    -> detune (edges split into red and blue copies), bounded flex
 *
 * Every value is a function of the sampled signals, so seeking reproduces the frame
 * (the afterglow in post aside). */
export function createMusicWorld(scene:THREE.Scene,camera?:THREE.PerspectiveCamera,options:MusicWorldOptions={}) {
 const seed=options.seed;
 const seedNumber=hashOf(JSON.stringify(seed??{}));
 const root=new THREE.Group();root.name='AV / fractal flight';scene.add(root);
 const background=scene.background,fog=scene.fog,worldBackground=new THREE.Color(0x000000);
 scene.background=worldBackground;scene.fog=null;

 const universe=createUniverse();
 const motes=createMotes(seedNumber);
 const beams=createBeams();
 const parts={universe,motes,beams};
 for(const object of [...universe.objects,...beams.objects,...motes.objects])root.add(object);
 const flight=flightTable(options.timeline);

 const view=new THREE.PerspectiveCamera(70,1,.05,400);
 const entity=new THREE.Vector3();
 const camPos=new THREE.Vector3(),camTarget=new THREE.Vector3();
 let camRoll=0,camFov=70;
 const hue=new THREE.Color(),hue2=new THREE.Color(),accent=new THREE.Color(),eCol=new THREE.Color(),eTip=new THREE.Color();
 const pathA=new THREE.Vector4(),pathF=new THREE.Vector4();
 {const r=rng(seedNumber,'path');
  pathA.set(1.4+1.2*r(),.6+.8*r(),1.1+.9*r(),.4+.6*r());
  pathF.set(.035+.02*r(),.07+.03*r(),.042+.02*r(),.022+.015*r());}
 const uState:UniverseState={time:0,beats:0,pathA,pathF,tunnel:3,cellA:10,cellB:10,familyA:0,familyB:0,morph:0,
  placeA:0,placeB:0,heightA:6,heightB:6,tubeA:3,tubeB:3,sky:0,
  varA:new THREE.Vector4(),varB:new THREE.Vector4(),w:0,rot:new THREE.Vector3(),detune:0,edge:1,haze:.02,spectrum:0,
  twist:0,roll:0,rings:0,cymatic:0,modes:new THREE.Vector4(4,5,4,5),modeMix:0,
  hue,hue2,accent,flex:0,hit:0,pulse:0,pulseAmp:0,fog:.012,lens:0,
  entity:{position:entity,scale:1,yaw:0,folds:5,open:1,glow:0,light:1,form:[new THREE.Vector4(),new THREE.Vector4(),new THREE.Vector4()],color:eCol,tip:eTip}};
 const gateState:GateState={time:0,ampA:Array.from({length:HARMONICS},()=>new THREE.Vector3()),ampB:Array.from({length:HARMONICS},()=>new THREE.Vector3()),
  mix:0,phase:new THREE.Vector3(),wave:new THREE.Vector3(1,0,0),sharp:3,spread:.2,detune:.01,drift:.1,damp:1.2,cycles:6,width:1.4,energy:.5,ref:.1,fog:.01,
  colA:new THREE.Color(),colB:new THREE.Color(),gates:Array.from({length:GATES},()=>({matrix:new THREE.Matrix4(),intensity:0,phase:0,size:2,depth:2.5}))};
 {const r=rng(seedNumber,'phase');gateState.phase.set(r()*TAU,Math.PI/2+r()*.6,Math.PI/4+r()*TAU);}
 const creatureState:CreatureState={time:0,strokesA:newStrokes(),strokesB:newStrokes(),formMix:1,fold:5,open:1,subSpread:.012,
  matrix:new THREE.Matrix4(),colors:[new THREE.Color(),new THREE.Color(),new THREE.Color()],width:1.3,energy:.5,bright:1,ref:.03,fog:.01};
 const worldUp=new THREE.Vector3(0,1,0),fwd=new THREE.Vector3(),right=new THREE.Vector3(),up=new THREE.Vector3();
 const gp=new THREE.Vector3(),gq=new THREE.Vector3(),turn=new THREE.Matrix4(),turn2=new THREE.Matrix4(),scaleV=new THREE.Vector3();
 /** A frame on the path at depth z: forward along the flight, up as near world-up as it can be. */
 const frameAt=(z:number,out:THREE.Matrix4)=>{
  onPath(z,gp);onPath(z-1,gq);fwd.subVectors(gp,gq).normalize();
  right.crossVectors(worldUp,fwd).normalize();up.crossVectors(fwd,right);
  return out.makeBasis(right,up,fwd).setPosition(gp);
 };

 let post:ReturnType<typeof createPost>|null=null,postRenderer:THREE.WebGLRenderer|null=null;
 let settings={persistence:.6,bloom:.8,fringe:.0015,flash:0,grain:.04,seed:0};
 let disposed=false,lastTime=Number.NaN;
 /** Layer switches for inspection (probe scripts); the show always draws everything. */
 const debug={motes:true,gates:true,creature:true,universe:true,rings:true,haze:1,edge:1,lens:1,cymatic:1};
 const lateral=new THREE.Vector2(),lateral2=new THREE.Vector2(),lateral3=new THREE.Vector2();
 const onPath=(z:number,out:THREE.Vector3)=>{pathAt(z,pathA,pathF,lateral);return out.set(lateral.x,lateral.y,z);};

 interface Pose {pos:THREE.Vector3;target:THREE.Vector3;entity:THREE.Vector3;roll:number;fov:number}
 const newPose=():Pose=>({pos:new THREE.Vector3(),target:new THREE.Vector3(),entity:new THREE.Vector3(),roll:0,fov:70});
 const poseNow=newPose(),poseBefore=newPose();
 const fo=new THREE.Vector3(),fx=new THREE.Vector3(),fy=new THREE.Vector3(),fa=new THREE.Vector3(),tmp=new THREE.Vector3();
 /** The path's frame at depth z: origin, right, up and ahead (the direction of flight). */
 const pathFrame=(z:number)=>{onPath(z,fo);onPath(z-1,tmp);fa.subVectors(tmp,fo).normalize();fx.crossVectors(fa,worldUp).normalize();fy.crossVectors(fx,fa);};
 /** One shot of the flight at depth zc: the camera, what it looks at, and where the creature is. */
 function pose(kind:ShotKind,u:number,r:()=>number,zc:number,R:number,ahead:number,out:Pose){
  const a0=r()*TAU,dir=r()<.5?-1:1,j=r();
  out.roll=0;out.fov=70;
  pathFrame(zc);out.pos.copy(fo);
  onPath(zc-ahead,out.entity);
  switch(kind){
   case 'forward':onPath(zc-ahead*.6,out.target).lerp(out.entity,.5);break;
   case 'spiral':{const phi=a0+dir*Math.PI*u,rho=R*.5;
    out.pos.addScaledVector(fx,Math.cos(phi)*rho).addScaledVector(fy,Math.sin(phi)*rho);
    out.target.copy(out.entity);out.roll=dir*Math.PI*u*.7;out.fov=74;break;}
   case 'orbit':{const D=8+2*j;onPath(zc-D,out.entity);pathFrame(zc-D);
    const th=a0+dir*1.5*u,rho=Math.min(R*1.1,5.5);
    out.pos.copy(out.entity).addScaledVector(fx,Math.cos(th)*rho).addScaledVector(fy,Math.sin(th)*rho).addScaledVector(fa,-3.2);
    out.target.copy(out.entity);out.fov=62;break;}
   case 'close':{onPath(zc-4.2-1.5*j,out.entity);
    out.pos.addScaledVector(fx,Math.cos(a0)*.4).addScaledVector(fy,Math.sin(a0)*.4);
    out.target.copy(out.entity);out.fov=58;break;}
   case 'wall':{const rho=R*.45,c=Math.cos(a0),sn=Math.sin(a0);
    out.pos.addScaledVector(fx,c*rho).addScaledVector(fy,sn*rho);
    onPath(zc-7,out.target).addScaledVector(fx,c*R*1.9).addScaledVector(fy,sn*R*1.9);out.fov=80;out.roll=-dir*.15;break;}
   case 'back':{onPath(zc+ahead*.8,out.entity);onPath(zc+10,out.target).lerp(out.entity,.4);out.fov=72;break;}
  }
 }

 function update(s:Signals,controls:Partial<WorldControls>={}){
  if(disposed)return;
  const ctl={...defaults,...controls};
  const score=s.phraseScore;
  const held=(match:(v:{stem:string;role:string})=>boolean)=>{
   if(!score)return s.voices.filter(match).reduce((m,v)=>Math.max(m,clamp(v.level,1.3)/1.3),0);
   const at=(voices:typeof score.current.voices)=>voices.filter(match).reduce((m,v)=>Math.max(m,clamp(v.level,1.3)/1.3),0);
   const a=at(score.current.voices),b=at(score.next.voices);return a+(b-a)*score.blend;
  };
  // Stems are what they are; roles are only a fallback cast, and never let drums stand in for bass.
  const has=(stem:string)=>s.voices.some(v=>v.stem===stem);
  const hasDrums=has('drums'),hasBass=has('bass');
  const isDrums=(v:{stem:string;role:string})=>hasDrums?v.stem==='drums':v.role==='strike'&&v.stem!=='bass';
  const isBass=(v:{stem:string;role:string})=>hasBass?v.stem==='bass':v.role==='pulse'&&v.stem!=='drums';
  const harmonicHeld=held(v=>!isDrums(v)&&!isBass(v)),drumsHeld=held(isDrums),bassHeld=held(isBass);
  const drums=s.voices.find(isDrums),bass=s.voices.find(isBass);
  const punch=clamp((drums?.punch??0)*ctl.punch,2);
  const beats=Math.max(0,s.beatIndex)+clamp(s.beatPhase);
  const clock=s.clock??{beat:.5,bar:2,phraseIndex:0,phraseCount:1,phraseStart:s.section.start,phraseEnd:s.section.end};
  const drive=clamp(s.drive);

  // ---- the story: which architecture, melting into the next
  const {current,next,morph,crossesSection,blockProgress}=sceneAt(s,seedNumber);
  const mood:Mood=current.mood;
  const lookA=sectionLook(s.section.label,s.sectionIndex,seed),lookB=sectionLook(s.nextLabel,s.sectionIndex+1,seed);
  const look=crossesSection?blendLook(lookA,lookB,morph):lookA;
  const sceneHue=wrap(look.hue+(mix(current.variant.w,next.variant.w,morph)-.5)*.1);
  hue.setHSL(sceneHue,look.saturation,.5);
  hue2.setHSL(wrap(sceneHue+.12+current.variant.z*.12),look.saturation*.9,.45);
  accent.setHSL(look.accentHue,1,.55);

  // ---- the grid made visible
  const beatLight=Math.exp(-clamp(s.beatPhase)*6)*(.3+.7*smooth(.05,.3,drumsHeld));
  const pressure=clamp((bass?.level??0)/1.3*ctl.bass,1.5);
  const wobble=clamp(s.wobbleDepth*2)*(.5+.5*Math.sin(s.wobblePhase));
  const flex=clamp(pressure*(.65+.35*Math.sin(s.wobblePhase)*clamp(s.wobbleDepth*2)),1.5);
  const sinceSection=s.time-s.section.start;
  const dropStart=mood==='peak'&&clock.phraseIndex===0?Math.exp(-Math.max(0,sinceSection)*6):0;

  // ---- the flight: distance flown, plus a surge on every kick in a drop
  const bp=clamp(s.beatPhase),kick=1-Math.pow(1-bp,3)-bp;
  const surge=(mood==='peak'?1.6:mood==='rise'?.6*clamp(blockProgress*2):0)*kick*smooth(.05,.3,drumsHeld);
  const zc=-(flightAt(flight,s.time)+surge);
  // bank into the curves: roll follows the path's sideways acceleration
  pathAt(zc,pathA,pathF,lateral);pathAt(zc-6,pathA,pathF,lateral2);pathAt(zc+6,pathA,pathF,lateral3);
  const bank=-(lateral2.x+lateral3.x-2*lateral.x)/36*14;

  // ---- the shot: where the camera rides and where the creature waits
  const R=mix(current.tunnel,next.tunnel,morph);
  const ahead=AHEAD[mood]+Math.sin(beats*TAU/16)*.8;
  const shot=shotAt(s,mood,seedNumber);
  pose(shot.now.kind,shot.u,shot.now.r,zc,R,ahead,poseNow);
  // drops cut on the bar; everywhere else the new shot glides in over a beat and a half
  const glide=shot.cut?1:ease(shot.since/Math.max(.05,clock.beat*1.5));
  if(glide<1){
   pose(shot.before.kind,1,shot.before.r,zc,R,ahead,poseBefore);
   poseNow.pos.lerpVectors(poseBefore.pos,poseNow.pos,glide);poseNow.target.lerpVectors(poseBefore.target,poseNow.target,glide);
   poseNow.entity.lerpVectors(poseBefore.entity,poseNow.entity,glide);
   poseNow.roll=mix(poseBefore.roll,poseNow.roll,glide);poseNow.fov=mix(poseBefore.fov,poseNow.fov,glide);
  }
  camPos.copy(poseNow.pos);camTarget.copy(poseNow.target);entity.copy(poseNow.entity);
  entity.y+=Math.sin(beats*TAU/8)*.25;
  const shake=mood==='peak'?punch*.05:0,h=hashOf(seedNumber,Math.round(s.time*60));
  camPos.x+=((h&255)/255-.5)*shake;camPos.y+=(((h>>8)&255)/255-.5)*shake;
  // a drop also rolls the whole view slowly round
  camRoll=Math.max(-.5,Math.min(.5,bank))+poseNow.roll+(mood==='peak'?TAU*beats/64:0);
  camFov=poseNow.fov+5*flex+14*dropStart;
  const cut=shot.cut&&shot.since<1/30;

  const being=creatureAt(s,mood,drums?{hits:drums.hits,since:drums.since}:undefined,seedNumber,creatureState.strokesA,creatureState.strokesB);
  const glow=clamp(ctl.glow,3);
  const eIntensity=(.6+.4*harmonicHeld+.3*drive)*(1+.45*beatLight+.45*punch);
  const fh=mixHue(wrap(sceneHue+being.from.hue),wrap(sceneHue+being.to.hue),being.mix);
  const white=mix(being.from.white,being.to.white,being.mix);
  creatureState.colors[0].setHSL(fh,1-.8*white,.55);
  creatureState.colors[1].setHSL(wrap(fh+mix(being.from.hue2,being.to.hue2,being.mix)),1-.8*white,.55);
  creatureState.colors[2].setHSL(fh,.45,.62);
  // the being lights the architecture around it
  eCol.copy(creatureState.colors[0]).multiplyScalar(eIntensity*glow);eTip.copy(eCol);
  const fold=being.mix<.5?being.from.fold:being.to.fold;
  // It faces the viewer, turning a little in depth, and springs open with each new form.
  fwd.subVectors(camPos,entity).normalize();right.crossVectors(worldUp,fwd).normalize();up.crossVectors(fwd,right);
  const size=(mood==='peak'?3.3+.3*flex:mood==='rise'?2.6+.6*blockProgress:3)*(1+.1*beatLight+.08*punch);
  creatureState.matrix.makeBasis(right,up,fwd)
   .multiply(turn.makeRotationY(.4*Math.sin(beats*TAU/16)))
   .multiply(turn2.makeRotationZ(mood==='peak'?TAU*beats/48:TAU*beats/160))
   .scale(scaleV.setScalar(size)).setPosition(entity);
  creatureState.time=s.time;creatureState.formMix=being.mix;creatureState.fold=fold;
  creatureState.open=1-.3*Math.exp(-being.since*14);
  creatureState.subSpread=.006+.25*(.012+.05*wobble*clamp(pressure)+.02*drive);
  // a stroke is about one creature-radius long, drawn in STROKE_SEGS steps
  creatureState.energy=.2*eIntensity*glow;creatureState.ref=size*1.1/STROKE_SEGS;creatureState.fog=mix(current.fog,next.fog,morph)*.8;
  beams.updateCreature(creatureState);
  Object.assign(uState.entity,{scale:1.3,yaw:0,folds:fold,open:1,glow:0,light:(.6+.9*drive)*(1+.6*punch)*glow});

  // ---- the architecture
  uState.time=s.time;uState.beats=beats;
  uState.familyA=current.family;uState.familyB=next.family;uState.morph=morph;
  uState.varA.copy(current.variant);uState.varB.copy(next.variant);
  uState.cellA=current.cell;uState.cellB=next.cell;
  uState.placeA=current.place;uState.placeB=next.place;uState.heightA=current.height;uState.heightB=next.height;
  uState.tubeA=current.tunnel;uState.tubeB=next.tunnel;uState.sky=mix(current.sky,next.sky,morph);
  uState.tunnel=mix(current.tunnel,next.tunnel,morph);
  uState.twist=mix(current.twist,next.twist,morph);
  uState.rings=debug.rings?mix(current.rings,next.rings,morph):0;
  uState.cymatic=mix(current.cymatic,next.cymatic,morph)*debug.cymatic;
  // The architecture turns around the flight: steadily in calm passages, a quick turn on each
  // bar in a drop, then it holds.
  const barTurn=Math.max(0,s.downbeatIndex)+ease((clamp(s.barPhase)-.75)*4);
  uState.roll=mood==='peak'?barTurn*.7:mood==='rise'?beats*.035:beats*.012;
  uState.flex=flex;uState.hit=punch;
  uState.pulse=clamp(s.beatPhase)*clock.beat*26;uState.pulseAmp=beatLight*(mood==='calm'?.5:1);
  uState.fog=mix(current.fog,next.fog,morph);
  uState.lens=mix(LENS[mood],LENS[next.mood],morph)*(1+(mood==='peak'?.9:.3)*clamp(punch,1.5));
  uState.lens*=debug.lens;
  uState.detune=.012+.05*wobble*clamp(pressure)+.02*drive;
  uState.edge=(.45+.5*harmonicHeld+.3*drive)*(1+.35*beatLight)*clamp(ctl.detail,2)*debug.edge;
  uState.haze=(.009+.016*drive)*debug.haze;
  uState.spectrum=s.sectionIndex*.21+clock.phraseIndex*.07;
  // The chord sets the cymatic figure: its just ratios become the plate's mode pair, and the old
  // figure fades into the next chord's over the bar before it lands. Drops alternate the pairs.
  const shift=mood==='peak'?Math.max(0,s.downbeatIndex)%2:0;
  const [m0,n0]=modePair(s.harmony?.current.ratios,shift),[m1,n1]=modePair(s.harmony?.next.ratios,mood==='peak'?shift^1:0);
  uState.modes.set(m0,n0,m1,n1);uState.modeMix=clamp(s.harmony?.blend??0);

  // The world refolds on the beat: a quick turn in the first fifth of each beat, then it holds.
  const snapEvery=mood==='peak'?1:mood==='rise'?2:8;
  const snapBeats=beats/snapEvery,snaps=Math.floor(snapBeats)+ease(Math.min(1,(snapBeats%1)*5));
  const v=current.variant;
  // Fold angles stay small (large ones empty the fractal) and jump to a new pose on each snap.
  uState.rot.set(beats*.05,(v.x-.5)*.4+.12*Math.sin(snaps*2.39996),(v.y-.5)*.4+.09*Math.cos(snaps*1.7));
  // The 4D slice: the phrase's voice balance sets where it rests; it steps once per bar.
  const res=sampleResonance(s,seed);
  uState.w=Math.atan2(res.weights[1],res.weights[0])*.6+barTurn*(mood==='peak'?.22:.1);
  universe.update(uState);

  // ---- the harmonograph gates: the chord drawn by a detuned scope beam, hung across the tunnel
  harmonics(s.harmony?.current.ratios,gateState.ampA);harmonics(s.harmony?.next.ratios,gateState.ampB);
  gateState.mix=clamp(s.harmony?.blend??0);
  const wa=WAVE[mood],wb=WAVE[next.mood];
  gateState.wave.set(mix(wa[0],wb[0],morph),mix(wa[1],wb[1],morph),mix(wa[2],wb[2],morph));
  // width: the traces spread in phase and detune apart as the bass wobbles; they drift together
  gateState.spread=(mood==='peak'?.35:mood==='rise'?.22:.12)+.25*wobble*clamp(pressure);
  gateState.detune=.004+.02*wobble*clamp(pressure)+.006*drive;
  gateState.drift=mood==='peak'?.45:mood==='rise'?.25:.1;
  gateState.damp=mix(1+.6*current.variant.x,1+.6*next.variant.x,morph);
  gateState.cycles=mix(5+3*current.variant.y,5+3*next.variant.y,morph);
  gateState.time=s.time;
  const gateGain=(.35+.9*harmonicHeld)*(mood==='calm'?.7:1)*(1+.3*beatLight)*glow;
  gateState.colA.setHSL(sceneHue,look.saturation,.55).multiplyScalar(gateGain);
  gateState.colB.setHSL(look.accentHue,1,.6).multiplyScalar(gateGain);
  gateState.energy=.2;
  // average step of the beam: about 5 radii of path per fundamental cycle
  gateState.ref=uState.tunnel*.85*5*gateState.cycles/GATE_SEGS;gateState.fog=uState.fog*.8;
  const base=Math.floor(zc/GATE_SPACING);
  // The last slot is the portal: a great sheet hung exactly where the flight will be on the next
  // section's downbeat, so every new section is entered through it.
  const zPortal=-flightAt(flight,s.section.end),toPortal=zc-zPortal;
  {const gate=gateState.gates[GATES-1];
   frameAt(zPortal,gate.matrix).multiply(turn.makeRotationZ(beats*.08));
   gate.intensity=s.section.end<s.section.start+1e-3?0:1.8*smooth(-6,-.5,toPortal)*(1-smooth(60,90,toPortal));
   gate.phase=s.sectionIndex*1.7;gate.size=Math.max(R*1.7,5);gate.depth=1.2;}
  for(let g=0;g<GATES-1;g++){
   // one gate just behind the lens (still around us as we pass through it), three ahead
   const index=base+1-g,zg=index*GATE_SPACING,dist=zc-zg,gate=gateState.gates[g],r=rng(seedNumber,'gate',index);
   frameAt(zg,gate.matrix).multiply(turn.makeRotationZ(r()*TAU+beats*(r()<.5?-1:1)*.04));
   gate.intensity=smooth(-10,-2,dist)*(1-smooth(48,76,dist));
   // wider than the tunnel: the walls cut each sheet, so it reads as woven through the architecture
   gate.phase=r()*TAU;gate.size=uState.tunnel*(1.1+.4*r());gate.depth=2+2*r();
  }
  beams.updateGates(gateState);

  // ---- particles
  motes.update({time:s.time,camera:camPos,entity,warp:0,dust:mood==='peak'?.7:1,
   hitAge:drums?.since??10,hit:(mood==='peak'?1:mood==='rise'?.5:.15)*smooth(.05,.3,drumsHeld),spread:mood==='peak'?1.3:.8,
   spin:(drums?.hits??0)*2.39996,color:hue,color2:hue2,accent});

  // ---- light in post
  // Afterglow is the one thing that remembers earlier frames; a seek or jump starts it clean.
  const jumped=!(Math.abs(s.time-lastTime)<.25)||s.time<lastTime;lastTime=s.time;
  settings={
   persistence:jumped||cut?0:mood==='peak'?.45:mood==='rise'?.55:mood==='dream'?.72:.66,
   seed:Math.floor(s.time*60),
   bloom:(.35+.2*drive)*glow,
   fringe:.0012+.004*punch,
   flash:dropStart,
   grain:.035,
  };
  root.userData={renderer:'fractal flight',world:FAMILY_NAMES[current.family],nextWorld:FAMILY_NAMES[next.family],
   morph:+morph.toFixed(3),mood,shot:shot.now.kind,place:PLACE_NAMES[current.place],nextPlace:PLACE_NAMES[next.place],flown:+(-zc).toFixed(1),form:being.index,folds:fold,
   symmetry:`D${fold} mandala creature in a kaleidoscopic ${FAMILY_NAMES[current.family]}`,
   modes:[m0,n0,m1,n1],chord:s.harmony?.current.label??null,hue:+sceneHue.toFixed(3),section:s.section.label,phrase:clock.phraseIndex,beat:s.beatIndex,
   lanes:{harmony:+harmonicHeld.toFixed(3),bass:+bassHeld.toFixed(3),drums:+drumsHeld.toFixed(3)}};
 }

 const size=new THREE.Vector2(),look=new THREE.Vector3();
 /** The directed flight, turned by the viewer's own look (drag); the wheel slides back along the path. */
 function composeCamera(host:THREE.Camera|undefined,width:number,height:number){
  view.position.copy(camPos);
  view.up.set(0,1,0);view.lookAt(camTarget);
  if(host){
   host.getWorldDirection(look);
   const yaw=Math.atan2(look.x,-look.z),pitch=Math.asin(Math.max(-1,Math.min(1,look.y)));
   view.rotateY(-yaw);view.rotateX(pitch);
  }
  view.rotateZ(camRoll);
  view.fov=camFov;view.aspect=width/Math.max(1,height);view.updateProjectionMatrix();view.updateMatrixWorld();
 }

 function render(renderer:THREE.WebGLRenderer,host?:THREE.Camera){
  if(disposed)return;
  if(!debug.motes)for(const o of motes.objects)o.visible=false;
  if(!debug.gates)beams.objects[0].visible=false;
  if(!debug.creature)beams.objects[1].visible=false;
  universe.objects[0].visible=debug.universe;
  if(postRenderer!==renderer){post?.dispose();post=createPost(renderer,scene,view);postRenderer=renderer;}
  renderer.getDrawingBufferSize(size);
  composeCamera(host,size.x,size.y);
  universe.march(renderer,view,size.x,size.y);motes.setResolution(size.y);beams.setResolution(size.x,size.y);
  post!.render(settings,view);
 }

 function dispose(){
  if(disposed)return;disposed=true;
  scene.remove(root);universe.dispose();motes.dispose();beams.dispose();post?.dispose();post=null;
  if(scene.background===worldBackground)scene.background=background;
  if(scene.fog===null)scene.fog=fog;
 }
 if(camera){camera.fov=70;camera.updateProjectionMatrix();}
 return {root,update,render,dispose,parts,view,debug};
}
