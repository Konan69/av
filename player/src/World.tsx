/** Browser rehearsal adapter for the same shared 3D world used by nw_wrld. */
import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useControls } from "leva";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Live } from "./App";
import { createMusicWorld } from "./world/MusicWorld";

export function World({ live }: { live: Live }) {
	const { scene, camera, invalidate } = useThree();
	const world = useRef<ReturnType<typeof createMusicWorld> | null>(null);
	const previous = useRef({ time: Number.NaN, punch: -1, bass: -1, detail: -1, glow: -1 });
	const controls = useControls("feel", {
		punch: { value: 1, min: 0, max: 3, step: 0.05 },
		bass: { value: 1, min: 0, max: 3, step: 0.05 },
		detail: { value: 1, min: 0, max: 2, step: 0.05 },
		glow: { value: 1, min: 0, max: 3, step: 0.05 },
	});

	useEffect(() => {
		const instance = createMusicWorld(scene, camera as THREE.PerspectiveCamera, {
			seed: live.seed,
			labels: live.genome.sections.labels,
		});
		world.current = instance;
		previous.current.time = Number.NaN;
		invalidate();
		return () => {
			instance.dispose();
			if (world.current === instance) world.current = null;
		};
	}, [scene, camera, live.seed, live.genome, invalidate]);

	useEffect(() => live.transport.subscribe(invalidate), [live.transport, invalidate]);
	useEffect(() => { invalidate(); }, [controls.punch, controls.bass, controls.detail, controls.glow, invalidate]);

	useFrame(() => {
		const time = live.transport.time;
		const last = previous.current;
		if (world.current && (time !== last.time || controls.punch !== last.punch || controls.bass !== last.bass || controls.detail !== last.detail || controls.glow !== last.glow)) {
			world.current.update(live.conductor.sample(time), controls);
			Object.assign(last, controls, { time });
		}
		// Demand rendering stops completely on pause. State transitions and orbit input wake it.
		if (live.transport.playing) invalidate();
	});

	return (
		<>
			<OrbitControls target={[0, 1, -8]} enableDamping={false} enablePan={false} minDistance={3} maxDistance={24} maxPolarAngle={Math.PI * 0.59} />
			<EffectComposer multisampling={4}>
				<Bloom intensity={0.55 * controls.glow} luminanceThreshold={1} luminanceSmoothing={0.3} mipmapBlur />
				<Vignette offset={0.25} darkness={0.45} />
			</EffectComposer>
		</>
	);
}
