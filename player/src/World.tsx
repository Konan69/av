/**
 * THE INSTRUMENT — white line-art on black, after the nw_wrld language.
 *
 * Everything is wireframe or points. There is no glow soup, no rainbow, no
 * lighting: MeshBasic + LineSegments + Points, one accent colour used sparely.
 * Depth comes from an INVISIBLE OCCLUDER (black faces, colorWrite off) that
 * hides the far edges of the lattice, so line art reads as a solid object —
 * the trick nw_wrld's CubeGrowth uses.
 *
 *   VESSEL    a lathe lattice: rings x verticals. Its radial profile morphs
 *             ring -> flower -> starburst -> spiral, one shape per 8-bar
 *             phrase, completing on the downbeat. Its surface carries the
 *             PULSE voice's bands and the measured bass LFO.
 *   MANDALA   the kaleidoscope, as geometry: K-fold mirrored chevrons at three
 *             depths, counter-rotating. Fold changes only at section
 *             boundaries so the symmetry is legible.
 *   SHELL     a point cloud whose brightness is the FILAMENT voice, flaring on
 *             its own onsets.
 *   FIELD     the cymatic plate drawn as a wireframe contour grid — Chladni
 *             modes are the voices, kicks drop expanding rings.
 *
 * All displacement happens in vertex shaders; the CPU only writes uniforms and
 * the small mandala buffer.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { Bloom, ChromaticAberration, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { useControls } from "leva";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Live } from "./App";
import { KaleidoscopeEffect } from "./kaleido";
import { ink } from "./palette";
import {
	FLOOR_R,
	floorFrag,
	floorVert,
	inkFrag,
	N_RIP,
	occluderFrag,
	shellFrag,
	shellVert,
	vesselVert,
} from "./shaders";

const RINGS = 13; // horizontal rings of the vessel
const SEG = 72; // theta divisions
const VERT_EVERY = 6; // draw a vertical every Nth theta — keep it airy
const LAYERS = 3;
const MAX_FOLD = 18;
const GRID = 44; // floor grid divisions
const SHELL_PTS = 1400;
const CENTER = new THREE.Vector3(0, 2.35, 0);

/** presence of each element per section — the journey, read from the map */
interface Stage {
	vessel: number;
	mandala: number;
	shell: number;
	field: number;
	kaleido: number;
	dist: number;
}
const STAGES: Record<string, Stage> = {
	intro: { vessel: 0.55, mandala: 0.2, shell: 0.75, field: 0.45, kaleido: 0, dist: 1.25 },
	buildup: { vessel: 0.85, mandala: 0.6, shell: 0.55, field: 0.6, kaleido: 0.2, dist: 1.05 },
	drop: { vessel: 1, mandala: 1, shell: 0.9, field: 0.85, kaleido: 0.8, dist: 0.85 },
	breakdown: { vessel: 0.6, mandala: 0.25, shell: 1, field: 1, kaleido: 0.1, dist: 1.3 },
	outro: { vessel: 0.35, mandala: 0.1, shell: 0.5, field: 0.4, kaleido: 0, dist: 1.4 },
	silence: { vessel: 0.12, mandala: 0.04, shell: 0.2, field: 0.15, kaleido: 0, dist: 1.5 },
};

function buildVesselLines(): THREE.BufferGeometry {
	const pos: number[] = [];
	for (let ri = 0; ri < RINGS; ri++) {
		const lv = ri / (RINGS - 1);
		for (let i = 0; i < SEG; i++) {
			const a = (i / SEG) * Math.PI * 2;
			const b = ((i + 1) / SEG) * Math.PI * 2;
			pos.push(a, lv, 0, b, lv, 0);
		}
	}
	for (let i = 0; i < SEG; i += VERT_EVERY) {
		const a = (i / SEG) * Math.PI * 2;
		for (let ri = 0; ri < RINGS - 1; ri++) {
			pos.push(a, ri / (RINGS - 1), 0, a, (ri + 1) / (RINGS - 1), 0);
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
	return g;
}

function buildVesselSolid(): THREE.BufferGeometry {
	const pos: number[] = [];
	for (let ri = 0; ri < RINGS - 1; ri++) {
		const l0 = ri / (RINGS - 1);
		const l1 = (ri + 1) / (RINGS - 1);
		for (let i = 0; i < SEG; i++) {
			const a = (i / SEG) * Math.PI * 2;
			const b = ((i + 1) / SEG) * Math.PI * 2;
			pos.push(a, l0, 0, b, l0, 0, b, l1, 0);
			pos.push(a, l0, 0, b, l1, 0, a, l1, 0);
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
	return g;
}

function buildShell(): THREE.BufferGeometry {
	const pos = new Float32Array(SHELL_PTS * 3);
	for (let i = 0; i < SHELL_PTS; i++) {
		// deterministic scatter — the same track always gets the same cloud
		const a = (i * 2.399963) % (Math.PI * 2);
		const lv = ((i * 0.6180339887) % 1) * 0.98 + 0.01;
		const j = ((i * 0.7548776662) % 1) ** 1.6;
		pos[i * 3] = a;
		pos[i * 3 + 1] = lv;
		pos[i * 3 + 2] = j;
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
	return g;
}

function buildFloorGrid(): THREE.BufferGeometry {
	const pos: number[] = [];
	const step = (FLOOR_R * 2) / GRID;
	for (let i = 0; i <= GRID; i++) {
		const x = -FLOOR_R + i * step;
		for (let j = 0; j < GRID; j++) {
			const y0 = -FLOOR_R + j * step;
			const y1 = y0 + step;
			pos.push(x, y0, 0, x, y1, 0);
			pos.push(y0, x, 0, y1, x, 0);
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
	return g;
}

export function World({ live }: { live: Live }) {
	const { conductor, transport, genome, seed } = live;
	const scene = useThree((st) => st.scene);

	const ctl = useControls("feel", {
		punch: { value: 1, min: 0, max: 3, step: 0.05 },
		bass: { value: 1, min: 0, max: 3, step: 0.05 },
		density: { value: 1, min: 0.2, max: 2, step: 0.05 },
		kaleido: { value: 1, min: 0, max: 2, step: 0.05 },
		glow: { value: 1, min: 0, max: 3, step: 0.05 },
	});

	const gfx = useMemo(() => {
		const shapeUniforms = () => ({
			uKindA: { value: 0 },
			uKindB: { value: 1 },
			uMorph: { value: 0 },
			uPetals: { value: 5 },
			uBands: { value: new Float32Array(5) },
			uWobPhase: { value: 0 },
			uWobDepth: { value: 0 },
			uPhase: { value: 0 },
			uPunch: { value: 0 },
		});

		const vesselMat = new THREE.ShaderMaterial({
			vertexShader: vesselVert,
			fragmentShader: inkFrag,
			uniforms: {
				...shapeUniforms(),
				uHeight: { value: 4.2 },
				uScale: { value: 1.55 },
				uColor: { value: new THREE.Color(1, 1, 1) },
				uInk: { value: 0.8 },
			},
			transparent: true,
			depthWrite: false,
		});
		const occluderMat = new THREE.ShaderMaterial({
			vertexShader: vesselVert,
			fragmentShader: occluderFrag,
			uniforms: vesselMat.uniforms, // shares every value — same surface
			colorWrite: false,
			depthWrite: true,
			side: THREE.DoubleSide,
		});
		const shellMat = new THREE.ShaderMaterial({
			vertexShader: shellVert,
			fragmentShader: shellFrag,
			uniforms: {
				...vesselMat.uniforms,
				uSpread: { value: 0.35 },
				uSize: { value: 1.6 },
				uColor: { value: new THREE.Color(1, 1, 1) },
				uInk: { value: 0.5 },
			},
			transparent: true,
			depthWrite: false,
		});
		const floorMat = new THREE.ShaderMaterial({
			vertexShader: floorVert,
			fragmentShader: floorFrag,
			uniforms: {
				uV: { value: new Float32Array(6) },
				uPhase: { value: 0 },
				uAmp: { value: 1 },
				uRip: { value: Array.from({ length: N_RIP }, () => new THREE.Vector3()) },
				uColor: { value: new THREE.Color(1, 1, 1) },
				uAccent: { value: new THREE.Color(1, 0.2, 0.2) },
				uInk: { value: 0.5 },
				uAccentAmount: { value: 0.3 },
			},
			transparent: true,
			depthWrite: false,
		});

		const vessel = new THREE.LineSegments(buildVesselLines(), vesselMat);
		const occluder = new THREE.Mesh(buildVesselSolid(), occluderMat);
		const shell = new THREE.Points(buildShell(), shellMat);
		const floor = new THREE.LineSegments(buildFloorGrid(), floorMat);
		for (const o of [vessel, occluder, shell, floor]) o.frustumCulled = false;
		vessel.renderOrder = 2;
		occluder.renderOrder = 1;
		shell.renderOrder = 3;

		// mandala: K-fold chevrons at three depths, CPU-written (tiny buffer)
		const marks = MAX_FOLD * LAYERS * 3; // 3 segments per chevron
		const mg = new THREE.BufferGeometry();
		mg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(marks * 2 * 3), 3));
		mg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(marks * 2 * 3), 3));
		const mandala = new THREE.LineSegments(
			mg,
			new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }),
		);
		mandala.frustumCulled = false;
		mandala.renderOrder = 4;

		return { vessel, occluder, shell, floor, mandala, vesselMat, shellMat, floorMat, marks };
	}, []);

	const kaleido = useMemo(() => new KaleidoscopeEffect(), []);
	const caOffset = useMemo(() => new THREE.Vector2(0.0004, 0.0002), []);

	const st = useRef({
		secIdx: -1,
		fold: seed.folds[0],
		spins: new Float32Array(LAYERS),
		phase: 0,
		poolPhase: 0,
		kAngle: 0,
		white: new THREE.Color(1, 1, 1),
		accent: new THREE.Color(1, 1, 1),
		tmp: new THREE.Color(),
	}).current;

	useFrame((state, rawDt) => {
		const dt = Math.min(0.1, rawDt);
		const t = transport.time;
		const s = conductor.sample(t);
		const c = s.chaos;
		const cam = state.camera as THREE.PerspectiveCamera;

		// staging
		const stage: Stage = { vessel: 0, mandala: 0, shell: 0, field: 0, kaleido: 0, dist: 0 };
		let tot = 0;
		genome.sections.labels.forEach((label, i) => {
			const p = s.probs[i] ?? 0;
			if (p <= 0) return;
			const g = STAGES[label] ?? STAGES.silence;
			stage.vessel += g.vessel * p;
			stage.mandala += g.mandala * p;
			stage.shell += g.shell * p;
			stage.field += g.field * p;
			stage.kaleido += g.kaleido * p;
			stage.dist += g.dist * p;
			tot += p;
		});
		if (tot > 0.001) {
			stage.vessel /= tot;
			stage.mandala /= tot;
			stage.shell /= tot;
			stage.field /= tot;
			stage.kaleido /= tot;
			stage.dist /= tot;
		} else stage.dist = 1.2;

		const pal = ink(seed, genome.sections.labels, s.probs, s.ambiguity);
		st.accent.setRGB(pal.accent[0], pal.accent[1], pal.accent[2]);

		const V = s.voices;
		const byRole = (r: string) => V.find((v) => v.role === r) ?? V[0];
		const pulse = byRole("pulse");
		const strike = byRole("strike");
		const filament = byRole("filament");
		const field = byRole("field");
		const pu = (v: typeof pulse, g = 1) => Math.min(2, v.punch * ctl.punch * g);

		// fold changes only at section boundaries
		const secIdx = conductor.sections.indexOf(s.section);
		if (secIdx !== st.secIdx) {
			st.secIdx = secIdx;
			st.fold = seed.folds[Math.abs(secIdx) % seed.folds.length];
		}

		// shape: one per 8-bar phrase, morph completing on the downbeat
		const di = Math.max(0, s.downbeatIndex);
		const phrase = Math.floor(di / 8);
		const barsIn = (di % 8) + s.barPhase;
		const hash = (n: number) => ((n * 2654435761 + Math.floor(seed.hue * 7919)) >>> 0) % 4;
		const mm = Math.max(0, Math.min(1, (barsIn - 6) / 2));
		st.phase += dt * (0.05 + 0.35 * Math.abs(c[0]) + 0.2 * s.tension);

		// ── VESSEL + SHELL (shared uniforms) ───────────────────────────────
		const u = gfx.vesselMat.uniforms;
		u.uKindA.value = hash(phrase);
		u.uKindB.value = hash(phrase + 1);
		u.uMorph.value = mm * mm * (3 - 2 * mm);
		u.uPetals.value = 3 + (st.fold % 5);
		(u.uBands.value as Float32Array).set(pulse.bands);
		u.uWobPhase.value = s.wobblePhase;
		u.uWobDepth.value = s.wobbleDepth * ctl.bass;
		u.uPhase.value = st.phase;
		u.uPunch.value = pu(pulse, ctl.bass) * 0.5;
		u.uScale.value = 1.5 + 0.25 * s.tension;
		u.uColor.value.copy(st.white).lerp(st.accent, Math.min(0.85, pal.accentAmount * (0.25 + 0.75 * pu(strike))));
		u.uInk.value = Math.min(1, (0.25 + 0.75 * pal.ink) * stage.vessel * (0.6 + 0.5 * s.rms));

		const su = gfx.shellMat.uniforms;
		su.uSpread.value = 0.22 + 0.5 * filament.level + 0.3 * s.tension;
		su.uSize.value = (1.2 + 2.6 * pu(filament)) * ctl.density;
		su.uInk.value = Math.min(1, (0.12 + 0.9 * filament.level + 0.6 * pu(filament)) * stage.shell);
		su.uColor.value.copy(st.white);

		// ── MANDALA: K-fold mirrored chevrons, three depths ────────────────
		const mp = gfx.mandala.geometry.getAttribute("position") as THREE.BufferAttribute;
		const mc = gfx.mandala.geometry.getAttribute("color") as THREE.BufferAttribute;
		const mpos = mp.array as Float32Array;
		const mcol = mc.array as Float32Array;
		mpos.fill(0);
		mcol.fill(0);
		let w = 0;
		const layerVoice = [strike, field, filament];
		for (let l = 0; l < LAYERS; l++) {
			const v = layerVoice[l];
			const fold = Math.max(4, Math.min(MAX_FOLD, st.fold + l * 2));
			const dir = l % 2 === 0 ? seed.spin : -seed.spin;
			st.spins[l] += dt * dir * (0.05 + 0.35 * Math.abs(c[l % 3]) + 0.2 * s.tension);
			const R = 3.4 + l * 1.5;
			const z = -l * 2.6;
			const punch = pu(v);
			const size = (0.42 + 0.5 * v.level + 0.9 * punch) * (0.5 + 0.7 * stage.mandala);
			const bright = Math.min(1, (0.1 + 0.7 * v.level + 1.1 * punch) * stage.mandala * pal.ink);
			const useAccent = l === 0 && punch > 0.25;
			st.tmp.copy(useAccent ? st.accent : st.white).multiplyScalar(bright * ctl.glow);

			for (let k = 0; k < fold; k++) {
				const a = (k / fold) * Math.PI * 2 + st.spins[l];
				const mirror = k % 2 === 0 ? 1 : -1; // mirrored pairs
				const cx = CENTER.x + Math.cos(a) * R;
				const cy = CENTER.y + Math.sin(a) * R;
				const ux = Math.cos(a);
				const uy = Math.sin(a);
				const tx = -uy * mirror;
				const ty = ux * mirror;
				// a chevron: two arms and a spine, pointing outward
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
						mcol[w * 3] = st.tmp.r;
						mcol[w * 3 + 1] = st.tmp.g;
						mcol[w * 3 + 2] = st.tmp.b;
						w++;
					}
				}
			}
		}
		mp.needsUpdate = true;
		mc.needsUpdate = true;

		// ── FIELD ──────────────────────────────────────────────────────────
		const fu = gfx.floorMat.uniforms;
		const fv = fu.uV.value as Float32Array;
		for (let i = 0; i < 6; i++) {
			const v = V[i];
			fv[i] = v ? v.level * (v.role === "pulse" ? ctl.bass : 1) : 0;
		}
		st.poolPhase += dt * (0.15 + 1.2 * s.rms);
		fu.uPhase.value = st.poolPhase;
		fu.uAmp.value = stage.field;
		fu.uInk.value = pal.ink * stage.field;
		fu.uAccentAmount.value = pal.accentAmount;
		fu.uAccent.value.copy(st.accent);
		const rips = conductor.recentOnsets("pulse", t, N_RIP);
		const rv = fu.uRip.value as THREE.Vector3[];
		for (let i = 0; i < N_RIP; i++) {
			const o = rips[i];
			if (o && o.age < 2.2) rv[i].set(o.age, o.strength * ctl.punch, 0);
			else rv[i].set(0, 0, 0);
		}

		// ── frame: black, always. Only a breath of ink on the beat ─────────
		if (scene.fog instanceof THREE.FogExp2) {
			scene.fog.color.setRGB(0, 0, 0);
			scene.fog.density = 0.03 - 0.012 * s.drive;
		}
		(scene.background as THREE.Color | null)?.setRGB(
			0.008 * s.beatPulse * pal.ink,
			0.008 * s.beatPulse * pal.ink,
			0.01 * s.beatPulse * pal.ink,
		);

		st.kAngle += dt * (0.03 + 0.18 * s.tension);
		kaleido.set(st.fold, st.kAngle + c[2] * 0.15, Math.min(0.85, ctl.kaleido * stage.kaleido * (0.5 + 0.5 * s.drive)));

		const dist = (13.5 - 2.2 * s.tension) * stage.dist;
		cam.position.set(
			CENTER.x + c[0] * 1.3 * seed.spin,
			CENTER.y + 0.35 + c[2] * 0.6 + 0.7 * s.tension,
			CENTER.z + dist,
		);
		cam.lookAt(CENTER.x, CENTER.y - 0.2, CENTER.z);
		cam.rotateZ(0.1 * s.morph * s.morph * seed.spin);
		cam.fov = 50 + 6 * s.tension + 4 * s.drive;
		cam.updateProjectionMatrix();

		const off = 0.0003 + 0.0018 * pu(strike) + 0.001 * s.drive * s.beatPulse;
		caOffset.set(off, off * 0.5);
	});

	return (
		<>
			<color attach="background" args={[0, 0, 0]} />
			<fogExp2 attach="fog" args={[0x000000, 0.03]} />

			<group position={[CENTER.x, CENTER.y, CENTER.z]}>
				<primitive object={gfx.occluder} />
				<primitive object={gfx.vessel} />
				<primitive object={gfx.shell} />
			</group>
			<primitive object={gfx.mandala} />
			<group rotation-x={-Math.PI / 2} position={[0, 0, 0]}>
				<primitive object={gfx.floor} />
			</group>

			<EffectComposer multisampling={4}>
				<primitive object={kaleido} dispose={null} />
				<Bloom intensity={0.32 * ctl.glow} luminanceThreshold={0.55} luminanceSmoothing={0.2} mipmapBlur />
				<ChromaticAberration offset={caOffset} />
				<Vignette offset={0.18} darkness={0.75} />
				<Noise opacity={0.035} />
			</EffectComposer>
		</>
	);
}
