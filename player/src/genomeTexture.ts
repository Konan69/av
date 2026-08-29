/**
 * THE TRACK AS A TEXTURE — our unfair advantage over every realtime visualizer.
 *
 * Vortexia uploads the current 128-bin FFT to the GPU each frame. We can do
 * something none of them can: we have the WHOLE track in advance, so we upload
 * ALL of it once and let shaders sample any moment — including moments that
 * have not happened yet.
 *
 * That turns "the engine knows a drop is coming 8 bars early" from a claim into
 * geometry: the top of the vessel is the next four bars, the horizon of the
 * field is energy still approaching. Anticipation becomes something you can
 * see arriving.
 *
 * Layout — rows are voices, columns are time:
 *   rows 0..5   one per discovered voice: R=level  G=sub  B=mid  A=air
 *   row  6      R=tension  G=rms  B=ambiguity  A=drop probability
 *   row  7      R=onset density (strike)  G=wobble depth  B=boundary  A=beat
 */
import * as THREE from "three";
import { BAND_ORDER, type Genome } from "./genome";
import type { Voice } from "./voices";

export const GENOME_W = 2048;
export const GENOME_ROWS = 8;

function sampler(arr: number[] | undefined, fps: number) {
	return (t: number) => {
		if (!arr || !arr.length) return 0;
		const x = t * fps;
		const i = Math.floor(x);
		if (i < 0) return arr[0];
		if (i >= arr.length - 1) return arr[arr.length - 1];
		return arr[i] + (arr[i + 1] - arr[i]) * (x - i);
	};
}

const byte = (x: number) => Math.max(0, Math.min(255, Math.round(x * 255)));

export function buildGenomeTexture(g: Genome, voices: Voice[]): THREE.DataTexture {
	const data = new Uint8Array(GENOME_W * GENOME_ROWS * 4);
	const dur = g.duration || 1;

	voices.slice(0, 6).forEach((v, row) => {
		const rms = sampler(v.features.rms, g.stems.rms_frame_rate);
		const bands = BAND_ORDER.map((b, i) => ({
			s: sampler(v.features.energy[b], g.stems.energy_frame_rate),
			k: v.bandScale[i],
		}));
		for (let x = 0; x < GENOME_W; x++) {
			const t = (x / (GENOME_W - 1)) * dur;
			const o = (row * GENOME_W + x) * 4;
			data[o] = byte(rms(t) * v.rmsScale);
			data[o + 1] = byte(bands[0].s(t) * bands[0].k);
			data[o + 2] = byte(bands[2].s(t) * bands[2].k);
			data[o + 3] = byte(bands[4].s(t) * bands[4].k);
		}
	});

	const tension = sampler(g.tension.curve, g.tension.frame_rate);
	const rms = sampler(g.waveform.rms, g.waveform.frame_rate);
	const boundary = sampler(g.sections.boundary, g.sections.frame_rate);
	const wob = sampler(g.wobble.depth, g.wobble.frame_rate);
	const dropIdx = Math.max(0, g.sections.labels.indexOf("drop"));
	const P = g.sections.label_probs;
	const pAt = (t: number) => P[Math.max(0, Math.min(P.length - 1, Math.round(t * g.sections.frame_rate)))] ?? [];

	// onset density of the strike voice, in a 100ms window
	const strike = voices.find((v) => v.role === "strike") ?? voices[0];
	const onsets = strike?.features.onsets ?? [];
	let ptr = 0;
	const density = new Float32Array(GENOME_W);
	for (let x = 0; x < GENOME_W; x++) {
		const t = (x / (GENOME_W - 1)) * dur;
		let n = 0;
		while (ptr < onsets.length && onsets[ptr].t < t - 0.05) ptr++;
		for (let i = ptr; i < onsets.length && onsets[i].t < t + 0.05; i++) n += onsets[i].strength;
		density[x] = Math.min(1, n);
	}

	const rmsScale = 1 / (Math.max(...g.waveform.rms.slice(0, 20000)) || 1);
	for (let x = 0; x < GENOME_W; x++) {
		const t = (x / (GENOME_W - 1)) * dur;
		const probs = pAt(t);
		const sorted = [...probs].sort((a, b) => b - a);
		const amb = Math.max(0, Math.min(1, 1 - ((sorted[0] ?? 1) - (sorted[1] ?? 0))));
		let o = (6 * GENOME_W + x) * 4;
		data[o] = byte(tension(t));
		data[o + 1] = byte(rms(t) * rmsScale);
		data[o + 2] = byte(amb);
		data[o + 3] = byte(probs[dropIdx] ?? 0);
		o = (7 * GENOME_W + x) * 4;
		data[o] = byte(density[x]);
		data[o + 1] = byte(wob(t));
		data[o + 2] = byte(boundary(t));
		data[o + 3] = 0;
	}

	const tex = new THREE.DataTexture(data, GENOME_W, GENOME_ROWS, THREE.RGBAFormat);
	tex.minFilter = THREE.LinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.wrapS = THREE.ClampToEdgeWrapping;
	tex.wrapT = THREE.ClampToEdgeWrapping;
	tex.generateMipmaps = false;
	tex.needsUpdate = true;
	return tex;
}
