/** Web Audio transport: the AudioContext clock is THE clock. */

export class Transport {
	private ctx = new AudioContext();
	private gain = this.ctx.createGain();
	private buffer: AudioBuffer | null = null;
	private source: AudioBufferSourceNode | null = null;
	private startedAt = 0; // ctx.currentTime when playback began
	private offset = 0; // track position at that moment
	playing = false;

	constructor() {
		this.gain.connect(this.ctx.destination);
		// ?muted lets automated QA run without making a sound
		if (new URLSearchParams(location.search).has("muted"))
			this.gain.gain.value = 0;
	}

	set muted(m: boolean) {
		this.gain.gain.value = m ? 0 : 1;
	}

	async load(file: Blob) {
		this.buffer = await this.ctx.decodeAudioData(await file.arrayBuffer());
	}

	get duration() {
		return this.buffer?.duration ?? 0;
	}

	get time(): number {
		if (!this.playing) return this.offset;
		return Math.min(
			this.duration,
			this.ctx.currentTime - this.startedAt + this.offset,
		);
	}

	async play() {
		if (!this.buffer || this.playing) return;
		await this.ctx.resume();
		const src = this.ctx.createBufferSource();
		src.buffer = this.buffer;
		src.connect(this.gain);
		src.onended = () => {
			if (this.source === src) this.pause();
		};
		src.start(0, this.offset);
		this.source = src;
		this.startedAt = this.ctx.currentTime;
		this.playing = true;
	}

	pause() {
		if (!this.playing) return;
		this.offset = this.time;
		this.playing = false;
		this.source?.stop();
		this.source = null;
	}

	async seek(t: number) {
		const wasPlaying = this.playing;
		this.pause();
		this.offset = Math.max(0, Math.min(this.duration, t));
		if (wasPlaying) await this.play();
	}

	async toggle() {
		this.playing ? this.pause() : await this.play();
	}
}
