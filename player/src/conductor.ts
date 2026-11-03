/**
 * THE CONDUCTOR — reads the genome as a score, with lookahead.
 *
 * Three clocks, all observed:
 *   THE MAP     sections + raw label probabilities (ambiguity kept)
 *   THE GRID    beats / downbeats / phrases
 *   THE NERVES  per-VOICE rms, bands, onsets, wobble (from the stems)
 *
 * Every output is sampled at absolute audio time. Onset envelopes and wobble
 * integrals are indexed once; the music-driven trajectory is baked on a fixed
 * grid so pauses, seeks, and different render frame rates produce the same world.
 */
import type { Genome, Section } from "./genome";
import { BAND_ORDER } from "./genome";
import type { WorldSeed } from "./seed";
import { PhraseScore, type PhraseScoreSignal } from "./phraseScore";
import { discoverVoices, type Voice } from "./voices";
import { HarmonyScore, type HarmonySignal } from "./harmony";

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
	/** how many of this layer's onsets have happened by now (a hit counter, pure lookup) */
	hits: number;
	/** seconds since this layer's latest onset (large before the first) */
	since: number;
}

/** The grid in seconds, and where we are among the section's 8-bar phrases. */
export interface Clock {
	beat: number;
	bar: number;
	phraseIndex: number;
	phraseCount: number;
	phraseStart: number;
	phraseEnd: number;
	/** the section's bar start times (its start, then every observed downbeat inside it) */
	sectionBars: number[];
	/** index into sectionBars of the bar we are in */
	barInSection: number;
}

export interface Signals {
	/** Precomputed musical form; optional only for older synthetic fixtures. */
	phraseScore?: PhraseScoreSignal;
	/** bar-level chord read from the stems' chroma; optional for synthetic fixtures */
	harmony?: HarmonySignal;
	/** grid timing; optional for synthetic fixtures */
	clock?: Clock;
	time: number;
	section: Section;
	/** index into conductor.sections — scenes key their choices off this */
	sectionIndex: number;
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
	readonly phraseScore: PhraseScore;
	readonly harmony: HarmonyScore;
	/** boundary time snapped to the nearest downbeat — morphs land here */
	private snapped: number[];
	private rmsScale: number;
	private labelIdx: Map<string, number>;

	private onsetPeaks: number[][];
	private onsetTimes: number[][];
	/** last frame the render loop computed — read-only consumers use this */
	last: Signals | null = null;
	private wobIntegral: Float64Array;
	private trajectory: Float32Array;
	private readonly trajectoryFps = 120;
	private chaos = new Float32Array(3);
	private sig: VoiceSignal[];
	private sectionBars: number[][] = [];

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

		// Use the same snapped intervals for section selection and morph targets.
		// The first section covers the lead-in; collapsed intervals are omitted.
		const aligned: Section[] = [{ ...this.sections[0], start: 0 }];
		for (const section of this.sections.slice(1)) {
			let start = section.start;
			let distance = Infinity;
			for (const d of this.downbeats) {
				if (Math.abs(d - section.start) < distance) {
					start = d;
					distance = Math.abs(d - section.start);
				}
			}
			if (start <= aligned[aligned.length - 1].start || start >= g.duration) continue;
			aligned[aligned.length - 1].end = start;
			aligned.push({ ...section, start, end: g.duration });
		}
		aligned[aligned.length - 1].end = g.duration;
		this.sections = aligned;
		this.snapped = aligned.map((s) => s.start);
		this.sectionBars = this.sections.map((s) => [s.start, ...this.downbeats.filter((d) => d > s.start + 1e-6 && d < s.end - 1e-6)]);
		this.phraseScore = new PhraseScore(g, this.voices, this.sections, this.downbeats, this.barDur);
		this.harmony = new HarmonyScore(g, this.voices, this.downbeats, this.beats,
			(t) => this.sections[Math.max(0, lowerBound(this.snapped, t))]?.label ?? "intro", seed);

		this.rmsScale = 1 / percentile(g.waveform.rms, 0.95);
		this.labelIdx = new Map(g.sections.labels.map((l, i) => [l, i]));

		this.onsetPeaks = this.voices.map((v) => {
			let peak = 0;
			let previous = 0;
			return v.features.onsets.map((onset) => {
				peak = Math.min(1.6, peak * Math.exp(-PUNCH_DECAY * (onset.t - previous)) + onset.strength);
				previous = onset.t;
				return peak;
			});
		});
		this.onsetTimes = this.voices.map((v) => v.features.onsets.map((o) => o.t));
		this.sig = this.voices.map((v) => ({
			stem: v.stem,
			role: v.role,
			level: 0,
			punch: 0,
			bright: 0,
			bands: new Float32Array(5),
			share: v.share,
			hits: 0,
			since: 1e3,
		}));
		const rates = g.wobble.rate_hz;
		this.wobIntegral = new Float64Array(rates.length);
		for (let i = 1; i < rates.length; i++)
			this.wobIntegral[i] = this.wobIntegral[i - 1] + (rates[i - 1] + rates[i]) / (2 * g.wobble.frame_rate);
		this.trajectory = this.bakeTrajectory();

	}

	private onsetEnvelope(voice: number, t: number): number {
		const index = lowerBound(this.onsetTimes[voice], t);
		return index < 0 ? 0 : this.onsetPeaks[voice][index] * Math.exp(-PUNCH_DECAY * (t - this.onsetTimes[voice][index]));
	}

	private wobbleAt(t: number): number {
		const rates = this.g.wobble.rate_hz;
		if (!rates.length || this.g.wobble.frame_rate <= 0) return 0;
		const fps = this.g.wobble.frame_rate;
		const index = Math.min(rates.length - 1, Math.floor(t * fps));
		const dt = t - index / fps;
		const slope = index < rates.length - 1 ? (rates[index + 1] - rates[index]) * fps : 0;
		return 2 * Math.PI * (this.wobIntegral[index] + rates[index] * dt + slope * dt * dt / 2);
	}

	/** Fixed audio-time integration: independent of the render loop's history. */
	private bakeTrajectory(): Float32Array {
		const count = Math.ceil(this.g.duration * this.trajectoryFps) + 1;
		const points = new Float32Array(count * 3);
		let x = 0.9, y = 0.4, z = 12;
		const pulse = this.voices.findIndex((v) => v.role === "pulse");
		for (let i = 0; i < count; i++) {
			const t = i / this.trajectoryFps;
			const tension = sampleLerp(this.g.tension.curve, this.g.tension.frame_rate, t);
			const rho = 16 + 26 * tension;
			points[i * 3] = Math.max(-1.5, Math.min(1.5, x / 18));
			points[i * 3 + 1] = Math.max(-1.5, Math.min(1.5, y / 22));
			points[i * 3 + 2] = Math.max(-1.5, Math.min(1.5, (z - rho) / 22));
			const rms = Math.min(1.3, sampleLerp(this.g.waveform.rms, this.g.waveform.frame_rate, t) * this.rmsScale);
			const flow = rms * 3.52 / this.trajectoryFps;
			const steps = Math.max(1, Math.ceil(flow / 0.004));
			const h = flow / steps;
			for (let step = 0; step < steps; step++) {
				const dx = this.seed.sigma * (y - x), dy = x * (rho - z) - y, dz = x * y - this.seed.beta * z;
				x += h * dx; y += h * dy; z += h * dz;
			}
			if (pulse >= 0) x += this.onsetEnvelope(pulse, t) * 36 / this.trajectoryFps;
			if (!Number.isFinite(x + y + z) || Math.abs(x) + Math.abs(y) + Math.abs(z) > 400) {
				x = 0.9; y = 0.4; z = 12;
			}
		}
		return points;
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
		t = Math.max(0, Math.min(this.g.duration, Number.isFinite(t) ? t : 0));
		const g = this.g;
		const stemsFps = g.stems.rms_frame_rate;
		const bandFps = g.stems.energy_frame_rate;

		for (let i = 0; i < this.voices.length; i++) {
			const v = this.voices[i];
			const s = this.sig[i];
			s.level = Math.min(1.3, sampleLerp(v.features.rms, stemsFps, t) * v.rmsScale);
			s.punch = this.onsetEnvelope(i, t);
			const last = lowerBound(this.onsetTimes[i], t);
			s.hits = last + 1;
			s.since = last < 0 ? 1e3 : t - this.onsetTimes[i][last];
			for (let b = 0; b < 5; b++)
				s.bands[b] = Math.min(1.3, sampleLerp(v.features.energy[BAND_ORDER[b]], bandFps, t) * v.bandScale[b]);
			s.bright = Math.min(1, sampleLerp(v.features.centroid, bandFps, t) / 6000);
		}

		// wobble comes from the isolated bass layer, so it is the real LFO
		const wobDepth = sampleLerp(g.wobble.depth, g.wobble.frame_rate, t);


		const bi = lowerBound(this.beats, t);
		const beatPhase =
			bi < 0 || bi >= this.beats.length - 1 ? 0 : (t - this.beats[bi]) / (this.beats[bi + 1] - this.beats[bi]);
		const di = lowerBound(this.downbeats, t);
		const barPhase = di < 0 ? 0 : Math.min(1, (t - this.downbeats[di]) / this.barDur);
		const phrase = di < 0 ? 0 : ((di % PHRASE_BARS) + barPhase) / PHRASE_BARS;

		const secIdx = Math.max(0, lowerBound(this.snapped, t));
		const section = this.sections[secIdx];
		const nextIdx = secIdx + 1 < this.sections.length ? secIdx + 1 : -1;
		const target = nextIdx >= 0 ? this.snapped[nextIdx] : Infinity;
		// A section shorter than four bars morphs over its whole length, never starting half-done.
		const morphStart = Math.max(this.snapped[secIdx], target - 4 * this.barDur);
		const morph = Number.isFinite(target)
			? Math.max(0, Math.min(1, (t - morphStart) / (target - morphStart || 1)))
			: 0;

		// Phrases are eight downbeats counted from the section's own first downbeat.
		const firstBar = lowerBound(this.downbeats, section.start - 1e-6) + 1;
		const lastBar = lowerBound(this.downbeats, section.end - 1e-6);
		const phraseCount = Math.max(1, Math.ceil((lastBar - firstBar + 1) / PHRASE_BARS));
		const phraseIndex = di >= firstBar ? Math.min(phraseCount - 1, Math.floor((di - firstBar) / PHRASE_BARS)) : 0;
		const phraseStart = phraseIndex === 0 ? section.start : this.downbeats[firstBar + PHRASE_BARS * phraseIndex];
		const phraseEnd = Math.min(section.end, this.downbeats[firstBar + PHRASE_BARS * (phraseIndex + 1)] ?? section.end);
		const beatLength = bi >= 0 && bi < this.beats.length - 1 ? this.beats[bi + 1] - this.beats[bi] : this.barDur / 4;
		const sectionBars = this.sectionBars[secIdx] ?? [section.start];
		const barInSection = Math.max(0, lowerBound(sectionBars, t));

		const P = g.sections.label_probs;
		const pi = Math.max(0, Math.min(P.length - 1, Math.round(t * g.sections.frame_rate)));
		const probs = P[pi] ?? P[P.length - 1] ?? [];
		const sorted = [...probs].sort((a, b) => b - a);
		const ambiguity = Math.max(0, Math.min(1, 1 - ((sorted[0] ?? 1) - (sorted[1] ?? 0))));
		const dropP = probs[this.labelIdx.get("drop") ?? 2] ?? 0;

		const rms = Math.min(1.3, sampleLerp(g.waveform.rms, g.waveform.frame_rate, t) * this.rmsScale);
		const tension = sampleLerp(g.tension.curve, g.tension.frame_rate, t);

		const trajectoryTime = t * this.trajectoryFps;
		const frame = Math.min(Math.floor(trajectoryTime), this.trajectory.length / 3 - 1);
		const nextFrame = Math.min(frame + 1, this.trajectory.length / 3 - 1);
		for (let axis = 0; axis < 3; axis++) {
			const a = this.trajectory[frame * 3 + axis], b = this.trajectory[nextFrame * 3 + axis];
			this.chaos[axis] = a + (b - a) * (trajectoryTime - frame);
		}

		this.last = {
			phraseScore: this.phraseScore.sample(t),
			harmony: this.harmony.sample(t),
			clock: { beat: beatLength, bar: this.barDur, phraseIndex, phraseCount, phraseStart, phraseEnd, sectionBars, barInSection },
			time: t,
			section,
			sectionIndex: secIdx,
			probs,
			boundary: sampleLerp(g.sections.boundary, g.sections.frame_rate, t),
			morph,
			nextLabel: nextIdx >= 0 ? this.sections[nextIdx].label : section.label,
			phrase,
			beatPhase,
			barPhase,
			beatIndex: bi,
			downbeatIndex: di,
			beatPulse: bi < 0 ? 0 : Math.exp(-6 * (t - this.beats[bi]) / (this.beats[bi + 1] - this.beats[bi] || this.barDur / 4)),
			barPulse: di < 0 ? 0 : Math.exp(-3.2 * (t - this.downbeats[di]) / this.barDur),
			rms,
			tension,
			ambiguity,
			drive: dropP * rms,
			wobblePhase: this.wobbleAt(t),
			wobbleDepth: wobDepth,
			chaos: this.chaos,
			voices: this.sig,
		};
		return this.last;
	}
}
