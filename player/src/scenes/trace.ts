/** TRACE — the track's anatomy, drawn. One oscilloscope lane per discovered
 *  voice, scrolling through a window of its OWN separated stem, with a tick at
 *  every onset it fired. This is the scene that literally shows what the author
 *  hears: the layers, side by side, as measurement. */
import * as THREE from "three";
import type { Conductor } from "../conductor";
import type { Ctx, Scene } from "./types";

const COLS = 240; // samples across the window
const WINDOW = 5.5; // seconds visible
const WIDTH = 17;
const LANE_H = 1.55;

export function makeTrace(_seed: unknown, conductor: Conductor): Scene {
	const voices = conductor.voices;
	const lanes = voices.length;
	const segs = lanes * (COLS - 1);
	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(segs * 2 * 3), 3));
	geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(segs * 2 * 3), 3));
	const wave = new THREE.LineSegments(
		geo,
		new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }),
	);

	const MAXTICK = 160;
	const tg = new THREE.BufferGeometry();
	tg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAXTICK * 2 * 3), 3));
	tg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAXTICK * 2 * 3), 3));
	const ticks = new THREE.LineSegments(
		tg,
		new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }),
	);

	// the playhead rail: a fixed vertical line the waveform scrolls past
	const rg = new THREE.BufferGeometry();
	const top = (lanes / 2) * LANE_H + 1.2;
	rg.setAttribute(
		"position",
		new THREE.Float32BufferAttribute([0, 2.4 - top, 0.02, 0, 2.4 + top, 0.02], 3),
	);
	const rail = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ transparent: true, depthWrite: false }));

	const root = new THREE.Group();
	root.add(wave, ticks, rail);
	for (const o of [wave, ticks, rail]) o.frustumCulled = false;

	const accent = new THREE.Color();

	return {
		name: "TRACE",
		object: root,
		update(ctx: Ctx) {
			const { s, ink, ctl, weight } = ctx;
			accent.setRGB(ink.accent[0], ink.accent[1], ink.accent[2]);
			const t = s.time;
			const fps = conductor.g.stems.rms_frame_rate;

			const wp = geo.getAttribute("position") as THREE.BufferAttribute;
			const wc = geo.getAttribute("color") as THREE.BufferAttribute;
			const wpos = wp.array as Float32Array;
			const wcol = wc.array as Float32Array;
			let w = 0;
			for (let li = 0; li < lanes; li++) {
				const v = voices[li];
				const sig = s.voices[li];
				const baseY = 2.4 + ((lanes - 1) / 2 - li) * LANE_H;
				const gain = LANE_H * 0.42 * v.rmsScale * (v.role === "pulse" ? ctl.bass : 1);
				const lit = Math.min(1.3, (0.12 + 0.75 * ink.ink) * (0.35 + 0.9 * sig.level) + 0.7 * sig.punch) * weight;
				let px = 0;
				let py = 0;
				for (let i = 0; i < COLS; i++) {
					const f = i / (COLS - 1);
					const tt = t + (f - 0.5) * WINDOW; // now sits at the centre rail
					const idx = Math.round(tt * fps);
					const raw = idx >= 0 && idx < v.features.rms.length ? v.features.rms[idx] : 0;
					const x = (f - 0.5) * WIDTH;
					// the future half is drawn dimmer — you can SEE the drop coming
					const y = baseY + Math.min(LANE_H * 0.5, raw * gain);
					if (i > 0) {
						const ahead = f > 0.5 ? 0.35 : 1;
						const c = lit * ahead;
						const useAcc = f <= 0.5 && sig.punch > 0.3;
						for (const [ax, ay] of [
							[px, py],
							[x, y],
						]) {
							wpos[w * 3] = ax;
							wpos[w * 3 + 1] = ay;
							wpos[w * 3 + 2] = 0;
							wcol[w * 3] = useAcc ? accent.r * c : c;
							wcol[w * 3 + 1] = useAcc ? accent.g * c : c;
							wcol[w * 3 + 2] = useAcc ? accent.b * c : c;
							w++;
						}
					}
					px = x;
					py = y;
				}
			}
			wp.needsUpdate = true;
			wc.needsUpdate = true;

			// onset ticks, per lane, inside the window
			const tp = tg.getAttribute("position") as THREE.BufferAttribute;
			const tc = tg.getAttribute("color") as THREE.BufferAttribute;
			const tpos = tp.array as Float32Array;
			const tcol = tc.array as Float32Array;
			tpos.fill(0);
			tcol.fill(0);
			let k = 0;
			for (let li = 0; li < lanes && k < MAXTICK; li++) {
				const v = voices[li];
				const baseY = 2.4 + ((lanes - 1) / 2 - li) * LANE_H;
				for (const o of v.features.onsets) {
					if (o.t < t - WINDOW / 2) continue;
					if (o.t > t + WINDOW / 2) break;
					if (k >= MAXTICK) break;
					const f = (o.t - (t - WINDOW / 2)) / WINDOW;
					const x = (f - 0.5) * WIDTH;
					const h = 0.12 + 0.5 * o.strength;
					const past = o.t <= t;
					const c = (past ? 1 : 0.3) * weight * (0.4 + 0.6 * ink.ink);
					for (const y of [baseY - h * 0.55, baseY + h * 0.55]) {
						tpos[k * 3] = x;
						tpos[k * 3 + 1] = y;
						tpos[k * 3 + 2] = 0.01;
						tcol[k * 3] = past ? accent.r * c : c;
						tcol[k * 3 + 1] = past ? accent.g * c : c;
						tcol[k * 3 + 2] = past ? accent.b * c : c;
						k++;
					}
				}
			}
			tp.needsUpdate = true;
			tc.needsUpdate = true;

			const rm = rail.material as THREE.LineBasicMaterial;
			rm.color.setRGB(accent.r, accent.g, accent.b);
			rm.opacity = (0.35 + 0.5 * s.beatPulse) * weight;
			(wave.material as THREE.LineBasicMaterial).opacity = weight;
			(ticks.material as THREE.LineBasicMaterial).opacity = weight;
		},
		camera(ctx: Ctx) {
			const { s } = ctx;
			return {
				pos: [s.chaos[0] * 0.5, 2.4 + s.chaos[2] * 0.25, 11.5 - 1.2 * s.tension],
				look: [0, 2.4, 0],
				fov: 46 + 4 * s.tension,
			};
		},
		dispose() {
			geo.dispose();
			tg.dispose();
			rg.dispose();
		},
	};
}
