import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VERSION } from '../src/server/paths.js';
import {
  cachedUpdate,
  checkForUpdate,
  compareVersions,
  detectManager,
  refreshInstallManager,
  registryVersion,
  runUpdate,
  updateInfo,
} from '../src/server/update.js';

afterEach(() => vi.unstubAllEnvs());

it('exposes unknown installations safely before manager detection completes', () => {
  expect(updateInfo()).toMatchObject({ installManager: null });
});

it('reports detected global managers, unknown roots and detection failures', async () => {
  for (const manager of ['npm', 'pnpm', null] as const) {
    await refreshInstallManager('/package', async () => manager);
    expect(cachedUpdate().installManager).toBe(manager);
  }
  await refreshInstallManager('/package', async () => {
    throw new Error('unavailable');
  });
  expect(cachedUpdate().installManager).toBe(null);
});

it('reads the installed package version from source as well as the built layout', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(VERSION).toBe(pkg.version);
});

it('caches daily checks and keeps stale data on offline failures without throwing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-update-cache-'));
  vi.stubEnv('XDG_CACHE_HOME', dir);
  vi.stubEnv('VITEST', '');
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('DEVIN_POCKET_NO_UPDATE_CHECK', '0');
  const request = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify({ version: '99.0.0' })));
  const log = { warn: vi.fn() };
  try {
    await checkForUpdate(log);
    expect(cachedUpdate()).toMatchObject({ latest: '99.0.0', updateAvailable: true });
    await checkForUpdate(log);
    expect(request).toHaveBeenCalledTimes(1);
    const file = path.join(dir, 'devin-pocket', 'update.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ latest: '99.0.0', checkedAt: Date.now() - 25 * 3600000 }),
    );
    request.mockRejectedValue(new Error('offline'));
    await expect(checkForUpdate(log)).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith('Update check failed: offline');
    expect(cachedUpdate().latest).toBe('99.0.0');
    fs.writeFileSync(file, 'bad cache');
    expect(cachedUpdate().updateAvailable).toBe(false);
  } finally {
    request.mockRestore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('semver', () => {
  for (const [a, b, result] of [
    ['1.2.3', '1.2.3', 0],
    ['1.10.0', '1.9.9', 1],
    ['2.0.0', '10.0.0', -1],
    ['1.0.0-alpha', '1.0.0', -1],
    ['1.0.0-beta.2', '1.0.0-beta.10', -1],
    ['1.0.0-beta', '1.0.0-alpha', 1],
    ['1.0.0+build', '1.0.0+other', 0],
    ['1.0.0-alpha', '1.0.0-alpha.1', -1],
    ['1.0.0-1', '1.0.0-alpha', -1],
  ] as const)
    it(`${a} vs ${b}`, () => expect(compareVersions(a, b)).toBe(result));
  for (const value of ['', 'latest', '1.2', '01.2.3', '1.0.0-01', '--help']) {
    it(`rejects ${value}`, () => expect(() => compareVersions(value, '1.0.0')).toThrow());
  }
});

it('fetches from an overridden local registry; validates HTTP, JSON and target versions', async () => {
  let body = JSON.stringify({ version: '2.3.4' });
  let status = 200;
  const urls: string[] = [];
  const server = http.createServer((req, res) => {
    urls.push(req.url ?? '');
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as import('node:net').AddressInfo;
  vi.stubEnv('npm_config_registry', `http://127.0.0.1:${address.port}/custom/`);
  try {
    expect(await registryVersion()).toBe('2.3.4');
    expect(await registryVersion('2.3.4')).toBe('2.3.4');
    expect(urls).toEqual(['/custom/devin-pocket/latest', '/custom/devin-pocket/2.3.4']);
    const cli = await promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', 'src/server/cli.ts', 'update', '--check'],
      { cwd: new URL('..', import.meta.url), env: process.env },
    );
    expect(cli.stdout).toContain(`Current: ${VERSION} · Latest: 2.3.4`);
    expect(cli.stdout).toContain('devin-pocket update');
    await expect(registryVersion('1.0.0')).rejects.toThrow('mismatch');
    status = 503;
    await expect(registryVersion()).rejects.toThrow('HTTP 503');
    status = 200;
    body = '{}';
    await expect(registryVersion()).rejects.toThrow('missing version');
    body = '{';
    await expect(registryVersion()).rejects.toThrow();
    vi.stubEnv('npm_config_registry', '');
    vi.stubEnv('NPM_CONFIG_REGISTRY', `http://127.0.0.1:${address.port}`);
    body = JSON.stringify({ version: '3.0.0' });
    expect(await registryVersion()).toBe('3.0.0');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('detects real global packages, prioritizes pnpm, and rejects sibling/source/npx paths', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-update-'));
  try {
    for (const p of [
      'pnpm/devin-pocket',
      'npm/devin-pocket',
      'npm-other/devin-pocket',
      'source',
      '_npx/devin-pocket',
    ])
      fs.mkdirSync(path.join(dir, p), { recursive: true });
    fs.symlinkSync(path.join(dir, 'pnpm/devin-pocket'), path.join(dir, 'linked'));
    const root = async (manager: string) => path.join(dir, manager);
    expect(await detectManager(path.join(dir, 'linked'), root)).toBe('pnpm');
    expect(await detectManager(path.join(dir, 'npm/devin-pocket'), root)).toBe('npm');
    for (const p of ['source', '_npx/devin-pocket', 'npm-other/devin-pocket'])
      expect(await detectManager(path.join(dir, p), root)).toBeNull();
    expect(await detectManager(path.join(dir, 'source'), async () => '')).toBeNull();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function fixture() {
  return {
    packageDir: '/source',
    current: '1.0.0',
    latest: vi.fn(async () => '2.0.0'),
    manager: vi.fn(async (): Promise<'npm' | 'pnpm' | null> => 'npm'),
    install: vi.fn(async () => 0),
    print: vi.fn(),
    confirm: vi.fn(async () => true),
    stop: vi.fn(async () => true),
    restart: vi.fn(async () => {}),
  };
}

it('--check prints versions and update command without detecting, prompting or mutating', async () => {
  const deps = fixture();
  expect(await runUpdate({ check: true }, deps)).toBe(0);
  expect(deps.print).toHaveBeenCalledWith('Current: 1.0.0 · Latest: 2.0.0');
  expect(deps.print).toHaveBeenCalledWith('Update / Actualizar: devin-pocket update');
  expect(deps.manager).not.toHaveBeenCalled();
  expect(deps.stop).not.toHaveBeenCalled();
  expect(deps.install).not.toHaveBeenCalled();
});

it('already current or newer never installs or stops', async () => {
  for (const latest of ['1.0.0', '0.9.9']) {
    const deps = fixture();
    deps.latest.mockResolvedValue(latest);
    expect(await runUpdate({}, deps)).toBe(0);
    expect(deps.print).toHaveBeenCalledWith('Already up to date / Ya está actualizado.');
    expect(deps.install).not.toHaveBeenCalled();
    expect(deps.stop).not.toHaveBeenCalled();
  }
});

it('unknown installation prints manual instructions and changes nothing', async () => {
  const deps = fixture();
  deps.manager.mockResolvedValue(null);
  expect(await runUpdate({ yes: true }, deps)).toBe(1);
  expect(deps.print.mock.calls.flat().join(' ')).toContain('original install method');
  expect(deps.install).not.toHaveBeenCalled();
  expect(deps.stop).not.toHaveBeenCalled();
});

it('installs the requested version with the detected manager and restarts', async () => {
  for (const manager of ['pnpm', 'npm'] as const) {
    const deps = fixture();
    deps.manager.mockResolvedValue(manager);
    expect(await runUpdate({ version: '2.0.0', yes: true }, deps)).toBe(0);
    expect(deps.latest).toHaveBeenCalledWith('2.0.0');
    expect(deps.install).toHaveBeenCalledWith(manager, [
      manager === 'pnpm' ? 'add' : 'install',
      '-g',
      'devin-pocket@2.0.0',
    ]);
    expect(deps.restart).toHaveBeenCalledWith(true);
    expect(deps.stop.mock.invocationCallOrder[0]).toBeLessThan(
      deps.install.mock.invocationCallOrder[0] ?? 0,
    );
    expect(deps.confirm).not.toHaveBeenCalled();
  }
});

it('restarts the old installation on failure, but never starts an idle daemon', async () => {
  const deps = fixture();
  deps.install.mockResolvedValue(1);
  expect(await runUpdate({ yes: true }, deps)).toBe(1);
  expect(deps.restart).toHaveBeenCalledWith(false);
  deps.restart.mockClear();
  deps.stop.mockResolvedValue(false);
  expect(await runUpdate({ yes: true }, deps)).toBe(1);
  expect(deps.restart).not.toHaveBeenCalled();
});

it('cancellation and network failure leave the daemon and packages untouched', async () => {
  const deps = fixture();
  deps.confirm.mockResolvedValue(false);
  expect(await runUpdate({}, deps)).toBe(1);
  deps.latest.mockRejectedValue(new Error('offline'));
  expect(await runUpdate({ yes: true }, deps)).toBe(1);
  expect(deps.stop).not.toHaveBeenCalled();
  expect(deps.install).not.toHaveBeenCalled();
});

it('background checks skip tests and the opt-out without accessing the registry', async () => {
  vi.stubEnv('DEVIN_POCKET_NO_UPDATE_CHECK', '1');
  vi.stubEnv('npm_config_registry', 'invalid:');
  const log = { warn: vi.fn() };
  await checkForUpdate(log);
  expect(log.warn).not.toHaveBeenCalled();
  expect(cachedUpdate().updateAvailable).toBe(false);
});
