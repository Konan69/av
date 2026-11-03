#!/usr/bin/env node
import {appendFile, mkdir, readFile, readdir, rename, stat, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash, randomBytes} from 'node:crypto';
import {execFileSync, spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {openProjectorForRecording} from './recording-popup.mjs';
import {parallaxClip} from './recording-view.mjs';
import {requireRecordingFrameRate} from './recording-performance.mjs';
import {samePassage} from './recording-comparison.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2), options={};
for(let i=0;i<args.length;i++) {const key=args[i].replace(/^--/,'');options[key]=['skip-tests','help','refresh-index','parallax','background'].includes(key)?true:args[++i];}
if(options.help){console.log('node scripts/record-visual.mjs --iteration NAME [--clips name:start:seconds,...] [--cdp http://localhost:9334] [--origin http://localhost:5177] [--skip-tests] [--note TEXT] [--refresh-index] [--parallax] [--background]');process.exit(0);}
const iteration=String(options.iteration||'visual-check').replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,80);
const timestamp=new Date().toISOString(), directory=path.resolve(root,String(options.output||'artifacts/visual-tests'),`${timestamp.replace(/[:.]/g,'-')}-${iteration}`);
const origin=String(options.origin||'http://localhost:5177'), cdp=String(options.cdp||'http://localhost:9334');
const audioAsset=String(options.audio||'audio/reference.m4a'),genomeAsset=String(options.genome||'genomes/reference.genome.json');
const manifest={version:1,iteration,startedAt:timestamp,status:'running',origin,cdp,note:options.note||'',clips:[],errors:[],source:{},tests:{},track:{},recording:{minimumFps:20,parallax:Boolean(options.parallax),diagnosticSnapshots:'structuredClone',fps:60,videoBitsPerSecond:8000000,audioBitsPerSecond:128000,capture:'Actual GenomeWorld WebGL canvas plus its Web Audio transport'}};
const log=async text=>{console.log(text);await appendFile(path.join(directory,'run.log'),`${new Date().toISOString()} ${text}\n`);};
const checkpoint=()=>writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const command=(program,args)=>{try{return execFileSync(program,args,{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024});}catch(error){return String(error.stdout||error.message);}};
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function reviewText(review){
 const observations=Array.isArray(review?.observations)?review.observations.join(' '):review?.observations||'';
 return {verdict:String(review?.verdict||'Pending review'),observations:String(observations),nextChange:String(review?.nextChange||'')};
}
function reviewHtml(review){
 const text=reviewText(review);
 return `<p><strong>Visual review: ${escape(text.verdict)}</strong></p>${text.observations?`<p>${escape(text.observations)}</p>`:''}${text.nextChange?`<p><strong>Next change:</strong> ${escape(text.nextChange)}</p>`:''}`;
}
const galleryStyle='body{background:#101317;color:#eef2f4;font:15px system-ui;margin:30px}a{color:#9cdfd6}p{line-height:1.5}td,th{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid #333}table{width:100%}video{width:100%;max-height:70vh;background:#000}section{max-width:1200px;margin:35px 0}select,button{font:inherit;padding:8px;margin:6px}code{overflow-wrap:anywhere}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:18px}.comparison figure{margin:0}.comparison figcaption{min-height:100px;white-space:pre-line}.thumbnail{max-width:320px;max-height:180px;display:block;margin:12px 0}@media(max-width:750px){body{margin:15px}.comparison{grid-template-columns:1fr}table{font-size:13px}}';
async function renderRun(parent,entry){
 const folder=path.join(parent,entry.directory);
 const cards=entry.clips.map(c=>{
  const start=Number(c.start||0),end=start+Number(c.duration||0),contact=c.video?.replace(/\.(webm|mp4)$/,'.contact.jpg');
  const screenshot=c.screenshot&&existsSync(path.join(folder,c.screenshot))?c.screenshot:null;
  return `<section><h2>${escape(c.label||c.name)} · ${start.toFixed(2)}s–${end.toFixed(2)}s</h2><p>Capture: ${escape(c.status)} · Measured render rate: ${Number.isFinite(c.measuredFps)?c.measuredFps.toFixed(2)+' FPS':'unreported'}${c.error?` · ${escape(c.error)}`:''}</p><video controls preload="metadata" src="${escape(c.video)}"></video><p><a href="${escape(c.video)}">Video with audio</a>${screenshot?` · <a href="${escape(screenshot)}">Screenshot</a>`:''}${contact&&existsSync(path.join(folder,contact))?` · <a href="${escape(contact)}">Contact sheet</a>`:''}</p>${screenshot?`<a href="${escape(screenshot)}"><img class="thumbnail" loading="lazy" src="${escape(screenshot)}" alt="${escape(c.name)} midpoint"></a>`:''}</section>`;
 }).join('');
 await writeFile(path.join(folder,'index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(entry.iteration)}</title><style>${galleryStyle}</style><p><a href="../index.html">All iterations and comparison</a></p><h1>${escape(entry.iteration)}</h1><p>${escape(entry.startedAt)} · Capture/tests: ${escape(entry.status)} · Tests: ${escape(entry.tests?.status||'unreported')}</p><p>Capture and test results do not indicate visual approval.</p>${reviewHtml(entry.review)}${entry.diagnosticsIntegrity?.reason?`<p><strong>Diagnostic history:</strong> ${escape(entry.diagnosticsIntegrity.reason)}</p>`:''}${entry.review?'<p><a href="review.json">Review notes</a></p>':''}<p>${escape(entry.note||'')}</p><p>Runtime module SHA-256: <code>${escape(entry.source?.runtimeSha256||'unavailable')}</code></p><p><a href="manifest.json">Manifest</a> · <a href="errors.json">Browser errors</a> · <a href="test.log">Test log</a> · <a href="run.log">Run log</a> · <a href="runtime-module.js">Exact recorded module</a> · <a href="working-tree.patch">Working tree patch</a></p>${cards}</html>`);
}
async function renderIndex(){await renderGallery(path.dirname(directory));}
async function renderGallery(parent){
 const entries=[];
 for(const item of await readdir(parent,{withFileTypes:true})){
  if(!item.isDirectory())continue;
  try{
   const folder=path.join(parent,item.name),m=JSON.parse(await readFile(path.join(folder,'manifest.json'),'utf8'));
   let review=null;try{review=JSON.parse(await readFile(path.join(folder,'review.json'),'utf8'));}catch{}
   entries.push({...m,directory:item.name,clips:m.clips||[],review});
  }catch{}
 }
 entries.sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
 for(const entry of entries)await renderRun(parent,entry);
 const comparison=entries.filter(e=>e.clips.some(c=>c.status==='passed'&&c.bytes>0)).map(e=>({directory:e.directory,iteration:e.iteration,review:reviewText(e.review),clips:e.clips.filter(c=>c.status==='passed'&&c.bytes>0)}));
 await writeFile(path.join(parent,'index.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Visual test recordings</title><style>${galleryStyle}</style><h1>Visual test recordings</h1><p><strong>Capture/tests</strong> reports recording and automated checks. <strong>Visual review</strong> records the separate design verdict; an unreviewed run is pending.</p><table><tr><th>Iteration</th><th>Recorded</th><th>Capture/tests</th><th>Visual review</th></tr>${entries.map(e=>`<tr><td><a href="${escape(e.directory)}/index.html">${escape(e.iteration)}</a>${e.note?`<p>${escape(e.note)}</p>`:''}</td><td>${escape(e.startedAt)}</td><td>${escape(e.status)}<p>Tests: ${escape(e.tests?.status||'unreported')}</p></td><td>${reviewHtml(e.review)}</td></tr>`).join('')}</table><h2>Compare the same passage</h2><label>Left <select id="left"></select></label><label>Right <select id="right"></select></label><label>Passage <select id="clip"></select></label><button id="play">Play both</button><button id="pause">Pause both</button><p id="comparison-status" role="status"></p><p>Left audio is audible; the right comparison is muted. Choose any recorded versions to compare, including rejected designs.</p><div class="comparison"><figure><figcaption id="left-note"></figcaption><video id="a" controls></video></figure><figure><figcaption id="right-note"></figcaption><video id="b" controls muted></video></figure></div><script>const entries=${JSON.stringify(comparison).replace(/</g,'\\u003c')};const l=document.querySelector('#left'),r=document.querySelector('#right'),c=document.querySelector('#clip'),a=document.querySelector('#a'),b=document.querySelector('#b');const samePassage=${samePassage.toString()};for(const [i,e]of entries.entries()){for(const s of[l,r])s.add(new Option(e.iteration,i));}if(entries.length>1)r.value='1';function clips(){const previous=c.value;c.replaceChildren();for(const x of entries[l.value]?.clips||[])if(entries[r.value]?.clips.some(y=>samePassage(x,y)))c.add(new Option(x.name,x.name));if([...c.options].some(o=>o.value===previous))c.value=previous;update();}function update(){const selected=entries[l.value]?.clips.find(x=>x.name===c.value);for(const [s,v,id]of[[l,a,'left-note'],[r,b,'right-note']]){const e=entries[s.value],clip=e?.clips.find(x=>selected&&samePassage(x,selected));if(clip)v.src=e.directory+'/'+clip.video;else v.removeAttribute('src');document.getElementById(id).textContent=e?e.iteration+' — Visual review: '+e.review.verdict+'\\n'+e.review.observations+(e.review.nextChange?'\\nNext change: '+e.review.nextChange:''):'No completed clips yet.';}document.querySelector('#play').disabled=!c.value;document.querySelector('#comparison-status').textContent=selected?'Same passage: '+selected.start+'s–'+(selected.start+selected.duration)+'s':'No identical passages in these two runs. Choose other iterations.';}l.onchange=clips;r.onchange=clips;c.onchange=update;document.querySelector('#play').onclick=async()=>{a.currentTime=0;b.currentTime=0;await Promise.allSettled([a.play(),b.play()]);};document.querySelector('#pause').onclick=()=>{a.pause();b.pause();};clips();</script></html>`);
}
if(options['refresh-index']){
 const parent=path.resolve(root,String(options.output||'artifacts/visual-tests'));
 await mkdir(parent,{recursive:true});await renderGallery(parent);
 console.log(`Gallery refreshed: ${path.join(parent,'index.html')}`);process.exit(0);
}
await mkdir(directory,{recursive:true});
let browser,frame,page;
const chunks=new Map();
let aborted=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{aborted=true;void frame?.evaluate(()=>window.__avVisualRecording?.stop?.()).catch(()=>{});});
await checkpoint();
try {
 manifest.source.commit=command('git',['rev-parse','HEAD']).trim();
 const recorderSource=await readFile(fileURLToPath(import.meta.url));
 await writeFile(path.join(directory,'recorder.mjs'),recorderSource);manifest.source.recorderSha256=sha(recorderSource);
 await writeFile(path.join(directory,'git-status.txt'),command('git',['status','--short']));
 await writeFile(path.join(directory,'working-tree.patch'),command('git',['diff','--binary','HEAD']));
 const runtimeResponse=await fetch(`${origin}/api/nw/modules/GenomeWorld`);
 if(!runtimeResponse.ok)throw new Error(`Cannot archive served GenomeWorld module: HTTP ${runtimeResponse.status}`);
 const runtime=Buffer.from(await runtimeResponse.arrayBuffer());
 await writeFile(path.join(directory,'runtime-module.js'),runtime);manifest.source.runtimeSha256=sha(runtime);
 const sourceFiles=['scripts/recording-comparison.mjs','scripts/recording-performance.mjs','scripts/recording-view.mjs','scripts/recording-popup.mjs','player/src/world/resonance.ts','player/src/world/universe.ts','player/src/world/director.ts','player/src/world/hyper.ts','player/src/world/motes.ts','player/src/world/cast.ts','player/src/world/post.ts','player/src/world/palette.ts','app/web/bridge.ts','app/web/shell.ts','app/web/projector.ts','app/web/sandbox.ts','player/src/world/MusicWorld.ts','nw/src/GenomeWorld.ts','nw/src/Orbit.ts','player/src/conductor.ts','player/src/phraseScore.ts','player/src/voices.ts','player/src/audio.ts'];
 manifest.source.files={};
 for(const name of sourceFiles){try{const bytes=await readFile(path.join(root,name));manifest.source.files[name]=sha(bytes);await mkdir(path.join(directory,'source',path.dirname(name)),{recursive:true});await writeFile(path.join(directory,'source',name),bytes);}catch{}}
 const genomeResponse=await fetch(`${origin}/api/nw/assets/${genomeAsset}`);
 if(!genomeResponse.ok)throw new Error(`Cannot read reference genome: HTTP ${genomeResponse.status}`);
 const genome=await genomeResponse.json();
 manifest.track={name:genome.source_filename,sha256:genome.track_sha256,duration:genome.duration,audioAsset,genomeAsset,sections:genome.sections.hard};
 const transitions=genome.sections.hard.filter((s,i,all)=>/drop/i.test(s.label)&&(i===0||!/drop/i.test(all[i-1].label)));
 const firstDrop=transitions[0]?.start??genome.duration*.3,secondDrop=transitions[1]?.start??genome.duration*.65;
 const requested=options.clips?String(options.clips).split(',').map(s=>{const[name,start,duration]=s.split(':');return{name,start:Number(start),duration:Number(duration||12)};}):[{name:'intro',start:8,duration:16},{name:'buildup-drop',start:Math.round(firstDrop)-10,duration:24},{name:'breakdown-second-drop',start:Math.round((genome.sections.hard.find(s=>/breakdown/i.test(s.label))?.start??secondDrop-22))-6,duration:40}];
 if(options.parallax){if(genome.duration<72)throw new Error('--parallax requires a track at least 72 seconds long.');if(requested.some(c=>c.name==='parallax'))throw new Error('The parallax clip name is reserved when --parallax is enabled.');requested.push(parallaxClip());}
 for(const clip of requested){if(!/^[\w-]+$/.test(clip.name)||!Number.isFinite(clip.start)||!Number.isFinite(clip.duration)||clip.duration<=0)throw new Error('Clips must be name:start:duration with finite positive duration.');clip.start=Math.max(0,Math.min(clip.start,genome.duration-clip.duration));}
 if(options['skip-tests']){manifest.tests={status:'skipped',reason:String(options.note||'Explicit --skip-tests; runtime visual assertions still run.')};await writeFile(path.join(directory,'test.log'),`${manifest.tests.reason}\n`);}
 else {
  await log('Running npm test; output retained even if it fails.');
  const output=await new Promise(resolve=>{const child=spawn(process.platform==='win32'?'npm.cmd':'npm',['test'],{cwd:root,shell:process.platform==='win32'});let text='';child.stdout.on('data',d=>{text+=d;});child.stderr.on('data',d=>{text+=d;});child.on('error',e=>resolve({code:1,text:`${text}\n${e.message}`}));child.on('close',code=>resolve({code,text}));});
  manifest.tests={status:output.code===0?'passed':'failed',exitCode:output.code};await writeFile(path.join(directory,'test.log'),output.text);
 }
 let playwright;try{playwright=await import('playwright');}catch{playwright=createRequire(path.join(root,'.runtime/nw_wrld/package.json'))('playwright');}
 browser=await playwright.chromium.connectOverCDP(cdp);
 const context=browser.contexts()[0];
 let pages=context.pages().filter(p=>p.url().startsWith(origin));
 if(!pages.length){const opened=await context.newPage();await opened.goto(origin,{waitUntil:'domcontentloaded'});pages=[opened];}
 let active=[];const readyDeadline=Date.now()+60000;
 while(!active.length&&Date.now()<readyDeadline){for(const candidate of pages)for(const f of candidate.frames())if(await f.evaluate(()=>Boolean(window.__genomeWorld)).catch(()=>false))active.push({page:candidate,frame:f});if(!active.length)await new Promise(resolve=>setTimeout(resolve,250));}
 if(active.length!==1)throw new Error(`Expected exactly one active GenomeWorld renderer; found ${active.length}.`);
 ({page,frame}=active[0]);
 // --background: the recording browser runs off screen; never raise or focus its window.
 if(!options.background)await page.bringToFront();
 if(await page.locator('#open-projector').count()){page=await openProjectorForRecording(page);await page.waitForLoadState('domcontentloaded');if(!options.background)await page.bringToFront();const end=Date.now()+30000;frame=null;while(!frame&&Date.now()<end){for(const candidate of page.frames())if(await candidate.evaluate(()=>Boolean(window.__genomeWorld)).catch(()=>false)){frame=candidate;break;}if(!frame)await new Promise(resolve=>setTimeout(resolve,200));}if(!frame)throw new Error('Projector popup did not initialize');pages.push(page);}
 manifest.gpu=await frame.evaluate(()=>{const gl=window.__genomeWorld.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION)};});
 if(/SwiftShader|llvmpipe|software rasterizer/i.test(manifest.gpu.renderer))throw new Error('Native GPU recording required; detected software renderer');
 manifest.browser={version:browser.version(),page:page.url(),sandbox:frame.url()};
 for(const p of pages){p.on('response',response=>{if(response.status()>=400)manifest.errors.push({at:new Date().toISOString(),type:'http',status:response.status(),url:response.url()});});p.on('pageerror',error=>manifest.errors.push({at:new Date().toISOString(),type:'pageerror',message:error.message}));p.on('console',message=>{if(['error','warning'].includes(message.type()))manifest.errors.push({at:new Date().toISOString(),type:message.type(),message:message.text(),location:message.location(),page:p.url()});});}
 const binding=`__avVideoChunk_${randomBytes(5).toString('hex')}`;
 await context.exposeBinding(binding,async(_source,id,sequence,data)=>{const clip=chunks.get(id);if(!clip)throw new Error('Unknown recording clip');if(sequence!==clip.next++)throw new Error('Recording chunks arrived out of order');const bytes=Buffer.from(data,'base64');await appendFile(clip.path,bytes);clip.bytes+=bytes.length;});
 // Opening the projector can restore the previously loaded track asynchronously (the shell polls for
 // up to 20 s); a load racing that restore gets cancelled mid-recording. Let the shell settle, load,
 // then require the track to stay loaded before any clip starts.
 await new Promise(resolve=>setTimeout(resolve,4000));
 for(let attempt=0;attempt<3;attempt++){
  await frame.evaluate(({audioAsset,genomeAsset})=>window.__genomeWorld.loadTrack({audio:audioAsset,genome:genomeAsset}),{audioAsset,genomeAsset});
  await frame.waitForFunction(expected=>window.__genomeWorld?.diagnostics.loaded&&window.__genomeWorld.session.current.genome.track_sha256===expected,genome.track_sha256,{timeout:60000});
  await new Promise(resolve=>setTimeout(resolve,2000));
  if(await frame.evaluate(expected=>Boolean(window.__genomeWorld?.diagnostics.loaded&&window.__genomeWorld.session.current?.genome.track_sha256===expected),genome.track_sha256))break;
  await log(`Track was unloaded after loading (attempt ${attempt+1}); loading again.`);
 }
 for(const requestedClip of requested){
  if(aborted)throw new Error('Recording interrupted');
  const clip={...requestedClip,status:'recording',video:`${requestedClip.name}.webm`,screenshot:`${requestedClip.name}.png`,samples:[]};manifest.clips.push(clip);
  const id=clip.name;chunks.set(id,{path:path.join(directory,clip.video),next:0,bytes:0});
  await writeFile(path.join(directory,clip.video),'');await checkpoint();await log(`Recording ${clip.name}: ${clip.start.toFixed(3)}s for ${clip.duration}s.`);
  try {
   if(clip.kind==='camera-test')clip.originalView=await frame.evaluate(()=>window.__genomeWorld.capturePlayback()?.view);
   await frame.evaluate(async start=>{const m=window.__genomeWorld;m.pauseTrack();m.showControls({visible:false});m.setFeel({punch:1,bass:1,detail:1,glow:1});m.setView();await m.session.current.transport.seek(start);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);},clip.start);
   clip.before=await frame.evaluate(()=>({diagnostics:window.__genomeWorld.diagnostics,state:window.__genomeWorld.capturePlayback()}));
   await frame.locator('canvas').first().click({position:{x:8,y:8}});
   const recording=frame.evaluate(async({id,duration,binding,viewPlan,originalView})=>{
    const m=window.__genomeWorld,t=m.session.current.transport,canvas=m.renderer.domElement;
    const dest=t.ctx.createMediaStreamDestination(),analyser=t.ctx.createAnalyser();analyser.fftSize=2048;
    t.gain.connect(dest);t.gain.connect(analyser);const originalGain=t.gain.gain.value;t.gain.gain.value=1;
    const canvasStream=canvas.captureStream(60),stream=new MediaStream([...canvasStream.getVideoTracks(),...dest.stream.getAudioTracks()]);
    const mime=['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus','video/webm'].find(x=>MediaRecorder.isTypeSupported(x));
    if(!mime)throw new Error('No supported WebM MediaRecorder codec');
    const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:8000000,audioBitsPerSecond:128000});
    let transfer=Promise.resolve(),sequence=0,timer,interval;const samples=[],viewEvents=[],viewTimers=[];let audioPeak=0;
    const signal=new Float32Array(analyser.fftSize);
    const completed=new Promise((resolve,reject)=>{recorder.ondataavailable=event=>{if(!event.data.size)return;transfer=transfer.then(async()=>{const bytes=new Uint8Array(await event.data.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));await window[binding](id,sequence++,btoa(binary));});};recorder.onerror=event=>reject(new Error(event.error?.message||'MediaRecorder failed'));recorder.onstop=()=>transfer.then(resolve,reject);});
    window.__avVisualRecording={stop:()=>{if(recorder.state!=='inactive')recorder.stop();}};
    // Count displayed frames from the host; render.frame counts every post-processing pass.
    const startFrame=m.diagnostics.renderedFrames,startTime=t.time,startWall=performance.now();
    try {
     recorder.start(1000);await t.play();
     const applyView=event=>{m.setView(event.view);viewEvents.push({scheduledSeconds:event.seconds,elapsedSeconds:t.time-startTime,trackTime:t.time,wallMs:performance.now()-startWall,view:structuredClone(m.capturePlayback?.()?.view||event.view)});};
     for(const event of viewPlan){if(event.seconds===0)applyView(event);else viewTimers.push(setTimeout(()=>applyView(event),event.seconds*1000));}
     interval=setInterval(()=>{analyser.getFloatTimeDomainData(signal);for(const value of signal)audioPeak=Math.max(audioPeak,Math.abs(value));samples.push(structuredClone({wallMs:performance.now()-startWall,time:t.time,frame:m.renderer.info.render.frame,...m.diagnostics}));},1000);
     timer=setTimeout(()=>recorder.stop(),duration*1000);
     await completed;
     return {mime,width:canvas.width,height:canvas.height,audioTracks:stream.getAudioTracks().length,audioPeak,startTime,endTime:t.time,wallMs:performance.now()-startWall,renderFrames:m.diagnostics.renderedFrames-startFrame,samples,...(viewPlan.length?{viewEvents}:{} )};
    } finally {clearTimeout(timer);clearInterval(interval);for(const timer of viewTimers)clearTimeout(timer);if(recorder.state!=='inactive')recorder.stop();t.pause();t.gain.gain.value=originalGain;try{t.gain.disconnect(dest);t.gain.disconnect(analyser);}catch{}for(const track of stream.getTracks())track.stop();if(originalView)m.setView(originalView);delete window.__avVisualRecording;}
   },{id,duration:clip.duration,binding,viewPlan:clip.viewPlan||[],originalView:clip.originalView});
   const screenshot=(async()=>{await new Promise(resolve=>setTimeout(resolve,clip.duration*500));await frame.locator('canvas').first().screenshot({path:path.join(directory,clip.screenshot),timeout:15000});})();
   const settled=await Promise.allSettled([recording,screenshot]);
   if(settled[0].status==='fulfilled')Object.assign(clip,settled[0].value);
   const failed=settled.find(result=>result.status==='rejected');if(failed)throw failed.reason;
   const result=settled[0].value;Object.assign(clip,result);clip.bytes=chunks.get(id).bytes;
   if(clip.bytes<1000||clip.audioTracks!==1||clip.audioPeak<=0||clip.endTime-clip.startTime<clip.duration-.5||clip.samples.some(s=>s.contextLost||s.rendererCount!==1))throw new Error('Recording validation failed: missing video/audio, frozen render, or audio clock did not advance.');
   clip.rawBytes=clip.bytes;
   try{
    const final=path.join(directory,clip.video),remux=path.join(directory,`${clip.name}.remux.webm`);
    execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-i',final,'-map','0','-c','copy','-y',remux],{stdio:['ignore','ignore','pipe'],timeout:60000});
    await rename(remux,final);clip.bytes=(await stat(final)).size;clip.remuxed=true;
   }catch(error){clip.remuxed=false;clip.remuxWarning=String(error.message);}
   try{clip.probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type,codec_name,width,height,duration','-of','json',path.join(directory,clip.video)],{encoding:'utf8'}));}catch(error){clip.probeWarning=String(error.message);}
   requireRecordingFrameRate(clip);
   clip.status='passed';await log(`Saved ${clip.video}: ${clip.bytes} bytes, ${clip.renderFrames} frames (${clip.measuredFps.toFixed(2)} FPS), audio peak ${clip.audioPeak.toFixed(3)}.`);
  }catch(error){clip.status='failed';clip.error=String(error.stack||error);await log(`FAILED ${clip.name}: ${error.message}`);try{await frame.evaluate(()=>window.__avVisualRecording?.stop?.());}catch{};}
  finally{if(clip.originalView)try{clip.restoredView=await frame.evaluate(view=>{const m=window.__genomeWorld;m?.setView(view);return m?.capturePlayback()?.view;},clip.originalView);}catch(error){clip.viewRestoreError=String(error.message);clip.status='failed';}}
  await checkpoint();await renderIndex();
 }
 const currentRuntime=Buffer.from(await(await fetch(`${origin}/api/nw/modules/GenomeWorld`)).arrayBuffer());
 manifest.source.runtimeSha256After=sha(currentRuntime);
 if(manifest.source.runtimeSha256After!==manifest.source.runtimeSha256)throw new Error('Served module changed during recording; this iteration is not reproducible.');
 manifest.status=manifest.clips.every(c=>c.status==='passed')&&manifest.tests.status!=='failed'&&!manifest.errors.some(e=>e.type==='pageerror')?'passed':'failed';
}catch(error){manifest.status='failed';manifest.errors.push({at:new Date().toISOString(),type:'runner',message:String(error.stack||error)});await log(`FAILED run: ${error.message}`);}
finally{
 try{await frame?.evaluate(()=>{window.__avVisualRecording?.stop?.();window.__genomeWorld?.pauseTrack();});}catch{}
 if(browser)await browser.close();
 manifest.finishedAt=new Date().toISOString();await writeFile(path.join(directory,'errors.json'),JSON.stringify(manifest.errors,null,2));await checkpoint();await renderIndex();
 await log(`Evidence retained: ${directory}`);if(manifest.status==='failed')process.exitCode=1;
}
