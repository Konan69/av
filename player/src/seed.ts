/**
 * The genome seeds the world. Same track -> same world, every time.
 * Different track -> different physics, symmetry habits, colour logic.
 * All derived from track_sha256, nothing random at runtime.
 */

export function mulberry32(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export interface WorldSeed {
	/** base hue 0..1 — the track's colour identity */
	hue: number;
	/** accent hue offset (radians of the colour wheel, 0.33..0.5 = split/complement) */
	accentShift: number;
	/** kaleidoscope fold counts this track is allowed to use (even numbers) */
	folds: number[];
	/** how many LED hoops the rig has */
	hoops: number;
	/** how many laser beams per emitter */
	beams: number;
	/** laser emitter count (2 or 3) */
	emitters: number;
	/** Lorenz constants — the track's own flavour of chaos */
	sigma: number;
	beta: number;
	/** camera orbit direction */
	spin: 1 | -1;
	/** hoop spiral handedness + pitch */
	helix: number;
	/** bass body: base tessellation twist */
	twist: number;
}

export function seedFromSha(sha: string): WorldSeed {
	const n = parseInt(sha.slice(0, 8), 16);
	const r = mulberry32(n);
	const foldFamilies = [
		[6, 8, 12],
		[8, 10, 16],
		[5, 10, 15],
		[6, 12, 18],
		[7, 14, 21],
	];
	return {
		hue: r(),
		accentShift: 0.33 + r() * 0.2,
		folds: foldFamilies[Math.floor(r() * foldFamilies.length)],
		hoops: 9 + Math.floor(r() * 8), // 9..16
		beams: 10 + Math.floor(r() * 9), // 10..18
		emitters: r() < 0.5 ? 2 : 3,
		sigma: 8 + r() * 6,
		beta: 2 + r() * 1.2,
		spin: r() < 0.5 ? 1 : -1,
		helix: (0.6 + r() * 0.8) * (r() < 0.5 ? 1 : -1),
		twist: 0.5 + r() * 2.5,
	};
}
