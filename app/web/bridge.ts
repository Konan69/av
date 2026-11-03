import { getActiveSetTracks } from '../src/shared/utils/setUtils';
import { safeAssetRelPath } from '../src/shared/validation/sandboxModuleUtils';
import ModuleBase from '../src/projector/helpers/moduleBase';
import ThreeBase from '../src/projector/helpers/threeBase';
import kickUrl from '../src/dashboard/assets/audio/kick.mp3?url';

type Listener = (event: null, payload: any) => void;
type Envelope = {direction: string; type?: string; props?: any; filename?: string; data?: any};
const clone = <T>(data: T): T => data == null ? data : structuredClone(data);
const pathPart = (value: unknown) => encodeURIComponent(String(value ?? '').replace(/\.js$/, ''));

export async function initializeBridge({role}: {role: 'dashboard' | 'projector'}) {
  const channel = new BroadcastChannel('av-nw-wrld');
  const listeners = new Map<string, Set<Listener>>();
  const cache: Record<string, any> = {};
  let projectDir = '';
  let summaries: any[] = [];
  let pending = Promise.resolve();
  let midi: any = null;
  let midiInput: any = null;
  let currentInput: any = null;
  async function json(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
    return response.json();
  }
  async function refresh() {
    await pending;
    const state = await json('/api/nw/bootstrap');
    projectDir = state.projectDir;
    Object.assign(cache, state.json);
    summaries = state.summaries || [];
    return state;
  }
  function emit(type: string, props: any) {
    for (const listener of listeners.get(type) || []) listener(null, props);
  }
  function on(type: string, listener: Listener) {
    const set = listeners.get(type) || new Set<Listener>();
    listeners.set(type, set);
    set.add(listener);
    return () => set.delete(listener);
  }
  function reportError(error: unknown) {
    console.error('[nw_wrld workspace]', error);
    if (role === 'dashboard') window.parent.postMessage({type:'nw-workspace-error',message:`Save failed: ${String(error)}`}, location.origin);
    const indicator = document.getElementById('workspace-status');
    if (indicator) { indicator.textContent = `Save failed: ${String(error)}`; indicator.setAttribute('role', 'alert'); }
  }
  function send(direction: string, type: string, props: any = {}) {
    void pending.then(() => channel.postMessage({direction, type, props}));
  }
  channel.onmessage = ({data}: MessageEvent<Envelope>) => {
    if (data.direction === 'json-update' && data.filename) { cache[data.filename] = clone(data.data); return; }
    if (data.direction === 'input-event') { emit('input-event', data.props); return; }
    if (data.direction === 'input-status') { emit('input-status', data.props); return; }
    if (role === 'projector' && data.direction === 'to-projector') emit('from-dashboard', {type: data.type, props: data.props});
    if (role === 'dashboard' && data.direction === 'to-dashboard') {
      if (data.type === 'projector-ready') {
        // A replacement projector has fresh state even when React's ready flag
        // was already true. reload-data is idempotent for an unchanged track.
        const state = cache['appState.json'] || {};
        const userData = cache['userData.json'] || {};
        const setId = state.activeSetId ?? userData.config?.activeSetId ?? null;
        const tracks = getActiveSetTracks(userData, setId) as any[];
        const activeId = state.activeTrackId ?? userData.config?.activeTrackId;
        const track = tracks.find(track => String(track.id) === String(activeId));
        send('to-projector', 'reload-data', {setId, trackName: track?.name ?? null});
      }
      emit('from-projector', {type: data.type, props: data.props});
    }
  };
  function write(filename: string, data: any) {
    const snapshot = clone(data);
    cache[filename] = snapshot;
    channel.postMessage({direction: 'json-update', filename, data: snapshot});
    const saving = pending.then(() => json(`/api/nw/json/${encodeURIComponent(filename)}`, {
      method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(snapshot),
    }));
    pending = saving.then(() => undefined, reportError);
    return saving;
  }
  const assetUrl = (rel: unknown) => {
    const safe = safeAssetRelPath(rel);
    return safe ? new URL(`/api/nw/assets/${safe.split('/').map(encodeURIComponent).join('/')}`, location.origin).href : null;
  };
  const status = (value: string, message = '') => {
    const payload = {type: 'input-status', data: {status: value, message, config: currentInput}};
    emit('input-status', payload); channel.postMessage({direction:'input-status', props:payload});
  };
  const inputEvent = (type: string, data: any) => {
    const payload = {type, data: {...data, timestamp: Date.now() / 1000}};
    emit('input-event', payload); channel.postMessage({direction:'input-event', props:payload});
  };
  async function enableMidi() {
    const request = (navigator as any).requestMIDIAccess;
    if (!request) throw new Error('This browser does not support Web MIDI.');
    midi = await request.call(navigator, {sysex:false});
    return Array.from(midi.inputs.values()).map((input: any) => ({id: input.id, name: input.name, manufacturer: input.manufacturer, state: input.state}));
  }
  async function getMidiDevices() {
    if (!midi) {
      try {
        const permission = await navigator.permissions.query({name:'midi' as PermissionName});
        if (permission.state !== 'granted') return [];
        await enableMidi();
      } catch { return []; }
    }
    return Array.from(midi.inputs.values()).map((input: any) => ({id: input.id, name: input.name, manufacturer: input.manufacturer, state: input.state}));
  }
  async function configureInput(config: any) {
    currentInput = config;
    if (midiInput) { midiInput.onmidimessage = null; midiInput = null; }
    if (cache['userData.json']?.config?.sequencerMode === true) { status('disconnected'); return {ok:true}; }
    if (config?.type === 'midi') {
      if (!config.deviceId && !config.deviceName) { status('disconnected', 'Select a MIDI device.'); return {ok:true}; }
      await enableMidi();
      midiInput = Array.from(midi.inputs.values()).find((input: any) => input.id === config.deviceId || input.name === config.deviceName);
      if (!midiInput) { status('disconnected', 'MIDI device is not connected.'); return {ok:false,reason:'DEVICE_NOT_FOUND'}; }
      midiInput.onmidimessage = ({data}: any) => {
        if ((data[0] & 0xf0) !== 0x90 || !data[2]) return;
        const ch = (data[0] & 0x0f) + 1;
        const payload = {source:'midi', note:data[1], channel:ch, velocity:config.velocitySensitive ? data[2] : 127};
        if (ch === config.trackSelectionChannel) inputEvent('track-selection', payload);
        if (ch === config.methodTriggerChannel) inputEvent('method-trigger', payload);
      };
      status('connected'); return {ok:true};
    }
    if (config?.type === 'osc') { status('disconnected', 'OSC needs a network bridge; use MIDI or browser audio here.'); return {ok:false,reason:'OSC_BRIDGE_UNAVAILABLE'}; }
    status('connected'); return {ok:true};
  }
  await refresh();
  let kick: ArrayBuffer | null = null;
  try { const response = await fetch(kickUrl); if (response.ok) kick = await response.arrayBuffer(); } catch {}
  const scan = async () => { const result = await json('/api/nw/modules'); summaries = result.summaries; return result; };
  const bridge: any = {
    project: {getDir: () => projectDir, isRequired: () => true, isDirAvailable: () => Boolean(projectDir)},
    os: {openExternal: (url: string) => { const safe = new URL(url); if (!['https:', 'http:'].includes(safe.protocol)) return false; window.open(safe.href, '_blank', 'noopener'); return true; }},
    workspace: {
      listModuleFiles: async () => (await scan()).summaries.map((m: any) => m.file),
      listModuleSummaries: async () => (await scan()).summaries,
      listModuleSummariesWithSkipped: scan,
      getModuleUrl: (id: unknown) => json(`/api/nw/modules/${pathPart(id)}/url`),
      readModuleText: async (id: unknown) => (await json(`/api/nw/modules/${pathPart(id)}/meta`)).text,
      readModuleWithMeta: (id: unknown) => json(`/api/nw/modules/${pathPart(id)}/meta`),
      writeModuleTextSync: (id: unknown, text: unknown) => {
        const request = new XMLHttpRequest();
        request.open('PUT', `/api/nw/modules/${pathPart(id)}`, false);
        request.setRequestHeader('Content-Type', 'text/javascript');
        request.send(String(text));
        if (request.status >= 400) return {ok:false,reason:request.responseText};
        if (!summaries.some(module => module.id === String(id))) summaries.push({id:String(id),file:`${id}.js`});
        return JSON.parse(request.responseText);
      },
      moduleExists: (id: unknown) => summaries.some(module => module.id === String(id).replace(/\.js$/, '')),
      showModuleInFolder: (id: unknown) => window.open(`/api/nw/modules/${pathPart(id)}`, '_blank', 'noopener'),
      rewriteStarterModule: (id: unknown) => json(`/api/nw/modules/${pathPart(id)}/rewrite`, {method:'POST'}),
      assetUrl,
      listAssets: (dir: unknown) => json(`/api/nw/assets?dir=${encodeURIComponent(String(dir ?? ''))}`),
      readAssetText: async (rel: unknown) => { const url = assetUrl(rel); if (!url) return null; const response = await fetch(url); return response.ok ? response.text() : null; },
      readAssetArrayBuffer: async (rel: unknown) => { const url = assetUrl(rel); if (!url) return null; const response = await fetch(url); return response.ok ? response.arrayBuffer() : null; },
      writeAudioAsset: async ({filename,bytes}: any) => {
        const safe = String(filename).replace(/[^\w.\-]/g, '_');
        const relPath = `audio/${Date.now()}-${safe}`;
        return json(assetUrl(relPath)!, {method:'PUT',body:bytes});
      },
    },
    app: {
      getBaseMethodNames: () => ({moduleBase: ModuleBase.methods.map(m => m.name), threeBase: ThreeBase.methods.map(m => m.name)}),
      getKickMp3ArrayBuffer: () => kick?.slice(0) ?? null,
      getVersion: () => '0.7.0-av-web', getRepositoryUrl: () => 'https://github.com/aagentah/nw_wrld', isPackaged: () => false,
      openProjectorDevTools: () => {
        if (role === 'dashboard') window.parent.postMessage({type:'nw-open-projector'}, location.origin);
      },
    },
    messaging: {
      sendToProjector: (type: string, props: any = {}) => send('to-projector', type, props),
      sendToDashboard: (type: string, props: any = {}) => send('to-dashboard', type, props),
      onFromProjector: (listener: Listener) => on('from-projector', listener),
      onFromDashboard: (listener: Listener) => on('from-dashboard', listener),
      onInputEvent: (listener: Listener) => on('input-event', listener),
      onInputStatus: (listener: Listener) => on('input-status', listener),
      onWorkspaceModulesChanged: (listener: Listener) => on('modules-changed', listener),
      onWorkspaceLostSync: (listener: Listener) => on('workspace-lost', listener),
      configureInput, getMidiDevices,
      emitAudioBand: async (payload: any) => { inputEvent('method-trigger', {...payload,source:'audio'}); return {ok:true}; },
      emitFileBand: async (payload: any) => { inputEvent('method-trigger', {...payload,source:'file'}); return {ok:true}; },
      selectWorkspace: async () => ({canceled:false,ok:true,path:projectDir,workspacePath:projectDir,projectDir}),
    },
  };
  Object.assign(globalThis, {nwWrldBridge:bridge, nwWrldAppBridge:{json:{
    read: async (filename: string, fallback: any) => clone(cache[filename] ?? fallback),
    readSync: (filename: string, fallback: any) => clone(cache[filename] ?? fallback),
    write,
    writeSync: (filename: string, data: any) => { void write(filename,data).catch(() => {}); return {ok:true,pending:true}; },
  },logToMain: () => {}}});
  const events = new EventSource('/api/nw/events');
  events.onmessage = () => { void scan().then(() => emit('modules-changed', {})).catch(reportError); };
  window.addEventListener('pagehide', () => { events.close(); channel.close(); midiInput?.close?.(); }, {once:true});
  return {refresh, emit, on, channel, cache, projectDir, bridge, enableMidi, flush: () => pending};
}
