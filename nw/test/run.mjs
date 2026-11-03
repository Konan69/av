import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const result = spawnSync(process.execPath, ['--test', fileURLToPath(new URL('./integration.test.mjs', import.meta.url)), fileURLToPath(new URL('./workspace.test.mjs', import.meta.url)), fileURLToPath(new URL('./projectorWindow.test.mjs', import.meta.url)), fileURLToPath(new URL('./recording-gallery.test.mjs', import.meta.url))], {stdio: 'inherit'});
process.exitCode = result.status ?? 1;
