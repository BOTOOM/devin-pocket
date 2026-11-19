import { describe, expect, it } from 'vitest';
import type { SessionSummary } from '../src/shared/protocol.js';
import { filterSessions, sessionActivity } from '../src/shared/session-activity.js';

describe('sessionActivity', () => {
  it('ranks a pending permission above a running turn', () => {
    expect(sessionActivity({ turn: 'awaitingPermission', permission: undefined }, true)).toBe(
      'permission',
    );
    expect(
      sessionActivity({ turn: 'working', permission: { requestId: 'r' } as never }, false),
    ).toBe('permission');
  });

  it('reports working turns, then unseen finished turns', () => {
    expect(sessionActivity({ turn: 'working' }, true)).toBe('working');
    expect(sessionActivity({ turn: 'cancelling' }, false)).toBe('working');
    expect(sessionActivity({ turn: 'idle' }, true)).toBe('unseen');
    expect(sessionActivity(undefined, true)).toBe('unseen');
    expect(sessionActivity({ turn: 'idle' }, false)).toBeUndefined();
  });
});

describe('filterSessions', () => {
  const s = (sessionId: string, title: string | undefined, cwd: string): SessionSummary => ({
    sessionId,
    title,
    cwd,
    locked: false,
    open: false,
  });
  const list = [s('a', 'Arreglar login', '/home/u/web'), s('b', undefined, '/home/u/api')];

  it('matches title or folder, case-insensitively', () => {
    expect(filterSessions(list, 'LOGIN', 'Nueva sesión').map((x) => x.sessionId)).toEqual(['a']);
    expect(filterSessions(list, 'api', 'Nueva sesión').map((x) => x.sessionId)).toEqual(['b']);
    expect(filterSessions(list, 'nueva', 'Nueva sesión').map((x) => x.sessionId)).toEqual(['b']);
    expect(filterSessions(list, '  ', 'Nueva sesión')).toBe(list);
  });
});
