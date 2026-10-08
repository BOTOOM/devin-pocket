import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { AgentProcess } from '../src/server/acp/agent.js';
import { normalizeUpdate } from '../src/server/acp/normalize.js';
import { PocketServer } from '../src/server/http.js';
import { Logger, StderrSink } from '../src/server/log.js';
import { SessionManager } from '../src/server/sessions.js';
import { estimateCost } from '../src/shared/cost.js';
import type { ClientEnvelope, ServerMessage } from '../src/shared/protocol.js';

// Isolated XDG dirs per run so nothing touches ~/.local/state.
const tmp = mkdtempSync(path.join(os.tmpdir(), 'devin-pocket-test-'));
process.env.XDG_STATE_HOME = tmp;
process.env.XDG_CONFIG_HOME = tmp;
process.env.XDG_CACHE_HOME = tmp;
process.env.FAKE_AGENT_AUTHED = '1';
process.env.FAKE_AGENT_FAST = '1';
process.env.DEVIN_POCKET_MODELS_FILE = path.join(tmp, 'models.json');

const AGENT_CMD = `npx tsx ${path.join(import.meta.dirname, 'fake-agent.ts')}`;

writeFileSync(
  process.env.DEVIN_POCKET_MODELS_FILE as string,
  JSON.stringify({
    families: [
      {
        family_label: 'SWE-1.6',
        family_uid: 'swe-1-6',
        variants: [
          {
            model_uid: 'swe-1-6',
            label: 'SWE-1.6',
            cost_tier: 'medium',
            cost_summary: '$1 / 1M input $4 / 1M output',
          },
          { model_uid: 'swe-1-6-fast', label: 'SWE-1.6 Fast', cost_tier: 'high' },
        ],
      },
    ],
  }),
);

interface Harness {
  server: PocketServer;
  agent: AgentProcess;
  sessions: SessionManager;
  port: number;
  stop: () => Promise<void>;
}

async function boot(): Promise<Harness> {
  const log = new Logger(path.join(tmp, `test-${Date.now()}.log`));
  const stderr = new StderrSink(path.join(tmp, `agent-${Date.now()}.stderr.log`));
  let sessions!: SessionManager;
  const agent = new AgentProcess(
    { command: AGENT_CMD, cwd: process.cwd(), log, stderrLog: stderr },
    {
      onStatus: () => {},
      onSessionNotification: (n) => sessions.handleNotification(n),
      onTurnStats: (sid, st) => sessions.handleTurnStats(sid, st),
      onBillingInfo: () => {},
      onPermissionRequest: (sid, req) => sessions.requestPermission(sid, req),
      onSessionsReopened: () => {},
    },
  );
  sessions = new SessionManager(agent, [{ path: process.cwd(), name: 'repo' }], log);
  const server = new PocketServer({
    agent,
    sessions,
    log,
    config: {
      port: 0,
      host: '127.0.0.1',
      agentCommand: AGENT_CMD,
      workspaces: [],
    },
    dev: true,
  });
  await server.start();
  const addr = server['http' as never] as import('node:http').Server;
  const port = (addr.address() as { port: number }).port;
  agent.spawn();
  await new Promise((r) => setTimeout(r, 1500));
  return {
    server,
    agent,
    sessions,
    port,
    stop: async () => {
      agent.dispose();
      await server.stop();
    },
  };
}

function wsClient(port: number): {
  ws: WebSocket;
  msgs: ServerMessage[];
  send: (cmd: ClientEnvelope['cmd'], id?: string) => void;
  waitFor: (pred: (m: ServerMessage) => boolean, ms?: number) => Promise<ServerMessage>;
} {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const msgs: ServerMessage[] = [];
  ws.on('message', (d) => msgs.push(JSON.parse(String(d)) as ServerMessage));
  const waiters: { pred: (m: ServerMessage) => boolean; res: (m: ServerMessage) => void }[] = [];
  ws.on('message', (d) => {
    const m = JSON.parse(String(d)) as ServerMessage;
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i]?.pred(m)) {
        waiters[i]?.res(m);
        waiters.splice(i, 1);
      }
    }
  });
  return {
    ws,
    msgs,
    send: (cmd, id = `t-${Math.random().toString(36).slice(2, 8)}`) =>
      ws.send(JSON.stringify({ id, cmd } satisfies ClientEnvelope)),
    waitFor: (pred, ms = 15_000) =>
      new Promise((res, rej) => {
        const hit = msgs.find(pred);
        if (hit) return res(hit);
        waiters.push({ pred, res });
        setTimeout(() => rej(new Error('waitFor timeout')), ms);
      }),
  };
}

async function poll(pred: () => boolean, ms = 10_000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('poll timeout');
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('devin-pocket server', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await boot();
  }, 30_000);
  afterAll(async () => {
    await h.stop();
  });

  it('ws hello on connect', async () => {
    const c = wsClient(h.port);
    const hello = await c.waitFor((m) => m.type === 'hello');
    expect(hello.type).toBe('hello');
    c.ws.close();
  });

  it('session.new → snapshot + configOptions + modes', async () => {
    const c = wsClient(h.port);
    await c.waitFor((m) => m.type === 'hello');
    c.send({ type: 'session.new', cwd: process.cwd() }, 'new-1');
    const ack = await c.waitFor((m) => m.type === 'ack' && m.id === 'new-1');
    expect(ack.type === 'ack' && ack.ok).toBe(true);
    await c.waitFor((m) => m.type === 'session.snapshot');
    c.ws.close();
  });

  it('prompt → stream events → permission → turnEnded', async () => {
    const c = wsClient(h.port);
    await c.waitFor((m) => m.type === 'hello');
    c.send({ type: 'session.new', cwd: process.cwd() }, 'new-2');
    const snapMsg = await c.waitFor((m) => m.type === 'session.snapshot');
    if (snapMsg.type !== 'session.snapshot') throw new Error('bad');
    const snap = snapMsg.state;
    c.send(
      { type: 'prompt', sessionId: snap.sessionId, blocks: [{ type: 'text', text: 'hello' }] },
      'p-1',
    );
    const perm = await c.waitFor(
      (m) => m.type === 'session.event' && m.event.type === 'permissionRequested',
    );
    if (perm.type !== 'session.event' || perm.event.type !== 'permissionRequested')
      throw new Error('bad');
    c.send(
      {
        type: 'permission.respond',
        sessionId: snap.sessionId,
        requestId: perm.event.request.requestId,
        outcome: { kind: 'selected', optionId: 'opt-allow' },
      },
      'perm-1',
    );
    await c.waitFor((m) => m.type === 'session.event' && m.event.type === 'turnEnded', 20_000);
    const s = h.sessions.openStates().find((x) => x.sessionId === snap.sessionId)!;
    expect(s.turn).toBe('idle');
    expect(s.items.some((i) => i.kind === 'agent')).toBe(true);
    expect(s.turnStats.length).toBeGreaterThan(0);
    c.ws.close();
  });

  it('sends queued messages in order after the active turn finishes', async () => {
    const c = wsClient(h.port);
    await c.waitFor((m) => m.type === 'hello');
    c.send({ type: 'session.new', cwd: process.cwd() }, 'serial-new');
    const snap = await c.waitFor((m) => m.type === 'session.snapshot');
    if (snap.type !== 'session.snapshot') throw new Error('missing snapshot');
    const sid = snap.state.sessionId;
    c.send(
      { type: 'prompt.enqueue', sessionId: sid, blocks: [{ type: 'text', text: 'QUEUE_SHORT' }] },
      'serial-1',
    );
    await c.waitFor(
      (m) => m.type === 'session.event' && m.sessionId === sid && m.event.type === 'turnStarted',
    );
    c.send(
      {
        type: 'prompt.enqueue',
        sessionId: sid,
        blocks: [{ type: 'text', text: 'QUEUE_RESULT_auto' }],
      },
      'serial-2',
    );
    await c.waitFor((m) => m.type === 'ack' && m.id === 'serial-2');
    expect(h.sessions.openStates().find((s) => s.sessionId === sid)?.queue).toHaveLength(1);
    await c.waitFor(
      (m) =>
        m.type === 'session.event' &&
        m.sessionId === sid &&
        m.event.type === 'agentChunk' &&
        m.event.text.includes('QUEUE_RESULT_auto'),
    );
    const events = c.msgs.filter((m) => m.type === 'session.event' && m.sessionId === sid);
    const firstEnd = events.findIndex(
      (m) => m.type === 'session.event' && m.event.type === 'turnEnded',
    );
    const secondStart = events.findIndex(
      (m, i) => i > firstEnd && m.type === 'session.event' && m.event.type === 'turnStarted',
    );
    expect(firstEnd).toBeGreaterThan(0);
    expect(secondStart).toBeGreaterThan(firstEnd);
    c.ws.close();
  });

  it('queues across reconnects, supports editing/removal, and interrupts to send now', async () => {
    const c = wsClient(h.port);
    await c.waitFor((m) => m.type === 'hello');
    c.send({ type: 'session.new', cwd: process.cwd() }, 'queue-new');
    const snap = await c.waitFor((m) => m.type === 'session.snapshot');
    if (snap.type !== 'session.snapshot') throw new Error('missing snapshot');
    const sid = snap.state.sessionId;
    c.send(
      { type: 'prompt.enqueue', sessionId: sid, blocks: [{ type: 'text', text: 'QUEUE_HOLD' }] },
      'queue-hold',
    );
    await c.waitFor(
      (m) => m.type === 'session.event' && m.sessionId === sid && m.event.type === 'turnStarted',
    );
    c.send(
      {
        type: 'prompt.enqueue',
        sessionId: sid,
        blocks: [{ type: 'text', text: 'QUEUE_RESULT_first' }],
      },
      'queue-first',
    );
    c.send(
      {
        type: 'prompt.enqueue',
        sessionId: sid,
        blocks: [{ type: 'text', text: 'QUEUE_RESULT_second' }],
      },
      'queue-second',
    );
    const second = await c.waitFor((m) => m.type === 'ack' && m.id === 'queue-second');
    if (second.type !== 'ack' || !second.ok) throw new Error('queue failed');
    const secondId = (second.result as { id: string }).id;
    const other = wsClient(h.port);
    const hello = await other.waitFor((m) => m.type === 'hello');
    if (hello.type !== 'hello') throw new Error('missing hello');
    expect(hello.open.find((s) => s.sessionId === sid)?.queue).toHaveLength(2);
    other.send({ type: 'prompt.remove', sessionId: sid, id: secondId }, 'queue-remove');
    const removed = await other.waitFor((m) => m.type === 'ack' && m.id === 'queue-remove');
    expect(removed.type === 'ack' && removed.ok).toBe(true);
    const first = await c.waitFor((m) => m.type === 'ack' && m.id === 'queue-first');
    if (first.type !== 'ack' || !first.ok) throw new Error('queue failed');
    const firstId = (first.result as { id: string }).id;
    c.send({ type: 'prompt.sendNow', sessionId: sid, id: firstId }, 'queue-now');
    await c.waitFor((m) => m.type === 'ack' && m.id === 'queue-now');
    await poll(
      () =>
        h.sessions
          .openStates()
          .find((s) => s.sessionId === sid)
          ?.items.some(
            (i) => i.kind === 'agent' && i.text.includes('Completed QUEUE_RESULT_first'),
          ) ?? false,
    );
    const state = h.sessions.openStates().find((s) => s.sessionId === sid);
    expect(state?.queue).toHaveLength(0);
    expect(
      state?.items.some(
        (i) =>
          i.kind === 'user' &&
          i.blocks.some((b) => b.type === 'text' && b.text === 'QUEUE_RESULT_second'),
      ),
    ).toBe(false);
    expect(
      c.msgs.filter(
        (m) => m.type === 'session.event' && m.sessionId === sid && m.event.type === 'turnEnded',
      ),
    ).toHaveLength(2);
    c.ws.close();
    other.ws.close();
  });

  it('prompt.update edits a queued message keeping its position', async () => {
    const c = wsClient(h.port);
    await c.waitFor((m) => m.type === 'hello');
    c.send({ type: 'session.new', cwd: process.cwd() }, 'upd-new');
    const created = await c.waitFor((m) => m.type === 'ack' && m.id === 'upd-new');
    if (created.type !== 'ack' || !created.ok) throw new Error('session.new failed');
    const sid = (created.result as { sessionId: string }).sessionId;
    c.send(
      { type: 'prompt.enqueue', sessionId: sid, blocks: [{ type: 'text', text: 'QUEUE_HOLD' }] },
      'upd-hold',
    );
    await c.waitFor(
      (m) => m.type === 'session.event' && m.sessionId === sid && m.event.type === 'turnStarted',
    );
    c.send(
      { type: 'prompt.enqueue', sessionId: sid, blocks: [{ type: 'text', text: 'ONE' }] },
      'upd-1',
    );
    c.send(
      { type: 'prompt.enqueue', sessionId: sid, blocks: [{ type: 'text', text: 'TWO' }] },
      'upd-2',
    );
    const a1 = await c.waitFor((m) => m.type === 'ack' && m.id === 'upd-1');
    const a2 = await c.waitFor((m) => m.type === 'ack' && m.id === 'upd-2');
    if (a1.type !== 'ack' || a2.type !== 'ack' || !a1.ok || !a2.ok)
      throw new Error('enqueue failed');
    const id1 = (a1.result as { id: string }).id;
    const id2 = (a2.result as { id: string }).id;

    c.send(
      {
        type: 'prompt.update',
        sessionId: sid,
        id: id2,
        blocks: [{ type: 'text', text: 'TWO_EDITED' }],
      },
      'upd-e',
    );
    const edited = await c.waitFor((m) => m.type === 'ack' && m.id === 'upd-e');
    expect(edited.type === 'ack' && edited.ok).toBe(true);
    const q = h.sessions.openStates().find((s) => s.sessionId === sid)?.queue ?? [];
    expect(q.map((i) => i.id)).toEqual([id1, id2]);
    expect(q[1]?.blocks[0]).toMatchObject({ type: 'text', text: 'TWO_EDITED' });

    c.send(
      {
        type: 'prompt.update',
        sessionId: sid,
        id: 'missing',
        blocks: [{ type: 'text', text: 'x' }],
      },
      'upd-404',
    );
    const missing = await c.waitFor((m) => m.type === 'ack' && m.id === 'upd-404');
    expect(missing.type === 'ack' && !missing.ok).toBe(true);

    c.send({ type: 'prompt.remove', sessionId: sid, id: id1 }, 'upd-r1');
    c.send({ type: 'prompt.remove', sessionId: sid, id: id2 }, 'upd-r2');
    await c.waitFor((m) => m.type === 'ack' && m.id === 'upd-r2');
    c.ws.close();
  });

  it('answers a side question without cancelling or mixing the active turn', async () => {
    const c = wsClient(h.port);
    await c.waitFor((m) => m.type === 'hello');
    c.send({ type: 'session.new', cwd: process.cwd() }, 'aside-new');
    const snap = await c.waitFor((m) => m.type === 'session.snapshot');
    if (snap.type !== 'session.snapshot') throw new Error('missing snapshot');
    const sid = snap.state.sessionId;
    await c.waitFor(
      (m) =>
        m.type === 'session.event' &&
        m.sessionId === sid &&
        m.event.type === 'commands' &&
        m.event.commands.some((command) => command.name === 'btw'),
    );
    c.send(
      { type: 'prompt.enqueue', sessionId: sid, blocks: [{ type: 'text', text: 'QUEUE_HOLD' }] },
      'aside-hold',
    );
    await c.waitFor(
      (m) =>
        m.type === 'session.event' &&
        m.sessionId === sid &&
        m.event.type === 'agentChunk' &&
        m.event.text.includes('Working on queued task'),
    );
    c.send({ type: 'aside.ask', sessionId: sid, question: '¿Cómo va?' }, 'aside-ask');
    const ack = await c.waitFor((m) => m.type === 'ack' && m.id === 'aside-ask');
    expect(ack.type === 'ack' && ack.ok).toBe(true);
    await c.waitFor(
      (m) => m.type === 'session.event' && m.sessionId === sid && m.event.type === 'asideEnded',
    );
    const state = h.sessions.openStates().find((s) => s.sessionId === sid);
    expect(state?.aside).toMatchObject({
      question: '¿Cómo va?',
      answer: 'Side answer: ¿Cómo va?',
      status: 'done',
    });
    expect(state?.turn).toBe('working');
    expect(state?.items.some((i) => i.kind === 'agent' && i.text.includes('Side answer'))).toBe(
      false,
    );
    expect(
      state?.items.some(
        (i) =>
          i.kind === 'user' && i.blocks.some((b) => b.type === 'text' && b.text.startsWith('/btw')),
      ),
    ).toBe(false);
    c.send({ type: 'cancel', sessionId: sid }, 'aside-stop');
    await c.waitFor(
      (m) => m.type === 'session.event' && m.sessionId === sid && m.event.type === 'turnEnded',
    );
    c.ws.close();
  });

  it('config.set thought_level', async () => {
    const c = wsClient(h.port);
    await c.waitFor((m) => m.type === 'hello');
    const s = h.sessions.openStates()[0]!;
    c.send(
      { type: 'config.set', sessionId: s.sessionId, configId: 'thought_level', value: 'medium' },
      'cfg-1',
    );
    const ack = await c.waitFor((m) => m.type === 'ack' && m.id === 'cfg-1');
    expect(ack.type === 'ack' && ack.ok).toBe(true);
    c.ws.close();
  });

  it('session list carries lock info', async () => {
    const list = await h.sessions.list(process.cwd());
    const locked = list.find((s) => s.sessionId === 'fake-session-newest');
    expect(locked?.locked).toBe(true);
    expect(locked?.lockHolderPid).toBe(4242);
  });

  it('syncs the session list on ready and after create/delete', async () => {
    // auto-list ran when the agent became ready during boot()
    await poll(() => h.sessions.summaries().some((s) => s.sessionId === 'fake-session-newest'));
    const c = wsClient(h.port);
    const hello = await c.waitFor((m) => m.type === 'hello');
    if (hello.type !== 'hello') throw new Error('bad');
    expect(hello.sessions.some((s) => s.sessionId === 'fake-session-newest')).toBe(true);

    c.send({ type: 'session.new', cwd: process.cwd() }, 'nl-1');
    const ack = await c.waitFor((m) => m.type === 'ack' && m.id === 'nl-1');
    if (ack.type !== 'ack' || !ack.ok) throw new Error('bad');
    const sid = (ack.result as { sessionId: string }).sessionId;
    await c.waitFor(
      (m) => m.type === 'sessions.list' && m.sessions.some((s) => s.sessionId === sid),
    );
    c.send({ type: 'session.delete', sessionId: sid, cwd: process.cwd() }, 'nl-2');
    await c.waitFor(
      (m) => m.type === 'sessions.list' && !m.sessions.some((s) => s.sessionId === sid),
    );
    c.ws.close();
  });

  it('rename broadcasts the new title in sessions.list', async () => {
    const c = wsClient(h.port);
    await c.waitFor((m) => m.type === 'hello');
    c.send(
      { type: 'session.rename', sessionId: 'fake-session-newest', title: 'Renamed test' },
      'rn-1',
    );
    await c.waitFor((m) => m.type === 'ack' && m.id === 'rn-1');
    const list = await c.waitFor(
      (m) =>
        m.type === 'sessions.list' &&
        m.sessions.some((s) => s.sessionId === 'fake-session-newest' && s.title === 'Renamed test'),
    );
    expect(list.type).toBe('sessions.list');
    c.ws.close();
  });

  it('closing a session resolves its pending permission', async () => {
    const c = wsClient(h.port);
    await c.waitFor((m) => m.type === 'hello');
    c.send({ type: 'session.new', cwd: process.cwd() }, 'pc-1');
    const snap = await c.waitFor((m) => m.type === 'session.snapshot');
    if (snap.type !== 'session.snapshot') throw new Error('bad');
    const sid = snap.state.sessionId;
    c.send({ type: 'prompt', sessionId: sid, blocks: [{ type: 'text', text: 'hi' }] }, 'pc-2');
    await c.waitFor((m) => m.type === 'session.event' && m.event.type === 'permissionRequested');
    c.send({ type: 'session.close', sessionId: sid }, 'pc-3');
    // prompt RPC resolves (cancelled) instead of hanging forever
    const ack = await c.waitFor((m) => m.type === 'ack' && m.id === 'pc-2', 20_000);
    expect(ack.type === 'ack' && ack.ok).toBe(true);
    c.ws.close();
  });

  it('does not resume the queue after a cancelled (Stop) turn', async () => {
    const s = await h.sessions.create(process.cwd());
    const p = h.sessions
      .prompt(s.sessionId, [{ type: 'text', text: 'STOP_QUEUE_TEST' }])
      .catch((e) => ({ stopReason: `error:${(e as Error).message}` }));
    await poll(
      () => h.sessions.openStates().find((x) => x.sessionId === s.sessionId)?.turn === 'working',
    );
    h.sessions.enqueue(s.sessionId, [{ type: 'text', text: 'QUEUED_AFTER_STOP' }]);
    await h.sessions.cancel(s.sessionId);
    await p;
    // a buggy finally would drain the queue right here
    await new Promise((r) => setTimeout(r, 800));
    const state = h.sessions.openStates().find((x) => x.sessionId === s.sessionId);
    expect(state?.queue).toHaveLength(1);
  });

  it('app-created sessions survive restart via the global session/list', async () => {
    const otherCwd = mkdtempSync(path.join(os.tmpdir(), 'devin-pocket-cwd-'));
    const s = await h.sessions.create(otherCwd);
    await h.sessions.rename(s.sessionId, 'Persisted session');
    // simulated restart: a fresh manager with no workspaces — only the
    // cwd-less session/list can return a session created under otherCwd
    const log2 = new Logger(path.join(tmp, `test2-${Date.now()}.log`));
    const m2 = new SessionManager(h.agent, [], log2);
    const list = await m2.list();
    const found = list.find((x) => x.sessionId === s.sessionId);
    expect(found).toBeTruthy();
    expect(found?.title).toBe('Persisted session');
    expect(found?.cwd).toBe(otherCwd);
  });

  it('catalog.refresh returns debug info (fixture source)', async () => {
    const c = wsClient(h.port);
    await c.waitFor((m) => m.type === 'hello');
    c.send({ type: 'catalog.refresh' }, 'cat-1');
    const ack = await c.waitFor((m) => m.type === 'ack' && m.id === 'cat-1');
    if (ack.type !== 'ack' || !ack.ok) throw new Error('bad');
    const cat = ack.result as {
      status: string;
      debug?: { source: string; entryCount: number };
    };
    expect(cat.debug?.source).toBe('fixture');
    expect(cat.debug?.entryCount).toBe(2);
    c.ws.close();
  });

  it('/api/health + /api/doctor + /api/fs', async () => {
    const health = (await fetch(`http://127.0.0.1:${h.port}/api/health`).then((r) => r.json())) as {
      ok: boolean;
    };
    expect(health.ok).toBe(true);
    const doctor = (await fetch(`http://127.0.0.1:${h.port}/api/doctor`).then((r) => r.json())) as {
      checks: unknown[];
    };
    expect(doctor.checks.length).toBeGreaterThan(3);
    const fs = (await fetch(
      `http://127.0.0.1:${h.port}/api/fs?cwd=${encodeURIComponent(process.cwd())}&q=package`,
    ).then((r) => r.json())) as { entries: { name: string }[] };
    expect(fs.entries.some((e) => e.name === 'package.json')).toBe(true);
    const denied = await fetch(`http://127.0.0.1:${h.port}/api/fs?cwd=/etc`);
    expect(denied.status).toBe(403);
  }, 40_000);
});

describe('normalizeUpdate', () => {
  it('maps the real Devin update shapes', () => {
    const text = (t: string) => ({ type: 'text' as const, text: t });
    expect(
      normalizeUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: text('hi'),
      } as SessionUpdate),
    ).toEqual([{ type: 'agentChunk', text: 'hi' }]);
    expect(
      normalizeUpdate({
        sessionUpdate: 'agent_thought_chunk',
        content: text('t'),
      } as SessionUpdate),
    ).toEqual([{ type: 'thoughtChunk', text: 't' }]);
    const tool = normalizeUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'x',
      title: 'Ran ls',
      kind: 'execute',
      status: 'in_progress',
      rawInput: { command: 'ls' },
      _meta: { 'cognition.ai/cwd': '/repo', terminal_exit: { exit_code: 0 } },
    } as SessionUpdate);
    expect(tool[0]).toMatchObject({ type: 'toolCall', exitCode: 0, cwd: '/repo', command: 'ls' });
    const upd = normalizeUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'x',
      status: 'completed',
      _meta: { terminal_exit: { terminal_id: 't', exit_code: 1, signal: null } },
    } as SessionUpdate);
    expect(upd[0]).toMatchObject({ type: 'toolCallUpdate', exitCode: 1 });
    const cmds = normalizeUpdate({
      sessionUpdate: 'available_commands_update',
      availableCommands: [
        {
          name: 'plan',
          description: 'd',
          input: { hint: '[prompt]' },
          _meta: { 'cognition.ai/category': 'Session' },
        },
      ],
    } as SessionUpdate);
    expect(cmds[0]).toMatchObject({
      type: 'commands',
      commands: [{ name: 'plan', hint: '[prompt]', category: 'Session' }],
    });
    expect(
      normalizeUpdate({
        sessionUpdate: 'usage_update',
        used: 100,
        size: 1000,
        cost: { amount: 1.5, currency: 'USD' },
      } as SessionUpdate)[0],
    ).toEqual({
      type: 'usage',
      usage: { used: 100, size: 1000, cost: { amount: 1.5, currency: 'USD' } },
    });
    expect(normalizeUpdate({ sessionUpdate: 'unknown_thing' } as unknown as SessionUpdate)).toEqual(
      [],
    );
  });
});

describe('estimateCost', () => {
  it('prices by model label; Fusion/unmatched unpriced', () => {
    const catalog = {
      status: 'ready' as const,
      fetchedAt: 0,
      fromCache: false,
      entries: [
        {
          modelUid: 'x',
          label: 'SWE-2 Max',
          isNew: false,
          isBeta: false,
          prices: { input: 1, cached: 0.1, output: 4 },
        },
      ],
    };
    const stats = [
      {
        turnRequestId: 'a',
        model: 'SWE-2 Max',
        input: 1_000_000,
        cached: 1_000_000,
        output: 1_000_000,
        extra: [],
      },
      { turnRequestId: 'b', model: 'Fusion (X + Y)', input: 1, cached: 0, output: 1, extra: [] },
      { turnRequestId: 'c', model: 'Mystery', input: 1, cached: 0, output: 1, extra: [] },
    ];
    const r = estimateCost(stats, catalog);
    expect(r.amount).toBeCloseTo(1 + 0.1 + 4, 5);
    expect(r.unpriced).toBe(2);
    expect(r.estimated).toBe(true);
  });
});
