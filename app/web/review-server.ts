import {createReadStream} from 'node:fs';
import {stat, realpath, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Plugin, Connect} from 'vite';

const reviewRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../artifacts/visual-tests');
const types:Record<string,string>={'.html':'text/html; charset=utf-8','.json':'application/json','.webm':'video/webm','.mp4':'video/mp4','.png':'image/png','.jpg':'image/jpeg','.txt':'text/plain; charset=utf-8','.log':'text/plain; charset=utf-8','.js':'text/plain; charset=utf-8','.patch':'text/plain; charset=utf-8'};

/** Local, read-only playback of the exact videos and evidence saved by test:visual. */
export function reviewServer():Plugin {
 const middleware:Connect.NextHandleFunction=async(req,res,next)=>{
  const url=new URL(req.url||'/', 'http://localhost');
  if(url.pathname!=='/reviews'&&!url.pathname.startsWith('/reviews/'))return next();
  if(req.method!=='GET'&&req.method!=='HEAD'){res.statusCode=405;res.end();return;}
  try{
   await mkdir(reviewRoot,{recursive:true});
   const relative=decodeURIComponent(url.pathname.replace(/^\/reviews\/?/,''))||'index.html';
   const file=path.resolve(reviewRoot,relative);
   const safe=await realpath(file),root=await realpath(reviewRoot);
   if(!safe.startsWith(root+path.sep)){res.statusCode=403;res.end();return;}
   const info=await stat(safe);
   if(!info.isFile()){res.statusCode=404;res.end();return;}
   res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
   res.setHeader('Cache-Control','no-store');res.setHeader('Accept-Ranges','bytes');
   let start=0,end=info.size-1;
   if(req.headers.range){
    const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if(!match||(!match[1]&&!match[2])){res.statusCode=416;res.end();return;}
    start=match[1]?Number(match[1]):Math.max(0,info.size-Number(match[2]));
    end=match[1]&&match[2]?Math.min(info.size-1,Number(match[2])):info.size-1;
    if(start>end||start>=info.size){res.statusCode=416;res.setHeader('Content-Range',`bytes */${info.size}`);res.end();return;}
    res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${info.size}`);
   }
   res.setHeader('Content-Length',Math.max(0,end-start+1));
   if(req.method==='HEAD'||!info.size)res.end();else createReadStream(safe,{start,end}).pipe(res);
  }catch(error){res.statusCode=(error as NodeJS.ErrnoException).code==='ENOENT'?404:400;res.end('No recording at this path. Run npm run test:visual to create one.');}
 };
 return {name:'av-visual-review-recordings',configureServer(server){server.middlewares.use(middleware);},configurePreviewServer(server){server.middlewares.use(middleware);}};
}
