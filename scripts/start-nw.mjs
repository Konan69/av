import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { hostDir, projectDir, profileDir, run, npm, requireSetup } from './nw-common.mjs';
import { buildModule } from './build-module.mjs';

requireSetup();
await mkdir(profileDir, { recursive: true });
const watcher = await buildModule(projectDir, process.argv.includes('--watch'));
if (!existsSync(path.join(hostDir, 'dist/runtime/main/mainProcess/entry.js')) || !existsSync(path.join(hostDir, 'dist/moduleSandbox.js'))) {
  await run(npm, ['run', 'nw:setup']);
}
const require = createRequire(path.join(hostDir, 'package.json'));
const electron = require('electron');
const extraArgs = process.argv.slice(2).filter(arg => arg !== '--watch');
console.log(`Opening Genome World in nw_wrld. Project: ${projectDir}`);
const child = spawn(electron, [path.join(hostDir, 'src'), ...extraArgs], {
  cwd: hostDir,
  stdio: 'inherit',
  env: { ...process.env, NW_WRLD_PROJECT_DIR: projectDir, NW_WRLD_USER_DATA_DIR: profileDir },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', async error => {
  console.error(error.message);
  if (watcher?.dispose) await watcher.dispose();
  process.exitCode = 1;
});
child.on('exit', async code => {
  if (watcher?.dispose) await watcher.dispose();
  process.exitCode = code ?? 1;
});
