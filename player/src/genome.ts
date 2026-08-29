/** genome.json v3 — see genome/SCHEMA.md. Everything observed, nothing imposed. */

export interface Section {
	label: string;
	start: number;
	end: number;
}

export const BAND_ORDER = ["sub", "low", "mid", "high", "air"] as const;
export type Band = (typeof BAND_ORDER)[number];

/** htdemucs_6s source order */
export const STEM_ORDER = ["drums", "bass", "other", "vocals", "guitar", "piano"] as const;
export type Stem = (typeof STEM_ORDER)[number];

export interface Onset {
	t: number;
	strength: number;
	band: string;
}

export interface Wobble {
	frame_rate: number;
	rate_hz: number[];
	depth: number[];
}

export interface StemFeatures {
	rms: number[]; // @ stems.rms_frame_rate
	energy: Record<string, number[]>; // 5 bands @ stems.energy_frame_rate
	centroid: number[]; // Hz @ stems.energy_frame_rate
	onsets: Onset[];
	wobble: Wobble;
}

export interface Genome {
	version: number;
	track_sha256: string;
	source_filename: string;
	duration: number;
	sections: {
		hard: Section[];
		frame_rate: number;
		labels: string[];
		label_probs: number[][];
		boundary: number[];
	};
	beats: {
		bpm: number | null;
		beats: number[];
		downbeats: number[];
		onset_phase_offset?: number;
	};
	waveform: { frame_rate: number; rms: number[]; peak: number[]; crest: number[] };
	bands: {
		frame_rate: number;
		names: string[];
		energy: Record<string, number[]>;
		flux: Record<string, number[]>;
		centroid: number[];
	};
	onsets: Onset[];
	wobble: Wobble;
	tension: { frame_rate: number; curve: number[] };
	stems: {
		model: string;
		names: string[];
		rms_frame_rate: number;
		energy_frame_rate: number;
		bands: string[];
		per_stem: Record<string, StemFeatures>;
	};
	analyzers: string[];
}

/** Hard requirement: a v3 genome with all six stems. No silent degradation. */
export function assertGenome(g: unknown): Genome {
	const x = g as Genome;
	if (!x || typeof x !== "object") throw new Error("genome: not an object");
	if (x.version !== 3) throw new Error(`genome: version ${String(x.version)} (need 3 — re-analyze)`);
	if (!x.stems?.per_stem) throw new Error("genome: no stems");
	for (const s of STEM_ORDER) if (!x.stems.per_stem[s]) throw new Error(`genome: missing stem "${s}"`);
	if (!x.beats?.beats?.length) throw new Error("genome: no beat grid");
	if (!x.sections?.label_probs?.length) throw new Error("genome: no section curves");
	return x;
}
