/** Headless check of the brain: voice casting + conductor signals, on a real
 *  genome. No DOM, no GPU — proves the mapping before anything is rendered. */
import { readFileSync } from "node:fs";
import { Conductor } from "./src/conductor";
import { assertGenome } from "./src/genome";
import { seedFromSha } from "./src/seed";
import { discoverVoices } from "./src/voices";

const g = assertGenome(JSON.parse(readFileSync(process.argv[2], "utf8")));
const seed = seedFromSha(g.track_sha256);
const voices = discoverVoices(g);

console.log(`\n${g.source_filename}  ${g.duration.toFixed(1)}s  ${g.beats.bpm} bpm  sha ${g.track_sha256.slice(0, 8)}`);
console.log(`world seed: hue ${seed.hue.toFixed(3)} folds [${seed.folds}] hoops ${seed.hoops} beams ${seed.beams}x${seed.emitters} sigma ${seed.sigma.toFixed(1)} spin ${seed.spin}`);
console.log("\nCAST (discovered, not authored)");
for (const v of voices)
	console.log(
		`  ${v.role.padEnd(9)} ${v.stem.padEnd(7)} share ${(v.share * 100).toFixed(1).padStart(5)}%  onsets/s ${v.onsetRate.toFixed(2).padStart(5)}  centroid ${v.brightness.toFixed(0).padStart(5)}Hz  low ${(v.lowRatio * 100).toFixed(0)}%`,
	);

const c = new Conductor(g, seed);
const N = 4000;
let bad = 0;
const rng = { level: [1, 0], punch: [1, 0], chaos: [1, 0], morph: [1, 0], amb: [1, 0] } as Record<string, number[]>;
const upd = (k: string, x: number) => {
	rng[k][0] = Math.min(rng[k][0], x);
	rng[k][1] = Math.max(rng[k][1], x);
};
for (let i = 0; i < N; i++) {
	const t = (i / N) * g.duration;
	const s = c.sample(t);
	const nums = [s.morph, s.beatPhase, s.barPhase, s.rms, s.tension, s.ambiguity, s.drive, s.wobblePhase, ...s.chaos];
	for (const v of s.voices) nums.push(v.level, v.punch, v.bright, ...v.bands);
	if (nums.some((n) => !Number.isFinite(n))) {
		bad++;
		if (bad < 3) console.log(`  NaN at t=${t.toFixed(2)}`);
	}
	upd("morph", s.morph);
	upd("amb", s.ambiguity);
	for (const k of [0, 1, 2]) upd("chaos", s.chaos[k]);
	for (const v of s.voices) {
		upd("level", v.level);
		upd("punch", v.punch);
	}
}
console.log(`\nSIGNAL SWEEP  ${N} frames, non-finite: ${bad}`);
for (const [k, [lo, hi]] of Object.entries(rng)) console.log(`  ${k.padEnd(6)} ${lo.toFixed(3)} … ${hi.toFixed(3)}`);

console.log("\nMORPH LANDS ON THE BAR");
for (let si = 1; si < c.sections.length; si++) {
	const b = c.sections[si].start;
	const before = c.sample(b - 0.05).morph;
	const db = c.downbeats.find((d) => d >= b - 0.12) ?? b;
	console.log(
		`  boundary ${b.toFixed(2)}s -> ${c.sections[si].label.padEnd(9)} snapped downbeat ${db.toFixed(2)}s  morph just before: ${before.toFixed(2)}`,
	);
}

console.log("\nFRAMES");
const probe = [
	["intro", g.sections.hard[0].start + 4],
	["mid drop 1", c.sections.find((s) => s.label === "drop")!.start + 8],
	["most ambiguous", 0],
] as [string, number][];
let worst = { t: 0, a: -1 };
for (let i = 0; i < 2000; i++) {
	const t = (i / 2000) * g.duration;
	const a = c.sample(t).ambiguity;
	if (a > worst.a) worst = { t, a };
}
probe[2][1] = worst.t;
for (const [name, t] of probe) {
	const s = c.sample(t);
	console.log(
		`  ${name.padEnd(15)} t=${t.toFixed(1)}s  ${s.section.label.padEnd(9)} amb ${s.ambiguity.toFixed(2)} tension ${s.tension.toFixed(2)} drive ${s.drive.toFixed(2)} wobDepth ${s.wobbleDepth.toFixed(2)}`,
	);
	console.log(`    ${s.voices.map((v) => `${v.role}:${v.level.toFixed(2)}`).join("  ")}`);
}
console.log();
