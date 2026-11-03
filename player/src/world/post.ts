import * as THREE from 'three';
import {EffectComposer} from 'three/examples/jsm/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/examples/jsm/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/examples/jsm/postprocessing/OutputPass.js';
import {Pass,FullScreenQuad} from 'three/examples/jsm/postprocessing/Pass.js';

/** Phosphor persistence: light fades like a scope trace instead of vanishing.
 * max(new, old * damp - cutoff) keeps a line's own brightness while its afterglow decays;
 * the cutoff lets only highlights leave trails, so the lit world does not smear when the
 * camera moves. Half-float targets keep faint tails that an 8-bit threshold would cut off. */
class PhosphorPass extends Pass {
 damp=.8;
 private history:THREE.WebGLRenderTarget;
 private next:THREE.WebGLRenderTarget;
 private blend=new FullScreenQuad(new THREE.ShaderMaterial({
  uniforms:{tNew:{value:null},tOld:{value:null},damp:{value:.8},cutoff:{value:.12}},
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
  fragmentShader:`uniform sampler2D tNew,tOld;uniform float damp,cutoff;varying vec2 vUv;
   void main(){vec4 n=texture2D(tNew,vUv),o=max(texture2D(tOld,vUv)*damp-cutoff,0.);gl_FragColor=max(n,o);}`,
 }));
 private copy=new FullScreenQuad(new THREE.ShaderMaterial({
  uniforms:{tDiffuse:{value:null}},
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
  fragmentShader:`uniform sampler2D tDiffuse;varying vec2 vUv;void main(){gl_FragColor=texture2D(tDiffuse,vUv);}`,
 }));
 constructor(){
  super();
  const options={type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter};
  this.history=new THREE.WebGLRenderTarget(1,1,options);this.next=new THREE.WebGLRenderTarget(1,1,options);
 }
 setSize(width:number,height:number){this.history.setSize(width,height);this.next.setSize(width,height);}
 render(renderer:THREE.WebGLRenderer,writeBuffer:THREE.WebGLRenderTarget,readBuffer:THREE.WebGLRenderTarget){
  const blend=this.blend.material as THREE.ShaderMaterial;
  blend.uniforms.tNew.value=readBuffer.texture;blend.uniforms.tOld.value=this.history.texture;blend.uniforms.damp.value=this.damp;
  renderer.setRenderTarget(this.next);this.blend.render(renderer);
  (this.copy.material as THREE.ShaderMaterial).uniforms.tDiffuse.value=this.next.texture;
  renderer.setRenderTarget(this.renderToScreen?null:writeBuffer);this.copy.render(renderer);
  [this.history,this.next]=[this.next,this.history];
 }
 dispose(){this.history.dispose();this.next.dispose();this.blend.dispose();(this.blend.material as THREE.Material).dispose();this.copy.dispose();(this.copy.material as THREE.Material).dispose();}
}

/** Lens finish: chromatic fringing toward the edges, a vignette, film grain, and a
 * negative flash that inverts the frame for an instant when a drop lands. */
class FinishPass extends Pass {
 fringe=.0015;flash=0;grain=.03;seed=0;
 private quad=new FullScreenQuad(new THREE.ShaderMaterial({
  uniforms:{tDiffuse:{value:null},fringe:{value:.0015},flash:{value:0},grain:{value:.03},seed:{value:0}},
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
  fragmentShader:`uniform sampler2D tDiffuse;uniform float fringe,flash,grain,seed;varying vec2 vUv;
   float hash(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
   void main(){
    vec2 d=vUv-.5;float r=length(d);vec2 o=d*fringe*(1.+6.*r*r);
    vec3 c=vec3(texture2D(tDiffuse,vUv+o).r,texture2D(tDiffuse,vUv).g,texture2D(tDiffuse,vUv-o).b);
    c*=1.-.5*smoothstep(.3,.85,r);
    float n=hash(gl_FragCoord.xy+seed*61.7)-.5;
    c=c*(1.+n*grain*2.)+n*grain*.03;
    c=mix(c,vec3(1.6)*exp(-c*2.5),flash);
    gl_FragColor=vec4(max(c,0.),1.);
   }`,
 }));
 render(renderer:THREE.WebGLRenderer,writeBuffer:THREE.WebGLRenderTarget,readBuffer:THREE.WebGLRenderTarget){
  const material=this.quad.material as THREE.ShaderMaterial;
  material.uniforms.tDiffuse.value=readBuffer.texture;material.uniforms.fringe.value=this.fringe;
  material.uniforms.flash.value=this.flash;material.uniforms.grain.value=this.grain;material.uniforms.seed.value=this.seed%977;
  renderer.setRenderTarget(this.renderToScreen?null:writeBuffer);this.quad.render(renderer);
 }
 dispose(){this.quad.dispose();(this.quad.material as THREE.Material).dispose();}
}

export interface PostSettings {persistence:number;bloom:number;fringe:number;flash?:number;grain?:number;seed?:number}

export function createPost(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.Camera){
 const size=renderer.getSize(new THREE.Vector2());
 const composer=new EffectComposer(renderer);
 composer.setPixelRatio(renderer.getPixelRatio());composer.setSize(size.x,size.y);
 const renderPass=new RenderPass(scene,camera);
 const phosphor=new PhosphorPass();
 const bloom=new UnrealBloomPass(new THREE.Vector2(size.x,size.y),.6,.5,.35);
 const finish=new FinishPass();
 const output=new OutputPass();
 composer.addPass(renderPass);composer.addPass(phosphor);composer.addPass(bloom);composer.addPass(finish);composer.addPass(output);
 let width=size.x,height=size.y,ratio=renderer.getPixelRatio();
 function render(settings:PostSettings,activeCamera:THREE.Camera){
  const now=renderer.getSize(new THREE.Vector2());
  if(now.x!==width||now.y!==height||renderer.getPixelRatio()!==ratio){
   width=now.x;height=now.y;ratio=renderer.getPixelRatio();
   composer.setPixelRatio(ratio);composer.setSize(width,height);
  }
  renderPass.camera=activeCamera;
  phosphor.damp=settings.persistence;bloom.strength=settings.bloom;finish.fringe=settings.fringe;finish.flash=settings.flash??0;finish.grain=settings.grain??0;finish.seed=settings.seed??0;
  composer.render();
 }
 function dispose(){
  // three r159's UnrealBloomPass.dispose() omits its high-pass material.
  (bloom as unknown as {materialHighPassFilter?:THREE.Material}).materialHighPassFilter?.dispose();
  phosphor.dispose();bloom.dispose();finish.dispose();output.dispose();composer.dispose();}
 return {render,dispose};
}
