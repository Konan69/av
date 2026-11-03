import {build} from 'esbuild';
import {mkdtemp, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const directory=dirname(fileURLToPath(import.meta.url));
const output=await mkdtemp(join(tmpdir(),'av-test-'));
try {
 const tests=(await readdir(directory)).filter(name=>name.endsWith('.test.ts'));
 await build({entryPoints:tests.map(name=>join(directory,name)),outdir:output,bundle:true,platform:'node',format:'esm',define:{'import.meta.env':'{"VITE_GENOME_URL":"https://analyzer.test"}'},outExtension:{'.js':'.mjs'}});
 const result=spawnSync(process.execPath,['--test',...tests.map(name=>join(output,name.replace(/\.ts$/,'.mjs')))],{stdio:'inherit'});
 process.exitCode=result.status??1;
} finally {await rm(output,{recursive:true,force:true});}
