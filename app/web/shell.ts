import {createProjectorWindow, findPlaybackModule} from './projectorWindow';

const dashboard = document.getElementById('dashboard-frame') as HTMLIFrameElement;
const preview = document.getElementById('projector-preview') as HTMLIFrameElement;
const status = document.getElementById('workspace-status')!;
let ready = false;
let restoreGeneration = 0;
const handoffKey = 'nw-wrld-projector-handoff';
let initialState: unknown = null;
try { initialState = JSON.parse(sessionStorage.getItem(handoffKey) || 'null'); } catch {}
const remember = (state: unknown) => {
  try { if (state) sessionStorage.setItem(handoffKey, JSON.stringify(state)); } catch {}
};
const report = (message: string) => { status.textContent = message; };
const dashboardReady = () => {
  try { return ready || Boolean((dashboard.contentWindow as Window & {__nwDashboardReady?: boolean})?.__nwDashboardReady); }
  catch { return ready; }
};

const projector = createProjectorWindow({
  initialState,
  isReady: dashboardReady,
  openBlank: () => window.open('about:blank', 'nw-wrld-projector'),
  capture: popup => findPlaybackModule((popup as Window | undefined) || preview.contentWindow)?.capturePlayback?.() ?? null,
  detachPreview: () => new Promise<void>(resolve => {
    let settled = false;
    const finished = () => { if (settled) return; settled = true; clearTimeout(timeout); preview.removeEventListener('load', finished); resolve(); };
    const timeout = setTimeout(finished, 1500);
    preview.addEventListener('load', finished, {once:true});
    // The host's destroy hook disposes GPU/audio resources synchronously.
    try { (preview.contentWindow as any)?.nwWrldBridge?.sandbox?.destroy?.(); } catch {}
    preview.src = 'about:blank';
  }),
  showPreview: () => { preview.src = '/projector.html'; },
  restore: async (popup, state) => {
    if (!state) return;
    const generation = ++restoreGeneration;
    const deadline = performance.now() + 20000;
    while (generation === restoreGeneration && performance.now() < deadline) {
      if (popup?.closed) return;
      const module = findPlaybackModule(popup as Window | null || preview.contentWindow);
      if (module?.restorePlayback) {
        await module.restorePlayback(state);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('The saved track is still available in Saved tracks; reopen it in the projector.');
  },
  report,
});

function dashboardIsReady() {
  ready = true;
  if (!projector.popup) report('Workspace saved locally');
  if (!projector.popup && !preview.getAttribute('src')) void projector.startPreview();
}
(window as Window & {__nwReceiveProjectorHandoff?: (source: Window, state: unknown) => void}).__nwReceiveProjectorHandoff = (source, state) => {
  if (projector.receiveHandoff(source, state)) remember(state);
};
window.addEventListener('message', event => {
  if (event.origin !== location.origin) return;
  if (event.data?.type === 'nw-projector-handoff') {
    if (projector.receiveHandoff(event.source as Window, event.data.state)) remember(event.data.state);
    return;
  }
  if (event.source !== dashboard.contentWindow) return;
  if (event.data?.type === 'nw-dashboard-ready') dashboardIsReady();
  if (event.data?.type === 'nw-open-projector') void projector.open();
  if (event.data?.type === 'nw-workspace-error') {
    report(String(event.data.message)); status.setAttribute('role','alert');
  }
});
const requestReady = () => {
  if (dashboardReady()) dashboardIsReady();
  else dashboard.contentWindow?.postMessage({type:'nw-request-ready'}, location.origin);
};
dashboard.addEventListener('load', requestReady);
requestReady();
document.getElementById('open-projector')!.addEventListener('click', () => { requestReady(); void projector.open(); });
document.getElementById('enable-midi')!.addEventListener('click', () => {
  dashboard.contentWindow?.postMessage({type:'nw-enable-midi'}, location.origin);
});
const popupCheck = window.setInterval(() => { void projector.check(); }, 500);
window.addEventListener('beforeunload', () => remember(projector.captureCurrent()));
window.addEventListener('pagehide', () => {
  restoreGeneration++;
  clearInterval(popupCheck);
  // Reload/HMR must not orphan a playing popup and spawn a second renderer.
  remember(projector.dispose());
}, {once:true});
