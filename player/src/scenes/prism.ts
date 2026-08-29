/** PRISM — the kaleidoscope as a distance field. A screen-space quad raymarches
 *  a folded IFS: bass zooms, mids open the fold, air sharpens detail, and the
 *  spin rides the attractor. Vortexia's lesson — fold space in the shader
 *  rather than instancing meshes — but monochrome, with the accent reserved for
 *  the brightest folds. */
import * as THREE from "three";
import { prismFrag, prismVert } from "./prism.frag";
import type { Ctx, Scene } from "./types";

export function makePrism(): Scene {
	const mat = new THREE.ShaderMaterial({
		vertexShader: prismVert,
		fragmentShader: prismFrag,
		uniforms: {
			uRes: { value: new THREE.Vector2(1920, 1080) },
			uTime: { value: 0 },
			uZoom: { value: 0 },
			uFold: { value: 0.5 },
			uDetail: { value: 0.5 },
			uSpin: { value: 0 },
			uInk: { value: 1 },
			uAccentAmount: { value: 0.3 },
			uAccent: { value: new THREE.Color(1, 0.2, 0.2) },
			uPunch: { value: 0 },
		},
		transparent: true,
		depthTest: false,
		depthWrite: false,
	});
	const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
	quad.frustumCulled = false;
	quad.renderOrder = -10; // behind the shared frame elements
	const root = new THREE.Group();
	root.add(quad);

	let spin = 0;
	let zoom = 0;

	return {
		name: "PRISM",
		object: root,
		update(ctx: Ctx) {
			const { s, ink, ctl, weight, dt } = ctx;
			const pulse = ctx.voice("pulse");
			const strike = ctx.voice("strike");
			const filament = ctx.voice("filament");
			const u = mat.uniforms;
			u.uRes.value.set(innerWidth, innerHeight);
			u.uTime.value += dt;
			// bass drives the push into the fractal; it eases back between hits
			const target = 0.55 * pulse.level * ctl.bass + 0.7 * Math.min(1.5, pulse.punch * ctl.punch);
			zoom += (target - zoom) * Math.min(1, dt * 6);
			u.uZoom.value = zoom;
			u.uFold.value = 0.25 + 0.9 * (strike.bands[2] + filament.level * 0.5) + 0.35 * s.tension;
			u.uDetail.value = 0.2 + 1.2 * filament.bright + 0.4 * s.drive;
			spin += dt * (0.05 + 0.35 * Math.abs(s.chaos[1]) + 0.25 * s.tension) * ctx.seed.spin;
			u.uSpin.value = spin + s.chaos[0] * 0.25;
			u.uInk.value = Math.min(1, (0.35 + 0.75 * ink.ink) * weight * ctl.kaleido);
			u.uAccentAmount.value = ink.accentAmount;
			u.uAccent.value.setRGB(ink.accent[0], ink.accent[1], ink.accent[2]);
			u.uPunch.value = Math.min(1.5, strike.punch * ctl.punch);
		},
		camera(ctx: Ctx) {
			// the quad ignores the camera; keep it where the shared floor reads
			const { s } = ctx;
			return { pos: [0, 3.2, 13 - 1.5 * s.tension], look: [0, 2.4, 0], fov: 52 };
		},
		dispose() {
			quad.geometry.dispose();
			mat.dispose();
		},
	};
}
