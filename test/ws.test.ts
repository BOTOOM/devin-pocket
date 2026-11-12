import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ClientCommand } from '../src/shared/protocol.js';

const modulePath = '../src/web/lib/ws.ts';
const { send, startSocket, stopSocket } = (await import(modulePath)) as {
  send: (cmd: ClientCommand) => Promise<unknown>;
  startSocket: () => void;
  stopSocket: () => void;
};

class Socket {
  static OPEN = 1;
  static current: Socket;
  readyState = 1;
  onmessage?: (event: { data: string }) => void;
  send = vi.fn<(data: string) => void>();
  close = vi.fn();
  constructor() {
    Socket.current = this;
  }
  ack(index: number, ok = true) {
    const call = this.send.mock.calls[index];
    if (!call) throw new Error('missing request');
    const { id } = JSON.parse(call[0]);
    this.onmessage?.({
      data: JSON.stringify({ type: 'ack', id, ok, result: { sessionId: id }, error: 'failed' }),
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('location', { origin: 'http://localhost' });
  startSocket();
});

afterEach(() => {
  stopSocket();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('deduplicates only matching cwd requests and clears each completed request independently', async () => {
  const first = send({ type: 'session.new', cwd: '/first' });
  const second = send({ type: 'session.new', cwd: '/second' });
  expect(second).not.toBe(first);
  expect(send({ type: 'session.new', cwd: '/first' })).toBe(first);
  expect(send({ type: 'session.new', cwd: '/second' })).toBe(second);
  expect(Socket.current.send).toHaveBeenCalledTimes(2);
  Socket.current.ack(0);
  await first;
  expect(send({ type: 'session.new', cwd: '/second' })).toBe(second);
  const next = send({ type: 'session.new', cwd: '/first' });
  expect(next).not.toBe(first);
  Socket.current.ack(1);
  Socket.current.ack(2);
  await Promise.all([second, next]);
});

it('clears failed and empty-cwd requests so they can be retried', async () => {
  const first = send({ type: 'session.new', cwd: '' });
  expect(send({ type: 'session.new', cwd: '' })).toBe(first);
  const rejected = expect(first).rejects.toThrow('failed');
  Socket.current.ack(0, false);
  await rejected;
  const retry = send({ type: 'session.new', cwd: '' });
  expect(retry).not.toBe(first);
  Socket.current.ack(1);
  await retry;
});
