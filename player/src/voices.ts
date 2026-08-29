/**
 * VOICE DISCOVERY — the part that makes a track its own world.
 *
 * We never say "kick -> pulse". We measure the six separated stems and let
 * THIS track decide who plays which visual role:
 *
 *   PULSE     the body. lowest-weighted, most sustained bottom end
 *   STRIKE    the flashes. densest, sharpest transients
 *   FILAMENT  the ear candy. brightest spectral centroid
 *   FIELD     the atmosphere. most sustained energy, fewest attacks
 *   EXTRA     anything else with real presence gets its own hoop anyway
 *
 * A dnb tune and a future-bass tune produce different castings, so the same
 * engine renders two different worlds. Stems below the presence floor are
 * dropped entirely — a track with no piano has no piano voice.
 */
import { BAND_ORDER, type Genome, type StemFeatures } from "./genome";

export type Role = "pulse" | "strike" | "filament" | "field" | "extra";

export interface Voice {
	stem: string;
	role: Role;
	/** share of total measured energy across stems, 0..1 */
	share: number;
	/** onsets per second */
	onsetRate: number;
	/** mean spectral centroid in Hz while the stem is audible */
	brightness: number;
	/** fraction of the stem's energy sitting in sub+low */
	lowRatio: number;
	/** p95 of this stem's rms — used to normalize levels to 0..1 */
	rmsScale: number;
	/** per-band p95 scales */
	bandScale: Float32Array;
	features: StemFeatures;
}

const PRESENCE_FLOOR = 0.02; // below 2% of total energy the stem is silence

function percentile(xs: number[], p: number): number {
	if (!xs.length) return 1;
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor(s.length * p))] || 1;
}

function mean(xs: number[]): number {
	if (!xs.length) return 0;
	let t = 0;
	for (const x of xs) t += x;
	return t / xs.length;
}

export function discoverVoices(g: Genome): Voice[] {
	const { per_stem, energy_frame_rate } = g.stems;
	const names = g.stems.names.filter((n) => per_stem[n]);

	const raw = names.map((stem) => {
		const f = per_stem[stem];
		const energy = mean(f.rms);
		const bandMeans = BAND_ORDER.map((b) => mean(f.energy[b] ?? []));
		const bandTotal = bandMeans.reduce((a, b) => a + b, 0) || 1;
		const audible = f.centroid.filter((_, i) => (f.rms[i * 2] ?? 0) > 0.005);
		return {
			stem,
			features: f,
			energy,
			onsetRate: f.onsets.length / Math.max(1, g.duration),
			brightness: mean(audible.length ? audible : f.centroid),
			lowRatio: (bandMeans[0] + bandMeans[1]) / bandTotal,
			rmsScale: 1 / percentile(f.rms, 0.95),
			bandScale: new Float32Array(BAND_ORDER.map((b) => 1 / percentile(f.energy[b] ?? [], 0.95))),
		};
	});

	const totalEnergy = raw.reduce((a, r) => a + r.energy, 0) || 1;
	const present = raw
		.map((r) => ({ ...r, share: r.energy / totalEnergy }))
		.filter((r) => r.share >= PRESENCE_FLOOR)
		.sort((a, b) => b.share - a.share);
	if (!present.length) throw new Error("no audible stems in this genome");

	const maxOnsetRate = Math.max(...present.map((r) => r.onsetRate), 1e-6);
	const maxBright = Math.max(...present.map((r) => r.brightness), 1e-6);

	const unclaimed = new Set(present.map((r) => r.stem));
	const cast = new Map<string, Role>();
	const claim = (role: Role, score: (r: (typeof present)[number]) => number) => {
		let best: string | null = null;
		let bestScore = -Infinity;
		for (const r of present) {
			if (!unclaimed.has(r.stem)) continue;
			const s = score(r);
			if (s > bestScore) {
				bestScore = s;
				best = r.stem;
			}
		}
		if (best) {
			unclaimed.delete(best);
			cast.set(best, role);
		}
	};

	// order matters: the body first, then what hits, then what shimmers
	claim("pulse", (r) => r.lowRatio * 2 + r.share);
	claim("strike", (r) => (r.onsetRate / maxOnsetRate) * 2 + r.share);
	claim("filament", (r) => r.brightness / maxBright + r.share * 0.5);
	claim("field", (r) => r.share + (1 - r.onsetRate / maxOnsetRate));

	void energy_frame_rate;
	return present.map((r) => ({
		stem: r.stem,
		role: cast.get(r.stem) ?? "extra",
		share: r.share,
		onsetRate: r.onsetRate,
		brightness: r.brightness,
		lowRatio: r.lowRatio,
		rmsScale: r.rmsScale,
		bandScale: r.bandScale,
		features: r.features,
	}));
}

export function voiceByRole(voices: Voice[], role: Role): Voice | undefined {
	return voices.find((v) => v.role === role);
}
