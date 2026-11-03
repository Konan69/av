import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {Script} from 'node:vm';
import {EventEmitter} from 'node:events';
import {openProjectorForRecording} from '../../scripts/recording-popup.mjs';
import {parallaxClip} from '../../scripts/recording-view.mjs';
import {requireRecordingFrameRate} from '../../scripts/recording-performance.mjs';
import {samePassage} from '../../scripts/recording-comparison.mjs';

const recorder=fileURLToPath(new URL('../../scripts/record-visual.mjs',import.meta.url));
test('gallery refresh keeps failed evidence but compares only completed media',async()=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'av-recording-gallery-'));
 try{
  const fixtures=[
   {directory:'01-baseline',iteration:'baseline',startedAt:'2026-01-01',status:'passed',clips:[{name:'intro',start:8,duration:16,video:'intro.webm',status:'passed',bytes:1000,measuredFps:29.7}]},
   {directory:'02-candidate',iteration:'candidate',startedAt:'2026-01-02',status:'passed',clips:[{name:'intro',start:8,duration:16,video:'intro.webm',status:'passed',bytes:1000},{name:'broken',video:'broken.webm',status:'failed',bytes:0}]},
   {directory:'03-failed',iteration:'retained failure',startedAt:'2026-01-03',status:'failed',clips:[]},
  ];
  for(const fixture of fixtures){await mkdir(path.join(folder,fixture.directory));await writeFile(path.join(folder,fixture.directory,'manifest.json'),JSON.stringify(fixture));}
  await writeFile(path.join(folder,'02-candidate','review.json'),JSON.stringify({verdict:'Rejected',observations:['Hollow tunnel.', 'Escaped <script>example</script>'],nextChange:'Add solid foreground forms.'}));
  execFileSync(process.execPath,[recorder,'--refresh-index','--output',folder],{encoding:'utf8'});
  const html=await readFile(path.join(folder,'index.html'),'utf8');
  assert.match(html,/03-failed\/index.html/,'failed run remains reachable');
  assert.match(html,/<th>Capture\/tests<\/th><th>Visual review<\/th>/);
  assert.match(html,/Visual review: Rejected/);
  assert.match(html,/Visual review: Pending review/);
  assert.match(html,/No identical passages in these two runs/);
  assert.match(html,/clips.some\(y=>samePassage\(x,y\)\)/);
  assert.match(html,/Escaped &lt;script&gt;example&lt;\/script&gt;/);
  const runHtml=await readFile(path.join(folder,'02-candidate','index.html'),'utf8');
  assert.match(await readFile(path.join(folder,'01-baseline','index.html'),'utf8'),/Measured render rate: 29.70 FPS/);
  assert.match(runHtml,/Capture\/tests: passed/,'technical pass remains distinct from visual rejection');
  assert.match(runHtml,/Visual review: Rejected/);
  assert.match(runHtml,/Next change:<\/strong> Add solid foreground forms/);
  assert.match(runHtml,/review.json/);
  const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);new Script(script);
  const serialized=script.slice('const entries='.length,script.indexOf(';const l='));
  const entries=JSON.parse(serialized);
  assert.deepEqual(entries.map(e=>e.iteration),['candidate','baseline'],'newest failed run cannot blank the comparison');
  assert.deepEqual(entries[0].clips.map(c=>c.name),['intro'],'failed partial media is excluded');
  assert.equal(entries[0].review.verdict,'Rejected','rejected designs remain available for comparison');
  assert.equal(entries[0].review.observations,'Hollow tunnel. Escaped <script>example</script>');
  await writeFile(path.join(folder,'02-candidate','review.json'),JSON.stringify({verdict:'Needs revision',observations:'Updated review after capture.'}));
  execFileSync(process.execPath,[recorder,'--refresh-index','--output',folder],{encoding:'utf8'});
  assert.match(await readFile(path.join(folder,'02-candidate','index.html'),'utf8'),/Visual review: Needs revision/,'refresh rereads later review notes on individual pages');
  assert.equal(JSON.parse(await readFile(path.join(folder,'02-candidate','manifest.json'),'utf8')).status,'passed','review never rewrites capture evidence');
  assert.match(script,/if\(entries\[r.value\]\?\.clips.some/,'clip menu must intersect both runs');
 }finally{await rm(folder,{recursive:true,force:true});}
});

// Execute the actual expression used by the serialized browser callback. Its nested
// composition data comes from mutable Three.js userData and must be copied now.
test('recorded diagnostic samples survive later composition mutations',async()=>{
 const source=await readFile(recorder,'utf8');
 const expression=source.match(/samples\.push\((.+)\);},1000\)/)?.[1];
 assert.ok(expression,'locate actual browser diagnostic sampling expression');
 const diagnostics={time:4,composition:{phase:'intro',shape:{radius:2},weights:[1,2]}};
 const scope={structuredClone,performance:{now:()=>1000},startWall:500,t:{time:4},m:{renderer:{info:{render:{frame:12}}},diagnostics}};
 const expressionScript=new Script(expression);
 const before=expressionScript.runInNewContext(scope);
 diagnostics.composition.phase='drop';diagnostics.composition.shape.radius=9;diagnostics.composition.weights[0]=8;diagnostics.time=5;
 const after=expressionScript.runInNewContext(scope);
 assert.equal(before.composition.phase,'intro');
 assert.equal(before.composition.shape.radius,2);
 assert.equal(before.composition.weights[0],1);
 assert.equal(after.composition.phase,'drop');
 assert.equal(after.composition.shape.radius,9);
 assert.equal(before.time,4);assert.equal(after.time,5);
});

test('recorder waits through saved-track restoration before taking popup ownership',async()=>{
 const page=new EventEmitter(),popup={name:'actual-projector'};let clicks=0;
 page.locator=selector=>selector==='#open-projector'?{click:async()=>{clicks++;if(clicks===3)page.emit('popup',popup);}}:{textContent:async()=>'Restoring projector…'};
 assert.equal(await openProjectorForRecording(page,{retryMs:1,timeoutMs:1000}),popup);
 assert.equal(clicks,3);assert.equal(page.listenerCount('popup'),0);
});
test('recorder preserves popup permission errors without repeated clicks',async()=>{
 const page=new EventEmitter();let clicks=0;
 page.locator=selector=>selector==='#open-projector'?{click:async()=>{clicks++;}}:{textContent:async()=>'Allow the projector popup in your browser, then click Open projector again.'};
 await assert.rejects(openProjectorForRecording(page,{retryMs:1,timeoutMs:1000}),/Allow the projector popup/);
 assert.equal(clicks,1);assert.equal(page.listenerCount('popup'),0);
});

test('optional parallax exercise translates and turns at the declared times then restores view',async()=>{
 const clip=parallaxClip(),source=await readFile(recorder,'utf8');
 assert.equal(clip.start,60);assert.equal(clip.duration,12);
 assert.deepEqual(clip.viewPlan.map(e=>[e.seconds,e.view.azimuth,e.view.distance]),[[0,0,0],[3,12,1.5],[6,-12,-1.5],[9,0,0]]);
 const scheduled=[],calls=[],viewEvents=[],viewTimers=[],cleared=[];let now=0;
 const scope={viewPlan:clip.viewPlan,viewEvents,viewTimers,m:{setView:view=>calls.push(structuredClone(view))},structuredClone,
  t:{time:60,pause(){},gain:{gain:{value:1},disconnect(){}}},startTime:60,startWall:0,performance:{now:()=>now},
  setTimeout:(fn,delay)=>{scheduled.push({fn,delay});return scheduled.length;}};
 const start=source.indexOf('const applyView='),end=source.indexOf('\n     interval=',start);
 assert.ok(start>0&&end>start);new Script(source.slice(start,end)).runInNewContext(scope);
 assert.equal(calls.length,1);assert.deepEqual(scheduled.map(e=>e.delay),[3000,6000,9000]);
 for(const event of scheduled){now=event.delay;scope.t.time=60+now/1000;event.fn();}
 assert.deepEqual(viewEvents.map(e=>[e.scheduledSeconds,e.elapsedSeconds,e.view.azimuth,e.view.distance]),[[0,0,0,0],[3,3,12,1.5],[6,6,-12,-1.5],[9,9,0,0]]);
 const originalView={azimuth:7,elevation:4,distance:-2};
 Object.assign(scope,{originalView,timer:10,interval:11,originalGain:0.8,clearTimeout:id=>cleared.push(id),clearInterval(){},recorder:{state:'inactive'},dest:{},analyser:{},stream:{getTracks:()=>[]},window:{}});
 const cleanup=source.split('\n').find(line=>line.includes('finally {clearTimeout(timer)'));
 new Script(cleanup.slice(cleanup.indexOf('{')+1,cleanup.lastIndexOf('}'))).runInNewContext(scope);
 assert.deepEqual(calls.at(-1),originalView);assert.deepEqual(cleared,[10,1,2,3]);
 assert.equal(parallaxClip().viewPlan[1].view.distance,1.5,'each invocation receives its own plan');
});

test('native recording review requires at least 20 measured frames per second',()=>{
 const playable={renderFrames:360,wallMs:12000};
 assert.equal(requireRecordingFrameRate(playable),30);assert.equal(playable.measuredFps,30);
 assert.equal(requireRecordingFrameRate({renderFrames:240,wallMs:12000}),20);
 const slow={renderFrames:180,wallMs:12000};
 assert.throws(()=>requireRecordingFrameRate(slow),/FPS below 20: measured 15.00 FPS/);
 assert.equal(slow.measuredFps,15,'failure retains measured FPS for review');
 assert.throws(()=>requireRecordingFrameRate({renderFrames:360,wallMs:0}),/FPS below 20/);
});

test('gallery compares matching names only when start and duration also agree',()=>{
 const standard={name:'buildup-drop',start:34,duration:24};
 assert.equal(samePassage(standard,{...standard}),true);
 assert.equal(samePassage(standard,{...standard,start:34.005,duration:24.005}),true);
 assert.equal(samePassage(standard,{...standard,start:34.01,duration:24.01}),true);
 assert.equal(samePassage(standard,{...standard,start:34.011}),false);
 assert.equal(samePassage(standard,{...standard,start:44,duration:8}),false,'smoke clip cannot masquerade as standard comparison');
 assert.equal(samePassage(standard,{...standard,duration:8}),false);
 assert.equal(samePassage(standard,{...standard,name:'drop-detail'}),false);
 assert.equal(samePassage(standard,{name:standard.name}),false);
});
