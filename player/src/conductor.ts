/**
 * THE CONDUCTOR — reads the genome as a score, with lookahead.
 *
 * Three clocks, all observed:
 *   THE MAP     sections + raw label probabilities (ambiguity kept)
 *   THE GRID    beats / downbeats / phrases
 *   THE NERVES  per-VOICE rms, bands, onsets, wobble (from the stems)
 *
 * Nothing here is driven by wall-clock time. The one continuous motion in
 * the system is a Lorenz attractor whose regime follows the tension curve,
 * whose speed follows how loud the track currently is (silence = stillness)
 * and which is kicked by the pulse voice's onsets. Chaos on a leash.
 */
import type { Genome, Section } from "./genome";
import { BAND_ORDER } from "./genome";
import type { WorldSeed } from "./seed";
import { discoverVoices, type Voice } from "./voices";

export interface VoiceSignal {
	stem: string;
	role: string;
	/** 0..~1.25 normalized loudness of this layer right now */
	level: number;
	/** decaying impulse from this layer's own onsets */
	punch: number;
	/** 0..1 brightness of this layer right now */
	bright: number;
	/** 5 normalized band energies of this layer */
	bands: Float32Array;
	share: number;
}

export interface Signals {
	time: number;
	section: Section;
	probs: number[];
	boundary: number;
	/** 0..1 ramp that COMPLETES on the next boundary's downbeat */
	morph: number;
	nextLabel: string;
	/** 0..1 position inside the current 8-bar phrase */
	phrase: number;
	beatPhase: number;
	barPhase: number;
	beatIndex: number;
	downbeatIndex: number;
	/** decaying flash on every beat — the constant connection to the grid */
	beatPulse: number;
	/** stronger flash on bar 1 */
	barPulse: number;
	rms: number;
	tension: number;
	/** 0..1 — how torn the section model is right now (tease drops spike) */
	ambiguity: number;
	/** drop probability * loudness */
	drive: number;
	wobblePhase: number;
	wobbleDepth: number;
	/** normalized attractor state, each component roughly -1..1 */
	chaos: Float32Array;
	voices: VoiceSignal[];
}

const PUNCH_DECAY = 9;
const PHRASE_BARS = 8;

function percentile(xs: number[], p: number): number {
	if (!xs.length) return 1;
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor(s.length * p))] || 1;
}

function sampleLerp(arr: number[] | undefined, fps: number, t: number): number {
	if (!arr || !arr.length) return 0;
	const x = t * fps;
	const i = Math.floor(x);
	if (i < 0) return arr[0];
	if (i >= arr.length - 1) return arr[arr.length - 1];
	return arr[i] + (arr[i + 1] - arr[i]) * (x - i);
}

function lowerBound(xs: number[], t: number): number {
	let lo = 0,
		hi = xs.length - 1,
		ans = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (xs[mid] <= t) {
			ans = mid;
			lo = mid + 1;
		} else hi = mid - 1;
	}
	return ans;
}

export class Conductor {
	readonly g: Genome;
	readonly seed: WorldSeed;
	readonly voices: Voice[];
	readonly sections: Section[];
	readonly beats: number[];
	readonly downbeats: number[];
	readonly barDur: number;
	/** boundary time snapped to the nearest downbeat — morphs land here */
	private snapped: number[];
	private rmsScale: number;
	private labelIdx: Map<string, number>;

	private punch: Float32Array;
	private onsetPtr: number[];
	private onsetTimes: number[][];
	/** last frame the render loop computed — read-only consumers use this */
	last: Signals | null = null;
	private wobPhase = 0;
	private lastT = 0;
	private lz = new Float32Array([0.9, 0.4, 12]);
	private chaos = new Float32Array(3);
	private sig: VoiceSignal[];

	constructor(g: Genome, seed: WorldSeed) {
		this.g = g;
		this.seed = seed;
		this.voices = discoverVoices(g);

		const merged: Section[] = [];
		for (const s of g.sections.hard) {
			const prev = merged[merged.length - 1];
			if (prev && (s.end - s.start < 1 || s.label === prev.label)) prev.end = s.end;
			else merged.push({ ...s });
		}
		this.sections = merged.length ? merged : [{ label: "intro", start: 0, end: g.duration }];

		const off = g.beats.onset_phase_offset ?? 0;
		this.beats = g.beats.beats.map((b) => b + off);
		this.downbeats = (g.beats.downbeats.length ? g.beats.downbeats : g.beats.beats).map((b) => b + off);
		const diffs = this.downbeats.slice(1).map((d, i) => d - this.downbeats[i]);
		this.barDur = diffs.length ? percentile(diffs, 0.5) : 2;

		// every section boundary snaps to the first downbeat at/after it, so a
		// morph completes ON the bar rather than near it
		this.snapped = this.sections.map((s) => {
			let best = s.start;
			let bestD = Infinity;
			for (const d of this.downbeats) {
				const gap = Math.abs(d - s.start);
				if (gap < bestD) {
					bestD = gap;
					best = d;
				}
				if (d > s.start + 4) break;
			}
			return best;
		});

		this.rmsScale = 1 / percentile(g.waveform.rms, 0.95);
		this.labelIdx = new Map(g.sections.labels.map((l, i) => [l, i]));

		this.punch = new Float32Array(this.voices.length);
		this.onsetPtr = this.voices.map(() => 0);
		this.onsetTimes = this.voices.map((v) => v.features.onsets.map((o) => o.t));
		this.sig = this.voices.map((v) => ({
			stem: v.stem,
			role: v.role,
			level: 0,
			punch: 0,
			bright: 0,
			bands: new Float32Array(5),
			share: v.share,
		}));
	}

	/** recent onsets of one role, for ripples on the floor. Allocation-free
	 *  lookup: the per-voice time arrays are built once in the constructor. */
	recentOnsets(role: string, t: number, n = 12): { age: number; strength: number }[] {
		let vi = this.voices.findIndex((x) => x.role === role);
		if (vi < 0) vi = 0;
		const os = this.voices[vi].features.onsets;
		const last = lowerBound(this.onsetTimes[vi], t);
		const out: { age: number; strength: number }[] = [];
		for (let i = last; i >= 0 && out.length < n; i--) out.push({ age: t - os[i].t, strength: os[i].strength });
		return out;
	}

	sample(t: number): Signals {
		let dt = t - this.lastT;
		const seeked = dt < 0 || dt > 0.75;
		if (seeked) {
			this.punch.fill(0);
			this.voices.forEach((v, i) => {
				let p = 0;
				while (p < v.features.onsets.length && v.features.onsets[p].t < t) p++;
				this.onsetPtr[i] = p;
			});
			dt = 0;
		}
		this.lastT = t;

		const g = this.g;
		const decay = Math.exp(-PUNCH_DECAY * dt);
		const stemsFps = g.stems.rms_frame_rate;
		const bandFps = g.stems.energy_frame_rate;

		for (let i = 0; i < this.voices.length; i++) {
			const v = this.voices[i];
			this.punch[i] *= decay;
			const os = v.features.onsets;
			while (this.onsetPtr[i] < os.length && os[this.onsetPtr[i]].t <= t) {
				this.punch[i] = Math.min(1.6, this.punch[i] + os[this.onsetPtr[i]].strength);
				this.onsetPtr[i]++;
			}
			const s = this.sig[i];
			s.level = Math.min(1.3, sampleLerp(v.features.rms, stemsFps, t) * v.rmsScale);
			s.punch = this.punch[i];
			for (let b = 0; b < 5; b++)
				s.bands[b] = Math.min(1.3, sampleLerp(v.features.energy[BAND_ORDER[b]], bandFps, t) * v.bandScale[b]);
			s.bright = Math.min(1, sampleLerp(v.features.centroid, bandFps, t) / 6000);
		}

		// wobble comes from the isolated bass layer, so it is the real LFO
		const wobRate = sampleLerp(g.wobble.rate_hz, g.wobble.frame_rate, t);
		const wobDepth = sampleLerp(g.wobble.depth, g.wobble.frame_rate, t);
		this.wobPhase += 2 * Math.PI * wobRate * dt;

		const bi = lowerBound(this.beats, t);
		const beatPhase =
			bi < 0 || bi >= this.beats.length - 1 ? 0 : (t - this.beats[bi]) / (this.beats[bi + 1] - this.beats[bi]);
		const di = lowerBound(this.downbeats, t);
		const barPhase = di < 0 ? 0 : Math.min(1, (t - this.downbeats[di]) / this.barDur);
		const phrase = di < 0 ? 0 : ((di % PHRASE_BARS) + barPhase) / PHRASE_BARS;

		const secIdx = Math.max(
			0,
			this.sections.findIndex((s) => t >= s.start && t < s.end),
		);
		const section = this.sections[secIdx] ?? this.sections[this.sections.length - 1];
		const nextIdx = this.sections.findIndex((s) => s.start > t);
		const target = nextIdx >= 0 ? this.snapped[nextIdx] : Infinity;
		const morphStart = target - 4 * this.barDur;
		const morph = Number.isFinite(target)
			? Math.max(0, Math.min(1, (t - morphStart) / (target - morphStart || 1)))
			: 0;

		const P = g.sections.label_probs;
		const pi = Math.max(0, Math.min(P.length - 1, Math.round(t * g.sections.frame_rate)));
		const probs = P[pi] ?? P[P.length - 1] ?? [];
		const sorted = [...probs].sort((a, b) => b - a);
		const ambiguity = Math.max(0, Math.min(1, 1 - ((sorted[0] ?? 1) - (sorted[1] ?? 0))));
		const dropP = probs[this.labelIdx.get("drop") ?? 2] ?? 0;

		const rms = Math.min(1.3, sampleLerp(g.waveform.rms, g.waveform.frame_rate, t) * this.rmsScale);
		const tension = sampleLerp(g.tension.curve, g.tension.frame_rate, t);

		// ── chaos on a leash ───────────────────────────────────────────────
		// rho (the regime knob) rides the tension curve: the attractor changes
		// character because the MUSIC changed character. Integration speed
		// follows loudness, so a breakdown genuinely slows the world down.
		//
		// Explicit Euler on Lorenz diverges fast at these sigma/rho values, and
		// one NaN here poisons the camera and every vertex downstream (a black
		// screen, silently). So: fixed small substeps, bounded substep count,
		// magnitude clamp, and a hard reseed if it ever leaves the reals.
		const rho = 16 + 26 * tension;
		const flow = Math.min(0.2, dt * (0.15 + 1.6 * rms) * 2.2);
		const H = 0.004;
		const steps = Math.max(1, Math.min(64, Math.ceil(flow / H)));
		const h = flow / steps;
		for (let k = 0; k < steps; k++) {
			const x = this.lz[0];
			const y = this.lz[1];
			const z = this.lz[2];
			this.lz[0] = x + h * (this.seed.sigma * (y - x));
			this.lz[1] = y + h * (x * (rho - z) - y);
			this.lz[2] = z + h * (x * y - this.seed.beta * z);
		}
		const pulseIdx = this.voices.findIndex((v) => v.role === "pulse");
		if (pulseIdx >= 0) this.lz[0] += this.punch[pulseIdx] * 0.6 * Math.min(1, dt * 60);
		const mag = Math.abs(this.lz[0]) + Math.abs(this.lz[1]) + Math.abs(this.lz[2]);
		if (!Number.isFinite(mag) || mag > 400) this.lz.set([0.9, 0.4, 12]);
		this.chaos[0] = Math.max(-1.5, Math.min(1.5, this.lz[0] / 18));
		this.chaos[1] = Math.max(-1.5, Math.min(1.5, this.lz[1] / 22));
		this.chaos[2] = Math.max(-1.5, Math.min(1.5, (this.lz[2] - rho) / 22));

		this.last = {
			time: t,
			section,
			probs,
			boundary: sampleLerp(g.sections.boundary, g.sections.frame_rate, t),
			morph,
			nextLabel: nextIdx >= 0 ? this.sections[nextIdx].label : section.label,
			phrase,
			beatPhase,
			barPhase,
			beatIndex: bi,
			downbeatIndex: di,
			beatPulse: Math.exp(-6 * beatPhase),
			barPulse: Math.exp(-3.2 * barPhase),
			rms,
			tension,
			ambiguity,
			drive: dropP * rms,
			wobblePhase: this.wobPhase,
			wobbleDepth: wobDepth,
			chaos: this.chaos,
			voices: this.sig,
		};
		return this.last;
	}
}
