import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Workspace } from '../shared/protocol.js';

export function contains(root: string, dir: string, platform = process.platform): boolean {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const relative = p.relative(
    platform === 'win32' ? root.toLowerCase() : root,
    platform === 'win32' ? dir.toLowerCase() : dir,
  );
  return (
    relative === '' ||
    (!relative.startsWith(`..${p.sep}`) && relative !== '..' && !p.isAbsolute(relative))
  );
}

export function validateCwd(
  cwd: unknown,
  workspaces: Workspace[],
  options: {
    platform?: NodeJS.Platform;
    home?: string;
    realpath?: (dir: string) => string;
    isDirectory?: (dir: string) => boolean;
  } = {},
): string {
  const platform = options.platform ?? process.platform;
  const p = platform === 'win32' ? path.win32 : path.posix;
  const realpath = options.realpath ?? fs.realpathSync;
  const isDirectory = options.isDirectory ?? ((dir: string) => fs.statSync(dir).isDirectory());
  try {
    if (typeof cwd !== 'string' || !p.isAbsolute(cwd)) throw new Error();
    if (platform === 'win32' && !/^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/i.test(cwd))
      throw new Error();
    const real = realpath(cwd);
    if (!isDirectory(real)) throw new Error();
    const allowed = [options.home ?? os.homedir(), ...workspaces.map((w) => w.path)].some(
      (root) => {
        try {
          return contains(realpath(root), real, platform);
        } catch {
          return false;
        }
      },
    );
    if (!allowed) throw new Error();
    return real;
  } catch {
    throw new Error('invalid_cwd');
  }
}
