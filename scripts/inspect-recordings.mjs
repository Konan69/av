import {readdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const directory=path.resolve(process.argv[2]||'artifacts/visual-tests');
const results=[];
async function visit(dir){
 for(const file of await readdir(dir,{withFileTypes:true})){
  const full=path.join(dir,file.name);
  if(file.isDirectory()){await visit(full);continue;}
  if(!/\.(webm|mp4)$/.test(file.name))continue;
  const probe=spawnSync('ffprobe',['-v','error','-count_packets','-show_entries','stream=codec_type,codec_name,width,height,nb_read_packets:format=duration,size','-of','json',full],{encoding:'utf8'});
  if(probe.status!==0)throw new Error(`Could not decode ${full}: ${probe.stderr}`);
  const info=JSON.parse(probe.stdout), video=info.streams.find(s=>s.codec_type==='video'),audio=info.streams.find(s=>s.codec_type==='audio');
  if(!video||!audio||Number(video.nb_read_packets)<10||Number(audio.nb_read_packets)<10)throw new Error(`Missing or empty audio/video: ${full}`);
  // Representative frames make long takes reviewable without discarding the recording.
  const sheet=full.replace(/\.(webm|mp4)$/,'.contact.jpg');
  const extract=spawnSync('ffmpeg',['-v','error','-y','-i',full,'-vf','fps=1/4,scale=384:-2,tile=4x3','-frames:v','1',sheet],{encoding:'utf8'});
  if(extract.status!==0)throw new Error(`Could not inspect ${full}: ${extract.stderr}`);
  results.push({file:full,video,audio,duration:info.format?.duration??null,bytes:Number(info.format?.size),contactSheet:sheet});
 }
}
await visit(directory);
if(!results.length)throw new Error('No recordings found.');
await writeFile(path.join(directory,'media-verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),recordings:results},null,2)+'\n');
console.log(JSON.stringify(results,null,2));
