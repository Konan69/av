/**
 * THE HOST — runs the shared frame and hands each section its scene.
 *
 * Shared across every scene: the black room, the Chladni floor grid (the
 * cymatic plate), and the post chain. Everything else belongs to the scene the
 * genome chose for this section; two bars before a boundary the next scene
 * crossfades in, and the camera lerps between what the two scenes ask for.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { Bloom, ChromaticAberration, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { useControls } from "leva";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Live } from "./App";
import { KaleidoscopeEffect } from "./kaleido";
import { ink } from "./palette";
import { buildScenes, pickScene } from "./scenes";
import type { Ctx } from "./scenes/types";
import { FLOOR_R, floorFrag, floorVert, N_RIP } from "./shaders";

const GRID = 44;

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

	const scenes = useMemo(() => buildScenes(seed, conductor), [seed, conductor]);
	const floor = useMemo(() => {
		const mat = new THREE.ShaderMaterial({
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
		const obj = new THREE.LineSegments(buildFloorGrid(), mat);
		obj.frustumCulled = false;
		return { obj, mat };
	}, []);

	const kaleido = useMemo(() => new KaleidoscopeEffect(), []);
	const caOffset = useMemo(() => new THREE.Vector2(0.0004, 0.0002), []);

	// the group every scene is mounted into
	const stage = useMemo(() => new THREE.Group(), []);
	useEffect(() => {
		for (const sc of Object.values(scenes)) stage.add(sc.object);
		return () => {
			for (const sc of Object.values(scenes)) {
				stage.remove(sc.object);
				sc.dispose();
			}
		};
	}, [scenes, stage]);

	const st = useRef({
		poolPhase: 0,
		kAngle: 0,
		curr: "VESSEL",
		next: "VESSEL",
		lastSec: -1,
		pos: new THREE.Vector3(0, 2.7, 13),
		look: new THREE.Vector3(0, 2.2, 0),
		posA: new THREE.Vector3(),
		posB: new THREE.Vector3(),
		lookA: new THREE.Vector3(),
		lookB: new THREE.Vector3(),
	}).current;

	useFrame((state, rawDt) => {
		const dt = Math.min(0.1, rawDt);
		const s = conductor.sample(transport.time);
		const cam = state.camera as THREE.PerspectiveCamera;
		const pal = ink(seed, genome.sections.labels, s.probs, s.ambiguity);

		// which scene is this section, and which is coming
		if (s.sectionIndex !== st.lastSec) {
			st.lastSec = s.sectionIndex;
			st.curr = pickScene(seed, s.section.label, s.sectionIndex);
		}
		const nextIdx = s.sectionIndex + 1;
		const nextLabel = conductor.sections[nextIdx]?.label ?? s.section.label;
		st.next = pickScene(seed, nextLabel, nextIdx);
		// crossfade over the LAST HALF of the 4-bar approach: two bars
		const xf = st.next === st.curr ? 0 : Math.max(0, Math.min(1, (s.morph - 0.5) * 2));

		const voice = (role: string) => s.voices.find((v) => v.role === role) ?? s.voices[0];
		const base: Omit<Ctx, "weight"> = { dt, s, ink: pal, seed, camera: cam, ctl, voice };

		for (const [name, sc] of Object.entries(scenes)) {
			const weight = name === st.curr ? 1 - xf : name === st.next ? xf : 0;
			sc.object.visible = weight > 0.002;
			if (!sc.object.visible) continue;
			sc.update({ ...base, weight });
		}

		// camera: lerp between what the outgoing and incoming scenes want
		const a = scenes[st.curr].camera({ ...base, weight: 1 - xf });
		const b = scenes[st.next].camera({ ...base, weight: xf });
		st.posA.set(a.pos[0], a.pos[1], a.pos[2]);
		st.posB.set(b.pos[0], b.pos[1], b.pos[2]);
		st.lookA.set(a.look[0], a.look[1], a.look[2]);
		st.lookB.set(b.look[0], b.look[1], b.look[2]);
		st.pos.lerpVectors(st.posA, st.posB, xf);
		st.look.lerpVectors(st.lookA, st.lookB, xf);
		cam.position.copy(st.pos);
		cam.lookAt(st.look);
		cam.rotateZ(0.1 * s.morph * s.morph * seed.spin);
		cam.fov = a.fov * (1 - xf) + b.fov * xf;
		cam.updateProjectionMatrix();

		// ── shared floor: the cymatic plate, present in every scene ────────
		const fu = floor.mat.uniforms;
		const fv = fu.uV.value as Float32Array;
		for (let i = 0; i < 6; i++) {
			const v = s.voices[i];
			fv[i] = v ? v.level * (v.role === "pulse" ? ctl.bass : 1) : 0;
		}
		st.poolPhase += dt * (0.15 + 1.2 * s.rms);
		fu.uPhase.value = st.poolPhase;
		fu.uAmp.value = 0.45 + 0.55 * s.tension;
		fu.uInk.value = pal.ink * (st.curr === "PRISM" ? 0.35 : 1);
		fu.uAccentAmount.value = pal.accentAmount;
		fu.uAccent.value.setRGB(pal.accent[0], pal.accent[1], pal.accent[2]);
		const rips = conductor.recentOnsets("pulse", s.time, N_RIP);
		const rv = fu.uRip.value as THREE.Vector3[];
		for (let i = 0; i < N_RIP; i++) {
			const o = rips[i];
			if (o && o.age < 2.2) rv[i].set(o.age, o.strength * ctl.punch, 0);
			else rv[i].set(0, 0, 0);
		}

		if (scene.fog instanceof THREE.FogExp2) {
			scene.fog.color.setRGB(0, 0, 0);
			scene.fog.density = 0.03 - 0.012 * s.drive;
		}

		st.kAngle += dt * (0.03 + 0.18 * s.tension);
		// the screen-space fold only lifts where the geometry is not already folded
		const kAmt = st.curr === "PRISM" ? 0.05 : 0.5 * s.drive + 0.35 * s.morph * s.morph;
		kaleido.set(seed.folds[Math.abs(s.sectionIndex) % seed.folds.length], st.kAngle + s.chaos[2] * 0.15, Math.min(0.85, ctl.kaleido * kAmt));

		const strike = voice("strike");
		const off = 0.0003 + 0.0018 * Math.min(2, strike.punch * ctl.punch) + 0.001 * s.drive * s.beatPulse;
		caOffset.set(off, off * 0.5);
	});

	return (
		<>
			<color attach="background" args={[0, 0, 0]} />
			<fogExp2 attach="fog" args={[0x000000, 0.03]} />
			<primitive object={stage} />
			<group rotation-x={-Math.PI / 2}>
				<primitive object={floor.obj} />
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
