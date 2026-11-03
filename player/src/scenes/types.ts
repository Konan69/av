/**
 * A SCENE is one strong idea, not a pile of elements.
 *
 * Every reference we studied is a scene system: nw_wrld sequences modules,
 * vizz.fm lists Mesh Grid / Wavy Form / Equalizer Rings, fosfora ships effect
 * families, dmnvis picks a scene per track. Our previous build was ONE
 * composite world with five things fighting inside it — which is exactly why
 * it read as "one static algorithm" and got repetitive over four minutes.
 *
 * Now the genome switches scenes at section boundaries, crossfading over the
 * last two bars, with the order derived from the track. Two drops in the same
 * track get different worlds.
 */
import type * as THREE from "three";
import type { Conductor, Signals } from "../conductor";
import type { Ink } from "../palette";
import type { WorldSeed } from "../seed";

export interface Ctx {
	dt: number;
	s: Signals;
	ink: Ink;
	seed: WorldSeed;
	/** 0..1 crossfade weight for this scene right now */
	weight: number;
	camera: THREE.PerspectiveCamera;
	/** user knobs */
	ctl: { punch: number; bass: number; density: number; kaleido: number; glow: number };
	voice: (role: string) => Signals["voices"][number];
}

export interface Scene {
	readonly name: string;
	readonly object: THREE.Object3D;
	update(ctx: Ctx): void;
	/** where this scene wants the camera, in world space */
	camera(ctx: Ctx): { pos: [number, number, number]; look: [number, number, number]; fov: number };
	dispose(): void;
}

export type SceneFactory = (seed: WorldSeed, conductor: Conductor) => Scene;
