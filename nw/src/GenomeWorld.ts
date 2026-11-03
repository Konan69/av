import * as Three from "three";
import { MusicSession } from "../../player/src/session";
import { getTrack, listTracks } from "../../player/src/library";
import { createMusicWorld, type WorldControls } from "../../player/src/world/MusicWorld";
import { Orbit } from "./Orbit";
import { Panel } from "./Panel";

const numberOption = (name: string, defaultVal: number, min: number, max: number) => ({name, defaultVal, type: "number", min, max});

/** The whole musical world is one nw_wrld module and one shared depth buffer. */
export default class GenomeWorld extends ModuleBase {
  static methods = [
    {name: "loadTrack", executeOnLoad: false, options: [
      {name: "audio", defaultVal: "", type: "text"},
      {name: "genome", defaultVal: "", type: "text"},
    ]},
    {name: "playTrack", executeOnLoad: false, options: []},
    {name: "pauseTrack", executeOnLoad: false, options: []},
    {name: "seekTrack", executeOnLoad: false, options: [numberOption("seconds", 0, 0, 86400)]},
    {name: "setFeel", executeOnLoad: false, options: ["punch", "bass", "detail", "glow"].map((name) => numberOption(name, 1, 0, 3))},
    {name: "setView", executeOnLoad: false, options: [numberOption("azimuth", 0, -180, 180), numberOption("elevation", 0, -65, 65), numberOption("distance", 0, -20, 18)]},
    {name: "showControls", executeOnLoad: false, options: [{name: "visible", defaultVal: true, type: "boolean"}]},
  ];

  private scene = new Three.Scene();
  private camera = new Three.PerspectiveCamera(66, 1, 0.1, 180);
  private renderer: Three.WebGLRenderer;
  private world: ReturnType<typeof createMusicWorld> | null = null;
  private orbit: Orbit;
  private panel: Panel;
  private session: MusicSession;
  private feel: WorldControls = {punch: 1, bass: 1, detail: 1, glow: 1};
  private events = new AbortController();
  private assetRequest: AbortController | null = null;
  private generation = 0;
  private resize: ResizeObserver;
  private frame = 0;
  private disposed = false;
  private lastUi = 0;
  private unsubscribe: (() => void) | null = null;
  private lastPoseTime = Number.NaN;
  private forcePose = true;
  private contextLost = false;
  private lastRenderAt = 0;
  private renderedFrames = 0;
  /** Following dj-organizer's player: its clock drives the visuals; this page plays no sound. */
  private follow: {events: EventSource | null; state: NowPlaying | null; id: number | null} = {events: null, state: null, id: null};
  /** dj-organizer id of the loaded track, when it came from the DJ library. */
  private djId: number | null = null;

  constructor(container: HTMLElement) {
    super(container);
    this.renderer = new Three.WebGLRenderer({antialias: true, alpha: false, powerPreference: "high-performance"});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = Three.SRGBColorSpace;
    // ACES for its deep blacks; the world keeps its own highlights below where ACES bleaches them.
    this.renderer.toneMapping = Three.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.scene.background = new Three.Color("#000000");
    container.appendChild(this.renderer.domElement);
    this.orbit = new Orbit(this.camera, this.renderer.domElement, () => this.requestFrame());
    this.panel = new Panel(container, {
      files: (files) => { void this.openFiles(files); },
      toggle: () => { this.session.current?.transport.playing ? this.pauseTrack() : this.playTrack(); },
      seek: (seconds) => this.seekTrack({seconds}),
      library: (sha) => { void this.openSaved(sha); },
      feel: (name, value) => this.setFeel({[name]: value}),
      resetView: () => this.setView(),
      djTracks: () => this.djTracks(),
      djTrack: (track) => this.loadDjTrack({id: track.id, name: trackName(track)}),
      follow: (on) => this.setFollow(on),
    });
    this.session = new MusicSession((stage) => this.panel.stage(stage));
    this.resize = new ResizeObserver(() => this.resizeCanvas());
    this.resize.observe(container);
    this.resizeCanvas();
    const opts = {signal: this.events.signal};
    container.addEventListener("dragover", (event) => event.preventDefault(), opts);
    container.addEventListener("drop", (event) => {
      event.preventDefault();
      void this.openFiles(Array.from(event.dataTransfer?.files ?? []));
    }, opts);
    window.addEventListener("keydown", (event) => {
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || /INPUT|SELECT|TEXTAREA|BUTTON/.test(event.target.tagName))) return;
      if (event.code === "Space") { event.preventDefault(); this.session.current?.transport.playing ? this.pauseTrack() : this.playTrack(); }
      if (event.code === "KeyH") this.panel.visible();
    }, opts);
    this.renderer.domElement.addEventListener("webglcontextlost", (event) => {
      event.preventDefault(); this.contextLost = true; this.pauseTrack();
      this.panel.visible(true); this.panel.message("Graphics context interrupted. Playback paused.", true);
    }, opts);
    this.renderer.domElement.addEventListener("webglcontextrestored", () => {
      this.contextLost = false; this.requestFrame(); this.panel.message("Graphics restored. Press Play to continue.");
    }, opts);
    this.show();
    this.requestFrame();
    void this.refreshLibrary();
    if (followRequested()) this.setFollow(true);
    // Read-only diagnostics plus the same public commands used by the composer.
    (window as unknown as {__genomeWorld?: GenomeWorld}).__genomeWorld = this;
  }

  private resizeCanvas() {
    if (!this.elem || this.disposed) return;
    const width = Math.max(1, this.elem.clientWidth), height = Math.max(1, this.elem.clientHeight);
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
    this.requestFrame();
  }

  private requestFrame = () => {
    if (!this.disposed && !this.frame) this.frame = requestAnimationFrame(this.animate);
  };
  private animate = () => {
    this.frame = 0;
    if (this.disposed) return;
    const current = this.session.current;
    const now = performance.now();
    const followed = this.followTime();
    const playing = followed !== null ? Boolean(this.follow.state?.playing) : current?.transport.playing ?? false;
    const interval = 1000 / 60, elapsed = now - this.lastRenderAt;
    // Bound GPU work on high-refresh displays while preserving the audio clock.
    if (playing && elapsed < interval) {
      this.requestFrame(); return;
    }
    this.lastRenderAt = playing ? now - elapsed % interval : now;
    const time = followed ?? current?.transport.time ?? 0;
    if (current && this.world && (this.forcePose || time !== this.lastPoseTime)) {
      this.world.update(current.conductor.sample(time), this.feel);
      this.lastPoseTime = time; this.forcePose = false;
    }
    if (!this.contextLost) {
      // The world owns its light pipeline (afterglow, bloom, lens finish).
      if (this.world) this.world.render(this.renderer, this.camera);
      else this.renderer.render(this.scene, this.camera);
      this.renderedFrames++;
    }
    if (now - this.lastUi > 100 || !playing) {
      this.panel.update(time, current?.transport.duration ?? 0, playing);
      this.lastUi = now;
    }
    if (playing) this.requestFrame();
  };

  private async refreshLibrary() {
    try { const tracks = await listTracks(); if (!this.disposed) this.panel.library(tracks); }
    catch (error) { if (!this.disposed) this.panel.message(`Saved tracks unavailable: ${this.errorText(error)}`, true); }
  }
  private errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
  private report(error: unknown, generation = this.generation) {
    if (this.disposed || generation !== this.generation) return;
    this.panel.visible(true); this.panel.message(this.errorText(error), true);
  }
  private beginLoad() {
    this.generation++;
    this.djId = null;
    this.assetRequest?.abort(); this.assetRequest = null;
    this.session.cancel(); this.session.current?.transport.pause();
    this.panel.visible(true);
    return this.generation;
  }
  private async openBlob(audio: Blob, name: string, genome: unknown, generation: number) {
    if (generation !== this.generation || this.disposed) return;
    try {
      const performance = await this.session.open(audio, name, genome);
      if (!performance || generation !== this.generation || this.disposed) return;
      this.world?.dispose();
      this.world = createMusicWorld(this.scene, undefined, {seed: performance.seed, labels: performance.genome.sections.labels,
        timeline: {sections: performance.conductor.sections, duration: performance.genome.duration}});
      this.setView();
      this.unsubscribe?.();
      this.unsubscribe = performance.transport.subscribe(this.requestFrame);
      this.lastPoseTime = Number.NaN; this.forcePose = true;
      this.requestFrame();
      this.world.update(performance.conductor.sample(0), this.feel);
      this.panel.ready(name, performance.conductor.voices);
      this.panel.update(0, performance.transport.duration, false);
      void this.refreshLibrary();
    } catch (error) { this.report(error, generation); }
  }
  async openFiles(files: File[]) {
    if (this.disposed || files.length === 0) return;
    const generation = this.beginLoad();
    const audio = files.filter((f) => !f.name.toLowerCase().endsWith(".json"));
    const analyses = files.filter((f) => f.name.toLowerCase().endsWith(".json"));
    if (audio.length !== 1 || analyses.length > 1) {
      this.report(new Error("Choose one audio file, optionally with its matching genome JSON."), generation); return;
    }
    try {
      const genome = analyses[0] ? JSON.parse(await analyses[0].text()) : undefined;
      await this.openBlob(audio[0], audio[0].name, genome, generation);
    } catch (error) { this.report(error, generation); }
  }
  private async openSaved(sha: string) {
    if (this.disposed) return;
    const generation = this.beginLoad();
    try {
      const rec = await getTrack(sha);
      if (!rec) throw new Error("This saved track is no longer available.");
      await this.openBlob(rec.audio, rec.name, rec.genome, generation);
    } catch (error) { this.report(error, generation); }
  }

  /** Asset paths are relative to this nw_wrld project's assets directory. */
  loadTrack({audio = "", genome = ""}: {audio?: string; genome?: string} = {}) {
    if (this.disposed) return;
    if (!audio) { this.showControls({visible: true}); return; }
    const generation = this.beginLoad();
    const request = new AbortController(); this.assetRequest = request;
    void (async () => {
      try {
        this.panel.message("Opening project audio…");
        const audioUrl = assetUrl(audio);
        const genomeUrl = genome ? assetUrl(genome) : null;
        if (!audioUrl || (genome && !genomeUrl)) throw new Error("Use paths inside the project's assets folder.");
        const audioResponse = await fetch(audioUrl, {signal: request.signal});
        if (!audioResponse.ok) throw new Error(`Could not open audio asset: ${audio}`);
        const blob = await audioResponse.blob();
        let analysis: unknown;
        if (genomeUrl) {
          // fetch avoids the SDK's 2 MB readText cap; real genomes exceed that.
          const response = await fetch(genomeUrl, {signal: request.signal});
          if (!response.ok) throw new Error(`Could not open analysis asset: ${genome}`);
          analysis = await response.json();
        }
        await this.openBlob(blob, audio.split("/").pop() || audio, analysis, generation);
      } catch (error) { if (!request.signal.aborted) this.report(error, generation); }
    })();
  }
  /** Open any audio URL on this origin (the DJ library proxy, for instance). */
  loadUrl({url, name, djId = null}: {url: string; name: string; djId?: number | null}) {
    if (this.disposed || !url) return;
    const generation = this.beginLoad();
    this.djId = null;
    const request = new AbortController(); this.assetRequest = request;
    void (async () => {
      try {
        this.panel.message(`Opening ${name}…`);
        const response = await fetch(url, {signal: request.signal});
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? `Could not open ${name} (HTTP ${response.status})`);
        await this.openBlob(await response.blob(), name, undefined, generation);
        if (generation === this.generation && this.session.current) {
          this.djId = djId; this.requestFrame();
          // Following is hands-off: get the controls out of the picture (H brings them back).
          if (this.follow.events) this.panel.visible(false);
        }
      } catch (error) { if (!request.signal.aborted) this.report(error, generation); }
    })();
  }
  /** A track from a local dj-organizer library, streamed through this origin's /api/dj proxy. */
  loadDjTrack({id, name}: {id: number; name?: string}) {
    if (!Number.isInteger(id)) return;
    this.loadUrl({url: `/api/dj/audio/${id}`, name: name || `DJ track ${id}`, djId: id});
  }
  async djTracks(): Promise<DjTrack[]> {
    const response = await fetch("/api/dj/tracks");
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error ?? `DJ library unavailable (HTTP ${response.status})`);
    return body.tracks ?? [];
  }
  /** Follow whatever dj-organizer is playing: load the same song (silently) and ride its clock. */
  setFollow(on: boolean) {
    this.follow.events?.close(); this.follow.events = null;
    this.panel.following(on);
    if (!on) { this.follow.state = null; this.follow.id = null; this.requestFrame(); return; }
    const events = new EventSource("/api/dj/now-playing/events");
    this.follow.events = events;
    events.onmessage = (event) => {
      let state: NowPlaying | null = null;
      try { state = JSON.parse(event.data); } catch { return; }
      if (!state || !Number.isInteger(state.id)) return;
      this.follow.state = state;
      if (state.id !== this.follow.id) {
        this.follow.id = state.id;
        this.session.current?.transport.pause();
        this.loadDjTrack({id: state.id, name: trackName(state)});
      }
      this.requestFrame();
    };
    events.onerror = () => { if (!this.disposed) this.panel.message("Waiting for the DJ library player…"); };
    this.panel.message("Following the DJ library player. Press play there.");
  }
  /** The followed player's position now, or null when not following the loaded track. */
  private followTime(): number | null {
    const state = this.follow.state, current = this.session.current;
    if (!this.follow.events || !state || !current || state.id !== this.djId) return null;
    const time = state.playing ? state.time + (Date.now() - state.sentAt) / 1000 : state.time;
    return Math.max(0, Math.min(current.transport.duration || time, time));
  }

  playTrack() {
    const current = this.session.current;
    if (!current || this.disposed || this.contextLost) return;
    if (this.follow.events) { this.panel.message("Following the DJ library player; play and pause there."); return; }
    void current.transport.play().catch((error) => this.report(error));
  }
  pauseTrack() { this.session.current?.transport.pause(); }
  seekTrack({seconds = 0}: {seconds?: number} = {}) {
    if (!Number.isFinite(seconds)) return;
    void this.session.current?.transport.seek(seconds).catch((error) => this.report(error));
  }
  setFeel(values: Partial<WorldControls> = {}) {
    for (const key of ["punch", "bass", "detail", "glow"] as const) {
      if (typeof values[key] === "number" && Number.isFinite(values[key])) this.feel[key] = Three.MathUtils.clamp(values[key]!, 0, 3);
    }
    this.panel.feel(this.feel);
    this.forcePose = true; this.requestFrame();
  }
  setView(values: {azimuth?: number; elevation?: number; distance?: number} = {}) { this.orbit.set(values); }
  showControls({visible = true}: {visible?: boolean} = {}) { this.panel.visible(visible); }

  capturePlayback() {
    const current = this.session.current;
    if (!current) return null;
    return {sha: current.genome.track_sha256, time: current.transport.time,
      playing: current.transport.playing, feel: {...this.feel}, view: this.orbit.view};
  }
  async restorePlayback(state: NonNullable<ReturnType<GenomeWorld["capturePlayback"]>>) {
    await this.openSaved(state.sha);
    if (this.disposed || !this.session.current) return;
    this.setFeel(state.feel); this.setView(state.view);
    await this.session.current.transport.seek(state.time);
    if (state.playing) {
      try { await this.session.current.transport.play(); }
      catch { this.panel.visible(true); this.panel.message("Track restored. Press Play to continue."); }
    }
  }

  get diagnostics() {
    const p = this.session.current;
    return {
      loaded: Boolean(p), playing: p?.transport.playing ?? false,
      time: p?.transport.time ?? 0, duration: p?.transport.duration ?? 0,
      voices: p?.conductor.voices.map((v) => ({stem: v.stem, role: v.role})) ?? [],
      rendererCount: 1, camera: this.world?.view.position.toArray() ?? this.camera.position.toArray(),
      geometries: this.renderer.info.memory.geometries, calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles, contextLost: this.contextLost,
      composition: this.world?.root.userData ?? null,
      renderedFrames: this.renderedFrames, frameRateLimit: 60,
    };
  }
  destroy() {
    if (this.disposed) return;
    this.disposed = true; this.generation++;
    cancelAnimationFrame(this.frame);
    this.assetRequest?.abort(); this.events.abort(); this.resize.disconnect(); this.follow.events?.close();
    this.unsubscribe?.(); this.session.dispose(); this.orbit.dispose(); this.world?.dispose();
    this.panel.dispose(); this.renderer.dispose(); this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    const globals = window as unknown as {__genomeWorld?: GenomeWorld};
    if (globals.__genomeWorld === this) delete globals.__genomeWorld;
    super.destroy();
  }
}

interface NowPlaying {id: number; title: string; artist: string | null; time: number; duration: number; playing: boolean; sentAt: number}
export interface DjTrack {id: number; title: string; artist: string | null; duration: number | null; addedAt: number; folder: string | null}
const trackName = (t: {title: string; artist: string | null}) => t.artist ? `${t.artist} – ${t.title}` : t.title;
/** ?follow on this page (standalone) or on the shell around it (nw_wrld). */
function followRequested() {
  for (const target of [window, window.top]) {
    try { if (target && new URLSearchParams(target.location.search).has("follow")) return true; } catch { /* cross-origin parent */ }
  }
  return false;
}
