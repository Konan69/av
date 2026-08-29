/**
 * Colour is the TRACK's, not the app's. The base hue comes from the genome
 * hash, so every track owns a colour identity; sections shift within it, and
 * because the shift is blended by PROBABILITY, an ambiguous passage literally
 * wavers between two colours instead of snapping.
 */
import type { WorldSeed } from "./seed";

export type Rgb = [number, number, number];

interface Profile {
	shift: number; // hue rotation from the track's base hue
	sat: number;
	val: number;
}

const PROFILES: Record<string, Profile> = {
	intro: { shift: -0.03, sat: 0.6, val: 0.5 },
	buildup: { shift: 0.08, sat: 0.85, val: 0.8 },
	drop: { shift: 0, sat: 0.95, val: 1 }, // + seed.accentShift, applied below
	breakdown: { shift: -0.14, sat: 0.5, val: 0.55 },
	outro: { shift: -0.07, sat: 0.45, val: 0.4 },
	silence: { shift: 0, sat: 0.1, val: 0.12 },
};

function hsv(h: number, s: number, v: number): Rgb {
	const i = Math.floor(((h % 1) + 1) % 1 * 6);
	const f = ((h % 1) + 1) % 1 * 6 - i;
	const p = v * (1 - s);
	const q = v * (1 - f * s);
	const t = v * (1 - (1 - f) * s);
	switch (i % 6) {
		case 0:
			return [v, t, p];
		case 1:
			return [q, v, p];
		case 2:
			return [p, v, t];
		case 3:
			return [p, q, v];
		case 4:
			return [t, p, v];
		default:
			return [v, p, q];
	}
}

export interface Palette {
	body: Rgb;
	accent: Rgb;
	haze: Rgb;
}

/** probability-weighted palette for this instant */
export function palette(seed: WorldSeed, labels: string[], probs: number[]): Palette {
	const body: Rgb = [0, 0, 0];
	const accent: Rgb = [0, 0, 0];
	let sat = 0;
	let val = 0;
	labels.forEach((label, i) => {
		const p = probs[i] ?? 0;
		if (p <= 0) return;
		const prof = PROFILES[label] ?? PROFILES.silence;
		const shift = prof.shift + (label === "drop" ? seed.accentShift * 0.5 : 0);
		const c = hsv(seed.hue + shift, prof.sat, prof.val);
		const a = hsv(seed.hue + shift + seed.accentShift, Math.min(1, prof.sat * 0.9), prof.val);
		for (let k = 0; k < 3; k++) {
			body[k] += c[k] * p;
			accent[k] += a[k] * p;
		}
		sat += prof.sat * p;
		val += prof.val * p;
	});
	const haze = hsv(seed.hue - 0.02, Math.min(1, sat * 0.7), val * 0.12);
	return { body, accent, haze };
}

/** stable per-track colour for a voice, spread around the accent wheel */
export function voiceColor(seed: WorldSeed, index: number, count: number): Rgb {
	return hsv(seed.hue + seed.accentShift * (index / Math.max(1, count - 1)) * 1.6, 0.8, 1);
}

export function cssColor([r, g, b]: Rgb, alpha = 1): string {
	const c = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255);
	return `rgba(${c(r)},${c(g)},${c(b)},${alpha})`;
}
