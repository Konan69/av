/**
 * THE HARMONY — which chord each bar holds, read from the stems' chroma.
 *
 * The renderer draws the chord as a 3D Lissajous figure: the chord's
 * just-intonation ratios become the figure's x/y/z frequencies, so a consonant
 * triad draws a simple knot and a tense voicing a dense one, and the root turns
 * the figure. This is an artistic mapping of harmony into shape, not a claim
 * that the figure is what the chord "looks like" physically.
 *
 * Chords change only on downbeats (a bar is the smallest harmonic unit); the
 * morph to the next bar's chord gathers over that bar's last half beat and
 * lands on the downbeat. Sampling is a pure lookup, so seeks reproduce the same pose.
 */
import type { Chroma, Genome } from "./genome";
import type { WorldSeed } from "./seed";
import type { Voice } from "./voices";

export interface Chord {
	/** pitch class of the root, C = 0 */
	root: number;
	/** intervals above the root in semitones, starting with 0 */
	tones: number[];
	/** small-integer x/y/z frequencies for the figure */
	ratios: [number, number, number];
	label: string;
	/** 0..1 tonal clarity of this bar, normalised over the track */
	clarity: number;
	/** false when the genome has no chroma and the chord is a section fallback */
	observed: boolean;
}

export interface HarmonySignal {
	current: Chord;
	next: Chord;
	/** eased 0..1, completes on the next downbeat */
	blend: number;
	barIndex: number;
}

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
/** 5-limit just intonation, with the harmonic 7th for the minor seventh. */
const JUST: [number, number][] = [[1, 1], [16, 15], [9, 8], [6, 5], [5, 4], [4, 3], [7, 5], [3, 2], [8, 5], [5, 3], [7, 4], [15, 8]];
const MAX_FREQUENCY = 16;

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** Chord tones -> the smallest integer frequencies that keep their ratios.
 * Voicings whose exact ratios need numbers above 16 are approximated on the
 * base that loses the least, so a cluster still draws a readable (dense) knot. */
export function figureRatios(tones: number[]): [number, number, number] {
	const ratios = tones.slice(0, 3).map((t) => JUST[((t % 12) + 12) % 12]);
	if (ratios.length === 1) return [1, 2, 3];
	if (ratios.length === 2) ratios.push([2, 1]);
	const lcm = ratios.reduce((l, [, d]) => (l * d) / gcd(l, d), 1);
	let exact = ratios.map(([n, d]) => (n * lcm) / d);
	const common = exact.reduce((a, b) => gcd(a, b));
	exact = exact.map((v) => v / common);
	if (Math.max(...exact) <= MAX_FREQUENCY) return exact as [number, number, number];
	let best: number[] = [1, 2, 3];
	let bestError = Infinity;
	for (let base = 2; base <= 8; base++) {
		const values = ratios.map(([n, d]) => (base * n) / d);
		const rounded = values.map(Math.round);
		if (new Set(rounded).size < rounded.length) continue;
		const error = values.reduce((sum, v, i) => sum + Math.abs(v - rounded[i]) / v, 0);
		if (error < bestError) {
			bestError = error;
			best = rounded;
		}
	}
	return best as [number, number, number];
}

function chordLabel(root: number, tones: number[]): string {
	const has = (i: number) => tones.includes(i);
	const quality = has(4) && has(7) ? "" : has(3) && has(7) ? "m" : has(3) && has(6) ? "dim" : has(4) && has(8) ? "aug"
		: has(5) && has(7) ? "sus4" : has(2) && has(7) ? "sus2" : has(7) && tones.length === 2 ? "5"
		: tones.length === 1 ? "" : `(${tones.slice(1).join(",")})`;
	return NAMES[root] + quality;
}

export function makeChord(root: number, tones: number[], clarity: number, observed: boolean): Chord {
	const sorted = [...new Set([0, ...tones.map((t) => ((t % 12) + 12) % 12)])].sort((a, b) => a - b).slice(0, 3);
	return { root: ((root % 12) + 12) % 12, tones: sorted, ratios: figureRatios(sorted), label: chordLabel(root, sorted), clarity, observed };
}

interface Source {
	chroma: Chroma;
	/** loudness of the layer at time t, 0..~1.3 */
	level: (t: number) => number;
	weight: number;
}

/** Accelerating arrival: most of the change happens at the downbeat itself. */
const land = (v: number) => {
	const x = Math.max(0, Math.min(1, v));
	return x * x * x;
};

function lerp(values: number[], fps: number, t: number): number {
	if (!values.length) return 0;
	const x = Math.max(0, t * fps), i = Math.min(values.length - 1, Math.floor(x));
	return values[i] + ((values[i + 1] ?? values[i]) - values[i]) * (x - i);
}

/** Accumulate strength x loudness weighted chroma over [start, end). */
function profile(sources: Source[], start: number, end: number): { bins: Float64Array; weight: number } {
	const bins = new Float64Array(12);
	let weight = 0;
	for (const s of sources) {
		const fps = s.chroma.frame_rate;
		const first = Math.max(0, Math.ceil(start * fps)), last = Math.min(s.chroma.bins.length - 1, Math.ceil(end * fps) - 1);
		for (let f = first; f <= last; f++) {
			const w = s.weight * (s.chroma.strength[f] ?? 0) * Math.min(1.3, s.level(f / fps));
			if (w <= 0) continue;
			const row = s.chroma.bins[f];
			for (let k = 0; k < 12; k++) bins[k] += w * row[k];
			weight += w;
		}
	}
	return { bins, weight };
}

function fallbackChord(label: string, seed: WorldSeed | undefined): Chord {
	const root = Math.floor((seed?.hue ?? 0) * 12);
	const tones = /drop|chorus/i.test(label) ? [0, 3, 7] : /build|rise/i.test(label) ? [0, 5, 7]
		: /break|verse/i.test(label) ? [0, 4, 7] : [0, 7];
	return makeChord(root, tones, 0, false);
}

export class HarmonyScore {
	/** one chord per bar; bar i spans downbeats[i]..downbeats[i+1] */
	readonly chords: Chord[] = [];
	readonly observed: boolean;
	private starts: number[];

	constructor(
		g: Genome,
		voices: Voice[],
		downbeats: number[],
		private beats: number[],
		sectionAt: (t: number) => string,
		seed?: WorldSeed,
	) {
		const bars = downbeats.length ? downbeats : [0];
		this.starts = bars;
		const levelOf = (v: Voice) => (t: number) => lerp(v.features.rms, g.stems.rms_frame_rate, t) * v.rmsScale;
		const harmonic: Source[] = [], bass: Source[] = [];
		for (const v of voices) {
			const chroma = v.features.chroma;
			// Stems are what they are; roles are only the visual cast. Drums never vote.
			if (!chroma || v.stem === "drums") continue;
			if (v.stem === "bass") bass.push({ chroma, level: levelOf(v), weight: 1 });
			else harmonic.push({ chroma, level: levelOf(v), weight: v.stem === "vocals" ? 0.5 : 1 });
		}
		if (!harmonic.length && g.chroma) {
			const mixScale = 1 / Math.max(1e-6, [...g.waveform.rms].sort((a, b) => a - b)[Math.floor(g.waveform.rms.length * 0.95)] ?? 1);
			harmonic.push({ chroma: g.chroma, level: (t) => lerp(g.waveform.rms, g.waveform.frame_rate, t) * mixScale, weight: 1 });
		}
		this.observed = harmonic.length + bass.length > 0;
		const ends = bars.map((b, i) => bars[i + 1] ?? g.duration);
		if (!this.observed) {
			for (let i = 0; i < bars.length; i++) this.chords.push(fallbackChord(sectionAt((bars[i] + ends[i]) / 2), seed));
			return;
		}
		const raw = bars.map((start, i) => {
			const h = profile(harmonic, start, ends[i]);
			const b = profile(bass, start, ends[i]);
			return { h, b, density: (h.weight + b.weight) / Math.max(1e-6, ends[i] - start) };
		});
		// Clarity is relative to this track: DnB mixes are far less tonal than
		// a piano ballad, and the figure should still read which bars are clearest.
		const densities = raw.map((r) => r.density).sort((a, b) => a - b);
		const reference = densities[Math.floor(densities.length * 0.9)] || 1;
		let previous: Chord | null = null;
		for (let i = 0; i < raw.length; i++) {
			const { h, b, density } = raw[i];
			const clarity = Math.min(1, density / reference);
			if (h.weight + b.weight <= 1e-9) {
				// A bar with no audible harmony holds the last chord; the figure dims.
				const held: Chord = previous ? { ...previous, clarity: 0 } : fallbackChord(sectionAt(bars[i]), seed);
				this.chords.push(held);
				continue;
			}
			const combined = new Float64Array(12);
			const hMax = Math.max(1e-9, ...h.bins), bMax = Math.max(1e-9, ...b.bins);
			for (let k = 0; k < 12; k++) combined[k] = (h.weight > 0 ? h.bins[k] / hMax : 0) + (b.weight > 0 ? 0.6 * b.bins[k] / bMax : 0);
			const argmax = (xs: ArrayLike<number>) => { let best = 0; for (let k = 1; k < 12; k++) if (xs[k] > xs[best]) best = k; return best; };
			// The isolated bass names the root when it is clearly present.
			const root = b.weight > 0.25 * h.weight ? argmax(b.bins) : argmax(combined);
			const peak = Math.max(...combined);
			const candidates = Array.from({ length: 11 }, (_, j) => j + 1)
				// Semitones, tritones and major sevenths need strong evidence: in a dense mix they
				// are usually passing tones or noise, and they draw needlessly dense knots.
				.filter((j) => combined[(root + j) % 12] >= ([1, 6, 11].includes(j) ? 0.85 : 0.6) * peak)
				.sort((x, y) => combined[(root + y) % 12] - combined[(root + x) % 12])
				.slice(0, 2);
			const chord = makeChord(root, [0, ...candidates], clarity, true);
			this.chords.push(chord);
			previous = chord;
		}
	}

	private barAt(t: number): number {
		let lo = 0, hi = this.starts.length - 1, ans = 0;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (this.starts[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
		}
		return ans;
	}

	sample(t: number): HarmonySignal {
		const i = this.barAt(t);
		const current = this.chords[i];
		const next = this.chords[i + 1] ?? current;
		const end = this.starts[i + 1];
		if (next === current || end === undefined || t < this.starts[i]) return { current, next, blend: 0, barIndex: i };
		// The new chord gathers over the bar's actual last half beat and snaps into place on the downbeat.
		let lo = 0, hi = this.beats.length - 1, last = -1;
		while (lo <= hi) { const mid = (lo + hi) >> 1; if (this.beats[mid] < end - 1e-6) { last = mid; lo = mid + 1; } else hi = mid - 1; }
		const lastBeat = last >= 0 && this.beats[last] > this.starts[i] ? this.beats[last] : end - (end - this.starts[i]) / 4;
		const start = Math.max(this.starts[i], end - (end - lastBeat) * 0.5);
		return { current, next, blend: land((t - start) / Math.max(1e-6, end - start)), barIndex: i };
	}
}
