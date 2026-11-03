import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { existsSync, constants } from 'node:fs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const upstream = JSON.parse(await readFile(path.join(root, 'nw/upstream.json'), 'utf8'));
export const hostDir = path.join(root, '.runtime/nw_wrld');
export const projectDir = path.resolve(process.env.NW_WRLD_PROJECT_DIR || path.join(root, 'nw/project'));
export const profileDir = path.resolve(process.env.NW_WRLD_USER_DATA_DIR || path.join(root, '.runtime/profile'));
export const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    // npm's CLI path avoids spawning a .cmd shim directly on Windows.
    const npmCli = command === npm ? process.env.npm_execpath : null;
    const executable = npmCli ? process.execPath : command;
    const argv = npmCli ? [npmCli, ...args] : args;
    const child = spawn(executable, argv, {
      cwd: root, stdio: 'inherit',
      ...(process.platform === 'win32' && executable.endsWith('.cmd') ? { shell: true } : {}),
      ...options,
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} failed (${signal || code})`)));
  });
}

// Copy only missing files: dashboard edits and assets survive every setup/build.
export async function scaffoldProject(destination = projectDir) {
  async function copyMissing(source, target) {
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const src = path.join(source, entry.name), dest = path.join(target, entry.name);
      if (entry.isDirectory()) await copyMissing(src, dest);
      else try { await copyFile(src, dest, constants.COPYFILE_EXCL); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
  }
  await copyMissing(path.join(root, 'nw/template'), destination);
  await mkdir(path.join(destination, 'modules'), { recursive: true });
  await mkdir(path.join(destination, 'assets/audio'), { recursive: true });
  await mkdir(path.join(destination, 'assets/genomes'), { recursive: true });
}

export function requireSetup() {
  if (!existsSync(path.join(hostDir, 'node_modules/electron/package.json'))) {
    throw new Error('nw_wrld is not installed. Run npm run nw:setup first.');
  }
}
