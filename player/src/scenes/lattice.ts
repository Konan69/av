/** LATTICE — a 3D grid of wireframe cubes that ignite on transients, after
 *  nw_wrld's CubeCube. Each cube belongs to a voice and a band; a hit lights
 *  the cubes that own it, so the rhythm draws itself in space. The whole
 *  lattice breathes with the pulse voice. */
import * as THREE from "three";
import type { Ctx, Scene } from "./types";

const NX = 7;
const NY = 4;
const NZ = 7;
const SPACING = 2.05;
const N = NX * NY * NZ;
const EDGES: [number, number][] = [
	[0, 1],
	[1, 3],
	[3, 2],
	[2, 0],
	[4, 5],
	[5, 7],
	[7, 6],
	[6, 4],
	[0, 4],
	[1, 5],
	[2, 6],
	[3, 7],
];

export function makeLattice(): Scene {
	const pos = new Float32Array(N * 24 * 3);
	const col = new Float32Array(N * 24 * 3);
	const centers = new Float32Array(N * 3);
	const owner = new Uint8Array(N); // which voice slot owns this cube
	const half = 0.42;
	let w = 0;
	for (let i = 0; i < NX; i++) {
		for (let j = 0; j < NY; j++) {
			for (let k = 0; k < NZ; k++) {
				const idx = (i * NY + j) * NZ + k;
				const cx = (i - (NX - 1) / 2) * SPACING;
				const cy = (j - (NY - 1) / 2) * SPACING + 2.6;
				const cz = (k - (NZ - 1) / 2) * SPACING;
				centers[idx * 3] = cx;
				centers[idx * 3 + 1] = cy;
				centers[idx * 3 + 2] = cz;
				owner[idx] = (i + j * 2 + k * 3) % 6;
				const c: [number, number, number][] = [];
				for (let b = 0; b < 8; b++)
					c.push([cx + (b & 1 ? half : -half), cy + (b & 2 ? half : -half), cz + (b & 4 ? half : -half)]);
				for (const [a, b] of EDGES) {
					for (const p of [c[a], c[b]]) {
						pos[w * 3] = p[0];
						pos[w * 3 + 1] = p[1];
						pos[w * 3 + 2] = p[2];
						w++;
					}
				}
			}
		}
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
	geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
	const mesh = new THREE.LineSegments(
		geo,
		new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }),
	);
	mesh.frustumCulled = false;
	const root = new THREE.Group();
	root.add(mesh);

	const energy = new Float32Array(N);
	const accent = new THREE.Color();
	let spin = 0;

	return {
		name: "LATTICE",
		object: root,
		update(ctx: Ctx) {
			const { s, ink, ctl, weight, dt } = ctx;
			accent.setRGB(ink.accent[0], ink.accent[1], ink.accent[2]);
			const decay = Math.exp(-3.4 * dt);
			for (let i = 0; i < N; i++) energy[i] *= decay;

			// a hit lights every cube that owns that voice, plus a moving cursor
			// so repeated hits do not always light the same cubes
			const cursor = Math.abs(s.downbeatIndex * 7 + Math.floor(s.barPhase * 4) * 13) % N;
			s.voices.forEach((v, slot) => {
				const p = Math.min(2, v.punch * ctl.punch * (v.role === "pulse" ? ctl.bass : 1));
				if (p < 0.12) return;
				for (let i = 0; i < N; i++) {
					if (owner[i] !== slot) continue;
					const near = 1 - Math.min(1, Math.abs(((i - cursor + N) % N) - N / 2) / (N / 2));
					energy[i] = Math.min(1.6, energy[i] + p * (0.35 + 0.9 * near));
				}
			});

			const breathe = 1 + 0.06 * s.rms * ctl.bass + 0.05 * s.beatPulse;
			root.scale.setScalar(breathe);
			spin += dt * (0.03 + 0.12 * Math.abs(s.chaos[1]));
			root.rotation.y = spin * ctx.seed.spin;

			const ca = geo.getAttribute("color") as THREE.BufferAttribute;
			const arr = ca.array as Float32Array;
			for (let i = 0; i < N; i++) {
				const e = energy[i];
				const base = 0.035 + 0.06 * ink.ink;
				const lit = Math.min(1.4, base + e * 1.3) * weight * ctl.glow;
				const useAccent = e > 0.55 && ink.accentAmount > 0.2;
				const r = useAccent ? accent.r * lit : lit;
				const g = useAccent ? accent.g * lit : lit;
				const b = useAccent ? accent.b * lit : lit;
				for (let v = 0; v < 24; v++) {
					const o = (i * 24 + v) * 3;
					arr[o] = r;
					arr[o + 1] = g;
					arr[o + 2] = b;
				}
			}
			ca.needsUpdate = true;
		},
		camera(ctx: Ctx) {
			const { s } = ctx;
			const d = 13 - 3.4 * s.tension - 1.4 * s.drive;
			return {
				pos: [s.chaos[0] * 2.2, 2.6 + s.chaos[2] * 1.2, d],
				look: [0, 2.6, 0],
				fov: 58 + 8 * s.tension,
			};
		},
		dispose() {
			geo.dispose();
			(mesh.material as THREE.Material).dispose();
		},
	};
}
