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
import { buildLayout } from "./bars";
import { makeJourney } from "./scenes/journey";
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

	// ONE world. The track is laid out in space and the camera flies through it,
	// so section changes arrive as travel instead of as a cut.
	const journey = useMemo(
		() => makeJourney(buildLayout(genome, seed, conductor.sections)),
		[genome, seed, conductor],
	);
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

	const floorRef = useRef<THREE.Group>(null);
	const kaleido = useMemo(() => new KaleidoscopeEffect(), []);
	const caOffset = useMemo(() => new THREE.Vector2(0.0004, 0.0002), []);

	// the group every scene is mounted into
	const stage = useMemo(() => new THREE.Group(), []);
	useEffect(() => {
		stage.add(journey.object);
		return () => {
			stage.remove(journey.object);
			journey.dispose();
		};
	}, [journey, stage]);

	const st = useRef({ poolPhase: 0, kAngle: 0 }).current;

	useFrame((state, rawDt) => {
		const dt = Math.min(0.1, rawDt);
		const s = conductor.sample(transport.time);
		const cam = state.camera as THREE.PerspectiveCamera;
		const pal = ink(seed, genome.sections.labels, s.probs, s.ambiguity);

		const voice = (role: string) => s.voices.find((v) => v.role === role) ?? s.voices[0];
		const ctx = { dt, s, ink: pal, seed, camera: cam, ctl, voice, weight: 1 };
		journey.update(ctx);

		const c = journey.camera(ctx);
		cam.position.set(c.pos[0], c.pos[1], c.pos[2]);
		cam.lookAt(c.look[0], c.look[1], c.look[2]);
		// a slow bank, driven by the attractor and the approach to a boundary
		cam.rotateZ((0.10 * s.chaos[1] + 0.16 * s.morph * s.morph) * seed.spin);
		cam.fov = c.fov;
		cam.updateProjectionMatrix();

		// ── shared floor: the cymatic plate, present in every scene ────────
		const fu = floor.mat.uniforms;
		const fv = fu.uV.value as Float32Array;
		for (let i = 0; i < 6; i++) {
			const v = s.voices[i];
			fv[i] = v ? v.level * (v.role === "pulse" ? ctl.bass : 1) : 0;
		}
		// the plate travels with us, a few bars ahead, so it never runs out
		if (floorRef.current) floorRef.current.position.set(0, -9, cam.position.z - 40);
		st.poolPhase += dt * (0.15 + 1.2 * s.rms);
		fu.uPhase.value = st.poolPhase;
		fu.uAmp.value = 0.45 + 0.55 * s.tension;
		fu.uInk.value = pal.ink * 0.1; // the plate is a floor, not a feature
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
			// the corridor is ~400 units deep: 0.03 fogged everything to black.
			// This gives depth falloff across the visible run instead.
			scene.fog.density = 0.0042 - 0.0012 * s.drive;
		}

		st.kAngle += dt * (0.03 + 0.18 * s.tension);
		// the screen-space fold only lifts where the geometry is not already folded
		// the geometry is already folded; the screen-space fold only tops it off
		const kAmt = 0.22 * s.drive + 0.18 * s.morph * s.morph;
		kaleido.set(seed.folds[Math.abs(s.sectionIndex) % seed.folds.length], st.kAngle + s.chaos[2] * 0.15, Math.min(0.85, ctl.kaleido * kAmt));

		const strike = voice("strike");
		const off = 0.0003 + 0.0018 * Math.min(2, strike.punch * ctl.punch) + 0.001 * s.drive * s.beatPulse;
		caOffset.set(off, off * 0.5);
	});

	return (
		<>
			<color attach="background" args={[0, 0, 0]} />
			<fogExp2 attach="fog" args={[0x000000, 0.0042]} />
			<primitive object={stage} />

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
