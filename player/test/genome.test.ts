import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertGenome} from '../src/genome';
import {validGenome} from './fixtures';
test('valid v3 retains identity; old versions request re-analysis',()=>{
 const g=validGenome();assert.equal(assertGenome(g),g);
 assert.throws(()=>assertGenome({...g,version:2}),/need 3.*re-analyze/);
});
test('malformed renderer inputs are rejected with an actionable field name',()=>{
 const cases:[string,(g:any)=>void][]=[
 ['duration',g=>g.duration=NaN], ['duration',g=>g.duration=0],
 ['waveform.frame_rate',g=>g.waveform.frame_rate=0],['waveform.rms',g=>g.waveform.rms[0]=Infinity],
 ['bands.energy.air',g=>delete g.bands.energy.air],['beats.beats',g=>g.beats.beats=[1,0]],
 ['beats.onset_phase_offset',g=>g.beats.onset_phase_offset=NaN],['sections.label_probs',g=>g.sections.label_probs=[[1,0]]],
 ['sections.hard',g=>g.sections.hard[0].start='zero'],['stems.names',g=>g.stems.names=['bass']],
 ['stems.bass.onsets',g=>g.stems.per_stem.bass.onsets=[{t:1,strength:Infinity,band:'low'}]],
 ['stems.bass.rms',g=>delete g.stems.per_stem.bass.rms], ['wobble.rate_hz',g=>g.wobble.rate_hz=null],
 ['tension.curve',g=>g.tension.curve=[NaN]],
 ];
 for(const [field,mutate] of cases){const g=validGenome();mutate(g);assert.throws(()=>assertGenome(g),error=>error instanceof Error&&error.message.includes(field)&&error.message.includes('re-analyze'),field);}
});
