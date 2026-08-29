/**
 * THE SCORE, LAID OUT IN SPACE.
 *
 * One BarSpec per bar of the track, precomputed once. The world places a gate
 * at z = -barIndex * SPACING, so flying forward at one bar per bar means the
 * camera is literally travelling through the song: what is ahead of you IS the
 * part of the track that has not played yet. The drop is a wall of structure
 * you can see coming from eight bars out — the lookahead, made visible.
 */
import { BAND_ORDER, type Genome } from "./genome";
import type { WorldSeed } from "./seed";

export interface BarSpec {
	index: number;
	t0: number;
	t1: number;
	label: string;
	/** dominant-label probability distribution at this bar */
	probs: number[];
	tension: number;
	energy: number;
	bands: Float32Array;
	onsets: number;
	/** how "drop-like" this bar is, 0..1 */
	drive: number;
	/** 0 blades · 1 cubes · 2 rings — derived, so a track's regions differ */
	style: number;
	/** kaleidoscopic fold count for this bar's gate */
	fold: number;
	/** gate radius */
	radius: number;
}

function meanAt(arr: number[] | undefined, fps: number, t0: number, t1: number): number {
	if (!arr || !arr.length) return 0;
	const a = Math.max(0, Math.floor(t0 * fps));
	const b = Math.min(arr.length - 1, Math.ceil(t1 * fps));
	if (b <= a) return arr[Math.min(arr.length - 1, a)] ?? 0;
	let sum = 0;
	for (let i = a; i <= b; i++) sum += arr[i];
	return sum / (b - a + 1);
}

export interface Gate {
	/** beat index — gates sit on the BEAT grid, so passing one is hearing one */
	beat: number;
	t: number;
	bar: number;
	down: boolean;
}

export interface Layout {
	bars: BarSpec[];
	gates: Gate[];
}

/** Place a gate on every beat and tie it to the bar it belongs to. Flying at
 *  one beat per beat is what makes the speed musical rather than arbitrary. */
export function buildLayout(g: Genome, seed: WorldSeed, sections: { label: string; start: number; end: number }[]): Layout {
	const bars = buildBars(g, seed, sections);
	const off = g.beats.onset_phase_offset ?? 0;
	const beats = g.beats.beats.map((b) => b + off);
	const downs = new Set(g.beats.downbeats.map((b) => (b + off).toFixed(3)));
	const gates: Gate[] = beats.map((t, i) => {
		let bar = 0;
		for (let k = 0; k < bars.length; k++) {
			if (t >= bars[k].t0) bar = k;
			else break;
		}
		return { beat: i, t, bar, down: downs.has(t.toFixed(3)) };
	});
	return { bars, gates };
}

export function buildBars(g: Genome, seed: WorldSeed, sections: { label: string; start: number; end: number }[]): BarSpec[] {
	const off = g.beats.onset_phase_offset ?? 0;
	const dbs = (g.beats.downbeats.length ? g.beats.downbeats : g.beats.beats).map((d) => d + off);
	if (dbs.length < 2) return [];

	const P = g.sections.label_probs;
	const fr = g.sections.frame_rate;
	const dropIdx = g.sections.labels.indexOf("drop");

	// normalize band means against the track, so gates read relatively
	const bandP95 = BAND_ORDER.map((b) => {
		const arr = [...(g.bands.energy[b] ?? [])].sort((x, y) => x - y);
		return arr[Math.floor(arr.length * 0.95)] || 1;
	});
	const rmsArr = [...g.waveform.rms].sort((a, b) => a - b);
	const rmsP95 = rmsArr[Math.floor(rmsArr.length * 0.95)] || 1;

	const bars: BarSpec[] = [];
	for (let i = 0; i < dbs.length; i++) {
		const t0 = dbs[i];
		const t1 = dbs[i + 1] ?? Math.min(g.duration, t0 + (dbs[i] - dbs[i - 1] || 2));
		const pi = Math.max(0, Math.min(P.length - 1, Math.round(((t0 + t1) / 2) * fr)));
		const probs = P[pi] ?? [];
		const sec = sections.find((s) => t0 >= s.start && t0 < s.end) ?? sections[sections.length - 1];
		const bands = new Float32Array(
			BAND_ORDER.map((b, k) => Math.min(1.4, meanAt(g.bands.energy[b], g.bands.frame_rate, t0, t1) / bandP95[k])),
		);
		const energy = Math.min(1.4, meanAt(g.waveform.rms, g.waveform.frame_rate, t0, t1) / rmsP95);
		const tension = meanAt(g.tension.curve, g.tension.frame_rate, t0, t1);
		let onsets = 0;
		for (const o of g.onsets) {
			if (o.t >= t0 && o.t < t1) onsets++;
			else if (o.t >= t1) break;
		}
		const drive = (probs[dropIdx] ?? 0) * energy;
		const label = sec?.label ?? "intro";
		// style is a property of the REGION, so you fly out of one kind of
		// architecture and into another instead of cutting between scenes
		const secIdx = Math.max(0, sections.indexOf(sec));
		const style = ((secIdx * 2654435761 + Math.floor(seed.hue * 104729)) >>> 0) % 3;
		const foldBase = seed.folds[secIdx % seed.folds.length];
		bars.push({
			index: i,
			t0,
			t1,
			label,
			probs,
			tension,
			energy,
			bands,
			onsets,
			drive,
			style,
			fold: Math.max(4, Math.min(24, foldBase + Math.round(drive * 6))),
				// wide enough that the corridor fills the frame instead of floating in it
			radius: 8.5 + 5.5 * tension - 1.8 * drive + 1.5 * bands[0],
		});
	}
	return bars;
}
