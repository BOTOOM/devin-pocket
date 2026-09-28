import { mkdtempSync } from 'node:fs';
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

const AGENT_CMD = `npx tsx ${path.join(import.meta.dirname, 'fake-agent.ts')}`;

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
