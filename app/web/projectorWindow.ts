/** Moves projector ownership between the preview and a popup without two renderers. */
export type PlaybackModule = {
  capturePlayback?: () => unknown;
  restorePlayback?: (state: unknown) => Promise<unknown> | unknown;
};
export function findPlaybackModule(target: Window | null): PlaybackModule | null {
  if (!target) return null;
  try {
    const module = (target as Window & {__genomeWorld?: PlaybackModule}).__genomeWorld;
    if (module) return module;
    for (let i = 0; i < target.frames.length; i++) {
      const found = findPlaybackModule(target.frames[i]);
      if (found) return found;
    }
  } catch { /* A closed or navigated window no longer belongs to this app. */ }
  return null;
}

type Popup = {closed: boolean; focus: () => void; close?: () => void; location: {href: string}};
type Options = {
  initialState?: unknown;
  isReady: () => boolean;
  openBlank: () => Popup | null;
  capture: (popup?: Popup) => unknown;
  detachPreview: () => Promise<void>;
  restore: (popup: Popup | null, state: unknown) => Promise<void>;
  showPreview: () => void;
  report: (message: string) => void;
};
export function createProjectorWindow(options: Options) {
  let popup: Popup | null = null;
  let snapshot: unknown = options.initialState ?? null;
  let moving = false;
  let generation = 0;
  return {
    get popup() { return popup; },
    get snapshot() { return snapshot; },
    receiveHandoff(source: Popup, state: unknown) {
      if (source !== popup || !state) return false;
      snapshot = state;
      return true;
    },
    captureCurrent() {
      const state = options.capture(popup && !popup.closed ? popup : undefined);
      if (state) snapshot = state;
      return snapshot;
    },
    dispose() {
      const state = options.capture(popup && !popup.closed ? popup : undefined);
      if (state) snapshot = state;
      generation++;
      popup?.close?.();
      popup = null;
      return snapshot;
    },
    async startPreview() {
      if (popup || moving) return;
      moving = true;
      options.showPreview();
      try { await options.restore(null, snapshot); }
      catch (error) { options.report(`Projector: ${error instanceof Error ? error.message : String(error)}`); }
      finally { moving = false; }
    },
    async open() {
      if (popup && !popup.closed) { popup.focus(); return; }
      if (moving) { options.report('Restoring projector…'); return; }
      if (!options.isReady()) { options.report('The dashboard is still opening. Try Open projector when it is ready.'); return; }
      // Open synchronously in the click gesture. Load no projector until preview disposal.
      const next = options.openBlank();
      if (!next) { options.report('Allow the projector popup in your browser, then click Open projector again.'); return; }
      snapshot = options.capture();
      popup = next;
      moving = true;
      const current = ++generation;
      options.report('Moving the projector…');
      try {
        await options.detachPreview();
        if (next.closed) throw new Error('The projector window was closed before it opened.');
        next.location.href = '/projector.html';
        await options.restore(next, snapshot);
        if (generation === current) options.report('Projector is open in a separate tab');
      } catch (error) {
        options.report(`Projector: ${error instanceof Error ? error.message : String(error)}`);
      } finally { moving = false; }
    },
    async check() {
      if (!popup || moving) return;
      if (!popup.closed) {
        const state = options.capture(popup);
        if (state) snapshot = state;
        return;
      }
      popup = null;
      moving = true;
      const current = ++generation;
      options.showPreview();
      options.report('Returning the projector to the dashboard…');
      try {
        await options.restore(null, snapshot);
        if (generation === current) options.report('Workspace saved locally');
      } catch (error) {
        options.report(`Track restored paused: ${error instanceof Error ? error.message : String(error)}`);
      } finally { moving = false; }
    },
  };
}

/** Runs in the popup before child frames dispose, even while its opener is throttled. */
export function handoffProjectorBeforeClose(target: Window) {
  const state = findPlaybackModule(target)?.capturePlayback?.();
  if (!state) return;
  try {
    const owner = target.opener as Window & {__nwReceiveProjectorHandoff?: (source: Window, state: unknown) => void};
    if (!owner || owner.closed) return;
    // Same-origin direct call is synchronous; postMessage alone can arrive after close polling.
    if (typeof owner.__nwReceiveProjectorHandoff === 'function') owner.__nwReceiveProjectorHandoff(target, state);
    else owner.postMessage({type:'nw-projector-handoff',state}, target.location.origin);
  } catch { /* The opener was closed or navigated away. */ }
}
