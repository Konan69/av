import {initializeBridge} from './bridge';
import {createSandboxBridge} from './sandboxBridge';

export async function initializeProjectorBridge() {
  const connection=await initializeBridge({role:'projector'});
  const global=globalThis as typeof globalThis & {nwWrldBridge:any};
  global.nwWrldBridge.sandbox=createSandboxBridge((type,props)=>global.nwWrldBridge.messaging.sendToDashboard(type,props));
  return connection;
}
