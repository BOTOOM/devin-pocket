import type { SessionState } from './protocol.js';

export type SessionActivity = 'permission' | 'working' | 'unseen';

/** What a session needs from the user right now, most urgent first. */
export function sessionActivity(
  state: Pick<SessionState, 'turn' | 'permission'> | undefined,
  unseen: boolean,
): SessionActivity | undefined {
  if (state?.permission || state?.turn === 'awaitingPermission') return 'permission';
  if (state?.turn === 'working' || state?.turn === 'cancelling') return 'working';
  return unseen ? 'unseen' : undefined;
}
