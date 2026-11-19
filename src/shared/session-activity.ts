import type { SessionState, SessionSummary } from './protocol.js';

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

export function filterSessions(
  sessions: SessionSummary[],
  query: string,
  untitled: string,
): SessionSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return sessions;
  return sessions.filter((s) => `${s.title || untitled}\n${s.cwd}`.toLowerCase().includes(q));
}
