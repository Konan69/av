import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'app');
const vite = path.join(app, 'node_modules/vite/bin/vite.js');
const mode = process.argv[2] || 'dev';
if (!['dev', 'build', 'preview'].includes(mode)) throw new Error(`Unknown web command: ${mode}`);

let currentChild;
let moduleWatcher;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => currentChild?.kill(signal));

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: app, stdio: 'inherit', ...options });
    currentChild = child;
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (currentChild === child) currentChild = undefined;
      if (code === 0) resolve();
      else reject(new Error(`${signal ? `Stopped by ${signal}` : `Command exited with status ${code}`}`));
    });
  });
}

try {
  if (!existsSync(vite) || !existsSync(path.join(app, 'node_modules/react/package.json'))) {
    console.log('Installing browser dependencies from app/package-lock.json…');
    const npmCli = process.env.npm_execpath;
    if (npmCli) await run(process.execPath, [npmCli, 'ci', '--prefix', app, '--no-audit', '--no-fund']);
    else await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--prefix', app, '--no-audit', '--no-fund'], { shell: process.platform === 'win32' });
  }
  const { buildModule } = await import('./build-module.mjs');
  moduleWatcher = await buildModule(undefined, mode === 'dev');
  const extra = process.argv.slice(3);
  if (mode === 'build') {
    await run(process.execPath, [vite, 'build', ...extra]);
  } else {
    const args = mode === 'preview' ? ['preview'] : [];
    args.push('--host', '127.0.0.1', '--port', mode === 'preview' ? '4173' : '5177', '--strictPort', ...extra);
    await run(process.execPath, [vite, ...args]);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (moduleWatcher?.dispose) await moduleWatcher.dispose();
}
