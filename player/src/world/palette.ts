import * as THREE from 'three';
import type {WorldSeed} from '../seed';

/** One saturated hue per section; the accent is reserved for hits.
 * Hue changes only at section boundaries, over the last beat before the downbeat. */
export interface SectionLook {hue:number;saturation:number;accentHue:number}

const wrap=(h:number)=>((h%1)+1)%1;

export function sectionLook(label:string,occurrence:number,seed?:WorldSeed):SectionLook{
 const base=seed?.hue??0.52, shift=seed?.accentShift??0.4;
 const [offset,saturation]=/drop|chorus/i.test(label)?[shift,1]
  :/build|rise/i.test(label)?[0.07,0.85]
  :/break|verse/i.test(label)?[-0.09,0.7]
  :[0,0.62];
 const hue=wrap(base+offset+occurrence*0.035);
 return {hue,saturation,accentHue:wrap(hue+0.5-0.07)};
}

/** Blend two looks along the shortest way round the hue circle. */
export function blendLook(a:SectionLook,b:SectionLook,t:number):SectionLook{
 const mixHue=(x:number,y:number)=>{let d=y-x;if(d>0.5)d-=1;if(d<-0.5)d+=1;return wrap(x+d*t);};
 return {hue:mixHue(a.hue,b.hue),saturation:a.saturation+(b.saturation-a.saturation)*t,accentHue:mixHue(a.accentHue,b.accentHue)};
}

export function inkColor(look:SectionLook,target:THREE.Color,lightness=0.55){return target.setHSL(look.hue,look.saturation,lightness);}
export function accentColor(look:SectionLook,target:THREE.Color,lightness=0.6){return target.setHSL(look.accentHue,Math.min(1,look.saturation+0.15),lightness);}
