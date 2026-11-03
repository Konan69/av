#!/usr/bin/env node
// Place the hidden recorder Chrome's windows without ever focusing them.
// usage: node scripts/recorder-window.mjs park     -> on screen, behind other windows (click its taskbar icon to see it)
//        node scripts/recorder-window.mjs offscreen -> at -32000,-32000
import {chromium} from 'playwright';
const mode=process.argv[2]||'park';
const browser=await chromium.connectOverCDP(process.env.CDP||'http://localhost:9334');
const cdp=await browser.newBrowserCDPSession();
const {targetInfos}=await cdp.send('Target.getTargets');
const seen=new Set();let i=0;
for(const t of targetInfos.filter(t=>t.type==='page')){
 const {windowId}=await cdp.send('Browser.getWindowForTarget',{targetId:t.targetId});
 if(seen.has(windowId))continue;seen.add(windowId);
 await cdp.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal'}});
 const bounds=mode==='offscreen'?{left:-32000,top:-32000}:{left:80+40*i,top:60+40*i,width:1600,height:940};
 await cdp.send('Browser.setWindowBounds',{windowId,bounds});i++;
 console.log(windowId,t.url.slice(0,60),JSON.stringify(bounds));
}
process.exit(0);
