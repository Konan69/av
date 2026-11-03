import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
async function bundleEntry(source){
 const result=await build({entryPoints:[new URL('../sandbox.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'controlled-upstream-startup',setup(build){build.onResolve({filter:/moduleSandboxEntry$/},()=>({path:'upstream',namespace:'test'}));build.onLoad({filter:/.*/,namespace:'test'},()=>({contents:source,loader:'js'}));}}]});
 return 'data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64');
}
function environment(){
 const sent=[];const listeners=new Map();
 globalThis.location={origin:'http://localhost:5177',hash:'#token=test-token'};
 globalThis.window={parent:{postMessage(data){sent.push(data)}},addEventListener(type,fn){listeners.set(type,fn)}};
 globalThis.nwSandboxIpc=undefined;return {sent,listeners};
}
test('unload during upstream import destroys late registration and emits no readiness',async()=>{
 const source=await bundleEntry(`await globalThis.startupGate; globalThis.nwSandboxIpc.on(data=>{if(data.type==='destroyTrack')globalThis.destroyedCount++});`);
 const env=environment();let release;globalThis.startupGate=new Promise(resolve=>release=resolve);globalThis.destroyedCount=0;
 const startup=import(source);
 for(let i=0;!globalThis.nwSandboxIpc&&i<20;i++)await new Promise(setImmediate);
 assert.ok(globalThis.nwSandboxIpc);globalThis.__nwWrldDispose();release();await startup;
 assert.equal(globalThis.destroyedCount,1);assert.equal(globalThis.nwSandboxIpc.disposed,true);assert.deepEqual(env.sent,[]);
});
test('upstream import failure reports its error immediately to the owning projector',async()=>{
 const source=await bundleEntry(`throw new Error('upstream import failed');`);const env=environment();await import(source);
 assert.deepEqual(env.sent,[{__nwWrldSandboxError:true,token:'test-token',error:'upstream import failed'}]);assert.equal(globalThis.nwSandboxIpc.disposed,true);
});
