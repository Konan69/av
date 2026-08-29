/**
 * Scene selection is DERIVED, like everything else. Each section picks from the
 * pool its label allows, offset by the track hash and the section index — so
 * drop 1 and drop 2 of the same track are different worlds, and two different
 * tracks order their scenes differently. That is the fix for "repetitive".
 */
import type { Conductor } from "../conductor";
import type { WorldSeed } from "../seed";
import { makeLattice } from "./lattice";
import { makePrism } from "./prism";
import { makeTrace } from "./trace";
import type { Scene, SceneFactory } from "./types";
import { makeVessel } from "./vessel";

export const FACTORIES: Record<string, SceneFactory> = {
	VESSEL: () => makeVessel(),
	LATTICE: () => makeLattice(),
	TRACE: (_seed, conductor) => makeTrace(_seed, conductor),
	PRISM: () => makePrism(),
};

const POOLS: Record<string, string[]> = {
	intro: ["TRACE", "VESSEL"],
	buildup: ["LATTICE", "VESSEL"],
	drop: ["PRISM", "VESSEL", "LATTICE"],
	breakdown: ["TRACE", "LATTICE"],
	outro: ["VESSEL", "TRACE"],
	silence: ["TRACE"],
};

export function pickScene(seed: WorldSeed, label: string, sectionIndex: number): string {
	const pool = POOLS[label] ?? POOLS.intro;
	const h = ((sectionIndex * 2654435761 + Math.floor(seed.hue * 104729)) >>> 0) % pool.length;
	return pool[h];
}

export function buildScenes(seed: WorldSeed, conductor: Conductor): Record<string, Scene> {
	const out: Record<string, Scene> = {};
	for (const [name, f] of Object.entries(FACTORIES)) out[name] = f(seed, conductor);
	return out;
}

export type { Ctx, Scene } from "./types";
