/**
 * THE HALL — five isolated lanes in deep, hazy space that you fly around.
 *
 * The last build failed three ways and this one answers each:
 *   "not 3d — 3d means I rotate it"  -> orbit/zoom with the mouse, always on.
 *                                       It drifts by itself only when idle.
 *   "no atmosphere"                  -> volumetric haze slabs, light shafts,
 *                                       drifting dust, depth fog and DOF. Air
 *                                       between things, not a black void.
 *   "nothing is isolated, no lanes"  -> every discovered voice owns its own
 *                                       REGION of space and its own kind of
 *                                       matter. Nothing is superimposed.
 *
 *   LANE 0  PULSE      the bass terrain: rods marching out of the fog toward
 *                      you. Depth IS time, so the bassline arrives before you
 *                      hear it — the lookahead made physical.
 *   LANE 1  STRIKE     shards. Discrete: each transient throws one, it flies,
 *                      it dies. Nothing continuous, nothing repeating.
 *   LANE 2  FIELD      the haze itself. The pads are the air in the room.
 *   LANE 3  FILAMENT   high streaks, sparse and far above everything else.
 *   CORE               a slender column of the track's own timeline: past
 *                      below, the coming bars above.
 */
import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import {
	Bloom,
	ChromaticAberration,
	DepthOfField,
	EffectComposer,
	Noise,
	Vignette,
} from "@react-three/postprocessing";
import { useControls } from "leva";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Live } from "./App";
import { KaleidoscopeEffect } from "./kaleido";
import { ink } from "./palette";

/* ── the hall ───────────────────────────────────────────────────────────── */
const TARGET = new THREE.Vector3(0, 4.5, -10);
const COLS = 44; // rods across
const ROWS = 30; // rods into the distance — depth is time
const SPAN_X = 30;
const Z_NEAR = 6;
const Z_FAR = -64;
const FUTURE = 7.5; // seconds visible at the horizon
const PAST = 1.2; // seconds still visible behind you
const SHARDS = 180;
const HAZE = 30;
const STREAKS = 22;
const DUST = 2200;
const COLUMN = 96;

interface Lane {
	rods: number;
	shards: number;
	haze: number;
	streaks: number;
	column: number;
	fog: number;
}
const STAGES: Record<string, Lane> = {
	intro: { rods: 0.45, shards: 0.25, haze: 0.9, streaks: 0.8, column: 0.7, fog: 1.25 },
	buildup: { rods: 0.8, shards: 0.7, haze: 0.75, streaks: 0.6, column: 0.9, fog: 1.0 },
	drop: { rods: 1, shards: 1, haze: 0.5, streaks: 0.35, column: 1, fog: 0.72 },
	breakdown: { rods: 0.4, shards: 0.2, haze: 1, streaks: 1, column: 0.8, fog: 1.45 },
	outro: { rods: 0.25, shards: 0.12, haze: 0.85, streaks: 0.6, column: 0.5, fog: 1.5 },
	silence: { rods: 0.08, shards: 0.04, haze: 0.5, streaks: 0.25, column: 0.25, fog: 1.6 },
};

function sampleAt(arr: number[] | undefined, fps: number, t: number): number {
	if (!arr || !arr.length) return 0;
	const x = t * fps;
	const i = Math.floor(x);
	if (i < 0) return arr[0];
	if (i >= arr.length - 1) return arr[arr.length - 1];
	return arr[i] + (arr[i + 1] - arr[i]) * (x - i);
}

export function World({ live }: { live: Live }) {
	const { conductor, transport, genome, seed } = live;
	const scene = useThree((s) => s.scene);
	const camera = useThree((s) => s.camera);

	const ctl = useControls("feel", {
		punch: { value: 1, min: 0, max: 3, step: 0.05 },
		bass: { value: 1, min: 0, max: 3, step: 0.05 },
		air: { value: 1, min: 0, max: 3, step: 0.05 },
		glow: { value: 1, min: 0, max: 3, step: 0.05 },
		kaleido: { value: 0, min: 0, max: 1.5, step: 0.05 },
	});

	// per-voice samplers, so any lane can read its own layer at any time
	const V = useMemo(() => {
		const get = (role: string) => conductor.voices.find((v) => v.role === role) ?? conductor.voices[0];
		const mk = (role: string) => {
			const v = get(role);
			return {
				v,
				rms: (t: number) => sampleAt(v.features.rms, genome.stems.rms_frame_rate, t) * v.rmsScale,
				band: (i: number, t: number) =>
					sampleAt(v.features.energy[["sub", "low", "mid", "high", "air"][i]], genome.stems.energy_frame_rate, t) *
					v.bandScale[i],
			};
		};
		return { pulse: mk("pulse"), strike: mk("strike"), field: mk("field"), filament: mk("filament") };
	}, [conductor, genome]);

	const gfx = useMemo(() => {
		// LANE 0 — bass terrain
		const rodGeo = new THREE.BoxGeometry(1, 1, 1);
		const rods = new THREE.InstancedMesh(
			rodGeo,
			new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, toneMapped: false, fog: true }),
			COLS * ROWS,
		);
		rods.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		rods.frustumCulled = false;

		// LANE 1 — shards
		const shards = new THREE.InstancedMesh(
			new THREE.TetrahedronGeometry(0.42),
			new THREE.MeshBasicMaterial({
				transparent: true,
				opacity: 0.95,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
				toneMapped: false,
			}),
			SHARDS,
		);
		shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		shards.frustumCulled = false;

		// LANE 2 — the air
		const haze = new THREE.InstancedMesh(
			new THREE.PlaneGeometry(1, 1),
			new THREE.MeshBasicMaterial({
				transparent: true,
				opacity: 0.055,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
				side: THREE.DoubleSide,
				toneMapped: false,
			}),
			HAZE,
		);
		haze.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		haze.frustumCulled = false;
		haze.renderOrder = 10;

		// LANE 3 — high streaks
		const streaks = new THREE.InstancedMesh(
			new THREE.PlaneGeometry(1, 1),
			new THREE.MeshBasicMaterial({
				transparent: true,
				opacity: 0.85,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
				side: THREE.DoubleSide,
				toneMapped: false,
			}),
			STREAKS,
		);
		streaks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		streaks.frustumCulled = false;

		// shafts of light from above — atmosphere you can see through
		const shafts = new THREE.InstancedMesh(
			new THREE.ConeGeometry(2.6, 26, 12, 1, true),
			new THREE.MeshBasicMaterial({
				transparent: true,
				opacity: 0.05,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
				side: THREE.DoubleSide,
				toneMapped: false,
			}),
			4,
		);
		shafts.frustumCulled = false;
		shafts.renderOrder = 9;

		// dust
		const dpos = new Float32Array(DUST * 3);
		for (let i = 0; i < DUST; i++) {
			dpos[i * 3] = (((i * 0.7548776662) % 1) - 0.5) * 70;
			dpos[i * 3 + 1] = ((i * 0.6180339887) % 1) * 26 - 1;
			dpos[i * 3 + 2] = -((i * 0.2451234) % 1) * 70 + 8;
		}
		const dgeo = new THREE.BufferGeometry();
		dgeo.setAttribute("position", new THREE.BufferAttribute(dpos, 3));
		const dust = new THREE.Points(
			dgeo,
			new THREE.PointsMaterial({
				size: 0.07,
				sizeAttenuation: true,
				transparent: true,
				opacity: 0.5,
				depthWrite: false,
				toneMapped: false,
			}),
		);
		dust.frustumCulled = false;

		// CORE — the timeline column
		const cgeo = new THREE.BufferGeometry();
		cgeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(COLUMN * 2 * 3), 3));
		cgeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(COLUMN * 2 * 3), 3));
		const column = new THREE.LineSegments(
			cgeo,
			new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false }),
		);
		column.frustumCulled = false;

		const state = {
			shard: Array.from({ length: SHARDS }, () => ({
				life: 0,
				pos: new THREE.Vector3(),
				vel: new THREE.Vector3(),
				spin: new THREE.Vector3(),
				rot: new THREE.Euler(),
				size: 1,
			})),
			next: 0,
			lastOnset: 0,
		};
		return { rods, shards, haze, streaks, shafts, dust, column, state };
	}, []);

	const kaleido = useMemo(() => new KaleidoscopeEffect(), []);
	const caOffset = useMemo(() => new THREE.Vector2(0.0004, 0.0002), []);
	const idle = useRef({ last: 0, auto: true });

	const st = useRef({
		dummy: new THREE.Object3D(),
		col: new THREE.Color(),
		accent: new THREE.Color(),
		white: new THREE.Color(1, 1, 1),
		fog: new THREE.Color(),
		drift: 0,
		secIdx: -1,
	}).current;

	useFrame((state, rawDt) => {
		const dt = Math.min(0.1, rawDt);
		const t = transport.time;
		const s = conductor.sample(t);
		const c = s.chaos;

		// staging
		const L: Lane = { rods: 0, shards: 0, haze: 0, streaks: 0, column: 0, fog: 0 };
		let tot = 0;
		genome.sections.labels.forEach((label, i) => {
			const p = s.probs[i] ?? 0;
			if (p <= 0) return;
			const g = STAGES[label] ?? STAGES.silence;
			L.rods += g.rods * p;
			L.shards += g.shards * p;
			L.haze += g.haze * p;
			L.streaks += g.streaks * p;
			L.column += g.column * p;
			L.fog += g.fog * p;
			tot += p;
		});
		if (tot > 0.001) {
			L.rods /= tot;
			L.shards /= tot;
			L.haze /= tot;
			L.streaks /= tot;
			L.column /= tot;
			L.fog /= tot;
		} else L.fog = 1.3;

		const pal = ink(seed, genome.sections.labels, s.probs, s.ambiguity);
		st.accent.setRGB(pal.accent[0], pal.accent[1], pal.accent[2]);
		st.drift += dt * (0.05 + 0.4 * s.rms);

		const pu = (role: string, g = 1) => {
			const v = s.voices.find((x) => x.role === role) ?? s.voices[0];
			return Math.min(2, v.punch * ctl.punch * g);
		};
		const lvl = (role: string) => (s.voices.find((x) => x.role === role) ?? s.voices[0]).level;

		// ── LANE 0: the bass terrain, depth = time ─────────────────────────
		const d = st.dummy;
		let i = 0;
		const bassPunch = pu("pulse", ctl.bass);
		for (let r = 0; r < ROWS; r++) {
			const fz = r / (ROWS - 1); // 0 near .. 1 far
			const z = Z_NEAR + (Z_FAR - Z_NEAR) * fz;
			const tt = t - PAST + fz * (PAST + FUTURE);
			const base = V.pulse.rms(tt) * ctl.bass;
			const sub = V.pulse.band(0, tt) * ctl.bass;
			for (let cIdx = 0; cIdx < COLS; cIdx++) {
				const fx = cIdx / (COLS - 1) - 0.5;
				const x = fx * SPAN_X * (1 + fz * 0.9);
				// carve a corridor down the middle so the hall has a floor plan
				const gap = Math.abs(fx) < 0.07 ? 0 : 1;
				const lateral = 0.55 + 0.45 * Math.cos(fx * 9 + r * 0.4);
				const h = Math.max(0.001, (base * 5.2 + sub * 3.4) * lateral * L.rods * gap);
				d.position.set(x, h * 0.5, z);
				d.rotation.set(0, 0, 0);
				d.scale.set(0.16, h, 0.16);
				d.updateMatrix();
				gfx.rods.setMatrixAt(i, d.matrix);
				const heat = Math.min(1, h * 0.22 + bassPunch * 0.35 * (1 - fz));
				st.col.copy(st.white).lerp(st.accent, Math.min(0.9, heat * pal.accentAmount * 1.4));
				st.col.multiplyScalar((0.06 + 0.75 * heat) * (1 - fz * 0.55) * ctl.glow);
				gfx.rods.setColorAt(i, st.col);
				i++;
			}
		}
		gfx.rods.instanceMatrix.needsUpdate = true;
		if (gfx.rods.instanceColor) gfx.rods.instanceColor.needsUpdate = true;

		// ── LANE 1: shards, one per transient ──────────────────────────────
		const strikeV = conductor.voices.find((v) => v.role === "strike") ?? conductor.voices[0];
		const onsets = strikeV.features.onsets;
		if (gfx.state.lastOnset > t + 0.5 || t - gfx.state.lastOnset > 2) gfx.state.lastOnset = t - 0.05;
		for (const o of onsets) {
			if (o.t <= gfx.state.lastOnset || o.t > t) continue;
			const sh = gfx.state.shard[gfx.state.next % SHARDS];
			gfx.state.next++;
			const a = ((o.t * 97.13) % 1) * Math.PI * 2;
			const rr = 7 + ((o.t * 31.7) % 1) * 5;
			sh.life = 1;
			sh.size = (0.5 + o.strength * 1.6) * (0.5 + L.shards);
			sh.pos.set(Math.cos(a) * rr, 2.2 + ((o.t * 13.1) % 1) * 6, TARGET.z + Math.sin(a) * rr);
			sh.vel.set(Math.cos(a) * (3 + o.strength * 9), 1.2 + o.strength * 3, Math.sin(a) * (3 + o.strength * 9));
			sh.spin.set(((o.t * 7.3) % 1) * 6 - 3, ((o.t * 3.9) % 1) * 6 - 3, ((o.t * 5.1) % 1) * 6 - 3);
			sh.rot.set(0, 0, 0);
		}
		gfx.state.lastOnset = t;
		for (let k = 0; k < SHARDS; k++) {
			const sh = gfx.state.shard[k];
			if (sh.life <= 0) {
				d.scale.set(0, 0, 0);
				d.position.set(0, -999, 0);
				d.updateMatrix();
				gfx.shards.setMatrixAt(k, d.matrix);
				continue;
			}
			sh.life = Math.max(0, sh.life - dt * 1.35);
			sh.pos.addScaledVector(sh.vel, dt);
			sh.vel.multiplyScalar(1 - dt * 1.6);
			sh.vel.y -= dt * 2.2;
			sh.rot.x += sh.spin.x * dt;
			sh.rot.y += sh.spin.y * dt;
			sh.rot.z += sh.spin.z * dt;
			d.position.copy(sh.pos);
			d.rotation.copy(sh.rot);
			const sc = sh.size * (0.35 + 0.65 * sh.life);
			d.scale.set(sc, sc, sc);
			d.updateMatrix();
			gfx.shards.setMatrixAt(k, d.matrix);
			st.col.copy(st.accent).lerp(st.white, 0.35).multiplyScalar(sh.life * sh.life * 2.2 * ctl.glow);
			gfx.shards.setColorAt(k, st.col);
		}
		gfx.shards.instanceMatrix.needsUpdate = true;
		if (gfx.shards.instanceColor) gfx.shards.instanceColor.needsUpdate = true;

		// ── LANE 2: the air ────────────────────────────────────────────────
		const fieldL = lvl("field");
		for (let k = 0; k < HAZE; k++) {
			const f = k / HAZE;
			const a = f * Math.PI * 2 * 3.7 + st.drift * 0.12 * (k % 2 ? 1 : -1);
			const rr = 8 + ((k * 0.618) % 1) * 26;
			d.position.set(
				Math.cos(a) * rr,
				3 + ((k * 0.37) % 1) * 13 + Math.sin(st.drift * 0.2 + k) * 0.8,
				TARGET.z + Math.sin(a) * rr - ((k * 0.29) % 1) * 22,
			);
			d.quaternion.copy(camera.quaternion);
			const sz = (14 + ((k * 0.51) % 1) * 22) * (0.6 + 0.5 * fieldL);
			d.scale.set(sz, sz * 0.7, 1);
			d.updateMatrix();
			gfx.haze.setMatrixAt(k, d.matrix);
			st.col
				.copy(st.white)
				.lerp(st.accent, 0.25 + 0.35 * pal.accentAmount)
				.multiplyScalar((0.15 + 0.85 * fieldL) * L.haze * ctl.air);
			gfx.haze.setColorAt(k, st.col);
		}
		gfx.haze.instanceMatrix.needsUpdate = true;
		if (gfx.haze.instanceColor) gfx.haze.instanceColor.needsUpdate = true;

		// ── LANE 3: high streaks ───────────────────────────────────────────
		const filP = pu("filament");
		const filL = lvl("filament");
		for (let k = 0; k < STREAKS; k++) {
			const f = k / STREAKS;
			const a = f * Math.PI * 2 + st.drift * 0.05 * seed.spin;
			const rr = 12 + ((k * 0.618) % 1) * 16;
			const flick = ((k * 7.13 + Math.floor(st.drift * 3)) % 5) / 5;
			d.position.set(Math.cos(a) * rr, 15 + ((k * 0.31) % 1) * 8, TARGET.z + Math.sin(a) * rr);
			d.quaternion.copy(camera.quaternion);
			d.rotation.z += a;
			const len = (7 + 16 * filL + 10 * filP) * (0.3 + L.streaks);
			d.scale.set(len, 0.035 + 0.09 * filP, 1);
			d.updateMatrix();
			gfx.streaks.setMatrixAt(k, d.matrix);
			st.col
				.copy(st.white)
				.multiplyScalar((0.04 + 0.9 * filL * flick + 1.6 * filP * flick) * L.streaks * ctl.glow);
			gfx.streaks.setColorAt(k, st.col);
		}
		gfx.streaks.instanceMatrix.needsUpdate = true;
		if (gfx.streaks.instanceColor) gfx.streaks.instanceColor.needsUpdate = true;

		// shafts
		for (let k = 0; k < 4; k++) {
			const a = (k / 4) * Math.PI * 2 + st.drift * 0.03;
			d.position.set(Math.cos(a) * 16, 15, TARGET.z + Math.sin(a) * 16);
			d.rotation.set(0.12 * Math.cos(a), 0, 0.12 * Math.sin(a));
			const w = 0.7 + 0.6 * s.tension;
			d.scale.set(w, 1, w);
			d.updateMatrix();
			gfx.shafts.setMatrixAt(k, d.matrix);
		}
		gfx.shafts.instanceMatrix.needsUpdate = true;
		const shaftMat = gfx.shafts.material as THREE.MeshBasicMaterial;
		shaftMat.opacity = (0.012 + 0.05 * s.tension + 0.05 * pu("strike")) * ctl.air;
		shaftMat.color.copy(st.white).lerp(st.accent, 0.4 * pal.accentAmount);

		// ── CORE: the timeline column, past below / future above ───────────
		const cp = gfx.column.geometry.getAttribute("position") as THREE.BufferAttribute;
		const cc = gfx.column.geometry.getAttribute("color") as THREE.BufferAttribute;
		const cpos = cp.array as Float32Array;
		const ccol = cc.array as Float32Array;
		for (let k = 0; k < COLUMN; k++) {
			const f = k / (COLUMN - 1);
			const tt = t - PAST + f * (PAST + FUTURE);
			const e = V.pulse.rms(tt) * ctl.bass + V.strike.rms(tt) * 0.6;
			const w = 0.25 + e * 2.4;
			const y = 0.4 + f * 15;
			const o = k * 2 * 3;
			cpos[o] = -w;
			cpos[o + 1] = y;
			cpos[o + 2] = TARGET.z;
			cpos[o + 3] = w;
			cpos[o + 4] = y;
			cpos[o + 5] = TARGET.z;
			const isNow = Math.abs(tt - t) < 0.08;
			st.col.copy(isNow ? st.accent : st.white).multiplyScalar(
				(isNow ? 2.2 : 0.1 + 0.7 * Math.min(1, e)) * L.column * ctl.glow,
			);
			for (let e2 = 0; e2 < 2; e2++) {
				ccol[o + e2 * 3] = st.col.r;
				ccol[o + e2 * 3 + 1] = st.col.g;
				ccol[o + e2 * 3 + 2] = st.col.b;
			}
		}
		cp.needsUpdate = true;
		cc.needsUpdate = true;

		// dust drifts, and reads the air
		const dustMat = gfx.dust.material as THREE.PointsMaterial;
		dustMat.opacity = (0.1 + 0.35 * fieldL) * L.haze * ctl.air;
		dustMat.color.copy(st.white).lerp(st.accent, 0.2);
		gfx.dust.position.y = Math.sin(st.drift * 0.1) * 0.6;
		gfx.dust.rotation.y = st.drift * 0.004 * seed.spin;

		// ── atmosphere ─────────────────────────────────────────────────────
		st.fog.copy(st.accent).multiplyScalar(0.012 * pal.ink).addScalar(0.004 + 0.01 * s.beatPulse * pal.ink);
		if (scene.fog instanceof THREE.FogExp2) {
			scene.fog.color.copy(st.fog);
			scene.fog.density = (0.019 - 0.007 * s.drive) * L.fog;
		}
		(scene.background as THREE.Color | null)?.copy(st.fog).multiplyScalar(0.5);

		kaleido.set(6, st.drift * 0.05, Math.min(0.6, ctl.kaleido * (0.2 + 0.8 * s.drive)));
		const off = 0.0003 + 0.0016 * pu("strike") + 0.001 * s.drive * s.beatPulse;
		caOffset.set(off, off * 0.5);

		// idle -> slow auto orbit; any input hands control straight back
		idle.current.auto = state.clock.elapsedTime - idle.current.last > 5;
		void c;
	});

	return (
		<>
			<color attach="background" args={[0, 0, 0]} />
			<fogExp2 attach="fog" args={[0x05060a, 0.019]} />

			<OrbitControls
				makeDefault
				target={TARGET}
				enableDamping
				dampingFactor={0.06}
				rotateSpeed={0.55}
				zoomSpeed={0.7}
				minDistance={4}
				maxDistance={70}
				maxPolarAngle={Math.PI * 0.52}
				autoRotate={idle.current.auto}
				autoRotateSpeed={0.35 * seed.spin}
				onStart={() => {
					idle.current.last = performance.now() / 1000;
				}}
			/>

			<primitive object={gfx.rods} />
			<primitive object={gfx.shards} />
			<primitive object={gfx.haze} />
			<primitive object={gfx.streaks} />
			<primitive object={gfx.shafts} />
			<primitive object={gfx.dust} />
			<primitive object={gfx.column} />

			<EffectComposer multisampling={4}>
				<primitive object={kaleido} dispose={null} />
				<DepthOfField focusDistance={0.012} focalLength={0.05} bokehScale={2.2} height={480} />
				<Bloom intensity={0.75 * ctl.glow} luminanceThreshold={0.25} luminanceSmoothing={0.3} mipmapBlur />
				<ChromaticAberration offset={caOffset} />
				<Vignette offset={0.22} darkness={0.82} />
				<Noise opacity={0.025} />
			</EffectComposer>
		</>
	);
}
