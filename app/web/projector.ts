import {initializeProjectorBridge} from './projectorBridge';
import {handoffProjectorBeforeClose} from './projectorWindow';

// Register in the top projector before its sandbox exists, so playback is captured first.
window.addEventListener('beforeunload', () => handoffProjectorBeforeClose(window));
window.addEventListener('pagehide', () => handoffProjectorBeforeClose(window));

try {
  await initializeProjectorBridge();
  await import('../src/projector/entry');
} catch(error) {
  const message=document.createElement('p');
  message.style.cssText='padding:24px;color:white;font-family:monospace';
  message.textContent=`nw_wrld projector could not start: ${error instanceof Error?error.message:String(error)}`;
  document.body.appendChild(message);
  console.error(error);
}
