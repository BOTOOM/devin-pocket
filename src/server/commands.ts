import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ResolverOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
  isFile?: (file: string) => boolean;
  isExecutable?: (file: string) => boolean;
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function findExecutable(bin: string, options: ResolverOptions = {}): string | null {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const exists = options.isFile ?? isFile;
  const win = platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const envValue = (key: string) =>
    env[Object.keys(env).find((k) => (win ? k.toUpperCase() === key : k === key)) ?? key];
  const explicit = bin.includes('/') || (win && (bin.includes('\\') || /^[a-z]:/i.test(bin)));
  const dirs = (envValue('PATH') ?? '').split(p.delimiter).filter(Boolean);
  const bases = explicit ? [bin] : dirs.map((dir) => p.join(dir.replace(/^"|"$/g, ''), bin));
  if (!win) {
    if (!explicit) bases.push(p.join(options.home ?? os.homedir(), '.local', 'bin', bin));
    const executable = options.isExecutable ?? isExecutable;
    return bases.find((file) => exists(file) && executable(file)) ?? null;
  }
  const extensions = (envValue('PATHEXT') ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .filter((ext) => /^\.[a-z0-9]+$/i.test(ext));
  extensions.sort(
    (a, b) => Number(b.toLowerCase() === '.exe') - Number(a.toLowerCase() === '.exe'),
  );
  const candidates = bases.flatMap((base) =>
    p.extname(base) ? [base] : extensions.map((ext) => `${base}${ext}`),
  );
  const native = candidates.filter((file) => !/\.(cmd|bat)$/i.test(file));
  const batch = candidates.filter((file) => /\.(cmd|bat)$/i.test(file));
  return [...native, ...batch].find(exists) ?? null;
}

export function resolveBin(bin: string, options: ResolverOptions = {}): string {
  return findExecutable(bin, options) ?? bin;
}

export function requireNativeExecutable(bin: string, platform = process.platform): string {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(bin)) {
    throw new Error(
      `Windows batch launchers are not supported: ${bin}. Use devin.exe on PATH or configure a native executable (quoted if its path contains spaces).`,
    );
  }
  return bin;
}
