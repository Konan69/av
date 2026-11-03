import type {Genome,Section} from './genome';
import {BAND_ORDER} from './genome';
import type {Voice} from './voices';

export interface PhraseVoiceSummary {
  stem:string;role:string;rms:number;level:number;
  /** Integrated spectral energy shares, not frame-by-frame brightness. */
  bands:[number,number,number,number,number];centroid:number;onsetRate:number;
}
export interface PhraseSummary {start:number;end:number;sectionIndex:number;label:string;voices:PhraseVoiceSummary[]}
export interface PhraseScoreSignal {
  current:PhraseSummary;next:PhraseSummary;
  /** Already eased, absolute score-time interpolation. */
  blend:number;sectionTransition:boolean;
}
const ease=(v:number)=>{const x=Math.max(0,Math.min(1,v));return x*x*(3-2*x);};
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
function at(values:number[],fps:number,t:number){const x=Math.max(0,t*fps),i=Math.min(values.length-1,Math.floor(x));return values[i]+((values[i+1]??values[i])-values[i])*(x-i);}
/** Exact mean (or mean square) of the analyzer's linearly sampled values. */
function mean(values:number[],fps:number,start:number,end:number,squared=false){
  if(!values.length||end<=start)return 0;
  let sum=0;
  for(let t=start;t<end;){const next=Math.min(end,(Math.floor(t*fps+1e-8)+1)/fps);if(next<=t)break;const a=at(values,fps,t),b=at(values,fps,next);sum+=(next-t)*(squared?(a*a+a*b+b*b)/3:(a+b)/2);t=next;}
  return sum/(end-start);
}
function blended(a:PhraseSummary,b:PhraseSummary,t:number):PhraseSummary{
  if(t<=0||a===b)return a;if(t>=1)return b;
  return {...a,voices:a.voices.map((v,i)=>{const w=b.voices[i];return {...v,rms:mix(v.rms,w.rms,t),level:mix(v.level,w.level,t),centroid:mix(v.centroid,w.centroid,t),onsetRate:mix(v.onsetRate,w.onsetRate,t),bands:v.bands.map((n,j)=>mix(n,w.bands[j],t)) as PhraseVoiceSummary['bands']};})};
}

/** Offline musical form: eight observed downbeats per phrase, restarted at sections.
 * Sampling is a pure lookup. No running averages or render-loop state are used. */
export class PhraseScore {
  readonly phrases:PhraseSummary[]=[];
  private perSection:PhraseSummary[][]=[];
  private transitions:{start:number;source:PhraseSummary;target:PhraseSummary}[]=[];
  constructor(g:Genome,voices:Voice[],private sections:Section[],private downbeats:number[],barDuration:number){
    const spectral=voices.map(v=>{
      const total=v.features.centroid.map((_,i)=>BAND_ORDER.reduce((sum,b)=>sum+(v.features.energy[b][i]??0),0));
      return {total,centroid:total.map((e,i)=>e*v.features.centroid[i])};
    });
    sections.forEach((section,sectionIndex)=>{
      const phrases:PhraseSummary[]=[];let start=section.start;
      let beatIndex=downbeats.findIndex(t=>t>=start-1e-7);if(beatIndex<0)beatIndex=downbeats.length;
      while(start<section.end){
        const end=Math.min(section.end,downbeats[beatIndex+8]??section.end);
        if(end<=start)break;
        const summary:PhraseSummary={start,end,sectionIndex,label:section.label,voices:voices.map((v,i)=>{
          const rms=Math.sqrt(mean(v.features.rms,g.stems.rms_frame_rate,start,end,true));
          const energies=BAND_ORDER.map(b=>mean(v.features.energy[b],g.stems.energy_frame_rate,start,end));
          const total=energies.reduce((sum,n)=>sum+n,0);
          const spectralEnergy=mean(spectral[i].total,g.stems.energy_frame_rate,start,end);
          return {stem:v.stem,role:v.role,rms,level:Math.min(1.3,rms*v.rmsScale),bands:energies.map(n=>total>0?n/total:0) as PhraseVoiceSummary['bands'],centroid:spectralEnergy>0?mean(spectral[i].centroid,g.stems.energy_frame_rate,start,end)/spectralEnergy:0,onsetRate:v.features.onsets.filter(o=>o.t>=start&&o.t<end).length/(end-start)};
        })};
        phrases.push(summary);this.phrases.push(summary);start=end;beatIndex+=8;
      }
      this.perSection.push(phrases);
    });
    for(let i=0;i<sections.length-1;i++){
      const start=Math.max(sections[i].start,sections[i].end-4*barDuration);
      const from=this.normalSample(i,start);
      this.transitions[i]={start,source:blended(from.current,from.next,from.blend),target:this.perSection[i+1][0]};
    }
  }
  private normalSample(sectionIndex:number,t:number):PhraseScoreSignal{
    const phrases=this.perSection[sectionIndex];
    let index=phrases.findIndex(p=>t<p.end);if(index<0)index=phrases.length-1;
    const current=phrases[index],next=phrases[index+1]??current;
    let start=current.start;
    for(const downbeat of this.downbeats){if(downbeat>=current.end-1e-7)break;if(downbeat>=current.start)start=downbeat;}
    const blend=next===current?0:ease((t-start)/(current.end-start));
    return {current,next,blend,sectionTransition:false};
  }
  sample(time:number):PhraseScoreSignal{
    const t=Math.max(this.sections[0].start,Math.min(this.sections.at(-1)!.end,Number.isFinite(time)?time:0));
    let index=this.sections.findIndex(s=>t<s.end);if(index<0)index=this.sections.length-1;
    const transition=this.transitions[index];
    if(transition&&t>=transition.start)return {current:transition.source,next:transition.target,blend:ease((t-transition.start)/(this.sections[index].end-transition.start)),sectionTransition:true};
    return this.normalSample(index,t);
  }
}
