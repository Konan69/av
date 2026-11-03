/** Preserve the measured rate in failed manifests as well as successful ones. */
export function requireRecordingFrameRate(clip,minimumFps=20){
 const seconds=Number(clip.wallMs)/1000;
 clip.measuredFps=seconds>0&&Number.isFinite(seconds)&&Number.isFinite(clip.renderFrames)?clip.renderFrames/seconds:0;
 if(clip.measuredFps<minimumFps){
  throw new Error(`Recording FPS below ${minimumFps}: measured ${clip.measuredFps.toFixed(2)} FPS across ${Number.isFinite(seconds)?seconds.toFixed(2):'invalid'} seconds (${clip.renderFrames} rendered frames).`);
 }
 return clip.measuredFps;
}
