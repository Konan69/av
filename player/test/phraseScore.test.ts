import {test} from 'node:test';import assert from 'node:assert/strict';
import {Conductor} from '../src/conductor';import {seedFromSha} from '../src/seed';
import {sampleResonance,evaluateResonance} from '../src/world/resonance';
import {validGenome} from './fixtures';
function make(){
 const g=validGenome();g.duration=64;
 g.beats.beats=Array.from({length:129},(_,i)=>i*.5);
 g.beats.downbeats=[0,2,4,6,8,10,12,14,17,19,21,24,26,28,30,32,35,37,39,41,43,45,47,49,51,53,55,57,59,61,63];
 g.sections.hard=[{label:'intro',start:0,end:24},{label:'drop',start:24,end:64}];
 g.sections.labels=['intro','drop'];g.sections.label_probs=Array.from({length:65},(_,i)=>i<24?[1,0]:[0,1]);g.sections.boundary=Array(65).fill(0);
 g.waveform.rms=Array(65).fill(.5);g.waveform.peak=Array(65).fill(.7);g.waveform.crest=Array(65).fill(1.4);
 for(const [stem,f] of Object.entries(g.stems.per_stem)){
  f.rms=Array.from({length:65},(_,i)=>stem==='bass'?(i%2?.95:.05):(i<17?.2:.65));
  f.centroid=Array(65).fill(1400);
  f.energy=Object.fromEntries(['sub','low','mid','high','air'].map((b,i)=>[b,Array(65).fill(i+1)]));
 }
 g.stems.per_stem.bass.onsets=[{t:3,strength:1,band:'low'},{t:17,strength:1,band:'low'},{t:23,strength:1,band:'low'}];
 return new Conductor(g,seedFromSha(g.track_sha256));
}
test('phrases use eight observed downbeats, clipped and restarted at section boundaries',()=>{
 const c=make();assert.deepEqual(c.phraseScore.phrases.slice(0,3).map(p=>[p.start,p.end]),[[0,17],[17,24],[24,41]]);
 const a=c.phraseScore.phrases[0].voices.find(v=>v.stem==='bass')!,b=c.phraseScore.phrases[1].voices.find(v=>v.stem==='bass')!;
 assert.equal(a.onsetRate,1/17);assert.equal(b.onsetRate,2/7);assert.ok(Math.abs(a.bands.reduce((s,v)=>s+v,0)-1)<1e-12);assert.ok(Math.abs(a.centroid-1400)<1e-9);
});
test('held phrase interiors ignore raw RMS swings and pressure cannot change nodal topology',()=>{
 const c=make(),s0=structuredClone(c.sample(2.1)),s1=structuredClone(c.sample(2.9));
 assert.notEqual(s0.voices.find(v=>v.stem==='bass')!.level,s1.voices.find(v=>v.stem==='bass')!.level);
 const a=sampleResonance(s0,c.seed),b=sampleResonance(s1,c.seed);assert.deepEqual(a.weights,b.weights);assert.equal(a.morph,0);assert.notEqual(a.pressure,b.pressure);
 assert.deepEqual(evaluateResonance([.31,.57,.83],a),evaluateResonance([.31,.57,.83],b));
});
test('phrase and section transitions are continuous, including lookahead starting during a phrase blend',()=>{
 const c=make(),edge=c.sections[0].end,start=edge-4*c.barDur;
 assert.equal(start,16); // The prior phrase is already blending during its 14..17 final bar.
 for(const t of [14,start,17,edge,41]){
  const a=sampleResonance(c.sample(t-1e-7),c.seed),b=sampleResonance(c.sample(t),c.seed),va=evaluateResonance([.4,.8,1.3],a).field,vb=evaluateResonance([.4,.8,1.3],b).field;
  assert.ok(Math.hypot(va[0]-vb[0],va[1]-vb[1])<1e-6,`continuous at ${t}`);
 }
 assert.equal(c.sample(start).phraseScore!.sectionTransition,true);
 assert.equal(sampleResonance(c.sample(edge),c.seed).morph,0);
});
test('score seeks match fresh sampling and transition angular speed stays far below waveform motion',()=>{
 const direct=make(),stepped=make();for(let t=0;t<40;t+=.137)stepped.sample(t);
 assert.deepEqual(stepped.sample(15.5).phraseScore,direct.sample(15.5).phraseScore);
 let previous=0,maxDelta=0;
 for(let i=0;i<=64*60;i++){const p=sampleResonance(direct.sample(i/60),direct.seed),angle=Math.atan2(p.weights[1],p.weights[0])*180/Math.PI;if(i)maxDelta=Math.max(maxDelta,Math.abs(angle-previous));previous=angle;}
 assert.ok(maxDelta<.3,`structural motion ${maxDelta} degrees/frame`);
});
