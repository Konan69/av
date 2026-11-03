/** Web Audio transport: the AudioContext clock is THE clock. */
export class Transport {
	private ctx: AudioContext;
	private gain: GainNode;
	private buffer: AudioBuffer | null = null;
	private source: AudioBufferSourceNode | null = null;
	private startedAt = 0;
	private offset = 0;
	private disposed = false;
	private revision = 0;
	private loadRevision = 0;
	private wantsPlayback = false;
	private pendingPlay: Promise<void> | null = null;
	private listeners = new Set<() => void>();
	playing = false;

	constructor(context?: AudioContext) {
		this.ctx = context ?? new AudioContext();
		this.gain = this.ctx.createGain();
		this.gain.connect(this.ctx.destination);
		if (typeof location !== "undefined" && new URLSearchParams(location.search).has("muted"))
			this.gain.gain.value = 0;
	}

	/** State transitions wake renderers; the AudioContext remains the only clock. */
	subscribe(listener: () => void): () => void {
		if (this.disposed) return () => {};
		this.listeners.add(listener);
		return () => { this.listeners.delete(listener); };
	}

	private notify() {
		for (const listener of this.listeners) listener();
	}

	set muted(m: boolean) {
		this.gain.gain.value = m ? 0 : 1;
	}

	async load(file: Blob) {
		if (this.disposed) return;
		const request = ++this.loadRevision;
		this.pause();
		this.buffer = null;
		this.offset = 0;
		this.notify();
		const bytes = await file.arrayBuffer();
		if (this.disposed || request !== this.loadRevision) return;
		const buffer = await this.ctx.decodeAudioData(bytes);
		if (this.disposed || request !== this.loadRevision) return;
		this.buffer = buffer;
		this.notify();
	}

	get duration() { return this.buffer?.duration ?? 0; }

	get time(): number {
		return this.playing ? Math.min(this.duration, this.ctx.currentTime - this.startedAt + this.offset) : this.offset;
	}

	play(): Promise<void> {
		if (this.disposed || !this.buffer || this.playing) return Promise.resolve();
		if (this.pendingPlay) return this.pendingPlay;
		this.wantsPlayback = true;
		const request = ++this.revision;
		const pending = this.startPlayback(request);
		this.pendingPlay = pending;
		void pending.then(() => {
			if (this.pendingPlay === pending) this.pendingPlay = null;
		}, () => {
			if (this.pendingPlay === pending) this.pendingPlay = null;
		});
		return pending;
	}

	private async startPlayback(request: number) {
		try {
			await this.ctx.resume();
			if (this.disposed || request !== this.revision || !this.wantsPlayback || !this.buffer) return;
			if (this.offset >= this.duration) this.offset = 0;
			const src = this.ctx.createBufferSource();
			src.buffer = this.buffer;
			src.connect(this.gain);
			src.onended = () => {
				if (this.source !== src) return;
				this.offset = this.duration;
				this.playing = false;
				this.wantsPlayback = false;
				this.source = null;
				src.disconnect();
				this.notify();
			};
			src.start(0, this.offset);
			this.source = src;
			this.startedAt = this.ctx.currentTime;
			this.playing = true;
			this.notify();
		} catch (error) {
			if (request === this.revision) this.wantsPlayback = false;
			throw error;
		}
	}

	pause() {
		this.offset = this.time;
		this.playing = false;
		this.wantsPlayback = false;
		this.revision++;
		this.pendingPlay = null;
		const src = this.source;
		this.source = null;
		if (src) {
			src.onended = null;
			src.stop();
			src.disconnect();
		}
		this.notify();
	}

	async seek(t: number) {
		if (this.disposed) return;
		const wasPlaying = this.wantsPlayback;
		this.pause();
		this.offset = Math.max(0, Math.min(this.duration, Number.isFinite(t) ? t : 0));
		this.notify();
		// Seeking to the end parks there. An explicit play starts a new pass.
		if (wasPlaying && this.offset < this.duration) await this.play();
	}

	async toggle() {
		this.wantsPlayback ? this.pause() : await this.play();
	}

	dispose() {
		if (this.disposed) return;
		this.pause();
		this.disposed = true;
		this.loadRevision++;
		this.buffer = null;
		this.gain.disconnect();
		void this.ctx.close().catch(() => {});
		this.notify();
		this.listeners.clear();
	}
}
