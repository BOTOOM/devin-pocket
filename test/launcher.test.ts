import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

it('loads the packaged server from a native path containing spaces and URL characters', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'pocket launcher #'));
  try {
    mkdirSync(path.join(root, 'bin'));
    mkdirSync(path.join(root, 'dist'));
    copyFileSync(
      path.join(import.meta.dirname, '..', 'bin', 'devin-pocket.mjs'),
      path.join(root, 'bin', 'devin-pocket.mjs'),
    );
    writeFileSync(
      path.join(root, 'dist', 'server.mjs'),
      "console.log('packaged server loaded');\n",
    );
    const result = spawnSync(process.execPath, [path.join(root, 'bin', 'devin-pocket.mjs')], {
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('packaged server loaded');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
