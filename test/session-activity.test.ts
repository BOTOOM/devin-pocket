import { describe, expect, it } from 'vitest';
import { sessionActivity } from '../src/shared/session-activity.js';

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
