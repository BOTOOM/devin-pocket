import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const APP_NAME = 'devin-pocket';

/** package.json is the single source of truth — resolves from src/ and from dist/. */
function readVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    for (const up of [path.join(here, '..'), path.join(here, '..', '..')]) {
      const pkg = JSON.parse(fs.readFileSync(path.join(up, 'package.json'), 'utf8')) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === APP_NAME && pkg.version) return pkg.version;
    }
  } catch {}
  return '0.0.0-dev';
}
export const VERSION = readVersion();

export const workspaceSchema = z.object({
  path: z.string(),
  name: z.string(),
  lastUsedAt: z.number().optional(),
});

export const configSchema = z.object({
  port: z.number().int().min(1).max(65535).default(7777),
  host: z.string().default('127.0.0.1'),
  agentCommand: z.string().default('devin acp'),
  workspaces: z.array(workspaceSchema).default([]),
  theme: z.string().optional(),
  showThoughts: z.boolean().optional(),
  lang: z.string().optional(),
});

export type Config = z.infer<typeof configSchema>;

export const DEFAULT_CONFIG: Config = configSchema.parse({});

export function appDirectories(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = os.homedir(),
): { config: string; state: string; cache: string } {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const roaming = env.APPDATA || p.join(home, 'AppData', 'Roaming');
  const local = env.LOCALAPPDATA || p.join(home, 'AppData', 'Local');
  const xdg = (key: string) => ((env[key] ?? '').trim() ? env[key] : undefined);
  return {
    config: p.join(
      xdg('XDG_CONFIG_HOME') ?? (platform === 'win32' ? roaming : p.join(home, '.config')),
      APP_NAME,
    ),
    state: xdg('XDG_STATE_HOME')
      ? p.join(xdg('XDG_STATE_HOME') as string, APP_NAME)
      : platform === 'win32'
        ? p.join(local, APP_NAME, 'state')
        : p.join(home, '.local', 'state', APP_NAME),
    cache: xdg('XDG_CACHE_HOME')
      ? p.join(xdg('XDG_CACHE_HOME') as string, APP_NAME)
      : platform === 'win32'
        ? p.join(local, APP_NAME, 'cache')
        : p.join(home, '.cache', APP_NAME),
  };
}

export function stateDir(): string {
  return appDirectories().state;
}

export function configFile(): string {
  return path.join(appDirectories().config, 'config.json');
}

export function cacheDir(): string {
  return appDirectories().cache;
}

export function modelsCacheFile(): string {
  return path.join(cacheDir(), 'models.json');
}

export function logFile(): string {
  return path.join(stateDir(), 'devin-pocket.log');
}

export function agentStderrFile(): string {
  return path.join(stateDir(), 'devin-acp.stderr.log');
}

export function pidFile(): string {
  return path.join(stateDir(), 'server.pid');
}

export function titlesFile(): string {
  return path.join(stateDir(), 'titles.json');
}

/** Load config.json; returns defaults on missing/corrupt file. */
export function loadConfig(file = configFile()): { config: Config; error?: string } {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = configSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      return { config: { ...DEFAULT_CONFIG }, error: `invalid config: ${parsed.error.message}` };
    }
    return { config: parsed.data };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { config: { ...DEFAULT_CONFIG } };
    return { config: { ...DEFAULT_CONFIG }, error: `cannot read config: ${(e as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

export function isTermux(): boolean {
  if (process.platform === 'win32') return false;
  return Boolean(process.env.TERMUX_VERSION) || fs.existsSync('/data/data/com.termux');
}

let prootCache: boolean | undefined;

/** Best-effort proot detection: env markers, /proc/self/status TracerPid, termux proot binary. */
export function isProot(): boolean {
  if (prootCache !== undefined) return prootCache;
  let out = false;
  try {
    if (process.env.PROOT_TMP_DIR || process.env.PROOT_NO_SECCOMP) out = true;
    else {
      const status = fs.readFileSync('/proc/self/status', 'utf8');
      const tracer = status.match(/^TracerPid:\s*(\d+)/m);
      if (tracer && tracer[1] !== '0') out = true;
    }
    if (!out && isTermux()) {
      // inside proot-distro, /data/data/com.termux still exists but PATH differs
      out =
        fs.existsSync('/etc/proot-distro') ||
        (process.env.PREFIX ?? '').includes('com.termux') === false;
    }
  } catch {
    out = false;
  }
  prootCache = out;
  return out;
}

export function platformInfo() {
  return {
    termux: isTermux(),
    proot: isProot(),
    os: process.platform,
    arch: process.arch,
    node: process.version,
  };
}

/** Ensure state/cache dirs exist; returns any mkdir error message. */
export function ensureDirs(): string | undefined {
  try {
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.mkdirSync(cacheDir(), { recursive: true });
    return undefined;
  } catch (e) {
    return (e as Error).message;
  }
}
