import {test} from 'node:test';
import assert from 'node:assert/strict';
import {figureRatios,makeChord,HarmonyScore} from '../src/harmony';
import {discoverVoices} from '../src/voices';
import {validGenome} from './fixtures';
import type {Chroma} from '../src/genome';

test('consonant chords draw simple knots and dissonant ones stay bounded',()=>{
 assert.deepEqual(figureRatios([0,4,7]),[4,5,6],'major triad is 4:5:6');
 assert.deepEqual(figureRatios([0,3,7]),[10,12,15],'minor triad is 10:12:15');
 assert.deepEqual(figureRatios([0,7]),[2,3,4],'a bare fifth adds the octave');
 assert.deepEqual(figureRatios([0]),[1,2,3]);
 const cluster=figureRatios([0,1,2]);
 assert.ok(Math.max(...cluster)<=16&&new Set(cluster).size===3,`cluster stays readable: ${cluster}`);
 assert.equal(makeChord(5,[0,3,7],1,true).label,'Fm');
 assert.equal(makeChord(0,[0,4,7],1,true).label,'C');
});

/** Two bars: F minor over an F bass, then C major over a C bass. */
function chordGenome(){
 const g=validGenome();
 g.duration=4;g.beats={bpm:120,beats:[0,.5,1,1.5,2,2.5,3,3.5],downbeats:[0,2]};
 const rows=(frames:number,pcs:number[])=>Array.from({length:frames},()=>Array.from({length:12},(_,k)=>pcs.includes(k)?1:.05));
 const chroma=(first:number[],second:number[]):Chroma=>({frame_rate:10,pitch_classes:[],bins:[...rows(20,first),...rows(20,second)],strength:Array(40).fill(.6)});
 for(const stem of g.stems.names){
  const f=g.stems.per_stem[stem];f.rms=Array(5).fill(.3);
  if(stem==='bass')f.chroma=chroma([5],[0]);
  else if(stem==='other'||stem==='piano')f.chroma=chroma([5,8,0],[0,4,7]);
 }
 g.stems.rms_frame_rate=1;
 return g;
}

test('bar chords are read from the harmonic stems, rooted by the isolated bass',()=>{
 const g=chordGenome();
 const score=new HarmonyScore(g,discoverVoices(g),[0,2],.5,()=>'drop');
 assert.ok(score.observed);
 assert.equal(score.chords[0].label,'Fm');assert.equal(score.chords[1].label,'C');
 assert.deepEqual(score.chords[1].ratios,[4,5,6]);
});

test('the chord morph gathers over the last half beat and lands on the downbeat',()=>{
 const g=chordGenome();
 const score=new HarmonyScore(g,discoverVoices(g),[0,2],.5,()=>'drop');
 assert.equal(score.sample(1.7).blend,0,'held through the bar');
 const late=score.sample(1.9).blend,early=score.sample(1.8).blend;
 assert.ok(late>0&&late<1&&late-early>early,'accelerating into the downbeat');
 const landed=score.sample(2);assert.equal(landed.current.label,'C');assert.equal(landed.blend,0);
 assert.deepEqual(score.sample(1.2),score.sample(1.2),'pure lookup');
});

test('older genomes without chroma fall back to unobserved section chords',()=>{
 const g=validGenome();
 const score=new HarmonyScore(g,discoverVoices(g),[0],.5,()=>'drop');
 assert.equal(score.observed,false);assert.equal(score.chords[0].observed,false);
});
