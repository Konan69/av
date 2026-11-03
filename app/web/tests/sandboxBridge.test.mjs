import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:[new URL('../sandboxBridge.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false});
const {createSandboxBridge}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
function environment(){
 const handlers=new Map();let frame;let destroyed=0;const sent=[];
 globalThis.location={origin:'http://localhost:5177'};
 globalThis.window={addEventListener(type,fn){handlers.set(type,fn)}};
 globalThis.document={createElement(){frame={isConnected:false,style:{},setAttribute(){},remove(){this.isConnected=false},contentWindow:{postMessage(packet){sent.push(packet)},__nwWrldDispose(){destroyed++}}};return frame},querySelector(){return {appendChild(item){item.isConnected=true}}}};
 const emit=(data,overrides={})=>handlers.get('message')({origin:location.origin,source:frame.contentWindow,data,...overrides});
 return {get frame(){return frame},sent,emit,get destroyed(){return destroyed}};
}
test('sandbox handshake and RPC accept only their origin, source and ownership token',async()=>{
 const env=environment();const bridge=createSandboxBridge(()=>{});const waiting=bridge.ensure();
 const token=new URLSearchParams(env.frame.src.split('#')[1]).get('token');
 await env.emit({__nwWrldSandboxReady:true,token});assert.deepEqual(await waiting,{ok:true,token});
 assert.equal((await bridge.request('wrong','destroyTrack',{})).error,'TOKEN_NOT_OWNED');
 const request=bridge.request(token,'destroyTrack',{});const packet=env.sent.at(-1);let resolved=false;request.then(()=>resolved=true);
 await env.emit({__nwWrldSandboxResult:true,token,requestId:packet.requestId,result:{ok:true}},{origin:'https://other.test'});
 await env.emit({__nwWrldSandboxResult:true,token,requestId:packet.requestId,result:{ok:true}},{source:{}});
 await env.emit({__nwWrldSandboxResult:true,token:'wrong',requestId:packet.requestId,result:{ok:true}});assert.equal(resolved,false);
 await env.emit({__nwWrldSandboxResult:true,token,requestId:packet.requestId,result:{ok:true}});assert.deepEqual(await request,{ok:true});bridge.destroy();
});
test('destroy synchronously disposes iframe modules and resolves outstanding requests',async()=>{
 const env=environment();const bridge=createSandboxBridge(()=>{});const ready=bridge.ensure();const token=new URLSearchParams(env.frame.src.split('#')[1]).get('token');
 await env.emit({__nwWrldSandboxReady:true,token});await ready;
 const pending=bridge.request(token,'invokeOnInstance',{instanceId:'world',methodName:'playTrack'});
 bridge.destroy();assert.equal(env.destroyed,1);assert.equal(env.frame.isConnected,false);assert.equal((await pending).error,'SANDBOX_UNAVAILABLE');
 assert.equal((await bridge.request(token,'destroyTrack',{})).error,'TOKEN_NOT_OWNED');
});

test('concurrent ensure shares one startup; import failure and send failure release pending work',async()=>{
 const env=environment();const bridge=createSandboxBridge(()=>{});const first=bridge.ensure();const frame=env.frame;const second=bridge.ensure();assert.equal(env.frame,frame);
 let token=new URLSearchParams(frame.src.split('#')[1]).get('token');
 await env.emit({__nwWrldSandboxError:true,token,error:'Module dependency failed'});
 assert.deepEqual(await first,{ok:false,reason:'Module dependency failed'});assert.deepEqual(await second,{ok:false,reason:'Module dependency failed'});assert.equal(frame.isConnected,false);
 const retry=bridge.ensure();token=new URLSearchParams(env.frame.src.split('#')[1]).get('token');await env.emit({__nwWrldSandboxReady:true,token});await retry;
 env.frame.contentWindow.postMessage=()=>{throw new DOMException('Cannot clone argument','DataCloneError')};
 assert.equal((await bridge.request(token,'destroyTrack',{})).error,'Cannot clone argument');bridge.destroy();
});
