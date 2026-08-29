/** Write every shader to disk with three.js's prelude so glslangValidator can
 *  compile them. Catches GLSL errors that would otherwise be a black screen. */
import { mkdirSync, writeFileSync } from "node:fs";
import { prismFrag, prismVert } from "./scenes/prism.frag";
import { floorFrag, floorVert, inkFrag, occluderFrag, shellFrag, shellVert, vesselVert } from "./shaders";

const VERT_PRELUDE = `#version 100
precision highp float;
precision highp int;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform vec3 cameraPosition;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
`;
const FRAG_PRELUDE = `#version 100
precision highp float;
precision highp int;
uniform mat4 viewMatrix;
uniform vec3 cameraPosition;
`;

const out = process.argv[2] ?? "/tmp/av-shaders";
mkdirSync(out, { recursive: true });
const files: [string, string][] = [
	["vessel.vert", VERT_PRELUDE + vesselVert],
	["shell.vert", VERT_PRELUDE + shellVert],
	["floor.vert", VERT_PRELUDE + floorVert],
	["ink.frag", FRAG_PRELUDE + "varying float vGlow;\n" + inkFrag.replace("varying float vGlow;", "")],
	["shell.frag", FRAG_PRELUDE + "varying float vGlow;\n" + shellFrag.replace("varying float vGlow;", "")],
	["floor.frag", FRAG_PRELUDE + floorFrag],
	["occluder.frag", FRAG_PRELUDE + occluderFrag],
	["prism.vert", VERT_PRELUDE + prismVert],
	["prism.frag", FRAG_PRELUDE + prismFrag.replace("precision highp float;", "")],
];
for (const [name, src] of files) writeFileSync(`${out}/${name}`, src);
console.log(files.map(([n]) => n).join(" "));
