import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Transport} from '../src/audio';
function deferred<T=void>() {let resolve!:(value:T)=>void; const promise=new Promise<T>(r=>{resolve=r});return {promise,resolve};}
class MockContext {
 currentTime=0; destination={}; sources:any[]=[]; closed=false;
 resumes:ReturnType<typeof deferred>[]=[];
 decodes:ReturnType<typeof deferred<{duration:number}>>[]=[];
 createGain(){return {connect(){},disconnect(){},gain:{value:1}};}
 resume(){const d=deferred();this.resumes.push(d);return d.promise;}
 decodeAudioData(){const d=deferred<{duration:number}>();this.decodes.push(d);return d.promise;}
 createBufferSource(){const src={buffer:null,onended:null as null|(()=>void),offset:-1,stopped:false,connect(){},disconnect(){},start(_when:number,offset:number){this.offset=offset},stop(){this.stopped=true;this.onended?.()}};this.sources.push(src);return src;}
 close(){this.closed=true;return Promise.resolve();}
}
async function loaded(){const ctx=new MockContext();const t=new Transport(ctx as unknown as AudioContext);const load=t.load(new Blob(['audio']));await new Promise(setImmediate);ctx.decodes[0].resolve({duration:10});await load;return {ctx,t};}
test('concurrent play calls create one source and pause freezes exact audio time',async()=>{
 const {ctx,t}=await loaded();const a=t.play(),b=t.play();assert.equal(ctx.resumes.length,1);
 ctx.resumes[0].resolve();await Promise.all([a,b]);assert.equal(ctx.sources.length,1);
 ctx.currentTime=2.3;t.pause();ctx.currentTime=8;assert.equal(t.time,2.3);assert.equal(t.playing,false);
});
test('pause and dispose invalidate pending resume',async()=>{
 for(const dispose of [false,true]) {
 const {ctx,t}=await loaded();const p=t.play();dispose?t.dispose():t.pause();ctx.resumes[0].resolve();await p;
 assert.equal(ctx.sources.length,0);assert.equal(t.playing,false);
 }
});
test('seek during pending resume starts only the newest request at the requested offset',async()=>{
 const {ctx,t}=await loaded();const p=t.play();const seek=t.seek(4);
 ctx.resumes[0].resolve();await p;assert.equal(ctx.sources.length,0);
 ctx.resumes[1].resolve();await seek;assert.equal(ctx.sources.length,1);assert.equal(ctx.sources[0].offset,4);
});
test('out of order loads and disposed decode never install stale audio',async()=>{
 const {ctx,t}=await loaded();const a=t.load(new Blob(['a']));await new Promise(setImmediate);
 const b=t.load(new Blob(['b']));await new Promise(setImmediate);
 ctx.decodes[2].resolve({duration:22});await b;ctx.decodes[1].resolve({duration:11});await a;assert.equal(t.duration,22);
 const c=t.load(new Blob(['c']));await new Promise(setImmediate);t.dispose();ctx.decodes[3].resolve({duration:33});await c;assert.equal(t.duration,0);
});
test('end seeking parks at duration, explicit play restarts, natural end is exact',async()=>{
 const {ctx,t}=await loaded();const p=t.play();ctx.resumes[0].resolve();await p;
 await t.seek(10);assert.equal(t.time,10);assert.equal(t.playing,false);
 const replay=t.play();ctx.resumes[1].resolve();await replay;assert.equal(ctx.sources[1].offset,0);
 ctx.sources[1].onended();assert.equal(t.time,10);assert.equal(t.playing,false);
});

test('subscribers wake on transport transitions, never on clock reads, and detach cleanly',async()=>{
 const ctx=new MockContext();const t=new Transport(ctx as unknown as AudioContext);
 const snapshots:{playing:boolean,time:number,duration:number}[]=[];
 const unsubscribe=t.subscribe(()=>snapshots.push({playing:t.playing,time:t.time,duration:t.duration}));
 const load=t.load(new Blob(['audio']));await new Promise(setImmediate);ctx.decodes[0].resolve({duration:10});await load;
 assert.deepEqual(snapshots.at(-1),{playing:false,time:0,duration:10});
 const play=t.play();ctx.resumes[0].resolve();await play;
 assert.deepEqual(snapshots.at(-1),{playing:true,time:0,duration:10});
 const count=snapshots.length;ctx.currentTime=3;assert.equal(t.time,3);assert.equal(snapshots.length,count);
 t.pause();assert.deepEqual(snapshots.at(-1),{playing:false,time:3,duration:10});
 await t.seek(6);assert.deepEqual(snapshots.at(-1),{playing:false,time:6,duration:10});
 const replay=t.play();ctx.resumes[1].resolve();await replay;ctx.sources[1].onended();
 assert.deepEqual(snapshots.at(-1),{playing:false,time:10,duration:10});
 unsubscribe();const detached=snapshots.length;await t.seek(2);assert.equal(snapshots.length,detached);
 t.subscribe(()=>snapshots.push({playing:t.playing,time:t.time,duration:t.duration}));t.dispose();
 assert.equal(snapshots.at(-1)?.duration,0);assert.equal(ctx.closed,true);
 const disposedCount=snapshots.length;t.pause();assert.equal(snapshots.length,disposedCount);
});
