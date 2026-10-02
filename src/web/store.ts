import type {
  AgentInfo,
  AgentStatus,
  CatalogState,
  LocalPort,
  ServerMessage,
  ServerSettings,
  SessionState,
  SessionSummary,
  Workspace,
} from '@shared/protocol';
import { applyEvent } from '@shared/reducer';
import { useSyncExternalStore } from 'react';
import { onConnection, onMessage, send, startSocket } from '@/lib/ws';

export interface UiPrefs {
  showThoughts: boolean;
  enterToSend: boolean;
  workspaces: Workspace[];
  workspace?: string;
}

export interface AppState {
  connected: boolean;
  settings?: ServerSettings;
  agent: AgentStatus;
  agentInfo?: AgentInfo;
  sessions: SessionSummary[];
  catalog: CatalogState;
  workspaces: Workspace[];
  ports: LocalPort[];
  open: Map<string, SessionState>;
  knownSeq: Map<string, number>;
  activeSessionId?: string;
  prefs: UiPrefs;
  hydrated: boolean;
}

const PREFS_KEY = 'dp.prefs';
const ACTIVE_KEY = 'dp.activeSession';

function loadPrefs(): UiPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return { showThoughts: false, enterToSend: true, workspaces: [], ...p };
  } catch {
    return { showThoughts: false, enterToSend: true, workspaces: [] };
  }
}

let state: AppState = {
  connected: false,
  agent: { phase: 'starting' },
  sessions: [],
  catalog: { status: 'loading' },
  workspaces: [],
  ports: [],
  open: new Map(),
  knownSeq: new Map(),
  activeSessionId: localStorage.getItem(ACTIVE_KEY) ?? undefined,
  prefs: loadPrefs(),
  hydrated: false,
};

const listeners = new Set<() => void>();
let snapshot = state;

function set(partial: Partial<AppState>) {
  state = { ...state, ...partial };
  snapshot = state;
  for (const l of listeners) l();
}

export function getState(): AppState {
  return snapshot;
}

export function useStore<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => sel(snapshot),
  );
}

export function setActiveSession(id?: string) {
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
  set({ activeSessionId: id });
}

export function setPrefs(p: Partial<UiPrefs>) {
  const prefs = { ...state.prefs, ...p };
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  set({ prefs });
}

// Debounce sessions.refresh for events of unknown sessions (≥1s between sends).
let refreshPending = false;
let lastRefresh = 0;
function requestSessionRefresh() {
  if (refreshPending) return;
  refreshPending = true;
  const wait = Math.max(0, 1000 - (Date.now() - lastRefresh));
  setTimeout(() => {
    refreshPending = false;
    lastRefresh = Date.now();
    send({ type: 'sessions.refresh' }).catch(() => {});
  }, wait);
}

function handle(msg: ServerMessage) {
  switch (msg.type) {
    case 'hello': {
      const open = new Map<string, SessionState>();
      const knownSeq = new Map<string, number>();
      for (const s of msg.open) {
        open.set(s.sessionId, s);
        knownSeq.set(s.sessionId, s.seq);
      }
      const workspaces = msg.workspaces.length > 0 ? msg.workspaces : state.prefs.workspaces;
      set({
        settings: msg.settings,
        agent: msg.agent,
        agentInfo: msg.agentInfo,
        sessions: msg.sessions,
        catalog: msg.catalog,
        workspaces,
        open,
        knownSeq,
        hydrated: true,
      });
      break;
    }
    case 'agent.status':
      set({ agent: msg.status, agentInfo: msg.info ?? state.agentInfo });
      break;
    case 'sessions.list':
      set({ sessions: msg.sessions });
      break;
    case 'session.snapshot': {
      const open = new Map(state.open);
      const knownSeq = new Map(state.knownSeq);
      open.set(msg.state.sessionId, msg.state);
      knownSeq.set(msg.state.sessionId, msg.state.seq);
      set({ open, knownSeq });
      break;
    }
    case 'session.event': {
      const s = state.open.get(msg.sessionId);
      if (!s) {
        // Event for a session we don't have (created on another client?) — ask for refresh.
        requestSessionRefresh();
        return;
      }
      const known = state.knownSeq.get(msg.sessionId) ?? s.seq;
      if (msg.seq <= known) return;
      const next = applyEvent(s, msg.event);
      const open = new Map(state.open);
      const knownSeq = new Map(state.knownSeq);
      open.set(msg.sessionId, next);
      knownSeq.set(msg.sessionId, Math.max(msg.seq, next.seq));
      set({ open, knownSeq });
      break;
    }
    case 'session.closed': {
      const open = new Map(state.open);
      open.delete(msg.sessionId);
      const knownSeq = new Map(state.knownSeq);
      knownSeq.delete(msg.sessionId);
      set({ open, knownSeq });
      if (state.activeSessionId === msg.sessionId) setActiveSession(undefined);
      break;
    }
    case 'catalog':
      set({ catalog: msg.catalog });
      break;
    case 'ports':
      set({ ports: msg.ports });
      break;
    case 'workspaces':
      set({ workspaces: msg.workspaces });
      break;
    case 'toast': {
      import('sonner').then(({ toast }) => {
        const fn =
          msg.level === 'error'
            ? toast.error
            : msg.level === 'warn'
              ? toast.warning
              : msg.level === 'success'
                ? toast.success
                : toast.info;
        fn(msg.text);
      });
      break;
    }
  }
}

let started = false;
export function initStore() {
  if (started) return;
  started = true;
  onMessage(handle);
  onConnection((c) => set({ connected: c }));
  startSocket();
}
