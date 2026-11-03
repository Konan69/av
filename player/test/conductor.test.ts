import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Conductor } from '../src/conductor';
import { discoverVoices } from '../src/voices';
import { seedFromSha } from '../src/seed';
import type { Genome, StemFeatures } from '../src/genome';

function genome(): Genome {
 const energy = Object.fromEntries(['sub','low','mid','high','air'].map(b => [b, Array(201).fill(0.1)]));
 const stem: StemFeatures = {rms: Array(401).fill(0.2), energy, centroid:Array(201).fill(1500), onsets:[{t:1, strength:1, band:'low'},{t:1.1,strength:1,band:'low'},{t:9.9,strength:0.8,band:'mid'}],wobble:{frame_rate:1, rate_hz:[1,3,2],depth:[0.5,0.8,0.2]}};
 return {version:3,track_sha256:'aabbccdd',source_filename:'test.wav',duration:20,
 sections:{hard:[{label:'intro',start:0,end:9.1},{label:'drop',start:9.1,end:20}],frame_rate:1,labels:['intro','drop'],label_probs:Array.from({length:21},(_,i)=>i<9?[0.9,0.1]:[0.1,0.9]),boundary:Array(21).fill(0)},
 beats:{bpm:120,beats:Array.from({length:40},(_,i)=>i*0.5+0.2),downbeats:Array.from({length:10},(_,i)=>i*2+0.2)},
 waveform:{frame_rate:20,rms:Array.from({length:401},(_,i)=>0.2+Math.sin(i/60)*0.1),peak:[],crest:[]},
 bands:{frame_rate:10,names:Object.keys(energy),energy,flux:energy,centroid:[]},onsets:stem.onsets,wobble:stem.wobble,tension:{frame_rate:1,curve:Array.from({length:21},(_,i)=>i/20)},
 stems:{model:'test',names:['bass'],rms_frame_rate:20,energy_frame_rate:10,bands:Object.keys(energy),per_stem:{bass:stem}},analyzers:[]};
}
const snapshot = (c:Conductor,t:number) => structuredClone(c.sample(t));
const make = () => new Conductor(genome(),seedFromSha('aabbccdd'));

test('direct seek, stepped playback and repeated paused samples are identical',()=>{
 const direct=make(), stepped=make();
 for(let t=0;t<10.23;t+=1/37) stepped.sample(t);
 const expected=snapshot(direct,10.23);
 assert.deepEqual(snapshot(stepped,10.23),expected);
 assert.deepEqual(snapshot(stepped,10.23),expected);
 stepped.sample(18); stepped.sample(1);
 assert.deepEqual(snapshot(stepped,10.23),expected);
});
test('onset envelopes decay from exact timestamps and preserve capped overlaps',()=>{
 const c=make();
 assert.equal(c.sample(0.9).voices[0].punch,0);
 assert.equal(c.sample(1).voices[0].punch,1);
 const peak=Math.min(1.6,Math.exp(-0.9)+1);
 assert.ok(Math.abs(c.sample(1.15).voices[0].punch-peak*Math.exp(-0.45))<1e-12);
 assert.ok(c.sample(10).voices[0].punch>0);
});
test('wobble is the exact integral of linearly interpolated frequency',()=>{
 const c=make();
 assert.ok(Math.abs(c.sample(0.5).wobblePhase-2*Math.PI*0.75)<1e-12);
 assert.ok(Math.abs(c.sample(1.5).wobblePhase-2*Math.PI*3.375)<1e-12);
 assert.ok(Math.abs(c.sample(4).wobblePhase-2*Math.PI*8.5)<1e-12);
});
test('section change and morph share a snapped downbeat, including track end',()=>{
 const c=make(); const boundary=c.sections[1].start;
 assert.equal(boundary,8.2);
 assert.equal(c.sections[0].end,boundary);
 assert.equal(c.sample(boundary-1e-6).sectionIndex,0);
 assert.ok(c.sample(boundary-1e-6).morph>0.99999);
 assert.equal(c.sample(boundary).sectionIndex,1);
 assert.equal(c.sample(20).section.label,'drop');
 assert.equal(c.sample(0).beatPulse,0);
});
test('brief foreground details survive low global share; silent stems do not',()=>{
 const g=genome(); const base=g.stems.per_stem.bass;
 const solo=Array(401).fill(0); solo.splice(200,4,0.15,0.2,0.2,0.15);
 g.stems.names.push('piano','silent');
 g.stems.per_stem.piano={...base,rms:solo};
 g.stems.per_stem.silent={...base,rms:Array(401).fill(0)};
 const voices=discoverVoices(g);
 assert.deepEqual(voices.map(v=>v.stem).sort(),['bass','piano']);
 const piano=voices.find(v=>v.stem==='piano')!;
 assert.ok(piano.share<0.05); assert.equal(piano.rmsScale,5);
});


test('attack-corrected out-of-order onsets are indexed without mutating the genome',()=>{
 const g=genome(); const onsets=g.stems.per_stem.bass.onsets;
 onsets.reverse();
 const c=new Conductor(g,seedFromSha('aabbccdd'));
 assert.equal(c.sample(1).voices[0].punch,1);
 assert.equal(c.recentOnsets('pulse',1.05)[0].age,1.05-1);
 assert.equal(onsets[0].t,9.9);
});

test('a section shorter than four bars morphs over its own length instead of starting half-done', async () => {
	const { Conductor } = await import('../src/conductor');
	const { seedFromSha } = await import('../src/seed');
	const { validGenome } = await import('./fixtures');
	const g = validGenome();
	g.duration = 12;
	g.sections.hard = [{ label: 'intro', start: 0, end: 4 }, { label: 'buildup', start: 4, end: 8 }, { label: 'drop', start: 8, end: 12 }];
	g.beats.beats = Array.from({ length: 24 }, (_, i) => i * 0.5);
	g.beats.downbeats = [0, 2, 4, 6, 8, 10];
	const c = new Conductor(g, seedFromSha('aabbccdd'.repeat(8)));
	assert.ok(c.sample(4.0001).morph < 0.01, `morph starts near zero after the boundary, got ${c.sample(4.0001).morph}`);
	assert.ok(c.sample(7.999).morph > 0.99);
});
