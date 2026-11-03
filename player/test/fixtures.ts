import { BAND_ORDER, STEM_ORDER, type Genome } from '../src/genome';
export function validGenome(sha='a'.repeat(64)): Genome {
 const energy=Object.fromEntries(BAND_ORDER.map(b=>[b,[0.2,0.3,0.2]]));
 const wobble={frame_rate:1,rate_hz:[1,2,1],depth:[0.2,0.5,0.2]};
 return {version:3,track_sha256:sha,source_filename:'test.wav',duration:2,
 sections:{hard:[{label:'intro',start:0,end:2}],frame_rate:1,labels:['intro'],label_probs:[[1],[1],[1]],boundary:[0,0,0]},
 beats:{bpm:120,beats:[0,0.5,1,1.5],downbeats:[0]},waveform:{frame_rate:1,rms:[0.2,0.3,0.2],peak:[0.3,0.4,0.3],crest:[1,1,1]},
 bands:{frame_rate:1,names:[...BAND_ORDER],energy,flux:energy,centroid:[1000,2000,1000]},onsets:[],wobble,tension:{frame_rate:1,curve:[0.2,0.4,0.2]},
 stems:{model:'htdemucs_6s',names:[...STEM_ORDER],rms_frame_rate:1,energy_frame_rate:1,bands:[...BAND_ORDER],per_stem:Object.fromEntries(STEM_ORDER.map(stem=>[stem,{rms:[0.2,0.3,0.2],energy,centroid:[1000,2000,1000],onsets:[],wobble}]))},analyzers:[]};
}
