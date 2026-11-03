import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sampleResonance,sectionModes,evaluateResonance,type Mode} from '../src/world/resonance';
import type {Signals} from '../src/conductor';
import {seedFromSha} from '../src/seed';
const seed=seedFromSha('aabbccdd');
function signals():Signals{return {time:0,section:{label:'intro',start:0,end:10},sectionIndex:0,nextLabel:'drop',morph:0,wobblePhase:0,wobbleDepth:0.5,voices:[{stem:'bass',role:'pulse',level:0.4,punch:0,bands:new Float32Array(5),bright:0.1,share:0.6},{stem:'other',role:'field',level:0.6,punch:0,bands:new Float32Array(5),bright:0.5,share:0.4}]} as Signals;}

test('section modal pairs are integer, three-dimensional, and share a cavity eigenvalue',()=>{
 for(const label of ['intro','buildup','drop','breakdown']){
  const [a,b]=sectionModes(label,seed);
  assert.ok(a.every(Number.isInteger)&&b.every(Number.isInteger));assert.ok(a.every(n=>n>0));assert.notDeepEqual(a,b);
  assert.equal(a.reduce((sum,n)=>sum+n*n,0),b.reduce((sum,n)=>sum+n*n,0));
 }
});
test('absolute clock changes do not move modal fields, while own bass and melody do',()=>{
 const s=signals(),a=sampleResonance(s,seed);s.time=800;s.sectionIndex=13;
 assert.deepEqual(sampleResonance(s,seed),a);
 s.voices[0].level=1.3;const bass=sampleResonance(s,seed);assert.notDeepEqual(bass.weights,a.weights);assert.ok(bass.pressure>a.pressure);
 s.voices[1].level=0.1;assert.notDeepEqual(sampleResonance(s,seed).weights,bass.weights);
});
test('scheduled coefficient morph reaches exactly the next section without fractional modes',()=>{
 const s=signals();s.morph=1;const end=sampleResonance(s,seed);
 const next=sampleResonance({...s,morph:0,section:{label:'drop',start:10,end:20},nextLabel:'outro'},seed);
 for(const point of [[0.2,0.7,1.3],[2.2,-0.4,0.6]] as Mode[]){
  assert.deepEqual(evaluateResonance(point,end),evaluateResonance(point,next));
 }
 s.morph=0.5;const middle=sampleResonance(s,seed);assert.deepEqual(middle.modeA,end.modeA);assert.equal(middle.morph,0.5);
});
test('analytic gradients match finite differences for both nodal fields during morph',()=>{
 const s=signals();s.morph=0.37;const params=sampleResonance(s,seed);const p:Mode=[0.31,-0.49,0.87];const exact=evaluateResonance(p,params);const h=1e-5;
 for(let axis=0;axis<3;axis++){
  const lo=[...p] as Mode,hi=[...p] as Mode;lo[axis]-=h;hi[axis]+=h;
  const f0=evaluateResonance(lo,params).field,f1=evaluateResonance(hi,params).field;
  assert.ok(Math.abs((f1[0]-f0[0])/(2*h)-exact.gradientF[axis])<1e-7);
  assert.ok(Math.abs((f1[1]-f0[1])/(2*h)-exact.gradientG[axis])<1e-7);
 }
});
test('a higher mode family changes the nodal lobe count, not just intensity',()=>{
 const s=signals();
 function crossings(label:string){const params=sampleResonance({...s,section:{...s.section,label}},undefined);let n=0,previous=evaluateResonance([0,0.23,0.41],params).field[0];for(let i=1;i<=1000;i++){const f=evaluateResonance([Math.PI*i/1000,0.23,0.41],params).field[0];if(f*previous<0)n++;previous=f;}return n;}
 assert.ok(crossings('drop')>crossings('intro'));
});


test('strong bass-to-harmony handoffs substantially rebalance nodes without dropping a mode',()=>{
 const s=signals();s.voices[0].level=0.05;s.voices[1].level=1.1;
 const harmony=sampleResonance(s,seed);
 s.voices[0].level=1.1;s.voices[1].level=0.05;
 const bass=sampleResonance(s,seed);
 assert.ok(harmony.weights[1]/harmony.weights[0]>3);
 assert.ok(bass.weights[0]/bass.weights[1]>3);
 for(const p of [harmony,bass]){assert.ok(p.weights.every(w=>w>0&&w<1));assert.ok(Math.abs(Math.hypot(...p.weights)-1)<1e-12);}
});
test('silent extra stems do not dilute harmony; a brief foreground detail changes the nodal balance',()=>{
 const s=signals(),original=sampleResonance(s,seed);
 s.voices.push({stem:'guitar',role:'extra',level:0,punch:0,bands:new Float32Array(5),bright:0,share:0.001});
 assert.deepEqual(sampleResonance(s,seed).weights,original.weights);
 s.voices[2].level=1.2;const detail=sampleResonance(s,seed);
 assert.ok(detail.weights[1]>original.weights[1]);
 assert.deepEqual(detail.modeA,original.modeA);assert.equal(detail.pressure,original.pressure);
});
