import {test, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {MusicSession} from '../src/session';
import {sha256} from '../src/library';
import {validGenome} from './fixtures';
function deferred<T=void>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}
const contexts: MockContext[]=[];
class MockContext {
 currentTime=0;destination={};closed=false;sources:any[]=[];
 decode=deferred<{duration:number}>();resumeWait=deferred();
 constructor(){contexts.push(this)}
 createGain(){return {connect(){},disconnect(){},gain:{value:1}};}
 decodeAudioData(){return this.decode.promise;}
 resume(){return this.resumeWait.promise;}
 createBufferSource(){const source={onended:null,stopped:false,connect(){},disconnect(){},start(){},stop(){this.stopped=true}};this.sources.push(source);return source;}
 close(){this.closed=true;return Promise.resolve();}
}
const records=new Map();
let writesHeld=false;let writes:(()=>void)[]=[];
function indexedDBMock(){return {open(){const req:any={};queueMicrotask(()=>{req.result={close(){},transaction(){const tx:any={};tx.objectStore=()=>({get(sha:string){const request={result:records.get(sha)};queueMicrotask(()=>tx.oncomplete?.());return request;},put(record:any){const request={result:record.sha};const complete=()=>{records.set(record.sha,record);tx.oncomplete?.()};if(writesHeld)writes.push(complete);else queueMicrotask(complete);return request;}});return tx;}};req.onsuccess()});return req;}};}
beforeEach(()=>{contexts.length=0;records.clear();writesHeld=false;writes=[];(globalThis as any).AudioContext=MockContext;(globalThis as any).indexedDB=indexedDBMock();});
async function pair(text='audio'){const audio=new Blob([text]);return {audio,genome:validGenome(await sha256(audio))};}
async function until(predicate:()=>boolean){const deadline=Date.now()+5000;while(Date.now()<deadline){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5))}assert.fail('asynchronous stage not reached');}
test('superseding an in-flight decode closes it immediately and only installs newest track',async()=>{
 const session=new MusicSession();const a=await pair('a'),b=await pair('b');
 const first=session.open(a.audio,'a',a.genome);await until(()=>contexts.length===1);
 const second=session.open(b.audio,'b',b.genome);assert.equal(contexts[0].closed,true);await until(()=>contexts.length===2);
 contexts[1].decode.resolve({duration:2});assert.equal((await second)?.name,'b');
 contexts[0].decode.resolve({duration:2});assert.equal(await first,null);assert.equal(session.current?.name,'b');session.dispose();
});
test('dispose closes pending decoder before it resolves and ignores completion',async()=>{
 const session=new MusicSession();const p=await pair();const opening=session.open(p.audio,'a',p.genome);await until(()=>contexts.length===1);
 session.dispose();assert.equal(contexts[0].closed,true);contexts[0].decode.resolve({duration:2});assert.equal(await opening,null);assert.equal(session.current,null);
 assert.equal(await session.open(p.audio,'after dispose',p.genome),null);
});
test('unloading an active session stops source; unloading during resume creates none',async()=>{
 for(const pending of [false,true]){
 const session=new MusicSession();const p=await pair();const opening=session.open(p.audio,'a',p.genome);const index=contexts.length;await until(()=>contexts.length>index);const context=contexts[index];
 context.decode.resolve({duration:2});const performance=(await opening)!;const play=performance.transport.play();
 if(!pending){context.resumeWait.resolve();await play;assert.equal(context.sources.length,1)}
 session.dispose();context.resumeWait.resolve();await play;
 assert.equal(context.closed,true);assert.equal(performance.transport.playing,false);assert.ok(context.sources.every(source=>source.stopped));assert.equal(context.sources.length,pending?0:1);
 }
});
test('supersession during cache commit never creates stale transport or ready stage',async()=>{
 const stages:string[]=[];const session=new MusicSession(stage=>stages.push(stage.kind));const p=await pair();writesHeld=true;
 const opening=session.open(p.audio,'a',p.genome);await until(()=>writes.length===1);session.cancel();writes[0]();assert.equal(await opening,null);assert.equal(contexts.length,0);assert.ok(!stages.includes('ready'));session.dispose();
});
test('supplied mismatched hash never writes a record or creates audio',async()=>{
 const session=new MusicSession();await assert.rejects(session.open(new Blob(['different']),'a',validGenome()),/different audio file/);assert.equal(records.size,0);assert.equal(contexts.length,0);
});

test('disposing during analyzer request aborts network and never starts audio',async()=>{
 const requests:any[]=[];
 (globalThis as any).XMLHttpRequest=class {
  upload={};responseType='';timeout=0;aborted=false;onabort:()=>void=()=>{};
  open(){}send(){requests.push(this)}abort(){this.aborted=true;this.onabort()}
 };
 const stages:string[]=[];const session=new MusicSession(stage=>stages.push(stage.kind));
 const opening=session.open(new Blob(['uncached']),'uncached.wav');await until(()=>requests.length===1);
 session.dispose();assert.equal(requests[0].aborted,true);assert.equal(await opening,null);assert.equal(contexts.length,0);assert.ok(!stages.includes('ready'));
});
