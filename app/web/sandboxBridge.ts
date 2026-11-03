/** Browser transport for nw_wrld's unmodified module sandbox RPC. */
import {safeAssetRelPath} from '../src/shared/validation/sandboxModuleUtils';
import {normalizeSandboxRequestProps, normalizeSandboxResult} from '../src/shared/validation/sandboxValidation';

type Packet = Record<string, any>;
type Pending = {resolve:(value:unknown)=>void; timer:ReturnType<typeof setTimeout>; type:string};
export function createSandboxBridge(sendToDashboard:(type:string,props:unknown)=>void) {
  let iframe:HTMLIFrameElement|null=null;
  let token:string|null=null;
  let ready:Promise<unknown>|null=null;
  let resolveReady:((value:unknown)=>void)|null=null;
  let readyTimer:ReturnType<typeof setTimeout>|null=null;
  const pending=new Map<string,Pending>();
  const assetRequests=new Set<AbortController>();
  const assetsBaseUrl=`${location.origin}/api/nw/assets/`;
  const send=(packet:Packet)=>iframe?.contentWindow?.postMessage(packet,location.origin);

  const destroy=()=>{
    if(readyTimer)clearTimeout(readyTimer);
    readyTimer=null;
    resolveReady?.({ok:false,reason:'SANDBOX_UNAVAILABLE'});resolveReady=null;
    for(const item of pending.values()){clearTimeout(item.timer);item.resolve({ok:false,error:'SANDBOX_UNAVAILABLE'});}
    pending.clear();
    for(const request of assetRequests)request.abort();assetRequests.clear();
    try { (iframe?.contentWindow as any)?.__nwWrldDispose?.(); } catch {}
    iframe?.remove();iframe=null;token=null;ready=null;
    return {ok:true};
  };
  const handle=async(event:MessageEvent)=>{
    const data=event.data as Packet;
    if(event.origin!==location.origin||event.source!==iframe?.contentWindow||!token||!data||typeof data!=='object'||data.token!==token)return;
    if(data.__nwWrldSandboxError){
      resolveReady?.({ok:false,reason:String(data.error||'Sandbox startup failed')});resolveReady=null;destroy();return;
    }
    if(data.__nwWrldSandboxReady){
      if(readyTimer)clearTimeout(readyTimer);readyTimer=null;
      resolveReady?.({ok:true,token});resolveReady=null;return;
    }
    if(data.__nwWrldSandboxPerf){sendToDashboard('perf:stats',data.stats);return;}
    const requestId=typeof data.requestId==='string'?data.requestId:'';
    if(!requestId)return;
    if(data.__nwWrldSandboxResult){
      const item=pending.get(requestId);if(!item)return;
      pending.delete(requestId);clearTimeout(item.timer);
      item.resolve(normalizeSandboxResult(item.type,data.result));return;
    }
    if(!data.__nwWrldSandbox)return;
    const requestToken=token;
    let result:unknown={ok:false};
    const assetRequest=new AbortController();assetRequests.add(assetRequest);
    try {
      if(data.type==='sdk:readAssetText'){
        const relative=safeAssetRelPath(data.props?.relPath);
        if(!relative)throw new Error('Invalid asset path');
        const response=await fetch(new URL(relative.split('/').map(encodeURIComponent).join('/'),assetsBaseUrl),{signal:assetRequest.signal});
        result={ok:response.ok,text:response.ok?await response.text():null};
      } else if(data.type==='sdk:listAssets'){
        const relative=safeAssetRelPath(data.props?.relDir);
        if(!relative)throw new Error('Invalid asset directory');
        const response=await fetch(`/api/nw/assets?dir=${encodeURIComponent(relative)}`,{signal:assetRequest.signal});
        const entries=response.ok?await response.json():[];
        // Upstream SDK returns names relative to the requested directory.
        result={ok:response.ok,entries:Array.isArray(entries)?entries.map((entry:string)=>entry.split('/').pop()):[]};
      } else return;
    } catch {result={ok:false,text:null,entries:[]};}
    finally {assetRequests.delete(assetRequest);}
    if(token===requestToken)send({__nwWrldSandboxResult:true,token,requestId,result});
  };
  window.addEventListener('message',handle);
  window.addEventListener('pagehide',destroy);

  const ensure=async()=>{
    if(iframe?.isConnected&&ready)return ready;
    destroy();
    token=crypto.randomUUID();
    iframe=document.createElement('iframe');
    iframe.title='nw_wrld module renderer';iframe.className='nw-module-sandbox';
    iframe.setAttribute('allow','autoplay; fullscreen');
    iframe.style.cssText='position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent;';
    ready=new Promise(resolve=>{resolveReady=resolve;});
    readyTimer=setTimeout(()=>{resolveReady?.({ok:false,reason:'Sandbox startup timed out'});resolveReady=null;destroy();},30000);
    iframe.src=`/sandbox.html#token=${encodeURIComponent(token)}`;
    const host=document.querySelector('.modules');
    if(!host){destroy();return {ok:false,reason:'NO_MODULES_CONTAINER'};}
    try { host.appendChild(iframe); } catch(error) { destroy();return {ok:false,reason:error instanceof Error?error.message:'SANDBOX_UNAVAILABLE'}; }
    return ready;
  };
  const request=async(requestToken:string,type:string,props:Record<string,unknown>)=>{
    if(!token||requestToken!==token)return {ok:false,error:'TOKEN_NOT_OWNED'};
    if(!iframe?.isConnected)return {ok:false,error:'SANDBOX_UNAVAILABLE'};
    const normalized=normalizeSandboxRequestProps(type,props as never);
    if(!normalized.ok)return {ok:false,error:normalized.error};
    const requestId=crypto.randomUUID();
    return new Promise(resolve=>{
      const timer=setTimeout(()=>{pending.delete(requestId);resolve({ok:false,error:'TIMEOUT'});},30000);
      pending.set(requestId,{resolve,timer,type});
      try { send({__nwWrldSandbox:true,token,type,requestId,props:normalized.props}); }
      catch(error) {clearTimeout(timer);pending.delete(requestId);resolve({ok:false,error:error instanceof Error?error.message:'MESSAGE_SEND_FAILED'});}
    });
  };
  return {ensure,request,destroy,assetsBaseUrl};
}
