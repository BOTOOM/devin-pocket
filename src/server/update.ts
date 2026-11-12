import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { UpdateInfo } from '../shared/protocol.js';
import { cacheDir, VERSION } from './paths.js';

const DAY = 24 * 3600 * 1000;
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][\da-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][\da-zA-Z-]*))*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/;

export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const m = SEMVER.exec(v);
    if (!m) throw new Error(`Invalid version: ${v}`);
    return m;
  };
  const x = parse(a);
  const y = parse(b);
  for (const i of [1, 2, 3]) {
    const diff = BigInt(x[i] ?? '0') - BigInt(y[i] ?? '0');
    if (diff !== 0n) return diff > 0n ? 1 : -1;
  }
  if (x[4] === y[4]) return 0;
  if (!x[4]) return 1;
  if (!y[4]) return -1;
  const xp = x[4].split('.');
  const yp = y[4].split('.');
  for (let i = 0; i < Math.max(xp.length, yp.length); i++) {
    const l = xp[i];
    const r = yp[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (l === r) continue;
    const ln = /^\d+$/.test(l);
    const rn = /^\d+$/.test(r);
    if (ln && rn) return BigInt(l) > BigInt(r) ? 1 : -1;
    if (ln !== rn) return ln ? -1 : 1;
    return l > r ? 1 : -1;
  }
  return 0;
}

export async function registryVersion(version = 'latest'): Promise<string> {
  if (version !== 'latest') compareVersions(version, version);
  const registry =
    process.env.npm_config_registry ||
    process.env.NPM_CONFIG_REGISTRY ||
    'https://registry.npmjs.org';
  const url = new URL(`${registry.replace(/\/$/, '')}/devin-pocket/${encodeURIComponent(version)}`);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid npm registry');
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`npm registry: HTTP ${res.status}`);
  const data = (await res.json()) as { version?: unknown };
  if (typeof data.version !== 'string') throw new Error('npm registry: missing version');
  compareVersions(data.version, data.version);
  if (version !== 'latest' && data.version !== version)
    throw new Error('npm registry: version mismatch');
  return data.version;
}

export function updateInfo(latest = VERSION): UpdateInfo {
  return { current: VERSION, latest, updateAvailable: compareVersions(VERSION, latest) < 0 };
}

export function updateChecksDisabled(): boolean {
  return (
    process.env.DEVIN_POCKET_NO_UPDATE_CHECK === '1' ||
    !!process.env.VITEST ||
    process.env.NODE_ENV === 'test'
  );
}

export function cachedUpdate(): UpdateInfo {
  if (updateChecksDisabled()) return updateInfo();
  try {
    const data = JSON.parse(fs.readFileSync(path.join(cacheDir(), 'update.json'), 'utf8'));
    return updateInfo(data.latest);
  } catch {
    return updateInfo();
  }
}

export async function checkForUpdate(log: { warn: (message: string) => void }): Promise<void> {
  if (updateChecksDisabled()) return;
  const file = path.join(cacheDir(), 'update.json');
  try {
    try {
      const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
      compareVersions(cached.latest, cached.latest);
      if (
        typeof cached.checkedAt === 'number' &&
        Date.now() - cached.checkedAt >= 0 &&
        Date.now() - cached.checkedAt < DAY
      )
        return;
    } catch {}
    const latest = await registryVersion();
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ latest, checkedAt: Date.now() }));
  } catch (e) {
    log.warn(`Update check failed: ${(e as Error).message}`);
  }
}

export function startUpdateChecks(log: { warn: (message: string) => void }): void {
  if (updateChecksDisabled()) return;
  void checkForUpdate(log);
  setInterval(() => void checkForUpdate(log), DAY).unref();
}

export function commandOutput(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 5000 }, (error, stdout) =>
      resolve(error ? '' : stdout.trim()),
    );
  });
}

export async function detectManager(
  packageDir: string,
  root: (manager: string) => Promise<string> = (manager) => commandOutput(manager, ['root', '-g']),
): Promise<'pnpm' | 'npm' | null> {
  const real = fs.realpathSync(packageDir);
  for (const manager of ['pnpm', 'npm'] as const) {
    const global = await root(manager);
    if (!global) continue;
    try {
      const relative = path.relative(fs.realpathSync(global), real);
      if (
        relative &&
        relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
      )
        return manager;
    } catch {}
  }
  return null;
}

export function installPackage(command: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', () => resolve(1));
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

export interface UpdateOptions {
  check?: boolean;
  version?: string;
  yes?: boolean;
}

export async function runUpdate(
  options: UpdateOptions,
  deps: {
    packageDir: string;
    current?: string;
    latest?: (version?: string) => Promise<string>;
    manager?: () => Promise<'pnpm' | 'npm' | null>;
    install?: typeof installPackage;
    print?: (message: string) => void;
    confirm?: () => Promise<boolean>;
    stop: () => Promise<boolean>;
    restart: (installed: boolean) => Promise<void>;
  },
): Promise<number> {
  const print = deps.print ?? console.log;
  try {
    const current = deps.current ?? VERSION;
    const latest = await (deps.latest ?? registryVersion)(options.version);
    print(`Current: ${current} · Latest: ${latest}`);
    if (compareVersions(current, latest) >= 0) {
      print('Already up to date / Ya está actualizado.');
      return 0;
    }
    print(
      `Update / Actualizar: devin-pocket update${options.version ? ` --version ${latest}` : ''}`,
    );
    if (options.check) return 0;
    const manager = await (deps.manager ?? (() => detectManager(deps.packageDir)))();
    if (!manager) {
      print(
        `Unknown/source/npx installation. Update using the original install method, or install globally: npm install -g devin-pocket@${latest}`,
      );
      return 1;
    }
    const confirm =
      deps.confirm ??
      (async () => {
        if (!process.stdin.isTTY) return false;
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        try {
          return /^y(es)?$/i.test(
            (
              await rl.question('Stop Pocket and update? / ¿Detener Pocket y actualizar? [y/N] ')
            ).trim(),
          );
        } finally {
          rl.close();
        }
      });
    if (!options.yes && !(await confirm())) {
      print('Cancelled / Cancelado. Use --yes to confirm non-interactively.');
      return 1;
    }
    const stopped = await deps.stop();
    let installed = false;
    try {
      const args = [manager === 'pnpm' ? 'add' : 'install', '-g', `devin-pocket@${latest}`];
      installed = (await (deps.install ?? installPackage)(manager, args)) === 0;
      if (!installed) print('Installation failed; attempting to restart the previous version.');
    } finally {
      if (stopped) await deps.restart(installed);
    }
    print(
      'Devin CLI is updated with its own installer / Devin CLI se actualiza con su propio instalador.',
    );
    return installed ? 0 : 1;
  } catch (e) {
    print(`Update failed / Error al actualizar: ${(e as Error).message}`);
    return 1;
  }
}
