import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {scaffoldProject, upstream} from '../../scripts/nw-common.mjs';
import {moduleBuildOptions, moduleBanner} from '../../scripts/build-module.mjs';
import {build} from 'esbuild';

// The first run creates a usable world; subsequent builds preserve performance edits.
test('workspace scaffold keeps user mappings and config across builds', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'av-workspace-'));
  try {
    await scaffoldProject(directory);
    const filename = path.join(directory, 'nw_wrld_data/json/userData.json');
    const initial = JSON.parse(await readFile(filename, 'utf8'));
    const track = initial.sets[0].tracks[0];
    assert.deepEqual(track.modules, [{id: 'genome_world_1', type: 'GenomeWorld'}]);
    assert.equal(initial.config.sequencerMuted, true);
    track.name = 'My performance';
    await writeFile(filename, JSON.stringify(initial));
    await scaffoldProject(directory);
    assert.equal(JSON.parse(await readFile(filename, 'utf8')).sets[0].tracks[0].name, 'My performance');
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('workspace bundle uses host THREE and has no unresolved runtime imports', async () => {
  const result = await build({...moduleBuildOptions(), write: false, metafile: true, logLevel: 'silent'});
  const module = result.outputFiles[0].text;
  assert.ok(module.startsWith(moduleBanner));
  assert.match(module, /export\s*\{[\s\S]*as default/);
  assert.doesNotMatch(module, /^import\s/m);
  assert.doesNotMatch(module, /import\.meta\.env/);
  assert.match(module, /globalThis\.THREE\.WebGLRenderer/);
  assert.match(module, /assetUrl\(audio\)/);
  const inputs = Object.keys(result.metafile.inputs);
  assert.ok(inputs.some(name => name.endsWith('player/src/world/resonance.ts')));
  assert.ok(!inputs.some(name => /three\.(module|core)\.js$/.test(name)), 'second copy of THREE would break the shared host scene');
  assert.ok(inputs.some(name => name.endsWith('player/src/conductor.ts')));
  assert.ok(inputs.some(name => name.endsWith('player/src/world/MusicWorld.ts')));
});

test('upstream pin and sandbox patch restrict analyzer permission to its origin', async () => {
  assert.match(upstream.commit, /^[a-f0-9]{40}$/);
  const patch = await readFile(new URL('../patches/analyzer-csp.patch', import.meta.url), 'utf8');
  const additions = patch.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).join('\n');
  assert.match(additions, /https:\/\/YOUR-WORKSPACE--genome-analyzer-analyzer-web\.modal\.run/);
  assert.doesNotMatch(additions, /connect-src[^;]*(?:\*|https:\s)/);
});
