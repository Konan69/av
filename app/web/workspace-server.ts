import {createReadStream, existsSync, constants, watch} from 'node:fs';
import {mkdir, readFile, readdir, copyFile, stat, writeFile, rename, realpath} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import type {IncomingMessage, ServerResponse} from 'node:http';
import type {Plugin, Connect} from 'vite';
import {parseNwWrldDocblockMetadata} from '../src/shared/nwWrldDocblock';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.dirname(appRoot);
export const projectRoot = path.resolve(process.env.NW_WRLD_PROJECT_DIR || path.join(repoRoot, 'nw/project'));
const starterRoot = path.join(appRoot, 'src/main/starter_modules');
const jsonNames = new Set(['userData.json', 'appState.json', 'config.json', 'recordingData.json']);
const moduleId = (name: string) => /^[A-Za-z][A-Za-z0-9]*$/.test(name);
const mime: Record<string,string> = {'.json':'application/json', '.js':'text/javascript', '.wav':'audio/wav', '.m4a':'audio/mp4', '.mp3':'audio/mpeg', '.ogg':'audio/ogg', '.flac':'audio/flac', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml', '.glb':'model/gltf-binary', '.gltf':'model/gltf+json'};

export function safePath(root: string, relative: string) {
  if (!relative || relative.includes('\\') || relative.includes('\0') || relative.split('/').some(p=>p==='..') || path.isAbsolute(relative)) throw new Error('Invalid workspace path');
  const target = path.resolve(root, relative);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('Invalid workspace path');
  return target;
}
async function contained(root: string, file: string, write = false) {
  const resolvedRoot = await realpath(root);
  const resolved = await realpath(write ? path.dirname(file) : file);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) throw new Error('Workspace symlink points outside project');
}
async function atomic(file: string, data: string | Buffer) {
  const temporary = `${file}.av-${randomUUID()}.tmp`;
  await writeFile(temporary, data);
  await rename(temporary, file);
}
async function body(req: IncomingMessage, max = 24 * 1024 * 1024) {
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of req) { length += chunk.length; if (length > max) throw new Error('Upload too large'); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks);
}
function json(res: ServerResponse, data: unknown, status = 200) {
  res.statusCode = status; res.setHeader('Content-Type','application/json'); res.setHeader('Cache-Control','no-store'); res.end(JSON.stringify(data));
}
async function seedDirectory(from: string, to: string) {
  await mkdir(to, {recursive:true});
  for (const entry of await readdir(from, {withFileTypes:true})) {
    const source=path.join(from,entry.name), target=path.join(to,entry.name);
    if(entry.isDirectory()) await seedDirectory(source,target);
    else try { await copyFile(source,target,constants.COPYFILE_EXCL); } catch(error) { if((error as NodeJS.ErrnoException).code!=='EEXIST') throw error; }
  }
}
export async function prepareWorkspace() {
  await seedDirectory(path.join(repoRoot,'nw/template'), projectRoot);
  await seedDirectory(starterRoot,path.join(projectRoot,'modules'));
  await seedDirectory(path.join(appRoot,'src/assets'),path.join(projectRoot,'assets'));
  await mkdir(path.join(projectRoot,'assets/audio'),{recursive:true});
  await mkdir(path.join(projectRoot,'assets/genomes'),{recursive:true});
  for(const name of jsonNames) {
    const dest=path.join(projectRoot,'nw_wrld_data/json',name);
    if(!existsSync(dest)) await copyFile(path.join(appRoot,'src/shared/json',name),dest);
  }
}
async function summaries() {
  const entries = await readdir(path.join(projectRoot,'modules'));
  const result: unknown[] = []; const skipped: unknown[] = [];
  for(const file of entries.filter(n=>n.endsWith('.js'))) {
    const id=file.slice(0,-3);
    if(!moduleId(id)) { skipped.push({file,reason:'Invalid module name'});continue; }
    const text=await readFile(path.join(projectRoot,'modules',file),'utf8');
    const meta=parseNwWrldDocblockMetadata(text,16*1024);
    let starterSync: string | null = null;
    const starter=path.join(starterRoot,file);
    if(existsSync(starter)) starterSync=(await readFile(starter,'utf8'))===text?'inSync':'outOfSync';
    result.push({file,id,name:meta.name,category:meta.category,hasMetadata:meta.hasMetadata,starterSync});
  }
  return {summaries:result,skipped};
}
async function listAssets(relative = '') {
  const root=path.join(projectRoot,'assets');
  const dir=relative?safePath(root,relative):root;
  try { await contained(root,dir); return (await readdir(dir,{withFileTypes:true})).filter(e=>e.isFile()).map(e=>(relative?`${relative}/`:'')+e.name).sort(); }
  catch(error) { if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error; }
}

export function workspaceServer(): Plugin {
  const clients = new Set<ServerResponse>();
  const notify=()=>{for(const client of clients)client.write('data: {"type":"modulesChanged"}\n\n');};
  const middleware: Connect.NextHandleFunction = async(req,res,next)=>{
    const url=new URL(req.url || '/', 'http://localhost');
    if(!url.pathname.startsWith('/api/nw/')) {next();return;}
    try {
      // Writable workspace routes are local app APIs, not cross-origin file services.
      if(req.headers.origin && new URL(req.headers.origin).host!==req.headers.host) {json(res,{error:'Origin mismatch'},403);return;}
      const route=decodeURIComponent(url.pathname.slice('/api/nw/'.length));
      const method=req.method || 'GET';
      if(route==='events' && method==='GET') {
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});
        res.write(': nw_wrld module watcher\n\n');clients.add(res);req.on('close',()=>clients.delete(res));return;
      }
      if(route==='bootstrap' && method==='GET') {
        const docs:Record<string,unknown>={};
        for(const name of jsonNames)docs[name]=JSON.parse(await readFile(path.join(projectRoot,'nw_wrld_data/json',name),'utf8'));
        json(res,{projectDir:projectRoot,json:docs,...await summaries()});return;
      }
      if(route.startsWith('json/')) {
        const name=route.slice(5);if(!jsonNames.has(name)) {json(res,{error:'Unknown document'},400);return;}
        const file=path.join(projectRoot,'nw_wrld_data/json',name);
        if(method==='GET')json(res,JSON.parse(await readFile(file,'utf8')));
        else if(method==='PUT') { const value=JSON.parse((await body(req)).toString('utf8'));await atomic(file,JSON.stringify(value,null,2));json(res,{ok:true}); }
        else json(res,{error:'Method not allowed'},405);
        return;
      }
      if(route==='modules' && method==='GET'){json(res,await summaries());return;}
      if(route.startsWith('modules/')) {
        const [id,action]=route.slice(8).split('/');
        if(!moduleId(id)){json(res,{error:'Invalid module name'},400);return;}
        const file=path.join(projectRoot,'modules',`${id}.js`);
        if(method==='PUT' && !action){const text=(await body(req,2*1024*1024)).toString('utf8');await atomic(file,text);json(res,{ok:true,path:file});notify();return;}
        if(method==='POST' && action==='rewrite') {const starter=path.join(starterRoot,`${id}.js`);await copyFile(starter,file);json(res,{ok:true});notify();return;}
        if(method!=='GET'){json(res,{error:'Method not allowed'},405);return;}
        const [metadata,text]=await Promise.all([stat(file),readFile(file,'utf8')]);
        if(action==='meta')json(res,{text,mtimeMs:metadata.mtimeMs});
        else if(action==='url')json(res,{url:`/api/nw/modules/${id}?t=${metadata.mtimeMs}`,mtimeMs:metadata.mtimeMs});
        else {res.setHeader('Content-Type','text/javascript');res.setHeader('Cache-Control','no-cache');res.end(text);}
        return;
      }
      if(route==='assets' && method==='GET'){json(res,await listAssets(url.searchParams.get('dir') || ''));return;}
      if(route.startsWith('assets/')) {
        const relative=route.slice(7), root=path.join(projectRoot,'assets');
        const file=safePath(root,relative);
        if(method==='PUT') {
          // New directories are local workspace-owned; reject an existing symlink ancestor.
          let parent=path.dirname(file);while(!existsSync(parent))parent=path.dirname(parent);
          await contained(root,parent);
          await mkdir(path.dirname(file),{recursive:true});await contained(root,file,true);
          await atomic(file,await body(req,256*1024*1024));json(res,{ok:true,relPath:relative,path:relative});return;
        }
        if(method!=='GET' && method!=='HEAD'){json(res,{error:'Method not allowed'},405);return;}
        await contained(root,file);
        const info=await stat(file);if(!info.isFile())throw new Error('Not a file');
        res.setHeader('Content-Type',mime[path.extname(file).toLowerCase()]||'application/octet-stream');
        res.setHeader('Accept-Ranges','bytes');
        res.setHeader('Cache-Control','no-cache');
        const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
        if(range){const start=Number(range[1]),end=range[2]?Math.min(info.size-1,Number(range[2])):info.size-1;
          if(start>end||start>=info.size){res.writeHead(416,{'Content-Range':`bytes */${info.size}`});res.end();return;}
          res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${info.size}`,'Content-Length':end-start+1});
          if(method==='HEAD')res.end();else createReadStream(file,{start,end}).pipe(res);
        }else{res.setHeader('Content-Length',info.size);if(method==='HEAD')res.end();else createReadStream(file).pipe(res);}
        return;
      }
      json(res,{error:'Unknown workspace route'},404);
    }catch(error){const code=(error as NodeJS.ErrnoException).code;json(res,{error:error instanceof Error?error.message:String(error)},code==='ENOENT'?404:400);}
  };
  async function install(server: {middlewares:Connect.Server; httpServer?:{once:(event:string,fn:()=>void)=>unknown}|null}) {
    await prepareWorkspace();server.middlewares.use(middleware);
    const watcher=watch(path.join(projectRoot,'modules'),()=>notify());
    server.httpServer?.once('close',()=>{watcher.close();for(const client of clients)client.end();clients.clear();});
  }
  return {name:'nw-wrld-browser-workspace',configureServer:install,configurePreviewServer:install};
}
