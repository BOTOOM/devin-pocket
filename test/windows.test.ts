import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { splitCommand } from '../src/server/acp/agent.js';
import { findExecutable, requireNativeExecutable, resolveBin } from '../src/server/commands.js';
import { browse, browsePath, cwdAllowed, search } from '../src/server/fs-search.js';
import { appDirectories } from '../src/server/paths.js';
import { openUrlCommand, stopDaemon } from '../src/server/platform.js';
import { contains, validateCwd } from '../src/server/workspace.js';

describe('browser commands', () => {
  const url = 'http://127.0.0.1:7777/?q=a&b="quoted"';
  it.each([
    ['win32', false, 'rundll32', ['url.dll,FileProtocolHandler', url]],
    ['win32', true, 'rundll32', ['url.dll,FileProtocolHandler', url]],
    ['darwin', false, 'open', [url]],
    ['linux', false, 'xdg-open', [url]],
    ['linux', true, 'termux-open-url', [url]],
  ] as const)('opens on %s (Termux=%s) without a shell', (platform, termux, command, args) => {
    expect(openUrlCommand(platform, url, termux)).toEqual([command, args]);
  });
});

describe('Windows executable resolution', () => {
  // Windows does not enforce POSIX execute permission bits.
  it.skipIf(process.platform === 'win32')(
    'skips non-executable POSIX files earlier on PATH',
    () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-executable-'));
      const first = path.join(root, 'first');
      const second = path.join(root, 'second');
      try {
        fs.mkdirSync(first);
        fs.mkdirSync(second);
        const blocked = path.join(first, 'devin');
        const executable = path.join(second, 'devin');
        fs.writeFileSync(blocked, '#!/bin/sh\nprintf blocked', { mode: 0o644 });
        fs.writeFileSync(executable, '#!/bin/sh\nprintf valid', { mode: 0o755 });
        expect((spawnSync(blocked).error as NodeJS.ErrnoException)?.code).toBe('EACCES');
        const options = {
          platform: 'linux' as const,
          env: { PATH: `${first}:${second}` },
          home: root,
        };
        const resolved = findExecutable('devin', options);
        expect(resolved).toBe(executable);
        expect(spawnSync(resolved ?? '', { encoding: 'utf8' }).stdout).toBe('valid');
        expect(findExecutable(blocked, options)).toBeNull();
        expect(findExecutable(executable, options)).toBe(executable);
        expect(findExecutable('missing', options)).toBeNull();
        expect(findExecutable('devin', { ...options, env: { PATH: first } })).toBeNull();
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );
  const options = (files: string[], env = { Path: 'C:\\first;"C:\\Program Files\\Devin"' }) => ({
    platform: 'win32' as const,
    env,
    home: 'C:\\Users\\me',
    isFile: (file: string) => files.some((f) => f.toLowerCase() === file.toLowerCase()),
  });
  it('searches PATH case-insensitively with default PATHEXT and prefers exe over batch', () => {
    expect(
      findExecutable(
        'devin',
        options(['C:\\first\\devin.cmd', 'C:\\Program Files\\Devin\\devin.exe']),
      ),
    ).toBe('C:\\Program Files\\Devin\\devin.EXE');
  });
  it('honors custom PATHEXT and explicit paths with spaces', () => {
    const o = { ...options(['C:\\first\\devin.COM']), env: { PATH: 'C:\\first', PATHEXT: '.COM' } };
    expect(findExecutable('devin', o)).toBe('C:\\first\\devin.COM');
    expect(findExecutable('C:\\first\\devin.COM', o)).toBe('C:\\first\\devin.COM');
    expect(splitCommand('"C:\\Program Files\\Devin\\devin.exe" acp')).toEqual([
      'C:\\Program Files\\Devin\\devin.exe',
      'acp',
    ]);
  });
  it('does not invent a Windows default directory or search the current directory', () => {
    const o = { ...options(['C:\\Users\\me\\.local\\bin\\devin.exe', 'devin.exe']), env: {} };
    expect(findExecutable('devin', o)).toBeNull();
    expect(resolveBin('devin', o)).toBe('devin');
  });
  it.each(['CMD', 'bat'])('finds but clearly rejects .%s rather than invoking a shell', (ext) => {
    const command = `C:\\first\\devin.${ext}`;
    const resolved = resolveBin('devin', options([command]));
    expect(resolved.toLowerCase()).toBe(command.toLowerCase());
    expect(() => requireNativeExecutable(resolved, 'win32')).toThrow('Use devin.exe on PATH');
    expect(requireNativeExecutable(command, 'linux')).toBe(command);
  });
  it('leaves native arguments untouched, including shell metacharacters', () => {
    expect(requireNativeExecutable('C:\\a&b\\devin.exe', 'win32')).toBe('C:\\a&b\\devin.exe');
  });
  it('keeps POSIX PATH precedence and ~/.local/bin fallback', () => {
    const o = {
      platform: 'linux' as const,
      env: { PATH: '/bin:/usr/bin' },
      home: '/home/me',
      isFile: (f: string) => f === '/home/me/.local/bin/devin',
      isExecutable: () => true,
    };
    expect(resolveBin('devin', o)).toBe('/home/me/.local/bin/devin');
    expect(
      findExecutable('devin', { ...o, isFile: (f) => f === '/bin/devin' || o.isFile(f) }),
    ).toBe('/bin/devin');
    expect(findExecutable('missing', o)).toBeNull();
  });
});

describe('platform directories', () => {
  it('uses roaming config and local state/cache on Windows', () => {
    expect(
      appDirectories(
        'win32',
        { APPDATA: 'C:\\Roaming', LOCALAPPDATA: 'C:\\Local' },
        'C:\\Users\\me',
      ),
    ).toEqual({
      config: 'C:\\Roaming\\devin-pocket',
      state: 'C:\\Local\\devin-pocket\\state',
      cache: 'C:\\Local\\devin-pocket\\cache',
    });
    expect(appDirectories('win32', {}, 'C:\\Users\\me').config).toBe(
      'C:\\Users\\me\\AppData\\Roaming\\devin-pocket',
    );
  });
  it.each(['win32', 'linux', 'darwin'] as const)('honors all XDG overrides on %s', (platform) => {
    const dirs = appDirectories(
      platform,
      { XDG_CONFIG_HOME: '/cfg', XDG_STATE_HOME: '/state', XDG_CACHE_HOME: '/cache' },
      '/home/me',
    );
    const slash = (s: string) => s.replaceAll('\\', '/');
    expect(Object.values(dirs).map(slash)).toEqual([
      '/cfg/devin-pocket',
      '/state/devin-pocket',
      '/cache/devin-pocket',
    ]);
  });
  it.each(['linux', 'darwin'] as const)('preserves defaults on %s', (platform) => {
    expect(appDirectories(platform, { XDG_CONFIG_HOME: '  ' }, '/home/me')).toEqual({
      config: '/home/me/.config/devin-pocket',
      state: '/home/me/.local/state/devin-pocket',
      cache: '/home/me/.cache/devin-pocket',
    });
  });
});

describe('Windows daemon stop', () => {
  // Exercises the real Windows process-tree utility; POSIX uses SIGTERM instead.
  it.skipIf(process.platform !== 'win32')('terminates a real parent and its child', async () => {
    const parent = spawn(
      process.execPath,
      [
        '-e',
        `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log(child.pid); setInterval(()=>{},1000);`,
      ],
      { windowsHide: true },
    );
    let childPid = 0;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('child pid timeout')), 10_000);
        parent.on('error', reject);
        parent.stdout.on('data', (data: Buffer) => {
          childPid = Number(String(data).trim());
          clearTimeout(timer);
          resolve();
        });
      });
      expect(childPid).toBeGreaterThan(0);
      stopDaemon(parent.pid as number);
      await vi.waitFor(() => {
        expect(() => process.kill(parent.pid as number, 0)).toThrow();
        expect(() => process.kill(childPid, 0)).toThrow();
      });
    } finally {
      try {
        parent.kill();
      } catch {}
      if (childPid) {
        try {
          process.kill(childPid);
        } catch {}
      }
    }
  });
  it('kills the supervisor tree via taskkill without relying on signal handlers', () => {
    const run = vi.fn();
    const kill = vi.fn();
    stopDaemon(123, 'win32', run, kill);
    expect(run).toHaveBeenCalledWith('taskkill', ['/pid', '123', '/T', '/F']);
    expect(kill).not.toHaveBeenCalled();
  });
  it('preserves POSIX SIGTERM and surfaces taskkill failures', () => {
    const kill = vi.fn();
    stopDaemon(123, 'linux', vi.fn(), kill);
    expect(kill).toHaveBeenCalledWith(123, 'SIGTERM');
    expect(() =>
      stopDaemon(123, 'win32', () => {
        throw new Error('access denied');
      }),
    ).toThrow('access denied');
  });
  it.each([0, -1, NaN])('rejects unsafe pid %s', (pid) => {
    expect(() => stopDaemon(pid, 'win32', vi.fn())).toThrow('Invalid daemon pid');
  });
});

describe('native filesystem browsing and search', () => {
  it('browses configured roots and normalizes search paths for ignore rules', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-fs-'));
    try {
      fs.mkdirSync(path.join(root, 'src'));
      fs.mkdirSync(path.join(root, 'ignored'));
      fs.writeFileSync(path.join(root, '.gitignore'), 'ignored/');
      fs.writeFileSync(path.join(root, 'src', 'file.ts'), 'export {};');
      fs.writeFileSync(path.join(root, 'ignored', 'secret.ts'), 'ignored');
      const workspaces = [{ name: 'fixture', path: root }];
      expect(cwdAllowed(root, workspaces)).toBe(true);
      expect(browsePath(root, workspaces)).toBe(fs.realpathSync(root));
      expect(browse(root, workspaces).map((entry) => entry.name)).toEqual(['ignored', 'src']);
      const results = await search(root, 'file', 10);
      expect(results.entries).toEqual([{ name: 'file.ts', path: 'src/file.ts', kind: 'file' }]);
      expect((await search(root, 'secret', 10)).entries).toEqual([]);
      expect((await search(path.join(root, 'missing'), '', 10)).entries).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('Windows workspace boundaries', () => {
  const home = 'C:\\Users\\me';
  const options = {
    platform: 'win32' as const,
    home,
    realpath: (dir: string) => dir,
    isDirectory: () => true,
  };
  it('allows case-insensitive drive paths and configured UNC roots', () => {
    expect(validateCwd('c:\\USERS\\ME\\project', [], options)).toBe('c:\\USERS\\ME\\project');
    expect(
      validateCwd('D:/Projects/app', [{ name: 'external', path: 'd:\\projects' }], options),
    ).toBe('D:/Projects/app');
    expect(
      validateCwd(
        '\\\\server\\share\\app',
        [{ name: 'share', path: '\\\\SERVER\\SHARE' }],
        options,
      ),
    ).toBe('\\\\server\\share\\app');
  });
  it.each([
    'C:relative',
    '\\Users\\me',
    '/Users/me',
    '',
    'C:\\Users\\me-other',
    'D:\\Users\\me',
    'C:\\Users\\me\\..\\outside',
  ])('rejects %s', (cwd) => {
    expect(() => validateCwd(cwd, [], options)).toThrow('invalid_cwd');
  });
  it('rejects files, missing paths and junction escapes after realpath', () => {
    expect(() => validateCwd(home, [], { ...options, isDirectory: () => false })).toThrow(
      'invalid_cwd',
    );
    expect(() =>
      validateCwd(home, [], {
        ...options,
        realpath: () => {
          throw new Error('ENOENT');
        },
      }),
    ).toThrow('invalid_cwd');
    expect(() =>
      validateCwd(`${home}\\escape`, [], {
        ...options,
        realpath: (dir) => (dir.endsWith('escape') ? 'D:\\outside' : dir),
      }),
    ).toThrow('invalid_cwd');
    expect(contains(home, 'C:\\Users\\ME', 'win32')).toBe(true);
    expect(contains('/home/me', '/home/ME', 'linux')).toBe(false);
  });
});
