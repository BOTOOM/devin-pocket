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
