import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Workspace } from '../shared/protocol.js';

function contains(root: string, dir: string): boolean {
  const relative = path.relative(root, dir);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

export function validateCwd(cwd: unknown, workspaces: Workspace[]): string {
  try {
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new Error();
    const real = fs.realpathSync(cwd);
    if (!fs.statSync(real).isDirectory()) throw new Error();
    const allowed = [os.homedir(), ...workspaces.map((w) => w.path)].some((root) => {
      try {
        return contains(fs.realpathSync(root), real);
      } catch {
        return false;
      }
    });
    if (!allowed) throw new Error();
    return real;
  } catch {
    throw new Error('invalid_cwd');
  }
}
