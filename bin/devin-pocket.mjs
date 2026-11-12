#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
if (major < 22) {
  console.error(`devin-pocket needs Node.js 22 or newer (you have ${process.versions.node}).`);
  console.error('Termux: pkg install nodejs-lts   ·   Ubuntu/Debian (proot): apt install nodejs');
  process.exit(1);
}

const built = ['server.js', 'server.mjs'].map((f) => join(here, '..', 'dist', f)).find(existsSync);
if (built) {
  await import(pathToFileURL(built).href);
} else {
  // Source checkout without a build: run through tsx.
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(
    process.execPath,
    ['--import', 'tsx', join(here, '..', 'src', 'server', 'cli.ts'), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(r.status ?? 1);
}
