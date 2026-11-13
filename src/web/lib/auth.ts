import type { AuthStatus, PairRequest } from '@shared/protocol';
import { useSyncExternalStore } from 'react';

type Phase = 'checking' | 'redeeming' | 'ready' | 'pair' | 'error';
type AuthState = { phase: Phase; required: boolean; error?: 'invalid' | 'limited' | 'network' };
let state: AuthState = { phase: 'checking', required: true };
const listeners = new Set<() => void>();
let boot: Promise<void> | undefined;

function update(next: AuthState) {
  state = next;
  for (const listener of listeners) listener();
}

export class AuthFailure extends Error {
  constructor(public kind: 'invalid' | 'limited' | 'network') {
    super(kind);
  }
}

export async function authRequest<T>(route: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/auth/${route}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
      ...(method === 'GET'
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }),
    });
  } catch {
    throw new AuthFailure('network');
  }
  if (!response.ok) {
    if (response.status === 401) await refreshAuth();
    throw new AuthFailure(
      response.status === 429 ? 'limited' : response.status === 400 ? 'invalid' : 'network',
    );
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new AuthFailure('network');
  }
}

async function status(): Promise<AuthStatus> {
  const response = await fetch('/api/auth/status', {
    cache: 'no-store',
    credentials: 'same-origin',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new AuthFailure('network');
  return (await response.json()) as AuthStatus;
}

export async function refreshAuth(): Promise<boolean> {
  try {
    const current = await status();
    const allowed = !current.required || current.paired;
    update({ required: current.required, phase: allowed ? 'ready' : 'pair' });
    return allowed;
  } catch {
    // A network outage is not evidence of revocation; keep the reconnect backoff.
    return state.phase === 'ready';
  }
}

export async function redeemPairing(input: PairRequest): Promise<void> {
  await authRequest('pair', 'POST', input);
  if (!(await refreshAuth())) throw new AuthFailure('network');
}

async function initialize(): Promise<void> {
  const query = location.hash.startsWith('#/pair?')
    ? new URLSearchParams(location.hash.split('?')[1])
    : undefined;
  const token = query?.get('t');
  if (query) history.replaceState(null, '', `${location.pathname}${location.search}#/`);
  update({ required: true, phase: token ? 'redeeming' : 'checking' });
  try {
    const current = await status();
    if (token) await redeemPairing({ token });
    else
      update({
        required: current.required,
        phase: current.required && !current.paired ? 'pair' : 'ready',
      });
  } catch (error) {
    update({
      required: true,
      phase: 'error',
      error: error instanceof AuthFailure ? error.kind : 'network',
    });
  }
}

export function initAuth(): Promise<void> {
  if (boot) return boot;
  boot = initialize();
  addEventListener('hashchange', () => {
    if (location.hash.startsWith('#/pair?')) boot = initialize();
  });
  return boot;
}

export async function retryAuth(): Promise<void> {
  update({ ...state, phase: 'checking', error: undefined });
  if (!(await refreshAuth()) && state.phase === 'checking')
    update({ ...state, phase: 'error', error: 'network' });
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}
