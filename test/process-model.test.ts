import { describe, expect, it } from 'vitest';
import { explicitProcessModel, processModelArgs } from '../src/server/acp/agent.js';
import { parseArgs, serializeArgs } from '../src/server/args.js';
import { translateLockError } from '../src/server/sessions.js';

describe('process-model argv', () => {
  it('auto/daemon map to --process-model daemon when supported', () => {
    expect(processModelArgs('auto', true)).toEqual(['--process-model', 'daemon']);
    expect(processModelArgs('daemon', true)).toEqual(['--process-model', 'daemon']);
    expect(processModelArgs('in-process', true)).toEqual(['--process-model', 'in-process']);
  });

  it('adds nothing when the CLI is too old', () => {
    expect(processModelArgs('auto', false)).toEqual([]);
    expect(processModelArgs('daemon', false)).toEqual([]);
    expect(processModelArgs('in-process', false)).toEqual([]);
  });

  it('detects an explicit --process-model in the agent command', () => {
    expect(explicitProcessModel(['acp', '--process-model', 'daemon'])).toBe('daemon');
    expect(explicitProcessModel(['acp', '--process-model=in-process'])).toBe('in-process');
    expect(explicitProcessModel(['acp'])).toBeUndefined();
    expect(explicitProcessModel(['acp', '--process-model', 'bogus'])).toBeUndefined();
  });
});

describe('--process-model flag', () => {
  it('parses and round-trips', () => {
    const a = parseArgs(['--process-model', 'daemon']);
    expect(a.processModel).toBe('daemon');
    expect(serializeArgs(a)).toContain('--process-model');
    expect(serializeArgs(a)).toContain('daemon');
  });

  it('rejects invalid values', () => {
    expect(() => parseArgs(['--process-model', 'bogus'])).toThrow(/--process-model/);
  });
});

describe('translateLockError', () => {
  it('maps session_locked data to a friendly message with the holder pid', () => {
    const err = Object.assign(new Error('Session x is already open'), {
      data: {
        'cognition.ai/errorKind': 'session_locked',
        'cognition.ai/retryable': true,
        'cognition.ai/lockHolderPid': 1176,
      },
    });
    const out = translateLockError(err, 'shore-asiago');
    expect(out.message).toContain('shore-asiago');
    expect(out.message).toContain('1176');
  });

  it('passes unrelated errors through unchanged', () => {
    const err = new Error('boom');
    expect(translateLockError(err, 's')).toBe(err);
    expect(translateLockError('nope', 's').message).toBe('nope');
  });
});
