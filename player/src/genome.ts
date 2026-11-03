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

/** Pitch-class energy, analyzer 3.1+. Absent from genomes analyzed earlier. */
export interface Chroma {
	frame_rate: number;
	pitch_classes: string[];
	/** one 12-value row per frame, each divided by its own max; zero rows when strength is 0 */
	bins: number[][];
	/** 0..1 tonal clarity x audibility per frame */
	strength: number[];
}

export interface StemFeatures {
	rms: number[]; // @ stems.rms_frame_rate
	energy: Record<string, number[]>; // 5 bands @ stems.energy_frame_rate
	centroid: number[]; // Hz @ stems.energy_frame_rate
	onsets: Onset[];
	wobble: Wobble;
	chroma?: Chroma;
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
	/** mix chroma, analyzer 3.1+ */
	chroma?: Chroma;
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

/** Validate the numerical inputs consumed by the renderer before allocating a world. */
export function assertGenome(g: unknown): Genome {
	const x = g as Genome;
	const fail = (field: string): never => { throw new Error(`genome: invalid ${field} — re-analyze this track`); };
	const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
	const rate = (value: unknown, field: string) => { if (!finite(value) || value <= 0) fail(field); };
	const numbers = (value: unknown, field: string, empty = false): number[] => {
		if (!Array.isArray(value) || (!empty && value.length === 0) || !value.every(finite)) fail(field);
		return value as number[];
	};
	const ordered = (value: unknown, field: string, empty = false) => {
		const values = numbers(value, field, empty);
		if (values.some((v, i) => v < 0 || (i > 0 && v <= values[i - 1]))) fail(field);
	};
	const bands = (value: Record<string, number[]> | undefined, field: string) => {
		for (const band of BAND_ORDER) numbers(value?.[band], `${field}.${band}`);
	};
	const wobble = (value: Wobble | undefined, field: string) => {
		rate(value?.frame_rate, `${field}.frame_rate`);
		numbers(value?.rate_hz, `${field}.rate_hz`, true);
		numbers(value?.depth, `${field}.depth`, true);
		if (value!.rate_hz.length !== value!.depth.length || value!.rate_hz.some((v) => v < 0)) fail(field);
	};
	const onsets = (value: Onset[] | undefined, field: string) => {
		if (!Array.isArray(value)) fail(field);
		for (let i = 0; i < value!.length; i++) {
			const onset = value![i];
			if (!onset || !finite(onset.t) || onset.t < 0 || !finite(onset.strength) || onset.strength < 0 ||
				typeof onset.band !== "string") fail(field);
		}
	};
	const chroma = (value: Chroma | undefined, field: string) => {
		if (value === undefined) return;
		rate(value?.frame_rate, `${field}.frame_rate`);
		const strength = numbers(value.strength, `${field}.strength`, true);
		if (!Array.isArray(value.bins) || value.bins.length !== strength.length) fail(`${field}.bins`);
		for (const row of value.bins) if (numbers(row, `${field}.bins`).length !== 12) fail(`${field}.bins width`);
	};
	if (!x || typeof x !== "object") fail("document");
	if (x.version !== 3) throw new Error(`genome: version ${String(x.version)} (need 3 — re-analyze this track)`);
	if (typeof x.track_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(x.track_sha256)) fail("track_sha256");
	rate(x.duration, "duration");
	rate(x.waveform?.frame_rate, "waveform.frame_rate");
	for (const key of ["rms", "peak", "crest"] as const) numbers(x.waveform?.[key], `waveform.${key}`);
	rate(x.bands?.frame_rate, "bands.frame_rate");
	bands(x.bands?.energy, "bands.energy"); bands(x.bands?.flux, "bands.flux");
	numbers(x.bands?.centroid, "bands.centroid");
	ordered(x.beats?.beats, "beats.beats");
	ordered(x.beats?.downbeats, "beats.downbeats", true);
	if (x.beats.bpm !== null) rate(x.beats.bpm, "beats.bpm");
	if (x.beats.onset_phase_offset !== undefined && !finite(x.beats.onset_phase_offset)) fail("beats.onset_phase_offset");
	rate(x.sections?.frame_rate, "sections.frame_rate");
	if (!Array.isArray(x.sections?.labels) || !x.sections.labels.length || x.sections.labels.some((v) => typeof v !== "string")) fail("sections.labels");
	if (!Array.isArray(x.sections.label_probs) || !x.sections.label_probs.length) fail("sections.label_probs");
	for (const row of x.sections.label_probs) {
		numbers(row, "sections.label_probs");
		if (row.length !== x.sections.labels.length) fail("sections.label_probs dimensions");
	}
	numbers(x.sections.boundary, "sections.boundary");
	if (!Array.isArray(x.sections.hard)) fail("sections.hard");
	for (let i = 0; i < x.sections.hard.length; i++) {
		const section = x.sections.hard[i];
		if (!section || typeof section.label !== "string" || !finite(section.start) || !finite(section.end) ||
			section.start < 0 || section.end <= section.start || (i > 0 && section.start < x.sections.hard[i - 1].start)) fail("sections.hard");
	}
	rate(x.tension?.frame_rate, "tension.frame_rate"); numbers(x.tension?.curve, "tension.curve");
	wobble(x.wobble, "wobble"); onsets(x.onsets, "onsets"); chroma(x.chroma, "chroma");
	rate(x.stems?.rms_frame_rate, "stems.rms_frame_rate"); rate(x.stems?.energy_frame_rate, "stems.energy_frame_rate");
	if (!Array.isArray(x.stems?.names) || STEM_ORDER.some((stem) => !x.stems.names.includes(stem))) fail("stems.names (need all six stems)");
	for (const stem of x.stems.names) {
		if (typeof stem !== "string") fail("stems.names");
		const f = x.stems.per_stem?.[stem];
		if (!f) fail(`missing stem "${stem}"`);
		numbers(f.rms, `stems.${stem}.rms`); numbers(f.centroid, `stems.${stem}.centroid`);
		bands(f.energy, `stems.${stem}.energy`); onsets(f.onsets, `stems.${stem}.onsets`);
		wobble(f.wobble, `stems.${stem}.wobble`); chroma(f.chroma, `stems.${stem}.chroma`);
	}
	return x;
}
