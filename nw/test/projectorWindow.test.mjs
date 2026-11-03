import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const bundle=await build({entryPoints:[fileURLToPath(new URL('../../app/web/projectorWindow.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {createProjectorWindow,handoffProjectorBeforeClose}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function fixture(overrides={}) {
  const calls=[];
  let url='about:blank';
  const popup={closed:false,close:()=>{popup.closed=true;calls.push('close-popup');},focus:()=>calls.push('focus'),location:{get href(){return url;},set href(value){calls.push('navigate');url=value;}}};
  const state={sha:'track',time:31.5,playing:true,feel:{bass:1.2}};
  const options={
    isReady:()=>true,openBlank:()=>{calls.push('open-blank');return popup;},
    capture:()=>{calls.push('capture');return state;},
    detachPreview:async()=>{calls.push('dispose-preview');},
    restore:async(target,snapshot)=>calls.push(['restore',target===popup?'popup':'preview',snapshot]),
    showPreview:()=>calls.push('show-preview'),report:message=>calls.push(['status',message]),...overrides,
  };
  return {calls,popup,state,controller:createProjectorWindow(options)};
}
test('popup opens in the click before preview disposal and navigates only after disposal finishes',async()=>{
  let release;
  const f=fixture({detachPreview:()=>new Promise(resolve=>{release=resolve;})});
  const opening=f.controller.open();
  assert.equal(f.calls[0],'open-blank');
  assert.equal(f.popup.location.href,'about:blank');
  assert.ok(!f.calls.includes('navigate'));
  release();await opening;
  assert.equal(f.popup.location.href,'/projector.html');
  assert.deepEqual(f.calls.find(call=>Array.isArray(call)&&call[0]==='restore'),['restore','popup',f.state]);
  await f.controller.open();assert.equal(f.calls.at(-1),'focus');
});
test('blocked popup leaves the embedded renderer and selected track untouched',async()=>{
  const f=fixture({openBlank:()=>null});await f.controller.open();
  assert.ok(!f.calls.includes('dispose-preview'));assert.ok(!f.calls.includes('capture'));
  assert.match(f.calls.at(-1)[1],/Allow the projector popup/);
});
test('missing dashboard readiness produces an actionable message instead of a silent click',async()=>{
  const f=fixture({isReady:()=>false});await f.controller.open();
  assert.ok(!f.calls.includes('open-blank'));assert.match(f.calls.at(-1)[1],/dashboard is still opening/);
});
test('closing the popup restores the latest captured playback state into one preview',async()=>{
  let time=31.5;
  const f=fixture({capture:()=>({sha:'track',time,playing:false})});
  await f.controller.open();time=48;await f.controller.check();
  f.popup.closed=true;await f.controller.check();
  assert.equal(f.controller.popup,null);
  assert.equal(f.calls.filter(call=>call==='show-preview').length,1);
  assert.deepEqual(f.calls.filter(call=>Array.isArray(call)&&call[0]==='restore').at(-1),['restore','preview',{sha:'track',time:48,playing:false}]);
  await f.controller.check();assert.equal(f.calls.filter(call=>call==='show-preview').length,1);
});


test('a track loaded after an empty popup opens is handed off synchronously with no opener polling',async()=>{
  const f=fixture({capture:()=>null});
  await f.controller.open();
  const loaded={sha:'newly-loaded-track',time:47.25,playing:false,view:{azimuth:20}};
  f.popup.frames=[];
  f.popup.__genomeWorld={capturePlayback:()=>loaded};
  f.popup.opener={closed:false,__nwReceiveProjectorHandoff:(source,state)=>f.controller.receiveHandoff(source,state)};
  // beforeunload runs while the sandbox still exists; then frame disposal destroys it.
  handoffProjectorBeforeClose(f.popup);
  delete f.popup.__genomeWorld;
  f.popup.closed=true;
  await f.controller.check();
  assert.deepEqual(f.calls.filter(call=>Array.isArray(call)&&call[0]==='restore').at(-1),['restore','preview',loaded]);
});

test('shell reload captures the live popup before closing it and restores the snapshot in a new shell',async()=>{
  let latest={sha:'track',time:0,playing:false};
  const f=fixture({capture:()=>latest});await f.controller.open();
  latest={sha:'track',time:63.5,playing:false};
  const saved=f.controller.dispose();
  assert.deepEqual(saved,latest);assert.equal(f.popup.closed,true);assert.equal(f.controller.popup,null);
  const next=fixture({initialState:JSON.parse(JSON.stringify(saved))});
  await next.controller.startPreview();
  assert.deepEqual(next.calls.find(call=>Array.isArray(call)&&call[0]==='restore'),['restore','preview',latest]);
});

test('handoff rejects messages from a window other than the owned popup',async()=>{
  const f=fixture();await f.controller.open();
  assert.equal(f.controller.receiveHandoff({}, {sha:'wrong'}),false);
  assert.deepEqual(f.controller.snapshot,f.state);
});
