import '../src/rendererPolyfills';
import { initializeBridge } from './bridge';

try {
  const runtime = await initializeBridge({role:'dashboard'});
  await import('../src/dashboard/entry');
  (window as Window & {__nwDashboardReady?: boolean}).__nwDashboardReady = true;
  window.parent.postMessage({type:'nw-dashboard-ready'}, location.origin);
  window.addEventListener('message', async event => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    if (event.data?.type === 'nw-request-ready') {
      window.parent.postMessage({type:'nw-dashboard-ready'}, location.origin);
      return;
    }
    if (event.data?.type !== 'nw-enable-midi') return;
    try { await runtime.enableMidi(); await runtime.flush(); location.reload(); }
    catch (error) { window.parent.postMessage({type:'nw-workspace-error',message:`MIDI: ${String(error)}`}, location.origin); }
  });
} catch (error) {
  window.parent.postMessage({type:'nw-workspace-error',message:`Could not open the workspace: ${String(error)}`}, location.origin);
  const message = document.createElement('p');
  message.textContent = `Could not open nw_wrld: ${String(error)}`;
  message.style.cssText = 'color:white;background:#151715;padding:24px;font:14px monospace';
  document.body.appendChild(message);
  console.error(error);
}
