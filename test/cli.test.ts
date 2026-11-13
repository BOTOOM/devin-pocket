import { describe, expect, it } from 'vitest';
import { parseArgs, serializeArgs } from '../src/server/args.js';

describe('parseArgs', () => {
  it('defaults to start with browser opening', () => {
    expect(parseArgs([])).toMatchObject({ cmd: 'start', open: true, foreground: false });
  });
  it('parses foreground start options', () => {
    expect(
      parseArgs([
        'start',
        '--port',
        '7799',
        '--host',
        '0.0.0.0',
        '--cwd',
        '/tmp',
        '--no-open',
        '--foreground',
      ]),
    ).toMatchObject({
      cmd: 'start',
      port: 7799,
      host: '0.0.0.0',
      cwd: '/tmp',
      open: false,
      foreground: true,
    });
  });
  it('parses dev mode and log options', () => {
    expect(parseArgs(['--dev'])).toMatchObject({
      cmd: 'start',
      dev: true,
      foreground: true,
      open: false,
    });
    expect(parseArgs(['logs', '-f', '-n', '25'])).toMatchObject({
      cmd: 'logs',
      follow: true,
      lines: 25,
    });
  });
  it('supports utility commands and aliases', () => {
    expect(parseArgs(['doctor']).cmd).toBe('doctor');
    expect(parseArgs(['--version']).cmd).toBe('version');
    expect(parseArgs(['--help']).cmd).toBe('help');
  });
});

describe('serializeArgs', () => {
  it.each([
    ['pair', '--qr=ascii', '--port', '7790'],
    ['devices'],
    ['devices', 'revoke', 'all'],
    ['devices', 'revoke', 'device-id', '--host', '127.0.0.1'],
    ['start', '--qr=ascii', '--no-open'],
  ])('roundtrips pairing/device options: %j', (...argv) => {
    const args = parseArgs(argv);
    expect(parseArgs(serializeArgs(args))).toEqual(args);
  });
  it('requires a revoke target', () => {
    expect(() => parseArgs(['devices', 'revoke'])).toThrow('revoke requires');
  });
  it('roundtrips update options without treating the target as --version output', () => {
    const args = parseArgs(['update', '--check', '--version', '1.2.3', '--yes']);
    expect(args).toMatchObject({ cmd: 'update', check: true, version: '1.2.3', yes: true });
    expect(parseArgs(serializeArgs(args))).toEqual(args);
    expect(() => parseArgs(['update', '--version'])).toThrow('requires a version');
  });
  it('roundtrips parse → serialize → parse', () => {
    const a = parseArgs([
      'start',
      '--port',
      '7799',
      '--host',
      '0.0.0.0',
      '--cwd',
      '/tmp',
      '--agent',
      'devin acp',
      '--no-open',
    ]);
    expect(parseArgs(serializeArgs(a))).toMatchObject({
      cmd: 'start',
      port: 7799,
      host: '0.0.0.0',
      cwd: '/tmp',
      agent: 'devin acp',
      open: false,
    });
  });
  it('restart (and any command) serializes to start', () => {
    const argv = serializeArgs(parseArgs(['restart', '--port', '7780']));
    expect(argv[0]).toBe('start');
    expect(argv).toContain('--port');
    expect(argv).not.toContain('restart');
  });
  it('omits defaults', () => {
    expect(serializeArgs(parseArgs(['start']))).toEqual(['start']);
  });
});
