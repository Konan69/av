import * as THREE from 'three';
import type {Signals} from '../conductor';
import {FAMILY,PLACE} from './universe';


/** The director: a pure function from the musical moment to the journey.
 *
 *   section / 8-bar block -> scene: which architecture, how it twists, which cymatic layers,
 *                            morphing into the next over the block's last bar or two
 *   drum hit / beat       -> creature form, morphing from the last one rather than cutting
 *
 * Nothing here keeps state between calls, so seeking lands on the same frame. */

export type Mood='calm'|'rise'|'peak'|'dream';
export const moodOf=(label:string):Mood=>/drop|chorus|peak/i.test(label)?'peak':/build|rise|pre/i.test(label)?'rise':/break|bridge|interlude/i.test(label)?'dream':'calm';

export const hashOf=(...parts:(string|number)[])=>{let h=2166136261;const text=parts.join('|');for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return h>>>0;};
export function rng(...parts:(string|number)[]){
 let a=hashOf(...parts);
 return()=>{a=(a+0x6d2b79f5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};
}
const clamp=(v:number,a=0,b=1)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:0));
const ease=(v:number)=>{const x=clamp(v);return x*x*(3-2*x);};

// ------------------------------------------------------------------ scenes
export interface Scene {
 family:number;place:number;variant:THREE.Vector4;cell:number;tunnel:number;height:number;sky:number;fog:number;
 twist:number;rings:number;cymatic:number;mood:Mood;key:number;
}
const newScene=():Scene=>({family:0,place:0,variant:new THREE.Vector4(),cell:10,tunnel:3,height:6,sky:0,fog:.012,
 twist:0,rings:0,cymatic:0,mood:'calm',key:0});
/** A phrase is a place: about eleven seconds, a power-of-two number of bars (8 at 174 bpm, 4 when
 * the analysis counts a half-time bar of nearly three seconds). */
export const blockBars=(bar:number)=>11/Math.max(.3,bar)<6?4:8;

/** The journey: what kind of place each 8-bar phrase is. It follows the track's arc: the intro
 * arrives out of open space, a buildup closes in until its last phrase is a tight tunnel, a drop
 * lands inside the megastructure and then tears through a new place every phrase, a breakdown
 * floats back out into the open. Neighbouring phrases never share a place. */
const JOURNEY:Record<Mood,number[]>={
 calm:[PLACE.islands,PLACE.landscape,PLACE.chambers,PLACE.strata],
 rise:[PLACE.strata,PLACE.chambers,PLACE.landscape],
 peak:[PLACE.strata,PLACE.landscape,-1,PLACE.chambers],   // -1: a vast hall
 dream:[PLACE.islands,PLACE.landscape,PLACE.chambers,PLACE.strata],
};
const FOG:Record<Mood,number>={calm:.014,rise:.011,peak:.007,dream:.02};

export function sceneFor(label:string,sectionIndex:number,block:number,seed:number,out=newScene(),last=false):Scene{
 const mood=moodOf(label),r=rng(seed,sectionIndex,block,'scene');
 const pick=<T,>(xs:T[])=>xs[Math.floor(r()*xs.length)];
 out.mood=mood;out.key=hashOf(seed,sectionIndex,block);
 out.variant.set(r(),r(),r(),r());
 const flip=block%2?-1:1,seq=JOURNEY[mood];
 let place:number;
 if(mood==='peak')place=block===0?PLACE.tunnel:seq[(block-1+sectionIndex)%seq.length];
 else if(mood==='rise')place=last?PLACE.tunnel:seq[(block+sectionIndex)%seq.length];
 else if(mood==='calm'&&sectionIndex===0)place=seq[block%seq.length];
 else place=seq[(block+sectionIndex)%seq.length];
 const hall=place===-1;
 out.place=hall?PLACE.tunnel:place;
 // the mood sets the pace and the energy of the architecture
 out.twist=flip*(mood==='peak'?.035+.035*r():mood==='rise'?.02+.02*r():.012);
 out.cymatic=mood==='peak'?.45:mood==='rise'?.55:mood==='dream'?1:.7;
 out.cell=mood==='peak'?8+3*r():mood==='rise'?10+2*r():12+4*r();
 out.fog=FOG[mood];out.sky=.15;out.height=6;out.tunnel=mood==='peak'?2.5+.6*r():mood==='rise'?(last?2.3:2.9):3.3;
 out.rings=mood==='peak'?(block%2?.8:0):mood==='rise'?.6:mood==='dream'?.4:0;
 // the place sets the space
 switch(out.place){
  case PLACE.tunnel:
   // every drop lands in the neon megastructure
   out.family=mood==='peak'&&block===0?FAMILY.cathedral:pick([FAMILY.cathedral,FAMILY.hypersponge]);
   if(hall){out.cell*=1.9;out.tunnel=7+2.5*r();out.rings*=.5;out.sky=.3;}
   break;
  case PLACE.landscape:
   // a fractal city under an open sky, a road of cymatic rings strung above it
   out.family=pick([FAMILY.cathedral,FAMILY.hypersponge]);out.cell*=1.4;out.height=4.5+2.5*r();out.tunnel=4;
   out.sky=1;out.fog=.006;out.twist*=.2;out.rings=Math.max(out.rings,.5);break;
  case PLACE.strata:
   out.family=pick([FAMILY.hypersponge,FAMILY.cathedral]);out.height=3.5+1.5*r();out.tunnel=4;out.sky=.6;out.fog=Math.min(out.fog,.009);
   out.twist*=.3;out.rings*=.5;break;
  case PLACE.islands:
   out.family=pick([FAMILY.hypersponge,FAMILY.cathedral]);out.tunnel=3.5;out.sky=1;out.fog=.005;out.rings=Math.max(out.rings,.6);break;
  default: // chambers
   out.family=pick([FAMILY.kleinian,FAMILY.cathedral]);out.height=10+4*r();out.tunnel=3;out.sky=.25;out.rings*=.4;
 }
 return out;
}

export interface SceneState {current:Scene;next:Scene;morph:number;crossesSection:boolean;blockProgress:number}
const sceneA=newScene(),sceneB=newScene();
/** Scenes are 8-bar blocks counted from the section's first bar; each melts into the next over
 * its last bar (drops) or last two bars (everything else), landing on the downbeat. */
export function sceneAt(s:Signals,seed:number):SceneState{
 const clock=s.clock??{beat:.5,bar:2,phraseIndex:0,phraseCount:1,phraseStart:s.section.start,phraseEnd:s.section.end,sectionBars:[s.section.start],barInSection:0};
 const bars=clock.sectionBars.length?clock.sectionBars:[s.section.start];
 const BLOCK_BARS=blockBars(clock.bar);
 const block=Math.floor(Math.max(0,clock.barInSection)/BLOCK_BARS);
 const start=bars[block*BLOCK_BARS]??s.section.start;
 const crossesSection=(block+1)*BLOCK_BARS>=bars.length;
 const end=crossesSection?s.section.end:bars[(block+1)*BLOCK_BARS];
 sceneFor(s.section.label,s.sectionIndex,block,seed,sceneA,(block+1)*BLOCK_BARS>=bars.length);
 if(crossesSection)sceneFor(s.nextLabel,s.sectionIndex+1,0,seed,sceneB);
 else sceneFor(s.section.label,s.sectionIndex,block+1,seed,sceneB,(block+2)*BLOCK_BARS>=bars.length);
 // the melt from one place into the next: one bar in a drop, otherwise about three seconds
 const span=Math.min((moodOf(s.section.label)==='peak'||clock.bar>2?1:2)*clock.bar,Math.max(1e-3,end-start));
 return {current:sceneA,next:sceneB,morph:ease((s.time-(end-span))/span),crossesSection,
  blockProgress:clamp((s.time-start)/Math.max(1e-3,end-start))};
}

// ------------------------------------------------------------------ camera
/** How the flight is filmed. Drops cut on every bar; elsewhere each shot glides into the next.
 *   forward  down the tunnel toward the creature       spiral  a barrel roll around the axis
 *   orbit    circling the creature in its chamber       close   right behind it, it fills the frame
 *   wall     off-axis, the architecture streaming by    back    looking back, the creature chasing */
export type ShotKind='forward'|'wall'|'orbit'|'close'|'spiral'|'back';
const SHOTS:Record<Mood,ShotKind[]>={
 calm:['forward','wall','orbit','spiral','forward','close'],
 rise:['forward','spiral','close','forward','orbit'],
 peak:['forward','orbit','close','spiral','back','wall','forward','orbit'],
 dream:['orbit','wall','close','spiral'],
};
const SHOT_BARS:Record<Mood,number>={calm:2,rise:2,peak:1,dream:2};
export interface Shot {kind:ShotKind;r:()=>number}
export interface ShotState {now:Shot;before:Shot;u:number;since:number;index:number;cut:boolean}
export function shotAt(s:Signals,mood:Mood,seed:number):ShotState{
 const clock=s.clock;
 const late=mood==='rise'&&(clock?clock.phraseIndex>=clock.phraseCount-1:false);
 const bars=late?1:SHOT_BARS[mood];
 const bar=Math.max(0,s.downbeatIndex),barPhase=clamp(s.barPhase);
 const index=Math.floor(bar/bars),inShot=(bar%bars)+barPhase;
 const kinds=SHOTS[mood];
 const choose=(i:number):Shot=>{const r=rng(seed,s.sectionIndex,i,'shot');let k=kinds[Math.floor(r()*kinds.length)];
  // a buildup's last phrase only rushes forward
  if(late)k=i%2?'spiral':'forward';return {kind:k,r};};
 return {now:choose(index),before:choose(index-1),u:inShot/bars,since:inShot*(clock?.bar??2),index,cut:mood==='peak'};
}

// ------------------------------------------------------------------ flight
export interface Timeline {sections:{label:string;start:number;end:number}[];duration:number}
const SPEED:Record<Mood,number>={calm:3.4,rise:5,peak:13,dream:2.6};
/** Distance flown by each moment of the track: speed follows the section (a buildup accelerates
 * toward its drop), smoothed across boundaries, integrated once so seeking is exact. */
export function flightTable(timeline:Timeline|undefined){
 if(!timeline||!timeline.sections.length)return null;
 const fps=30,n=Math.ceil(timeline.duration*fps)+2,raw=new Float64Array(n);
 for(let i=0;i<n;i++){
  const t=i/fps,sec=timeline.sections.find(x=>t<x.end)??timeline.sections[timeline.sections.length-1];
  const mood=moodOf(sec.label),u=clamp((t-sec.start)/Math.max(.001,sec.end-sec.start));
  raw[i]=mood==='rise'?4+9.5*Math.pow(u,1.6):SPEED[mood];
 }
 const half=Math.round(.8*fps),dist=new Float64Array(n);
 let acc=0;for(let i=0;i<n;i++){
  let sum=0,count=0;for(let j=Math.max(0,i-half);j<=Math.min(n-1,i+half);j++){sum+=raw[j];count++;}
  if(i>0)acc+=sum/count/fps;dist[i]=acc;
 }
 return {fps,dist};
}
export function flightAt(table:ReturnType<typeof flightTable>,t:number){
 if(!table)return t*4;
 const x=Math.max(0,t*table.fps),i=Math.min(table.dist.length-2,Math.floor(x));
 return table.dist[i]+(table.dist[i+1]-table.dist[i])*(x-i);
}

// ------------------------------------------------------------------ creature
export interface Form {index:number;since:number;f0:THREE.Vector4;f1:THREE.Vector4;f2:THREE.Vector4;hueShift:number;white:number;symmetry:number}
export const newForm=():Form=>({index:0,since:0,f0:new THREE.Vector4(),f1:new THREE.Vector4(),f2:new THREE.Vector4(),hueShift:0,white:0,symmetry:5});

function formParams(seed:number,sectionIndex:number,index:number,mood:Mood,out:Form){
 const r=rng(seed,sectionIndex,index);
 // A branching tendril being: stem length, bend, fork spread and shrink; twist, root, curl, crown;
 // thickness, spikes, core ring, phase. The stem is capped so the whole tree fits its bound.
 const shrink=1.45+.4*r(),root=.1+.4*r();
 out.f0.set(Math.min(.55+.45*r(),(2.6-root)*(shrink-1)/shrink),(r()-.5)*2,.35+.65*r(),shrink);
 out.f1.set((r()-.5)*1.2,root,(r()-.5)*1.6,r());
 out.f2.set(.022+.022*r(),r(),.15+.3*r(),r());
 const pick=r();
 out.hueShift=pick<.45?0:pick<.75?1:pick<.92?.5:0;
 out.white=pick>=.92?1:0;
 // polyhedral symmetry: 3 tetrahedral, 4 octahedral, 5 icosahedral
 out.symmetry=mood==='peak'?[5,4,5,3][Math.floor(r()*4)]:mood==='rise'?(r()<.5?4:5):r()<.7?5:3;
 return out;
}
const previous=newForm();
/** One creature per form index — every drum onset in a drop, every beat (then eighth) elsewhere —
 * and it morphs from the previous form into the new one instead of cutting. */
export function formAt(s:Signals,mood:Mood,drums:{hits:number;since:number}|undefined,seed:number,out:Form){
 const beat=s.clock?.beat??.5;
 let index:number,since:number,morphTime:number;
 if(mood==='peak'&&drums&&drums.hits>0){index=drums.hits;since=drums.since;morphTime=.09;}
 else {
  const late=mood==='rise'&&(s.clock?s.clock.phraseIndex>=s.clock.phraseCount-1:false);
  const per=late?.5:1,b=(Math.max(0,s.beatIndex)+clamp(s.beatPhase))/per;
  index=Math.floor(b)+(mood==='rise'?100000:mood==='dream'?200000:300000);since=(b-Math.floor(b))*beat*per;morphTime=beat*per*.5;
 }
 formParams(seed,s.sectionIndex,index,mood,out);
 formParams(seed,s.sectionIndex,index-1,mood,previous);
 const k=ease(since/morphTime);
 out.f0.lerpVectors(previous.f0,out.f0,k);out.f1.lerpVectors(previous.f1,out.f1,k);out.f2.lerpVectors(previous.f2,out.f2,k);
 if(k<.5){out.symmetry=previous.symmetry;out.hueShift=previous.hueShift;out.white=previous.white;}
 out.index=index;out.since=since;
 return out;
}

// ------------------------------------------------------------------ the pseudohuasca creature
const STROKE_COUNT=16;
/** A creature drawn in light: a dihedral mandala (k turns, each mirrored) of strokes, after
 * pseudohuasca's beings. Sixteen strokes per form, each a vec4 triple:
 *   (r0, length, loop, angle)  (sweep, curl, wiggle, wiggle frequency)  (beads, beadiness, depth, colour)
 * A core ring, bead rings, petals (out and back), curling tendrils and beaded spokes, all inside
 * one half-wedge of the symmetry so their mirror images never land on top of them. */
export interface Creature {fold:number;hue:number;hue2:number;white:number}
export function strokesFor(seed:number,sectionIndex:number,index:number,mood:Mood,out:THREE.Vector4[]):Creature{
 const r=rng(seed,sectionIndex,index,'creature');
 const pick=<T,>(xs:T[])=>xs[Math.floor(r()*xs.length)];
 const fold=mood==='peak'?(r()<.15?1:pick([2,3,4,4,5,6,6,8])):mood==='rise'?pick([3,4,6]):pick([4,5,6,8]);
 const wedge=Math.PI/fold;
 let i=0;
 const put=(r0:number,len:number,loop:number,th0:number,sweep:number,curl:number,wig:number,wf:number,beads:number,beady:number,z:number,ci:number)=>{
  if(i>=STROKE_COUNT)return;
  out[i*3].set(r0,len,loop,th0);out[i*3+1].set(sweep,curl,wig,wf);out[i*3+2].set(beads,beady,z,ci);i++;
 };
 const inWedge=(margin=.08)=>margin*wedge+r()*(1-2*margin)*wedge;
 // the core and the bead rings
 put(.08+.1*r(),0,0,0,wedge,0,0,0,r()<.5?0:1+Math.floor(r()*3),r()<.5?0:.7,0,2);
 const rings=1+Math.floor(r()*2);
 for(let k=0;k<rings;k++)put(.35+.8*r(),0,0,0,wedge,0,.02*r(),2+Math.floor(r()*6),1+Math.floor(r()*5),.85,(r()-.5)*.3,r()<.6?0:1);
 // petals: filled blades from the centre
 const petals=2+Math.floor(r()*3),petalColour=r()<.6?0:1;
 for(let k=0;k<petals;k++)put(.04+.35*r(),.45+.7*r(),1,inWedge(),.12+.5*r(),(r()-.5)*.6,.03*r(),3+4*r(),0,0,(r()-.5)*.4,k===0?petalColour:1-petalColour);
 // tendrils that curl at their tips
 const tendrils=4+Math.floor(r()*4),dir=r()<.5?-1:1;
 for(let k=0;k<tendrils;k++){
  const tip=(1.5+3.5*r())*(r()<.75?dir:-dir);
  put(.15+.55*r(),.55+1.05*r(),0,inWedge(),(r()-.5)*1.6,tip,.02+.09*r(),2+5*r(),r()<.2?4+Math.floor(r()*6):0,r()<.2?.5:0,(r()-.5)*.6,r()<.7?0:1);
 }
 // spokes along the mirror lines
 const spokes=1+Math.floor(r()*2);
 for(let k=0;k<spokes;k++)put(.12+.1*r(),.8+.8*r(),0,k%2?wedge:0,0,0,0,0,3+Math.floor(r()*6),.55,0,1);
 while(i<STROKE_COUNT)put(0,0,0,0,0,0,0,0,0,0,0,0);
 const shift=r();
 return {fold,hue:shift<.5?0:shift<.8?.5:.15,hue2:.08+.35*r(),white:r()<.12?1:0};
}

export interface CreatureMorph {index:number;since:number;mix:number;from:Creature;to:Creature}
/** The creature for this moment and the one it is morphing from: a new form on every drum
 * onset in a drop, every beat (then eighth) elsewhere; each morph takes most of the gap. */
export function creatureAt(s:Signals,mood:Mood,drums:{hits:number;since:number}|undefined,seed:number,from:THREE.Vector4[],to:THREE.Vector4[]):CreatureMorph{
 const beat=s.clock?.beat??.5;
 let index:number,since:number,morphTime:number;
 if(mood==='peak'&&drums&&drums.hits>0){index=drums.hits;since=drums.since;morphTime=Math.min(.16,beat*.4);}
 else {
  const late=mood==='rise'&&(s.clock?s.clock.phraseIndex>=s.clock.phraseCount-1:false);
  const per=mood==='rise'?(late?.5:1):mood==='peak'?.5:2,b=(Math.max(0,s.beatIndex)+clamp(s.beatPhase))/per;
  index=Math.floor(b)+(mood==='rise'?100000:mood==='dream'?200000:mood==='peak'?400000:300000);
  since=(b-Math.floor(b))*beat*per;morphTime=beat*per*.6;
 }
 const a=strokesFor(seed,s.sectionIndex,index-1,mood,from),b=strokesFor(seed,s.sectionIndex,index,mood,to);
 return {index,since,mix:ease(since/Math.max(1e-3,morphTime)),from:a,to:b};
}
