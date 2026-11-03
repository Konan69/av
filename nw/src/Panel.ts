import type { TrackMeta } from "../../player/src/library";
import type { Stage } from "../../player/src/analyzer";

interface DjTrack {id: number; title: string; artist: string | null; duration: number | null; addedAt: number; folder: string | null}

const format = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;

export class Panel {
  readonly root = document.createElement("div");
  private status: HTMLElement;
  private title: HTMLElement;
  private clock: HTMLElement;
  private seek: HTMLInputElement;
  private play: HTMLButtonElement;
  private saved: HTMLSelectElement;
  private events = new AbortController();
  private scrubbing = false;
  private djList: HTMLElement;
  private djFilter: HTMLInputElement;
  private djItems: HTMLElement;
  private followButton: HTMLButtonElement;
  private djTracks: DjTrack[] = [];
  constructor(container: HTMLElement, handlers: {
    files(files: File[]): void; toggle(): void; seek(time: number): void;
    library(sha: string): void; feel(name: string, value: number): void; resetView(): void;
    djTracks(): Promise<DjTrack[]>; djTrack(track: DjTrack): void; follow(on: boolean): void;
  }) {
    this.root.className = "av-controls";
    this.root.innerHTML = `
      <style>
        .av-controls{position:absolute;inset:auto 22px 22px;z-index:10;color:#edf5ef;font:13px/1.5 system-ui,sans-serif;max-width:680px;border:1px solid #ffffff1c;background:#0c1214e8;border-radius:14px;padding:18px 20px;backdrop-filter:blur(18px);box-sizing:border-box}
        .av-controls[hidden]{display:none}.av-controls *{box-sizing:border-box}
        .av-controls .av-heading{display:flex;justify-content:space-between;gap:16px;align-items:baseline}.av-controls h1{font-size:16px;letter-spacing:.04em;margin:0;font-weight:550}.av-controls small{color:#9dafac;font-size:11px}
        .av-controls p{margin:8px 0 14px;color:#aebfba;min-height:20px}.av-controls p[data-error=true]{color:#ffc1b3}
        .av-controls button,.av-controls select{color:inherit;background:#ffffff09;border:1px solid #ffffff25;border-radius:6px;padding:7px 12px;font:inherit;cursor:pointer}.av-controls button:hover{background:#ffffff18}.av-controls button:disabled{opacity:.4;cursor:default}
        .av-controls .av-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.av-controls .av-primary{background:#c8ebd5;color:#13251c;border-color:transparent;font-weight:600}.av-controls input[type=range]{accent-color:#c8ebd5;width:100%;cursor:pointer}
        .av-controls .av-seek{display:flex;gap:12px;margin:12px 0;align-items:center}.av-controls output{white-space:nowrap;font:11px ui-monospace,monospace;color:#b6c6bf}.av-controls .av-feel{display:grid;grid-template-columns:repeat(4,1fr);gap:15px;margin-top:14px}.av-controls label{font-size:11px;color:#b6c6bf}.av-controls select{max-width:200px}.av-controls select option{background:#111b1a}
        .av-controls button:focus-visible,.av-controls select:focus-visible,.av-controls input:focus-visible{outline:2px solid #c8ebd5;outline-offset:3px}
        .av-controls .av-dj{margin-top:12px;border-top:1px solid #ffffff1c;padding-top:12px}.av-controls .av-dj[hidden]{display:none}
        .av-controls .av-dj input{width:100%;color:inherit;background:#ffffff09;border:1px solid #ffffff25;border-radius:6px;padding:7px 10px;font:inherit}
        .av-controls .av-dj ul{list-style:none;margin:8px 0 0;padding:0;max-height:38vh;overflow:auto}
        .av-controls .av-dj li button{display:flex;justify-content:space-between;gap:12px;width:100%;text-align:left;border:0;border-radius:6px;background:transparent;padding:6px 8px}
        .av-controls .av-dj li button:hover,.av-controls .av-dj li button:focus-visible{background:#ffffff14}
        .av-controls .av-dj li span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.av-controls .av-dj li small{flex:none}
        .av-controls button[aria-pressed=true]{background:#c8ebd533;border-color:#c8ebd5}
        @media(max-width:600px){.av-controls{inset:auto 10px 10px;padding:12px}.av-controls small{display:none}.av-controls .av-feel{gap:8px}}
      </style>
      <div class="av-heading"><h1>AV · Music, in space</h1><small>drag to look around · scroll to move · H to hide</small></div>
      <p role="status" aria-live="polite">Choose a track. Its layers build the world.</p>
      <div class="av-row">
        <button class="av-primary" data-action="choose">Open audio</button>
        <input data-action="files" type="file" accept="audio/*,.json" multiple hidden aria-label="Audio and optional matching genome JSON">
        <button data-action="play" disabled>Play</button>
        <button data-action="view">Reset view</button>
        <select data-action="library" aria-label="Saved tracks"><option value="">Saved tracks</option></select>
        <button data-action="dj" aria-expanded="false" title="Tracks from your DJ library">DJ library</button>
        <button data-action="follow" aria-pressed="false" title="Visualize whatever the DJ library is playing">Follow DJ</button>
        <button data-action="hide" aria-label="Hide controls (H to restore)">Hide</button>
      </div>
      <div class="av-seek"><input data-action="seek" aria-label="Track position" type="range" min="0" max="1" step="0.01" value="0" disabled><output>0:00 / 0:00</output></div>
      <div class="av-dj" hidden><input data-action="dj-filter" type="search" placeholder="Search your library" aria-label="Search DJ library"><ul data-dj-items></ul></div>
      <div class="av-feel">${["punch", "bass", "detail", "glow"].map((name) => `<label>${name}<input data-feel="${name}" aria-label="${name}" type="range" min="0" max="3" step="0.05" value="1"></label>`).join("")}</div>
    `;
    container.appendChild(this.root);
    const find = <T extends Element>(selector: string) => this.root.querySelector<T>(selector)!;
    this.status = find("p[role=status]"); this.title = find("h1"); this.clock = find("output");
    this.seek = find('[data-action="seek"]'); this.play = find('[data-action="play"]'); this.saved = find('[data-action="library"]');
    const input = find<HTMLInputElement>('[data-action="files"]');
    this.djList = find(".av-dj"); this.djFilter = find('[data-action="dj-filter"]'); this.djItems = find("[data-dj-items]");
    this.followButton = find('[data-action="follow"]');
    const djButton = find<HTMLButtonElement>('[data-action="dj"]');
    const opts = {signal: this.events.signal};
    find('[data-action="choose"]').addEventListener("click", () => input.click(), opts);
    input.addEventListener("change", () => { handlers.files(Array.from(input.files ?? [])); input.value = ""; }, opts);
    this.play.addEventListener("click", handlers.toggle, opts);
    find('[data-action="view"]').addEventListener("click", handlers.resetView, opts);
    find('[data-action="hide"]').addEventListener("click", () => this.visible(false), opts);
    this.saved.addEventListener("change", () => { if (this.saved.value) handlers.library(this.saved.value); }, opts);
    djButton.addEventListener("click", async () => {
      const open = this.djList.hidden;
      this.djList.hidden = !open; djButton.setAttribute("aria-expanded", String(open));
      if (!open) return;
      this.djFilter.focus();
      try { this.djTracks = await handlers.djTracks(); this.renderDj(handlers.djTrack); }
      catch (error) { this.message(error instanceof Error ? error.message : String(error), true); }
    }, opts);
    this.djFilter.addEventListener("input", () => this.renderDj(handlers.djTrack), opts);
    this.djFilter.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      this.djItems.querySelector<HTMLButtonElement>("button")?.click();
    }, opts);
    this.followButton.addEventListener("click", () => handlers.follow(this.followButton.getAttribute("aria-pressed") !== "true"), opts);
    this.seek.addEventListener("pointerdown", () => { this.scrubbing = true; }, opts);
    this.seek.addEventListener("input", () => { this.scrubbing = true; }, opts);
    this.seek.addEventListener("change", () => { handlers.seek(Number(this.seek.value)); this.scrubbing = false; }, opts);
    this.seek.addEventListener("pointercancel", () => { this.scrubbing = false; }, opts);
    this.root.querySelectorAll<HTMLInputElement>("[data-feel]").forEach((el) => {
      el.addEventListener("input", () => handlers.feel(el.dataset.feel!, Number(el.value)), opts);
    });
  }
  /** Newest downloads first; the filter matches artist, title and folder. */
  private renderDj(pick: (track: DjTrack) => void) {
    const words = this.djFilter.value.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = this.djTracks.filter((t) => {
      const text = `${t.artist ?? ""} ${t.title} ${t.folder ?? ""}`.toLowerCase();
      return words.every((w) => text.includes(w));
    }).slice(0, 80);
    this.djItems.replaceChildren(...matches.map((t) => {
      const li = document.createElement("li"), button = document.createElement("button"), label = document.createElement("span"), meta = document.createElement("small");
      label.textContent = t.artist ? `${t.artist} – ${t.title}` : t.title;
      meta.textContent = t.duration ? format(t.duration) : "";
      button.append(label, meta);
      button.addEventListener("click", () => { pick(t); this.djList.hidden = true; });
      li.append(button); return li;
    }));
  }
  following(on: boolean) { this.followButton.setAttribute("aria-pressed", String(on)); }
  message(message: string, error = false) { this.status.textContent = message; this.status.dataset.error = String(error); }
  stage(stage: Stage) {
    const message = stage.kind === "hashing" ? "Reading audio…" : stage.kind === "cached" ? "Opening saved analysis…" : stage.kind === "uploading" ? `Sending audio · ${Math.round(stage.pct * 100)}%` : stage.kind === "listening" ? `Listening to the layers · ${Math.round(stage.seconds)}s` : "Ready. Press Play to listen.";
    this.message(message);
  }
  ready(name: string, voices: {stem: string}[]) { this.title.textContent = name; this.message(voices.map((v) => v.stem).join(" · ")); }
  update(time: number, duration: number, playing: boolean) {
    this.play.disabled = duration === 0; this.seek.disabled = duration === 0;
    this.play.textContent = playing ? "Pause" : "Play";
    this.seek.max = String(duration || 1);
    if (!this.scrubbing) this.seek.value = String(time);
    this.clock.textContent = `${format(time)} / ${format(duration)}`;
  }
  library(tracks: TrackMeta[]) {
    this.saved.replaceChildren(new Option("Saved tracks", ""), ...tracks.map((t) => new Option(t.name, t.sha)));
    this.saved.hidden = tracks.length === 0;
  }
  feel(values: {punch: number; bass: number; detail: number; glow: number}) {
    for (const [key, value] of Object.entries(values)) {
      const el = this.root.querySelector<HTMLInputElement>(`[data-feel="${key}"]`);
      if (el) el.value = String(value);
    }
  }
  visible(value?: boolean) { this.root.hidden = value === undefined ? !this.root.hidden : !value; }
  dispose() { this.events.abort(); this.root.remove(); }
}
