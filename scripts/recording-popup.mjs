/** Constructor-ready modules can still be restoring saved playback in the shell. */
export async function openProjectorForRecording(page,{timeoutMs=60000,retryMs=1000}={}) {
 let popup=null;
 const receive=next=>{popup=next;};
 page.on('popup',receive);
 const deadline=Date.now()+timeoutMs;
 try {
  while(Date.now()<deadline){
   await page.locator('#open-projector').click();
   const waitUntil=Date.now()+retryMs;
   while(!popup&&Date.now()<waitUntil)await new Promise(resolve=>setTimeout(resolve,Math.min(50,retryMs)));
   if(popup)return popup;
   const status=await page.locator('#workspace-status').textContent()||'';
   // Retry only the shell's explicit readiness transitions. A blocked popup needs
   // an actionable error, not repeated clicks or a second projector runtime.
   if(!/Restoring projector|dashboard is still opening|Moving the projector|Returning the projector/i.test(status)){
    throw new Error(`Projector popup did not open: ${status||'no popup event received'}`);
   }
  }
  throw new Error('Projector restoration did not finish within the recording readiness timeout.');
 }finally{page.off('popup',receive);}
}
