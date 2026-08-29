/**
 * THE JOURNEY — one continuous world, and you fly through it.
 *
 * The previous build failed three ways at once: a full-screen fractal with a
 * fixed camera reads as wallpaper, four unrelated scenes cannot tell a story,
 * and nothing ever passed the camera so nothing felt three-dimensional.
 *
 * So: the track is laid out IN SPACE. Bar i sits at z = -i * SPACING and the
 * camera advances exactly one bar per bar, which means
 *
 *   - what is ahead of you is the part of the song that has not played yet.
 *     The drop is a wall of structure you watch approach from eight bars out.
 *     That is the lookahead, made visible.
 *   - depth is real: gates rush past, fog swallows the far ones, the rails
 *     converge. Parallax does the work no amount of post could fake.
 *   - there are no cuts. Sections change what the architecture is MADE of, and
 *     because that is a property of the region you are flying through, the
 *     change arrives as travel rather than as an edit.
 *
 * Each gate is a K-fold mirrored ring — the kaleidoscope the author liked, but as
 * something you pass through rather than something painted on the screen.
 */
import * as THREE from "three";
import type { BarSpec, Layout } from "../bars";
import { inkFrag, occluderFrag, vesselVert } from "../shaders";
import { prismFrag, prismVert } from "./prism.frag";
import type { Ctx, Scene } from "./types";

const SPACING = 12; // world units per BEAT — one beat of travel per beat heard
const AHEAD = 24; // gates rendered ahead — more than this piles into a white blob at the vanishing point
const BEHIND = 2;
const MAX_GATES = AHEAD + BEHIND + 1;
const MAX_FOLD = 24;
const RING_SEG = 96;
const RING_COPIES = 2; // LineBasicMaterial ignores linewidth — fake weight with copies
const CORE_RINGS = 11;
const CORE_SEG = 56;

/** the four silhouettes a gate ring can take, blended per region */
function shapeR(kind: number, th: number, petals: number): number {
	switch (kind & 3) {
		case 0:
			return 1;
		case 1:
			return 1 + 0.3 * Math.cos(petals * th);
		case 2:
			return 1 + 0.5 * Math.abs(Math.cos(petals * th * 0.5)) ** 8;
		default:
			return 1 + 0.18 * Math.cos(petals * th);
	}
}

function coreLines(): THREE.BufferGeometry {
	const pos: number[] = [];
	for (let ri = 0; ri < CORE_RINGS; ri++) {
		const lv = ri / (CORE_RINGS - 1);
		for (let i = 0; i < CORE_SEG; i++)
			pos.push((i / CORE_SEG) * Math.PI * 2, lv, 0, ((i + 1) / CORE_SEG) * Math.PI * 2, lv, 0);
	}
	for (let i = 0; i < CORE_SEG; i += 7) {
		const a = (i / CORE_SEG) * Math.PI * 2;
		for (let ri = 0; ri < CORE_RINGS - 1; ri++)
			pos.push(a, ri / (CORE_RINGS - 1), 0, a, (ri + 1) / (CORE_RINGS - 1), 0);
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
	return g;
}

function coreSolid(): THREE.BufferGeometry {
	const pos: number[] = [];
	for (let ri = 0; ri < CORE_RINGS - 1; ri++) {
		const l0 = ri / (CORE_RINGS - 1);
		const l1 = (ri + 1) / (CORE_RINGS - 1);
		for (let i = 0; i < CORE_SEG; i++) {
			const a = (i / CORE_SEG) * Math.PI * 2;
			const b = ((i + 1) / CORE_SEG) * Math.PI * 2;
			pos.push(a, l0, 0, b, l0, 0, b, l1, 0, a, l0, 0, b, l1, 0, a, l1, 0);
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
	return g;
}

export function makeJourney(layout: Layout): Scene {
	const { bars, gates: gateList } = layout;
	const root = new THREE.Group();

	// ── the void you are flying toward: the IFS, far away and dim ───────────
	const backdropMat = new THREE.ShaderMaterial({
		vertexShader: prismVert,
		fragmentShader: prismFrag,
		uniforms: {
			uRes: { value: new THREE.Vector2(1920, 1080) },
			uTime: { value: 0 },
			uZoom: { value: 0 },
			uFold: { value: 0.5 },
			uDetail: { value: 0.5 },
			uSpin: { value: 0 },
			uInk: { value: 0.25 },
			uAccentAmount: { value: 0.15 },
			uAccent: { value: new THREE.Color(1, 0.3, 0.2) },
			uPunch: { value: 0 },
		},
		transparent: true,
		depthTest: false,
		depthWrite: false,
	});
	const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), backdropMat);
	backdrop.frustumCulled = false;
	backdrop.renderOrder = -100;

	// ── gates: K-fold mirrored blades, one ring per bar ─────────────────────
	const blade = new THREE.ConeGeometry(0.5, 1, 4);
	blade.translate(0, 0.5, 0);
	const gateMat = new THREE.MeshBasicMaterial({
		transparent: true,
		depthWrite: false,
		fog: true,
		toneMapped: false,
	});
	const gates = new THREE.InstancedMesh(blade, gateMat, MAX_GATES * MAX_FOLD);
	gates.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
	gates.frustumCulled = false;

	// ── gate rings: the kaleidoscopic silhouette of each bar ────────────────
	const ringGeo = new THREE.BufferGeometry();
	const ringVerts = MAX_GATES * RING_SEG * 2 * RING_COPIES;
	ringGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(ringVerts * 3), 3));
	ringGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(ringVerts * 3), 3));
	const rings = new THREE.LineSegments(
		ringGeo,
		new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: true }),
	);
	rings.frustumCulled = false;

	// ── rails: perspective you can read, without a noisy grid ───────────────
	const railGeo = new THREE.BufferGeometry();
	const railVerts = MAX_GATES * 8;
	railGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(railVerts * 3), 3));
	railGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(railVerts * 3), 3));
	const rails = new THREE.LineSegments(
		railGeo,
		new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: true }),
	);
	rails.frustumCulled = false;

	// ── the core: the one thing that travels WITH you, morphing per phrase ──
	const coreU = {
		uKindA: { value: 0 },
		uKindB: { value: 1 },
		uMorph: { value: 0 },
		uPetals: { value: 5 },
		uBands: { value: new Float32Array(5) },
		uWobPhase: { value: 0 },
		uWobDepth: { value: 0 },
		uPhase: { value: 0 },
		uPunch: { value: 0 },
		uHeight: { value: 3.1 },
		uScale: { value: 1.15 },
		uColor: { value: new THREE.Color(1, 1, 1) },
		uInk: { value: 0.8 },
	};
	const coreLine = new THREE.LineSegments(
		coreLines(),
		new THREE.ShaderMaterial({
			vertexShader: vesselVert,
			fragmentShader: inkFrag,
			uniforms: coreU,
			transparent: true,
			depthWrite: false,
		}),
	);
	const coreOcc = new THREE.Mesh(
		coreSolid(),
		new THREE.ShaderMaterial({
			vertexShader: vesselVert,
			fragmentShader: occluderFrag,
			uniforms: coreU,
			colorWrite: false,
			depthWrite: true,
			side: THREE.DoubleSide,
		}),
	);
	const core = new THREE.Group();
	coreOcc.renderOrder = 1;
	coreLine.renderOrder = 2;
	core.add(coreOcc, coreLine);
	for (const o of [coreLine, coreOcc]) o.frustumCulled = false;

	// The corridor IS the subject. The backdrop smudged the contrast and the
	// core sat in the middle of the frame blocking the very thing you fly
	// through, so both are held back: the core rides low and small, the
	// backdrop is off until it earns its place.
	root.add(gates, rings, rails);

	const dummy = new THREE.Object3D();
	const white = new THREE.Color(1, 1, 1);
	const accent = new THREE.Color();
	const tmp = new THREE.Color();
	let spin = 0;
	let corePhase = 0;
	let backSpin = 0;
	let zoom = 0;
	const state = { camZ: 0, look: new THREE.Vector3() };

	const gateAt = (i: number) => gateList[i];
	const barOf = (i: number): BarSpec | undefined => bars[gateList[i]?.bar ?? -1];

	return {
		name: "JOURNEY",
		object: root,
		update(ctx: Ctx) {
			const { s, ink, ctl, dt, seed } = ctx;
			accent.setRGB(ink.accent[0], ink.accent[1], ink.accent[2]);
			const pulse = ctx.voice("pulse");
			const strike = ctx.voice("strike");
			const filament = ctx.voice("filament");
			const pu = (v: typeof pulse, g = 1) => Math.min(2, v.punch * ctl.punch * g);

			// the odometer runs on beats: one beat of travel per beat heard
			const beatFloat = Math.max(0, s.beatIndex + s.beatPhase);
			state.camZ = -beatFloat * SPACING;
			spin += dt * (0.05 + 0.4 * Math.abs(s.chaos[1]) + 0.25 * s.tension) * seed.spin;

			const b0 = Math.max(0, Math.floor(beatFloat) - BEHIND);
			let gi = 0;
			let rv = 0;
			let rl = 0;
			const rp = ringGeo.getAttribute("position") as THREE.BufferAttribute;
			const rc = ringGeo.getAttribute("color") as THREE.BufferAttribute;
			const rpos = rp.array as Float32Array;
			const rcol = rc.array as Float32Array;
			const lp = railGeo.getAttribute("position") as THREE.BufferAttribute;
			const lc = railGeo.getAttribute("color") as THREE.BufferAttribute;
			const lpos = lp.array as Float32Array;
			const lcol = lc.array as Float32Array;
			rpos.fill(0);
			rcol.fill(0);
			lpos.fill(0);
			lcol.fill(0);

			for (let n = 0; n < MAX_GATES; n++) {
				const bi = b0 + n;
				const gate = gateAt(bi);
				const bar = barOf(bi);
				if (!gate || !bar) continue;
				const z = -bi * SPACING;
				const dz = z - state.camZ; // negative = ahead of us
				const dist = Math.abs(dz);
				// the bar you are inside right now is the brightest thing in frame
				const nowness = Math.max(0, 1 - Math.abs(bi - beatFloat) / 1.2);
				const near = Math.max(0, 1 - dist / (SPACING * AHEAD)) ** 1.6;
				const live = bi <= beatFloat + 0.001;
				// downbeats are the architecture; the beats between are lighter
				const R = bar.radius * (gate.down ? 1 : 0.78);
				const fold = gate.down ? bar.fold : Math.max(4, Math.round(bar.fold / 2));
				const gateSpin = spin + bi * 0.13 * seed.helix;
				const petals = 3 + (fold % 5);

				// blades: pointing inward, so a gate reads as an iris you pass through
				const bladeLen = R * (0.20 + 0.20 * bar.energy + 0.14 * bar.bands[0] + 0.16 * nowness * pu(pulse, ctl.bass));
				const bright =
					(0.6 + 2.0 * bar.energy + 1.4 * bar.drive) * (0.35 + 0.9 * near) +
					2.6 * nowness * (0.4 + pu(strike));
				// colour is scarce: only the gate you are passing takes the accent
				// colour is scarce: the gate you are passing takes the accent, and a
				// strike hit briefly lends it to its neighbours
				const strikeLend = Math.min(0.55, pu(strike) * 0.5) * (bar.drive > 0.3 ? 1 : 0.4);
				const accMix = Math.min(1, nowness * (0.55 + ink.accentAmount) + strikeLend * near * 0.5);
				tmp.copy(white).lerp(accent, accMix).multiplyScalar(Math.min(1.9, bright * ctl.glow * (live ? 1 : 0.5)));

				for (let k = 0; k < MAX_FOLD; k++) {
					if (gi >= MAX_GATES * MAX_FOLD) break;
					if (k >= fold) {
						dummy.scale.set(0, 0, 0);
						dummy.position.set(0, 0, 0);
						dummy.updateMatrix();
						gates.setMatrixAt(gi, dummy.matrix);
						gi++;
						continue;
					}
					const a = (k / fold) * Math.PI * 2 + gateSpin;
					const mir = k % 2 === 0 ? 1 : -1;
					const dirx = Math.cos(a);
					const diry = Math.sin(a);
					dummy.position.set(dirx * R, diry * R, z);
					// blades point INWARD toward the axis
					dummy.quaternion.setFromUnitVectors(
						new THREE.Vector3(0, 1, 0),
						new THREE.Vector3(-dirx, -diry, 0.12 * mir).normalize(),
					);
					const w = 0.05 + 0.09 * bar.bands[3] + 0.05 * nowness;
					dummy.scale.set(w, bladeLen * (k % 4 === 0 ? 1.4 : k % 2 === 0 ? 1 : 0.7), w);
					dummy.updateMatrix();
					gates.setMatrixAt(gi, dummy.matrix);
					gates.setColorAt(gi, tmp);
					gi++;
				}

				// the ring silhouette — the kaleidoscope, seen edge-on as you approach
				const kind = bar.style; // 0 circle · 1 flower · 2 star — no lumpy blends
				const ringBright = Math.min(
					3.4,
					(0.7 + 1.9 * bar.tension + 1.6 * bar.drive) * (0.45 + 0.85 * near) +
						2.4 * nowness +
						1.1 * pu(strike) * near,
				);
				tmp.copy(white).lerp(accent, accMix * 0.85).multiplyScalar(Math.min(2.8, ringBright * ctl.glow * (live ? 1 : 0.55)));
				for (let copy = 0; copy < RING_COPIES; copy++) {
					const off = (copy - (RING_COPIES - 1) / 2) * 0.004;
					let px = 0;
					let py = 0;
					for (let i = 0; i <= RING_SEG; i++) {
						const th = (i / RING_SEG) * Math.PI * 2 + gateSpin;
						const rr = R * (0.9 + off + 0.5 * (shapeR(kind, th, petals) - 1));
						const x = Math.cos(th) * rr;
						const y = Math.sin(th) * rr;
						if (i > 0 && rv + 2 <= ringVerts) {
							for (const [ax, ay] of [
								[px, py],
								[x, y],
							]) {
								rpos[rv * 3] = ax;
								rpos[rv * 3 + 1] = ay;
								rpos[rv * 3 + 2] = z;
								rcol[rv * 3] = tmp.r;
								rcol[rv * 3 + 1] = tmp.g;
								rcol[rv * 3 + 2] = tmp.b;
								rv++;
							}
						}
						px = x;
						py = y;
					}
				}

				// rails: four lines running bar to bar, converging to the horizon
				const nb = barOf(bi + 1);
				if (nb && dist > SPACING * 2.5 && rl + 8 <= railVerts) {
					const z2 = -(bi + 1) * SPACING;
					const nR = nb.radius * (gateAt(bi + 1)?.down ? 1 : 0.78);
					const railC = Math.min(1.6, (0.14 + 0.5 * bar.energy) * (0.25 + 0.9 * near) + 1.1 * nowness);
					tmp.copy(white).multiplyScalar(railC * (live ? 1 : 0.45));
					const corners: [number, number, number, number][] = [
						[-R, -R * 0.62, -nR, -nR * 0.62],
						[R, -R * 0.62, nR, -nR * 0.62],
						[-R, R * 0.62, -nR, nR * 0.62],
						[R, R * 0.62, nR, nR * 0.62],
					];
					for (const [x1, y1, x2, y2] of corners) {
						lpos[rl * 3] = x1;
						lpos[rl * 3 + 1] = y1;
						lpos[rl * 3 + 2] = z;
						lcol[rl * 3] = tmp.r;
						lcol[rl * 3 + 1] = tmp.g;
						lcol[rl * 3 + 2] = tmp.b;
						rl++;
						lpos[rl * 3] = x2;
						lpos[rl * 3 + 1] = y2;
						lpos[rl * 3 + 2] = z2;
						lcol[rl * 3] = tmp.r * 0.7;
						lcol[rl * 3 + 1] = tmp.g * 0.7;
						lcol[rl * 3 + 2] = tmp.b * 0.7;
						rl++;
					}
				}
			}
			if (typeof window !== "undefined")
				(window as unknown as { __dbg: unknown }).__dbg = {
					beatFloat,
					camZ: state.camZ,
					b0,
					gatesWritten: gi,
					ringVertsWritten: rv,
					firstBar: barOf(b0)?.index ?? null,
					firstR: barOf(b0)?.radius ?? null,
					ink: ink.ink,
					gateCount: gateList.length,
				};
			gates.count = MAX_GATES * MAX_FOLD;
			gates.instanceMatrix.needsUpdate = true;
			if (gates.instanceColor) gates.instanceColor.needsUpdate = true;
			rp.needsUpdate = true;
			rc.needsUpdate = true;
			lp.needsUpdate = true;
			lc.needsUpdate = true;

			// ── the core travels with us ────────────────────────────────────
			const di = Math.max(0, s.downbeatIndex);
			const phrase = Math.floor(di / 8);
			const barsIn = (di % 8) + s.barPhase;
			const hash = (n: number) => ((n * 2654435761 + Math.floor(seed.hue * 7919)) >>> 0) % 4;
			const m = Math.max(0, Math.min(1, (barsIn - 6) / 2));
			corePhase += dt * (0.06 + 0.4 * Math.abs(s.chaos[0]));
			coreU.uKindA.value = hash(phrase);
			coreU.uKindB.value = hash(phrase + 1);
			coreU.uMorph.value = m * m * (3 - 2 * m);
			coreU.uPetals.value = 3 + (Math.abs(s.sectionIndex) % 5);
			(coreU.uBands.value as Float32Array).set(pulse.bands);
			coreU.uWobPhase.value = s.wobblePhase;
			coreU.uWobDepth.value = s.wobbleDepth * ctl.bass;
			coreU.uPhase.value = corePhase;
			coreU.uPunch.value = pu(pulse, ctl.bass) * 0.5;
			coreU.uScale.value = 1.0 + 0.3 * s.tension + 0.25 * pu(pulse, ctl.bass);
			coreU.uColor.value.copy(white).lerp(accent, Math.min(0.8, ink.accentAmount * (0.2 + 0.8 * pu(strike))));
			coreU.uInk.value = Math.min(1, 0.35 + 0.8 * ink.ink * (0.5 + 0.6 * s.rms));
			core.position.set(0, -2.4, state.camZ - SPACING * 5);
			core.rotation.z = spin * 0.35;

			// ── backdrop: the void at the vanishing point ───────────────────
			const bu = backdropMat.uniforms;
			bu.uRes.value.set(innerWidth, innerHeight);
			bu.uTime.value += dt;
			const target = 0.35 * pulse.level * ctl.bass + 0.5 * Math.min(1.5, pulse.punch * ctl.punch);
			zoom += (target - zoom) * Math.min(1, dt * 5);
			bu.uZoom.value = zoom;
			bu.uFold.value = 0.25 + 0.8 * (strike.bands[2] + filament.level * 0.5) + 0.3 * s.tension;
			bu.uDetail.value = 0.2 + 1.0 * filament.bright + 0.35 * s.drive;
			backSpin += dt * (0.03 + 0.2 * Math.abs(s.chaos[2])) * seed.spin;
			bu.uSpin.value = backSpin;
			// deliberately faint: it is the sky, not the subject
			bu.uInk.value = Math.min(0.55, (0.06 + 0.3 * s.drive + 0.16 * s.tension) * ctl.kaleido);
			bu.uAccentAmount.value = ink.accentAmount * 0.5;
			bu.uAccent.value.copy(accent);
			bu.uPunch.value = Math.min(1.2, strike.punch * ctl.punch * 0.5);
		},
		camera(ctx: Ctx) {
			const { s } = ctx;
			const beatFloat = Math.max(0, s.beatIndex + s.beatPhase);
			const z = -beatFloat * SPACING;
			// the sway is small: the sensation of speed comes from what passes you
			return {
				pos: [s.chaos[0] * 1.6, 0.4 + s.chaos[2] * 0.9, z + 3.2],
				look: [s.chaos[1] * 0.7, 0.2, z - SPACING * 8],
				fov: 66 + 8 * s.tension + 6 * s.drive,
			};
		},
		dispose() {
			blade.dispose();
			ringGeo.dispose();
			railGeo.dispose();
			backdrop.geometry.dispose();
			backdropMat.dispose();
		},
	};
}
