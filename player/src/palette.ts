/**
 * MONOCHROME + ONE ACCENT.
 *
 * Structure is white on black. Exactly one accent colour, derived from the
 * track hash, carries the "live" elements — impacts, the axis, the playhead.
 * Sections do NOT change hue: they change brightness, density and structure.
 * Colour stays scarce so the geometry can read. (Six competing hues is what
 * made the previous build unreadable.)
 */
import type { WorldSeed } from "./seed";

export type Rgb = [number, number, number];

export function hsv(h: number, s: number, v: number): Rgb {
	const hh = (((h % 1) + 1) % 1) * 6;
	const i = Math.floor(hh);
	const f = hh - i;
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

/** how "lit" each section is — brightness and density, never hue */
const WEIGHT: Record<string, { ink: number; accent: number }> = {
	intro: { ink: 0.55, accent: 0.15 },
	buildup: { ink: 0.8, accent: 0.45 },
	drop: { ink: 1, accent: 1 },
	breakdown: { ink: 0.6, accent: 0.2 },
	outro: { ink: 0.4, accent: 0.1 },
	silence: { ink: 0.18, accent: 0.02 },
};

export interface Ink {
	/** structure brightness 0..1 */
	ink: number;
	/** how much accent this passage earns 0..1 */
	accentAmount: number;
	accent: Rgb;
}

export function ink(seed: WorldSeed, labels: string[], probs: number[], ambiguity: number): Ink {
	let i = 0;
	let a = 0;
	let total = 0;
	labels.forEach((label, k) => {
		const p = probs[k] ?? 0;
		if (p <= 0) return;
		const w = WEIGHT[label] ?? WEIGHT.silence;
		i += w.ink * p;
		a += w.accent * p;
		total += p;
	});
	if (total > 0.001) {
		i /= total;
		a /= total;
	}
	// on an ambiguous passage the accent drifts toward its complement, so a
	// tease drop reads as a colour that cannot decide
	return { ink: i, accentAmount: a, accent: hsv(seed.hue + ambiguity * seed.accentShift, 0.95, 1) };
}

export function cssColor([r, g, b]: Rgb, alpha = 1): string {
	const c = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255);
	return `rgba(${c(r)},${c(g)},${c(b)},${alpha})`;
}
