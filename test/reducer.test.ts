import { describe, expect, it } from 'vitest';
import type { PermissionRequest } from '../src/shared/protocol.js';
import { applyEvent, initialSessionState } from '../src/shared/reducer.js';

const at = 1_000;

describe('shared reducer', () => {
  it('merges streaming agent chunks and finishes on turn end', () => {
    let s = initialSessionState('s', '/tmp');
    s = applyEvent(s, { type: 'turnStarted' }, at);
    s = applyEvent(s, { type: 'agentChunk', text: 'Hola' }, at + 1);
    s = applyEvent(s, { type: 'agentChunk', text: ' mundo' }, at + 2);
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ kind: 'agent', text: 'Hola mundo', streaming: true });
    s = applyEvent(s, { type: 'turnEnded', stopReason: 'end_turn' }, at + 3);
    expect(s.items[0]).toMatchObject({ streaming: false });
    expect(s.turn).toBe('idle');
  });

  it('creates and updates a tool call', () => {
    let s = initialSessionState('s', '/tmp');
    s = applyEvent(s, {
      type: 'toolCall',
      toolCallId: 'tool-1',
      title: 'Run tests',
      toolKind: 'execute',
      status: 'in_progress',
      command: 'npm test',
    });
    s = applyEvent(s, {
      type: 'toolCallUpdate',
      toolCallId: 'tool-1',
      status: 'completed',
      exitCode: 0,
    });
    const tool = s.items[0];
    expect(tool).toMatchObject({
      kind: 'tool',
      toolCallId: 'tool-1',
      status: 'completed',
      exitCode: 0,
    });
  });

  it('deduplicates turn stats', () => {
    let s = initialSessionState('s', '/tmp');
    const stat = { turnRequestId: 'turn-1', input: 1, cached: 2, output: 3, extra: [] };
    s = applyEvent(s, { type: 'turnStats', stat });
    s = applyEvent(s, { type: 'turnStats', stat });
    expect(s.turnStats).toHaveLength(1);
  });

  it('tracks permission requested and resolved', () => {
    let s = initialSessionState('s', '/tmp');
    const request = {
      requestId: 'perm-1',
      toolCallId: 'tool-1',
      title: 'Run command',
      toolKind: 'execute',
      options: [],
      at,
    } as PermissionRequest;
    s = applyEvent(s, { type: 'permissionRequested', request });
    expect(s.turn).toBe('awaitingPermission');
    expect(s.permission?.requestId).toBe('perm-1');
    s = applyEvent(s, { type: 'permissionResolved', requestId: 'perm-1' });
    expect(s.permission).toBeUndefined();
    expect(s.turn).toBe('working');
  });
});
