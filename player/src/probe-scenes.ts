/** Which scene does each section of this track get? Proves the ordering is
 *  derived and that repeated labels do not repeat worlds. */
import { readFileSync } from "node:fs";
import { Conductor } from "./conductor";
import { assertGenome } from "./genome";
import { pickScene } from "./scenes";
import { seedFromSha } from "./seed";

const g = assertGenome(JSON.parse(readFileSync(process.argv[2], "utf8")));
const seed = seedFromSha(g.track_sha256);
const c = new Conductor(g, seed);
console.log(`\n${g.source_filename}  seed hue ${seed.hue.toFixed(3)}`);
c.sections.forEach((sec, i) => {
	const mm = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(0).padStart(2, "0")}`;
	console.log(`  ${mm(sec.start)}-${mm(sec.end)}  ${sec.label.padEnd(10)} -> ${pickScene(seed, sec.label, i)}`);
});
