/** VESSEL — a lathe lattice whose radial profile morphs ring/flower/starburst/
 *  spiral, one shape per 8-bar phrase, landing on the downbeat. A black
 *  occluder (colorWrite off) hides its far edges so line art reads solid —
 *  nw_wrld's CubeGrowth trick. Around it, K-fold mirrored chevrons at three
 *  counter-rotating depths: the kaleidoscope as geometry. */
import * as THREE from "three";
import { inkFrag, occluderFrag, shellFrag, shellVert, vesselVert } from "../shaders";
import type { Ctx, Scene } from "./types";

const RINGS = 13;
const SEG = 72;
const VERT_EVERY = 6;
const LAYERS = 3;
const MAX_FOLD = 18;
const SHELL_PTS = 1400;

function vesselLines(): THREE.BufferGeometry {
	const pos: number[] = [];
	for (let ri = 0; ri < RINGS; ri++) {
		const lv = ri / (RINGS - 1);
		for (let i = 0; i < SEG; i++) {
			pos.push((i / SEG) * Math.PI * 2, lv, 0, ((i + 1) / SEG) * Math.PI * 2, lv, 0);
		}
	}
	for (let i = 0; i < SEG; i += VERT_EVERY) {
		const a = (i / SEG) * Math.PI * 2;
		for (let ri = 0; ri < RINGS - 1; ri++) pos.push(a, ri / (RINGS - 1), 0, a, (ri + 1) / (RINGS - 1), 0);
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
	return g;
}

function vesselSolid(): THREE.BufferGeometry {
	const pos: number[] = [];
	for (let ri = 0; ri < RINGS - 1; ri++) {
		const l0 = ri / (RINGS - 1);
		const l1 = (ri + 1) / (RINGS - 1);
		for (let i = 0; i < SEG; i++) {
			const a = (i / SEG) * Math.PI * 2;
			const b = ((i + 1) / SEG) * Math.PI * 2;
			pos.push(a, l0, 0, b, l0, 0, b, l1, 0, a, l0, 0, b, l1, 0, a, l1, 0);
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
	return g;
}

function shellPoints(): THREE.BufferGeometry {
	const pos = new Float32Array(SHELL_PTS * 3);
	for (let i = 0; i < SHELL_PTS; i++) {
		pos[i * 3] = (i * 2.399963) % (Math.PI * 2);
		pos[i * 3 + 1] = ((i * 0.6180339887) % 1) * 0.98 + 0.01;
		pos[i * 3 + 2] = ((i * 0.7548776662) % 1) ** 1.6;
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
	return g;
}

export function makeVessel(): Scene {
	const uniforms = {
		uKindA: { value: 0 },
		uKindB: { value: 1 },
		uMorph: { value: 0 },
		uPetals: { value: 5 },
		uBands: { value: new Float32Array(5) },
		uWobPhase: { value: 0 },
		uWobDepth: { value: 0 },
		uPhase: { value: 0 },
		uPunch: { value: 0 },
		uHeight: { value: 4.2 },
		uScale: { value: 1.55 },
		uColor: { value: new THREE.Color(1, 1, 1) },
		uInk: { value: 0.8 },
	};
	const lineMat = new THREE.ShaderMaterial({
		vertexShader: vesselVert,
		fragmentShader: inkFrag,
		uniforms,
		transparent: true,
		depthWrite: false,
	});
	const occMat = new THREE.ShaderMaterial({
		vertexShader: vesselVert,
		fragmentShader: occluderFrag,
		uniforms,
		colorWrite: false,
		depthWrite: true,
		side: THREE.DoubleSide,
	});
	const shellMat = new THREE.ShaderMaterial({
		vertexShader: shellVert,
		fragmentShader: shellFrag,
		uniforms: {
			...uniforms,
			uSpread: { value: 0.35 },
			uSize: { value: 1.6 },
			uColor: { value: new THREE.Color(1, 1, 1) },
			uInk: { value: 0.5 },
		},
		transparent: true,
		depthWrite: false,
	});

	const root = new THREE.Group();
	const body = new THREE.Group();
	body.position.set(0, 2.35, 0);
	const lines = new THREE.LineSegments(vesselLines(), lineMat);
	const occ = new THREE.Mesh(vesselSolid(), occMat);
	const shell = new THREE.Points(shellPoints(), shellMat);
	occ.renderOrder = 1;
	lines.renderOrder = 2;
	shell.renderOrder = 3;
	body.add(occ, lines, shell);

	const marks = MAX_FOLD * LAYERS * 3;
	const mg = new THREE.BufferGeometry();
	mg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(marks * 2 * 3), 3));
	mg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(marks * 2 * 3), 3));
	const mandala = new THREE.LineSegments(
		mg,
		new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }),
	);
	mandala.renderOrder = 4;
	root.add(body, mandala);
	for (const o of [lines, occ, shell, mandala]) o.frustumCulled = false;

	const spins = new Float32Array(LAYERS);
	const white = new THREE.Color(1, 1, 1);
	const accent = new THREE.Color();
	const tmp = new THREE.Color();
	let phase = 0;
	let fold = 8;
	let lastSec = -1;

	return {
		name: "VESSEL",
		object: root,
		update(ctx: Ctx) {
			const { s, ink, seed, ctl, weight } = ctx;
			accent.setRGB(ink.accent[0], ink.accent[1], ink.accent[2]);
			const pulse = ctx.voice("pulse");
			const strike = ctx.voice("strike");
			const filament = ctx.voice("filament");
			const field = ctx.voice("field");
			const pu = (v: typeof pulse, g = 1) => Math.min(2, v.punch * ctl.punch * g);

			if (s.sectionIndex !== lastSec) {
				lastSec = s.sectionIndex;
				fold = seed.folds[Math.abs(s.sectionIndex) % seed.folds.length];
			}

			const di = Math.max(0, s.downbeatIndex);
			const phraseIdx = Math.floor(di / 8);
			const barsIn = (di % 8) + s.barPhase;
			const hash = (n: number) => ((n * 2654435761 + Math.floor(seed.hue * 7919)) >>> 0) % 4;
			const m = Math.max(0, Math.min(1, (barsIn - 6) / 2));
			phase += ctx.dt * (0.05 + 0.35 * Math.abs(s.chaos[0]) + 0.2 * s.tension);

			uniforms.uKindA.value = hash(phraseIdx);
			uniforms.uKindB.value = hash(phraseIdx + 1);
			uniforms.uMorph.value = m * m * (3 - 2 * m);
			uniforms.uPetals.value = 3 + (fold % 5);
			(uniforms.uBands.value as Float32Array).set(pulse.bands);
			uniforms.uWobPhase.value = s.wobblePhase;
			uniforms.uWobDepth.value = s.wobbleDepth * ctl.bass;
			uniforms.uPhase.value = phase;
			uniforms.uPunch.value = pu(pulse, ctl.bass) * 0.5;
			uniforms.uScale.value = 1.5 + 0.25 * s.tension;
			uniforms.uColor.value
				.copy(white)
				.lerp(accent, Math.min(0.85, ink.accentAmount * (0.25 + 0.75 * pu(strike))));
			uniforms.uInk.value = Math.min(1, (0.25 + 0.75 * ink.ink) * (0.6 + 0.5 * s.rms) * weight);

			const su = shellMat.uniforms;
			su.uSpread.value = 0.22 + 0.5 * filament.level + 0.3 * s.tension;
			su.uSize.value = (1.2 + 2.6 * pu(filament)) * ctl.density;
			su.uInk.value = Math.min(1, (0.12 + 0.9 * filament.level + 0.6 * pu(filament)) * weight);

			const mp = mandala.geometry.getAttribute("position") as THREE.BufferAttribute;
			const mc = mandala.geometry.getAttribute("color") as THREE.BufferAttribute;
			const mpos = mp.array as Float32Array;
			const mcol = mc.array as Float32Array;
			mpos.fill(0);
			mcol.fill(0);
			let w = 0;
			const layerVoice = [strike, field, filament];
			for (let l = 0; l < LAYERS; l++) {
				const v = layerVoice[l];
				const K = Math.max(4, Math.min(MAX_FOLD, fold + l * 2));
				const dir = l % 2 === 0 ? seed.spin : -seed.spin;
				spins[l] += ctx.dt * dir * (0.05 + 0.35 * Math.abs(s.chaos[l % 3]) + 0.2 * s.tension);
				const R = 3.4 + l * 1.5;
				const z = -l * 2.6;
				const punch = pu(v);
				const size = (0.42 + 0.5 * v.level + 0.9 * punch) * 0.9;
				const bright = Math.min(1, (0.1 + 0.7 * v.level + 1.1 * punch) * ink.ink * weight);
				tmp.copy(l === 0 && punch > 0.25 ? accent : white).multiplyScalar(bright * ctl.glow);
				for (let k = 0; k < K; k++) {
					const a = (k / K) * Math.PI * 2 + spins[l];
					const mir = k % 2 === 0 ? 1 : -1;
					const cx = Math.cos(a) * R;
					const cy = 2.35 + Math.sin(a) * R;
					const ux = Math.cos(a);
					const uy = Math.sin(a);
					const tx = -uy * mir;
					const ty = ux * mir;
					const tip = [cx + ux * size, cy + uy * size, z];
					const armA = [cx - ux * size * 0.4 + tx * size * 0.75, cy - uy * size * 0.4 + ty * size * 0.75, z];
					const armB = [cx - ux * size * 0.4 - tx * size * 0.75, cy - uy * size * 0.4 - ty * size * 0.75, z];
					const spine = [cx - ux * size * 1.5, cy - uy * size * 1.5, z];
					for (const [p0, p1] of [
						[tip, armA],
						[tip, armB],
						[tip, spine],
					]) {
						for (const p of [p0, p1]) {
							mpos[w * 3] = p[0];
							mpos[w * 3 + 1] = p[1];
							mpos[w * 3 + 2] = p[2];
							mcol[w * 3] = tmp.r;
							mcol[w * 3 + 1] = tmp.g;
							mcol[w * 3 + 2] = tmp.b;
							w++;
						}
					}
				}
			}
			mp.needsUpdate = true;
			mc.needsUpdate = true;
		},
		camera(ctx: Ctx) {
			const { s } = ctx;
			const d = 13.5 - 2.2 * s.tension;
			return {
				pos: [s.chaos[0] * 1.3 * ctx.seed.spin, 2.7 + s.chaos[2] * 0.6 + 0.7 * s.tension, d],
				look: [0, 2.15, 0],
				fov: 50 + 6 * s.tension + 4 * s.drive,
			};
		},
		dispose() {
			root.traverse((o) => {
				const any = o as THREE.Mesh;
				any.geometry?.dispose?.();
			});
			lineMat.dispose();
			occMat.dispose();
			shellMat.dispose();
		},
	};
}
