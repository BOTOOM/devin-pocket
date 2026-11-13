import type { ClientCommand, ClientEnvelope, ServerMessage } from '@shared/protocol';

type Handler = (msg: ServerMessage) => void;
type ConnHandler = (connected: boolean) => void;

const handlers = new Set<Handler>();
const connHandlers = new Set<ConnHandler>();
let ws: WebSocket | null = null;
let seq = 0;
let attempt = 0;
let closed = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let checkAccess: (() => Promise<boolean>) | undefined;
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const sessionCreations = new Map<string, Promise<unknown>>();

function url(): string {
  return `${location.origin.replace(/^http/, 'ws')}/ws`;
}

function connect() {
  if (closed) return;
  const socket = new WebSocket(url());
  ws = socket;
  ws.onopen = () => {
    attempt = 0;
    for (const h of connHandlers) h(true);
  };
  ws.onmessage = (e) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(e.data as string);
    } catch {
      return;
    }
    if (msg.type === 'ack') {
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(msg.error));
      }
      return;
    }
    for (const h of handlers) h(msg);
  };
  ws.onclose = async () => {
    if (ws !== socket) return;
    ws = null;
    for (const h of connHandlers) h(false);
    for (const p of pending.values()) p.reject(new Error('connection closed'));
    pending.clear();
    if (!closed && (!checkAccess || (await checkAccess())) && !closed) {
      const delay = Math.min(1000 * 2 ** attempt++, 15000);
      retryTimer = setTimeout(connect, delay);
    }
  };
}

export function startSocket(check?: () => Promise<boolean>) {
  if (ws) return;
  if (retryTimer) clearTimeout(retryTimer);
  checkAccess = check;
  closed = false;
  connect();
}

export function stopSocket() {
  closed = true;
  if (retryTimer) clearTimeout(retryTimer);
  const socket = ws;
  ws = null;
  socket?.close();
  for (const h of connHandlers) h(false);
  for (const p of pending.values()) p.reject(new Error('connection closed'));
  pending.clear();
}

export function onMessage(h: Handler): () => void {
  handlers.add(h);
  return () => handlers.delete(h);
}

export function onConnection(h: ConnHandler): () => void {
  connHandlers.add(h);
  return () => connHandlers.delete(h);
}

export function isConnected(): boolean {
  return ws?.readyState === WebSocket.OPEN;
}

export function send(cmd: ClientCommand): Promise<unknown> {
  if (cmd.type === 'session.new') {
    const existing = sessionCreations.get(cmd.cwd);
    if (existing) return existing;
  }
  const env: ClientEnvelope = { id: `c${++seq}`, cmd };
  const request = new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('not connected'));
      return;
    }
    pending.set(env.id, { resolve, reject });
    ws.send(JSON.stringify(env));
    setTimeout(() => {
      if (pending.delete(env.id)) reject(new Error('ack timeout'));
    }, 30000);
  });
  if (cmd.type === 'session.new') {
    sessionCreations.set(cmd.cwd, request);
    const clear = () => {
      sessionCreations.delete(cmd.cwd);
    };
    void request.then(clear, clear);
  }
  return request;
}
