/**
 * THE RIG — a modelled stage, not a filter and not a tunnel.
 *
 *   HOOPS      nested LED rings on a mandala plane. Each ring is bound to a
 *              DISCOVERED voice of this track and morphs between four
 *              geometric states — ring, flower, starburst, spiral — with the
 *              morph COMPLETING on the downbeat that starts the next section.
 *              Ring radius carries that voice's band energies as standing
 *              waves, so the shape is cymatics of one layer, not of the mix.
 *   MIRROR     the whole rig is reflected in the floor, completing every
 *              figure into a full mandala.
 *   LASERS     beam fans from seeded emitters, strobing on the STRIKE voice's
 *              own transients; fan width re-aimed only on downbeats.
 *   POOL       a Chladni plate whose modes are the voices and whose ripples
 *              are the strike voice's ms-accurate onsets.
 *   CORE       the PULSE voice's body, deformed by the measured bass LFO —
 *              you are literally watching the wobble.
 *   HAZE       colour field from the FIELD voice; breathes on every beat so
 *              the grid never disappears.
 *
 * No motion in here is a function of wall-clock time. Continuous drift comes
 * from the conductor's Lorenz state, whose regime follows tension and whose
 * speed follows loudness.
 */
import { useFrame, useThree } from "@react-three/fiber";
import { Bloom, ChromaticAberration, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { useControls } from "leva";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Live } from "./App";
import { KaleidoscopeEffect } from "./kaleido";
import { palette, voiceColor } from "./palette";

const SEG = 96; // points per hoop
const N_RIP = 12;
const POOL_R = 15;
const RIG_Y = 2.7;
const RIG_Z = -3;

/** the four geometric states a hoop morphs between */
function shapeRadius(kind: number, th: number, petals: number): number {
	switch (kind & 3) {
		case 0:
			return 1; // ring
		case 1:
			return 1 + 0.3 * Math.cos(petals * th); // flower
		case 2:
			return 1 + 0.5 * Math.abs(Math.cos(petals * th * 0.5)) ** 6; // starburst
		default:
			return 1 + 0.26 * (th / (Math.PI * 2)); // spiral
	}
}
function shapeLift(kind: number, th: number, helix: number): number {
	return (kind & 3) === 3 ? helix * (th / (Math.PI * 2) - 0.5) : 0;
}

const poolVert = /* glsl */ `
uniform float uV[6];
uniform float uPhase;
uniform vec3 uRip[${N_RIP}];
varying float vH;
varying vec2 vP;
void main() {
  vec2 xy = position.xy;
  float r = length(xy);
  float th = atan(xy.y, xy.x);
  float h = 0.0;
  for (int i = 0; i < 6; i++) {
    float m = 2.0 + float(i);
    float k = 3.0 + float(i) * 2.6;
    h += uV[i] * 0.26 * cos(m * th + float(i) * 1.3) * sin(k * r * 0.24 + uPhase * 0.35);
  }
  for (int i = 0; i < ${N_RIP}; i++) {
    float age = uRip[i].x;
    float s = uRip[i].y;
    if (s <= 0.0) continue;
    float dr = r - 4.0 * age;
    h += s * 0.55 * exp(-2.4 * age) * exp(-dr * dr * 5.0) * sin((7.0 + 3.0 * uRip[i].z) * dr);
  }
  vH = h;
  vP = xy;
  vec3 p = position;
  p.z += h;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const poolFrag = /* glsl */ `
uniform vec3 uBody;
uniform vec3 uAccent;
uniform float uDrive;
varying float vH;
varying vec2 vP;
void main() {
  float r = length(vP);
  float rim = smoothstep(${POOL_R.toFixed(1)}, ${(POOL_R - 3.0).toFixed(1)}, r);
  if (rim <= 0.002) discard;
  float a = abs(vH);
  float node = smoothstep(0.045, 0.0, a);
  float crest = pow(min(1.0, a * 2.4), 1.5);
  vec3 col = uBody * 0.04 + uAccent * crest * (0.6 + 0.8 * uDrive) + (uAccent * 0.5 + vec3(0.4)) * node * 0.8;
  gl_FragColor = vec4(col * rim, 1.0);
}
`;

const coreVert = /* glsl */ `
uniform float uWobPhase;
uniform float uWobDepth;
uniform float uLevel;
uniform float uBands[5];
varying float vGlow;
void main() {
  vec3 n = normalize(normal);
  float lat = atan(n.z, n.x);
  float lon = asin(clamp(n.y, -1.0, 1.0));
  float d = uWobDepth * 0.42 * sin(uWobPhase + 5.0 * lat)
          + uBands[0] * 0.34 * cos(3.0 * lon + uWobPhase * 0.5)
          + uBands[2] * 0.16 * sin(7.0 * lat - uWobPhase * 0.7);
  vGlow = 0.3 + abs(d) * 2.4 + uLevel * 0.7;
  vec3 p = position + n * d * (0.7 + uLevel);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const coreFrag = /* glsl */ `
uniform vec3 uColor;
varying float vGlow;
void main() { gl_FragColor = vec4(uColor * vGlow, 1.0); }
`;

export function World({ live }: { live: Live }) {
	const { conductor, transport, genome, seed } = live;
	const scene = useThree((st) => st.scene);
	const voices = conductor.voices;

	const ctl = useControls("feel", {
		punch: { value: 1, min: 0, max: 3, step: 0.05 },
		bass: { value: 1, min: 0, max: 3, step: 0.05 },
		lasers: { value: 1, min: 0, max: 3, step: 0.05 },
		kaleido: { value: 0.8, min: 0, max: 1.5, step: 0.01 },
		bloom: { value: 1, min: 0, max: 3, step: 0.05 },
	});

	const nHoops = seed.hoops;
	const vColors = useMemo(
		() => voices.map((_, i) => new THREE.Color(...voiceColor(seed, i, voices.length))),
		[seed, voices],
	);

	// ── geometry built once, rewritten every frame ──────────────────────────
	const rig = useMemo(() => {
		const count = nHoops * SEG * 2;
		const mk = (opacity: number) => {
			const geo = new THREE.BufferGeometry();
			geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
			geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
			const mat = new THREE.LineBasicMaterial({
				vertexColors: true,
				transparent: true,
				opacity,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
				toneMapped: false,
			});
			const obj = new THREE.LineSegments(geo, mat);
			obj.frustumCulled = false;
			return obj;
		};
		const hoops = mk(1);
		const mirror = mk(0.32);

		const beamCount = seed.emitters * seed.beams;
		const lgeo = new THREE.BufferGeometry();
		lgeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(beamCount * 2 * 3), 3));
		lgeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(beamCount * 2 * 3), 3));
		const lasers = new THREE.LineSegments(
			lgeo,
			new THREE.LineBasicMaterial({
				vertexColors: true,
				transparent: true,
				opacity: 0.85,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
				toneMapped: false,
			}),
		);
		lasers.frustumCulled = false;

		const emitters: THREE.Vector3[] = [];
		for (let e = 0; e < seed.emitters; e++) {
			const a = seed.emitters === 2 ? (e ? 1 : -1) * 1.0 : (e - 1) * 0.95;
			emitters.push(new THREE.Vector3(Math.sin(a) * 8.5, 5.6 + (e % 2) * 1.1, -7 + Math.cos(a) * 1.5));
		}
		return { hoops, mirror, lasers, emitters, beamCount };
	}, [nHoops, seed]);

	const poolMat = useMemo(
		() =>
			new THREE.ShaderMaterial({
				vertexShader: poolVert,
				fragmentShader: poolFrag,
				uniforms: {
					uV: { value: new Float32Array(6) },
					uPhase: { value: 0 },
					uRip: { value: Array.from({ length: N_RIP }, () => new THREE.Vector3()) },
					uBody: { value: new THREE.Color() },
					uAccent: { value: new THREE.Color() },
					uDrive: { value: 0 },
				},
			}),
		[],
	);

	const coreMat = useMemo(() => {
		const m = new THREE.ShaderMaterial({
			vertexShader: coreVert,
			fragmentShader: coreFrag,
			uniforms: {
				uWobPhase: { value: 0 },
				uWobDepth: { value: 0 },
				uLevel: { value: 0 },
				uBands: { value: new Float32Array(5) },
				uColor: { value: new THREE.Color(1, 1, 1) },
			},
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			toneMapped: false,
		});
		m.wireframe = true;
		return m;
	}, []);

	const kaleido = useMemo(() => new KaleidoscopeEffect(), []);
	const caOffset = useMemo(() => new THREE.Vector2(0.0006, 0.0004), []);
	const keyLight = useRef<THREE.PointLight>(null);

	const st = useRef({
		dbIdx: -1,
		fold: seed.folds[0],
		fan: 0.5,
		kAngle: 0,
		ringPhase: new Float32Array(6),
		body: new THREE.Color(),
		accent: new THREE.Color(),
		haze: new THREE.Color(),
		tmp: new THREE.Color(),
		white: new THREE.Color(1, 1, 1),
	}).current;

	useFrame((state, rawDt) => {
		const dt = Math.min(0.1, rawDt);
		const t = transport.time;
		const s = conductor.sample(t);
		const c = s.chaos;

		const pal = palette(seed, genome.sections.labels, s.probs);
		st.body.setRGB(pal.body[0], pal.body[1], pal.body[2]);
		st.accent.setRGB(pal.accent[0], pal.accent[1], pal.accent[2]);
		st.haze.setRGB(pal.haze[0], pal.haze[1], pal.haze[2]);

		// on each downbeat: re-aim the rig. Nothing changes mid-bar.
		if (s.downbeatIndex !== st.dbIdx) {
			st.dbIdx = s.downbeatIndex;
			st.fold = seed.folds[(Math.abs(s.downbeatIndex) + Math.round(s.drive * 3)) % seed.folds.length];
			st.fan = 0.35 + 0.5 * s.tension + 0.3 * s.drive;
		}

		// shape sequence: deterministic per section, morph completes on the bar
		const secIdx = conductor.sections.indexOf(s.section);
		const hash = (n: number) => (n * 2654435761 + Math.floor(seed.hue * 7919)) >>> 0;
		const shapeA = hash(secIdx + 1) % 4;
		const shapeB = hash(secIdx + 2) % 4;
		const morph = s.morph * s.morph * (3 - 2 * s.morph); // smoothstep

		// ── HOOPS + MIRROR ──────────────────────────────────────────────────
		const hp = rig.hoops.geometry.getAttribute("position") as THREE.BufferAttribute;
		const hc = rig.hoops.geometry.getAttribute("color") as THREE.BufferAttribute;
		const mp = rig.mirror.geometry.getAttribute("position") as THREE.BufferAttribute;
		const mc = rig.mirror.geometry.getAttribute("color") as THREE.BufferAttribute;
		const pos = hp.array as Float32Array;
		const col = hc.array as Float32Array;
		const mpos = mp.array as Float32Array;
		const mcol = mc.array as Float32Array;

		for (let i = 0; i < 6; i++) st.ringPhase[i] += dt * (0.4 + 1.6 * Math.abs(c[i % 3]));
		const spin = c[1] * 0.55 * seed.spin;

		let w = 0;
		const px = new Float32Array(SEG);
		const py = new Float32Array(SEG);
		const pz = new Float32Array(SEG);
		for (let h = 0; h < nHoops; h++) {
			const v = s.voices[h % s.voices.length];
			const vi = h % s.voices.length;
			const base = 1.15 + (h * 7.6) / nHoops;
			const punch = Math.min(2, v.punch * ctl.punch * (v.role === "pulse" ? ctl.bass : 1));
			const z = RIG_Z - h * 0.34 + punch * 0.5;
			const bandGain = v.role === "pulse" ? ctl.bass : 1;

			for (let i = 0; i < SEG; i++) {
				const th = (i / SEG) * Math.PI * 2 + spin + h * 0.11;
				let r = shapeRadius(shapeA, th, 5 + (h % 4)) * (1 - morph) + shapeRadius(shapeB, th, 5 + (h % 4)) * morph;
				// this layer's bands, standing on the ring
				for (let b = 0; b < 5; b++)
					r += v.bands[b] * bandGain * 0.11 * Math.cos((b + 2) * th + st.ringPhase[b] + h * 0.3);
				r += punch * 0.16;
				const rr = base * r;
				const lift =
					shapeLift(shapeA, th, seed.helix) * (1 - morph) + shapeLift(shapeB, th, seed.helix) * morph;
				px[i] = Math.cos(th) * rr;
				py[i] = RIG_Y + Math.sin(th) * rr + lift;
				pz[i] = z;
			}

			// clamped: this is an additive line rig under bloom — unbounded gain
			// is exactly how the earlier builds turned into a white blob
			const glow = Math.min(3.2, 0.22 + 1.5 * v.level + 2.2 * punch + 0.5 * s.beatPulse * (h % 2 === 0 ? 1 : 0.4));
			const cc = vColors[vi];
			st.tmp.copy(cc).lerp(st.white, Math.min(0.65, punch * 0.5 + s.barPulse * 0.15));
			const cr = st.tmp.r * glow;
			const cg = st.tmp.g * glow;
			const cb = st.tmp.b * glow;

			for (let i = 0; i < SEG; i++) {
				const j = (i + 1) % SEG;
				for (const k of [i, j]) {
					pos[w * 3] = px[k];
					pos[w * 3 + 1] = py[k];
					pos[w * 3 + 2] = pz[k];
					mpos[w * 3] = px[k];
					mpos[w * 3 + 1] = -py[k];
					mpos[w * 3 + 2] = pz[k];
					col[w * 3] = cr;
					col[w * 3 + 1] = cg;
					col[w * 3 + 2] = cb;
					mcol[w * 3] = cr * 0.55;
					mcol[w * 3 + 1] = cg * 0.55;
					mcol[w * 3 + 2] = cb * 0.55;
					w++;
				}
			}
		}
		hp.needsUpdate = true;
		hc.needsUpdate = true;
		mp.needsUpdate = true;
		mc.needsUpdate = true;

		// ── LASERS: the strike voice's transients, as beams in haze ─────────
		const strike = s.voices.find((v) => v.role === "strike") ?? s.voices[0];
		const lp = rig.lasers.geometry.getAttribute("position") as THREE.BufferAttribute;
		const lc = rig.lasers.geometry.getAttribute("color") as THREE.BufferAttribute;
		const lpos = lp.array as Float32Array;
		const lcol = lc.array as Float32Array;
		const strikePunch = Math.min(2, strike.punch * ctl.punch);
		const sweep = c[0] * 0.9 + c[2] * 0.25;
		let bi = 0;
		for (let e = 0; e < rig.emitters.length; e++) {
			const o = rig.emitters[e];
			const dir = e % 2 === 0 ? 1 : -1;
			for (let b = 0; b < seed.beams; b++) {
				const f = seed.beams === 1 ? 0 : b / (seed.beams - 1) - 0.5;
				const a = sweep * dir + f * st.fan * 2.2;
				const pitch = -0.35 - f * 0.12 - 0.25 * strike.level;
				const dx = Math.sin(a) * Math.cos(pitch);
				const dy = Math.sin(pitch);
				const dz = Math.cos(a) * Math.cos(pitch);
				const len = 24;
				lpos[bi * 6] = o.x;
				lpos[bi * 6 + 1] = o.y;
				lpos[bi * 6 + 2] = o.z;
				lpos[bi * 6 + 3] = o.x - dx * len;
				lpos[bi * 6 + 4] = o.y + dy * len;
				lpos[bi * 6 + 5] = o.z + dz * len;
				// each beam belongs to a band of the strike voice: it lights when
				// THAT band moves, so the fan flickers like the drum pattern
				const band = strike.bands[b % 5];
				const g = Math.min(
					2.6,
					ctl.lasers *
						(0.05 + 1.9 * strikePunch * (0.35 + 0.65 * Math.abs(Math.cos(f * 6 + sweep * 3))) + 0.5 * band),
				);
				st.tmp.copy(st.accent).lerp(st.white, Math.min(0.8, strikePunch * 0.45));
				for (const end of [0, 1]) {
					const k = bi * 6 + end * 3;
					const fade = end === 0 ? 1 : 0.15;
					lcol[k] = st.tmp.r * g * fade;
					lcol[k + 1] = st.tmp.g * g * fade;
					lcol[k + 2] = st.tmp.b * g * fade;
				}
				bi++;
			}
		}
		lp.needsUpdate = true;
		lc.needsUpdate = true;

		// ── POOL ────────────────────────────────────────────────────────────
		const u = poolMat.uniforms;
		const uv = u.uV.value as Float32Array;
		for (let i = 0; i < 6; i++) {
			const v = s.voices[i];
			uv[i] = v ? v.level * (v.role === "pulse" ? ctl.bass : 1) : 0;
		}
		u.uPhase.value += dt * (0.3 + 2.2 * s.rms);
		const rips = conductor.recentOnsets("strike", t, N_RIP);
		const rvec = u.uRip.value as THREE.Vector3[];
		for (let i = 0; i < N_RIP; i++) {
			const o = rips[i];
			if (o && o.age < 3.5) rvec[i].set(o.age, o.strength * ctl.punch, i % 5);
			else rvec[i].set(0, 0, 0);
		}
		u.uBody.value.copy(st.body);
		u.uAccent.value.copy(st.accent);
		u.uDrive.value = s.drive;

		// ── CORE: the wobble made visible ───────────────────────────────────
		const pulse = s.voices.find((v) => v.role === "pulse") ?? s.voices[0];
		const cu = coreMat.uniforms;
		cu.uWobPhase.value = s.wobblePhase;
		cu.uWobDepth.value = s.wobbleDepth * ctl.bass;
		cu.uLevel.value = pulse.level * ctl.bass + pulse.punch * 0.6;
		(cu.uBands.value as Float32Array).set(pulse.bands);
		cu.uColor.value.copy(st.accent).lerp(st.white, 0.25 + 0.4 * s.beatPulse);

		// ── haze, light, camera — all musically caused ──────────────────────
		if (keyLight.current) {
			keyLight.current.color.copy(st.accent);
			keyLight.current.intensity = 6 + 26 * s.rms + 18 * strikePunch + 10 * s.beatPulse;
		}
		st.haze.multiplyScalar(1 + 0.9 * s.beatPulse * (0.4 + s.drive));
		if (scene.fog instanceof THREE.FogExp2) {
			scene.fog.color.copy(st.haze);
			scene.fog.density = 0.028 - 0.012 * s.drive;
		}
		scene.background = st.haze;

		st.kAngle += dt * (0.05 + 0.35 * s.tension + 0.4 * s.ambiguity);
		kaleido.set(
			st.fold,
			st.kAngle + c[2] * 0.4,
			Math.min(0.65, ctl.kaleido * (0.06 + 0.34 * s.drive + 0.42 * morph * morph)),
		);

		const cam = state.camera as THREE.PerspectiveCamera;
		cam.position.set(
			c[0] * 2.6 * seed.spin,
			2.3 + c[2] * 1.1 + 0.8 * s.tension,
			9.2 - 2.4 * s.tension - 1.4 * s.drive + c[1] * 0.5,
		);
		cam.lookAt(0, RIG_Y - 0.3 + c[1] * 0.35, RIG_Z);
		cam.rotateZ(0.22 * morph * morph * seed.spin + 0.05 * c[1]);
		cam.fov = 58 + 12 * s.tension + 6 * s.drive;
		cam.updateProjectionMatrix();

		const o = 0.0004 + 0.003 * strikePunch + 0.002 * s.drive * s.beatPulse;
		caOffset.set(o, o * 0.6);
	});

	return (
		<>
			<fogExp2 attach="fog" args={[0x000000, 0.028]} />
			<ambientLight intensity={0.1} />
			<pointLight ref={keyLight} position={[0, 6, 0]} intensity={10} decay={1.5} />

			<primitive object={rig.hoops} />
			<primitive object={rig.mirror} />
			<primitive object={rig.lasers} />

			<mesh position={[0, RIG_Y, RIG_Z]} material={coreMat}>
				<icosahedronGeometry args={[1.05, 3]} />
			</mesh>

			<mesh rotation-x={-Math.PI / 2} position={[0, 0, RIG_Z]} material={poolMat}>
				<planeGeometry args={[POOL_R * 2, POOL_R * 2, 200, 200]} />
			</mesh>

			<EffectComposer multisampling={0}>
				<primitive object={kaleido} dispose={null} />
				<Bloom intensity={1.1 * ctl.bloom} luminanceThreshold={0.18} mipmapBlur />
				<ChromaticAberration offset={caOffset} />
				<Vignette offset={0.22} darkness={0.72} />
				<Noise opacity={0.025} />
			</EffectComposer>
		</>
	);
}
