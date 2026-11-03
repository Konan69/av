import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { root, upstream, hostDir, npm, run, scaffoldProject } from './nw-common.mjs';

await mkdir(path.dirname(hostDir), { recursive: true });
if (!existsSync(path.join(hostDir, '.git'))) {
  if (existsSync(hostDir)) throw new Error(`${hostDir} exists but is not a Git checkout; move it aside first.`);
  await run('git', ['clone', '--filter=blob:none', upstream.repository, hostDir]);
  await run('git', ['checkout', '--detach', upstream.commit], { cwd: hostDir });
}
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: hostDir, encoding: 'utf8' }).trim();
if (head !== upstream.commit) throw new Error(`Host is at ${head}; expected ${upstream.commit}. Existing checkout left intact.`);
for (const patch of upstream.patches) {
  const absolute = path.join(root, patch);
  try { execFileSync('git', ['apply', '--reverse', '--check', absolute], { cwd: hostDir, stdio: 'ignore' }); }
  catch {
    await run('git', ['apply', '--check', absolute], { cwd: hostDir });
    await run('git', ['apply', absolute], { cwd: hostDir });
  }
}
const installStamp = path.join(hostDir, '.av-install-commit');
const installedCommit = existsSync(installStamp) ? (await readFile(installStamp, 'utf8')).trim() : '';
if (installedCommit !== upstream.commit || !existsSync(path.join(hostDir, 'node_modules/electron/dist'))) {
  await run(npm, ['ci', '--no-audit', '--no-fund'], { cwd: hostDir });
  await writeFile(installStamp, `${upstream.commit}\n`);
}
await scaffoldProject();
await run(npm, ['run', 'build:runtime'], { cwd: hostDir });
const hash = createHash('sha256').update(upstream.commit);
for (const patch of upstream.patches) hash.update(await readFile(path.join(root, patch)));
const buildFingerprint = hash.digest('hex');
const buildStamp = path.join(hostDir, '.av-renderer-inputs');
const lastBuild = existsSync(buildStamp) ? (await readFile(buildStamp, 'utf8')).trim() : '';
if (process.argv.includes('--build') || lastBuild !== buildFingerprint || !existsSync(path.join(hostDir, 'dist/moduleSandbox.js'))) {
  await run(npm, ['run', 'build'], { cwd: hostDir });
  await writeFile(buildStamp, `${buildFingerprint}\n`);
}
console.log(`nw_wrld ${upstream.version} ready at ${hostDir}`);
