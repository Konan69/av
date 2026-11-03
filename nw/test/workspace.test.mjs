import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {build} from 'esbuild';

// Exercise the real local workspace HTTP adapter against an isolated project.
test('browser workspace serves upstream modules, persists edits, and confines file access', async () => {
  const directory=await mkdtemp(path.join(tmpdir(),'av-nw-web-'));
  const original=process.env.NW_WRLD_PROJECT_DIR;
  process.env.NW_WRLD_PROJECT_DIR=path.join(directory,'project');
  const source=fileURLToPath(new URL('../../app/web/workspace-server.ts',import.meta.url));
  const bundle=path.join(directory,'server.mjs');
  const http=createServer();
  try {
    await build({entryPoints:[source],outfile:bundle,bundle:true,platform:'node',format:'esm',define:{'import.meta.url':JSON.stringify(pathToFileURL(source).href)}});
    const {workspaceServer}=await import(pathToFileURL(bundle).href);
    const plugin=workspaceServer();
    let middleware;
    await plugin.configureServer({httpServer:http,middlewares:{use(fn){middleware=fn;}}});
    http.on('request',(req,res)=>middleware(req,res,()=>{res.statusCode=404;res.end();}));
    await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${http.address().port}/api/nw`;
    const bootstrap=await (await fetch(`${base}/bootstrap`)).json();
    assert.ok(bootstrap.summaries.some(module=>module.id==='CubeGrowth'));
    assert.ok(bootstrap.summaries.some(module=>module.id==='SpinningCube'));
    const meta=await (await fetch(`${base}/modules/CubeGrowth/meta`)).json();
    assert.match(meta.text,/extends BaseThreeJsModule/);
    assert.equal(typeof meta.mtimeMs,'number');
    const saved={...bootstrap.json['appState.json'],activeTrackId:42};
    assert.equal((await fetch(`${base}/json/appState.json`,{method:'PUT',body:JSON.stringify(saved)})).status,200);
    assert.equal((await(await fetch(`${base}/json/appState.json`)).json()).activeTrackId,42);
    assert.equal(JSON.parse(await readFile(path.join(directory,'project/nw_wrld_data/json/appState.json'),'utf8')).activeTrackId,42);
    assert.equal((await fetch(`${base}/json/secrets.json`)).status,400);
    assert.equal((await fetch(`${base}/assets/%2e%2e%2foutside.txt`)).status,400);
    assert.equal((await fetch(`${base}/json/appState.json`,{method:'PUT',headers:{Origin:'https://unrelated.example'},body:'{}'})).status,403);
    const file=path.join(directory,'project/assets/audio/probe.wav');
    await writeFile(file,Buffer.from([0,1,2,3,4,5]));
    const range=await fetch(`${base}/assets/audio/probe.wav`,{headers:{Range:'bytes=2-4'}});
    assert.equal(range.status,206);assert.deepEqual([...new Uint8Array(await range.arrayBuffer())],[2,3,4]);
    assert.equal(range.headers.get('content-range'),'bytes 2-4/6');
  } finally {
    http.closeAllConnections();await new Promise(resolve=>http.close(resolve));
    if(original===undefined)delete process.env.NW_WRLD_PROJECT_DIR;else process.env.NW_WRLD_PROJECT_DIR=original;
    await rm(directory,{recursive:true,force:true});
  }
});
