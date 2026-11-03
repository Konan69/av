import '../src/rendererPolyfills';
import {getTokenFromLocationHash} from '../src/shared/validation/sandboxModuleUtils';

const token=getTokenFromLocationHash(location.hash);
const listeners=new Set<(data:unknown)=>unknown>();
let disposed=false;
const destroyPacket=()=>({__nwWrldSandbox:true,token,type:'destroyTrack',requestId:'browser-dispose',props:{}});
const allowed=(data:any)=>data&&typeof data==='object'&&data.token===token&&(data.__nwWrldSandbox||data.__nwWrldSandboxResult);
const bridge={
  get disposed(){return disposed;},
  send(data:unknown){if(!disposed&&token&&window.parent!==window)window.parent.postMessage(data,location.origin);},
  on(listener:(data:unknown)=>unknown){if(disposed){void listener(destroyPacket());return()=>{};}listeners.add(listener);return()=>listeners.delete(listener);},
};
(globalThis as any).nwSandboxIpc=bridge;
window.addEventListener('message',(event)=>{
  if(disposed||event.origin!==location.origin||event.source!==window.parent||!token||!allowed(event.data))return;
  for(const listener of listeners)void listener(event.data);
});
const dispose=()=>{
  if(disposed)return;disposed=true;
  for(const listener of listeners)void listener(destroyPacket());
  listeners.clear();
};
(globalThis as any).__nwWrldDispose=dispose;
window.addEventListener('pagehide',dispose);
if(!token||window.parent===window)throw new Error('This renderer must be opened by the nw_wrld projector.');
try {
  await import('../src/projector/moduleSandboxEntry');
  bridge.send({__nwWrldSandboxReady:true,token});
} catch(error) {
  bridge.send({__nwWrldSandboxError:true,token,error:error instanceof Error?error.message:String(error)});
  dispose();
}
