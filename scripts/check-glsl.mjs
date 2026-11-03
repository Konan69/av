#!/usr/bin/env node
// Compile-check exported GLSL ES 3.0 strings with glslangValidator, without a browser.
// usage: node scripts/check-glsl.mjs <module.ts> <export>:<vert|frag> [...]
import {build} from 'esbuild';
import {writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const [file,...names]=process.argv.slice(2);
const dir=path.join(root,'.runtime/glsl');mkdirSync(dir,{recursive:true});
const bundle=path.join(dir,'module.mjs');
await build({entryPoints:[path.resolve(file)],bundle:true,platform:'node',format:'esm',outfile:bundle,external:['three'],logLevel:'error'});
const mod=await import(pathToFileURL(bundle).href+`?${Date.now()}`);
let failed=0;
for(const name of names){
 const [exp,stage]=name.split(':');
 if(typeof mod[exp]!=='string'){console.log(exp,'MISSING');failed=1;continue;}
 const target=path.join(dir,`${exp}.${stage}`);
 writeFileSync(target,'#version 300 es\n'+mod[exp]);
 try{execFileSync('glslangValidator',[target],{encoding:'utf8'});console.log(exp,'OK');}
 catch(e){failed=1;console.log(exp,'FAILED\n'+String(e.stdout||e.message).split('\n').slice(0,40).join('\n'));}
}
process.exit(failed);
