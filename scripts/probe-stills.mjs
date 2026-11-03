#!/usr/bin/env node
// Quick look between recordings: seek the live GenomeWorld to chosen times, save canvas stills,
// and measure the playing frame rate. Dev evidence only; candidates still get full recordings.
// usage: node scripts/probe-stills.mjs --name NAME --times 10,50,120 [--fps-at 60] [--debug '{"hyper":false}'] [--cdp http://localhost:9334]
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {openProjectorForRecording} from './recording-popup.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),o={};for(let i=0;i<args.length;i+=2)o[args[i].replace(/^--/,'')]=args[i+1];
const origin=o.origin||'http://localhost:5177',cdp=o.cdp||'http://localhost:9334';
const times=String(o.times||'12,50,120').split(',').map(Number);
const dir=path.join(root,'artifacts/visual-tests/probes',`${new Date().toISOString().replace(/[:.]/g,'-')}-${o.name||'probe'}`);
await mkdir(dir,{recursive:true});
const browser=await chromium.connectOverCDP(cdp);
try{
 const context=browser.contexts()[0];
 let page=context.pages().find(p=>p.url().startsWith(origin));
 if(!page){page=await context.newPage();await page.goto(origin,{waitUntil:'domcontentloaded'});}
 else await page.reload({waitUntil:'domcontentloaded'});
 const find=async()=>{for(const p of context.pages())for(const f of p.frames())if(await f.evaluate(()=>Boolean(window.__genomeWorld)).catch(()=>false))return {p,f};return null;};
 let hit=null;for(let i=0;i<120&&!hit;i++){hit=await find();if(!hit)await new Promise(r=>setTimeout(r,250));}
 if(!hit)throw new Error('no GenomeWorld');
 if(await hit.p.locator('#open-projector').count()){const popup=await openProjectorForRecording(hit.p);await popup.waitForLoadState('domcontentloaded');hit=null;for(let i=0;i<120&&!hit;i++){hit=await find();if(!hit)await new Promise(r=>setTimeout(r,250));}}
 const {f}=hit;const errors=[];for(const p of context.pages()){p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});p.on('pageerror',e=>errors.push(e.message));}
 await f.evaluate(()=>window.__genomeWorld.loadTrack({audio:'audio/reference.m4a',genome:'genomes/reference.mixchroma.genome.json'}));
 await f.waitForFunction(()=>window.__genomeWorld?.diagnostics.loaded,null,{timeout:60000});
 await f.evaluate(()=>{const m=window.__genomeWorld;m.showControls({visible:false});m.setView();});
 // (the flight has no models to wait for)
 if(o.debug)await f.evaluate(d=>Object.assign(window.__genomeWorld.world.debug,JSON.parse(d)),o.debug);
 const report={times:[],errors};
 for(const t of times){
  const info=await f.evaluate(async t=>{const m=window.__genomeWorld;m.pauseTrack();await m.session.current.transport.seek(t);
   const raf=()=>new Promise(requestAnimationFrame);
   for(let i=0;i<10;i++){m.world.update(m.session.current.conductor.sample(t),m.feel);m.world.render(m.renderer,m.camera);await raf();}
   return structuredClone(m.world.root.userData);},t);
  await f.locator('canvas').first().screenshot({path:path.join(dir,`t${t.toFixed(2).padStart(8,'0')}.png`)});
  report.times.push({t,...info});
 }
 if(o['fps-at']){
  report.fps=await f.evaluate(async t=>{const m=window.__genomeWorld;await m.session.current.transport.seek(t);const a=m.diagnostics.renderedFrames,w=performance.now();
   await m.session.current.transport.play();await new Promise(r=>setTimeout(r,4000));m.pauseTrack();return (m.diagnostics.renderedFrames-a)/((performance.now()-w)/1000);},Number(o['fps-at']));
 }
 await writeFile(path.join(dir,'report.json'),JSON.stringify(report,null,2));
 console.log(dir);console.log(JSON.stringify({fps:report.fps,errors:errors.slice(0,5),worlds:report.times.map(x=>`${x.t}:${x.world}>${x.nextWorld}@${x.morph} ${x.mood} ${x.place}>${x.nextPlace} ${x.shot}`)}));
}finally{process.exit(process.exitCode??0);}
