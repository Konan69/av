import { build, context } from 'esbuild';
import * as THREE from 'three';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, projectDir, scaffoldProject } from './nw-common.mjs';

export const moduleBanner = `/*
@nwWrld name: GenomeWorld
@nwWrld category: 3D
@nwWrld imports: ModuleBase, assetUrl
*/`;

export function moduleBuildOptions(destination = projectDir) {
  return {
    entryPoints: [path.join(root, 'nw/src/GenomeWorld.ts')],
    outfile: path.join(destination, 'modules/GenomeWorld.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'chrome120',
    sourcemap: false,
    banner: { js: moduleBanner },
    define: {
      'import.meta.env.DEV': 'false',
      'import.meta.env.VITE_GENOME_URL': JSON.stringify('https://YOUR-WORKSPACE--genome-analyzer-analyzer-web.modal.run'),
    },
    plugins: [{
      name: 'nw-wrld-shared-three',
      setup(builder) {
        builder.onResolve({ filter: /^three\/addons\// }, args => ({ path: path.join(root, 'node_modules/three/examples/jsm', args.path.slice('three/addons/'.length)) }));
        builder.onResolve({ filter: /^three\/examples\// }, args => ({ path: path.join(root, 'node_modules', args.path) }));
        builder.onResolve({ filter: /^three$/ }, () => ({ path: 'three', namespace: 'nw-sdk' }));
        builder.onLoad({ filter: /.*/, namespace: 'nw-sdk' }, () => ({
          contents: Object.keys(THREE).filter(name => /^[A-Za-z_$][\w$]*$/.test(name)).map(name => `export const ${name} = globalThis.THREE.${name};`).join('\n'),
          loader: 'js',
        }));
      },
    }],
    logLevel: 'info',
  };
}

export async function buildModule(destination = projectDir, watch = false) {
  await scaffoldProject(destination);
  if (watch) {
    const watcher = await context(moduleBuildOptions(destination));
    await watcher.rebuild();
    await watcher.watch();
    return watcher;
  }
  return build(moduleBuildOptions(destination));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildModule(projectDir, process.argv.includes('--watch'));
}
