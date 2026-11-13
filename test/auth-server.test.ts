import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import WebSocket from 'ws';
import { AgentProcess } from '../src/server/acp/agent.js';
import { AuthStore } from '../src/server/auth.js';
import { adminRequest, runningServerUrl } from '../src/server/auth-cli.js';
import { PocketServer, type ServerDeps } from '../src/server/http.js';
import { Logger, StderrSink } from '../src/server/log.js';
import { stateDir } from '../src/server/paths.js';
import { SessionManager } from '../src/server/sessions.js';
import type {
  AuthStatus,
  DevicesResponse,
  PairingResponse,
  PairResponse,
} from '../src/shared/protocol.js';

let root: string;
let auth: AuthStore;
let server: PocketServer;
let agent: AgentProcess;
let now: number;
let base: string;
let admin: string;
let deps: ServerDeps;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-auth-server-'));
  process.env.XDG_STATE_HOME = root;
  process.env.XDG_CONFIG_HOME = root;
  process.env.XDG_CACHE_HOME = root;
  process.env.FAKE_AGENT_AUTHED = '1';
  now = Date.now();
  auth = new AuthStore(stateDir(), () => now);
  admin = fs.readFileSync(path.join(stateDir(), 'admin.token'), 'utf8');
  const log = new Logger(path.join(root, 'server.log'));
  const command = `"${process.execPath}" --import tsx "${path.join(import.meta.dirname, 'fake-agent.ts')}"`;
  let sessions!: SessionManager;
  agent = new AgentProcess(
    { command, cwd: process.cwd(), log, stderrLog: new StderrSink(path.join(root, 'agent.log')) },
    {
      onStatus: () => {},
      onSessionNotification: (notification) => sessions.handleNotification(notification),
      onTurnStats: (id, stats) => sessions.handleTurnStats(id, stats),
      onBillingInfo: () => {},
      onPermissionRequest: (id, request) => sessions.requestPermission(id, request),
      onSessionsReopened: () => void sessions.reopenAll(),
    },
  );
  sessions = new SessionManager(agent, [], log);
  deps = {
    agent,
    sessions,
    log,
    auth,
    dev: false,
    config: { host: '0.0.0.0', port: 0, agentCommand: command, workspaces: [] },
  };
  server = new PocketServer(deps);
  await server.start();
  agent.spawn();
  base = `http://127.0.0.1:${server.port}`;
  fs.writeFileSync(
    path.join(stateDir(), 'server.json'),
    JSON.stringify({ host: '0.0.0.0', port: server.port }),
  );
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  agent?.dispose();
  await server?.stop();
  fs.rmSync(root, { recursive: true, force: true });
});

function post(route: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
async function pair(method: 'token' | 'code' = 'token') {
  const grant = auth.createGrant();
  const response = await post(
    '/api/auth/pair',
    { [method]: grant[method] },
    { 'User-Agent': 'Mozilla Android Chrome/1' },
  );
  expect(response.status).toBe(200);
  return {
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
    body: (await response.json()) as PairResponse,
    response,
  };
}
function connect(cookie?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base.replace('http:', 'ws:')}/ws`, {
      headers: cookie ? { Cookie: cookie } : {},
    });
    sockets.push(ws);
    ws.on('error', reject);
    ws.once('message', () => resolve(ws));
  });
}
function rejectedWs(headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base.replace('http:', 'ws:')}/ws`, { headers });
    sockets.push(ws);
    ws.on('error', reject);
    ws.once('unexpected-response', (_req, response) => {
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      response.resume();
      resolve(response.statusCode ?? 0);
      ws.terminate();
    });
    ws.once('open', () => reject(new Error('unexpected WebSocket access')));
  });
}

it('keeps the shell/status public but gates every other API and WebSocket', async () => {
  const status = await fetch(`${base}/api/auth/status`);
  expect(await status.json()).toEqual({ required: true, paired: false });
  for (const route of [
    '/api/health',
    '/api/config',
    '/api/catalog',
    '/api/doctor',
    '/api/fs',
    '/api/logs',
    '/api/report',
    '/api/unknown',
  ]) {
    const response = await fetch(`${base}${route}`);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  }
  const shell = await fetch(base);
  expect(shell.status).not.toBe(401);
  expect(shell.headers.get('x-content-type-options')).toBe('nosniff');
  expect(shell.headers.get('referrer-policy')).toBe('no-referrer');
  expect(shell.headers.get('x-frame-options')).toBe('DENY');
  expect(shell.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  expect(await rejectedWs()).toBe(401);
  expect(await rejectedWs({ Authorization: `Bearer ${admin}` })).toBe(401);
});

it('lets the CLI discover the actual port, request grants, list and revoke through its local token', async () => {
  expect(runningServerUrl().href).toBe(`${base}/`);
  const grant = await adminRequest<PairingResponse>('/api/auth/pairings', 'POST');
  expect(grant.code).toMatch(/^.{4}-.{4}$/);
  expect(await adminRequest<DevicesResponse>('/api/auth/devices')).toEqual({ devices: [] });
  const paired = await post('/api/auth/pair', { token: grant.token });
  expect(paired.status).toBe(200);
  await adminRequest('/api/auth/devices', 'DELETE');
  expect(await adminRequest<DevicesResponse>('/api/auth/devices')).toEqual({ devices: [] });
  await server.stop();
  await expect(adminRequest('/api/auth/status')).rejects.toThrow();
});

it('does not rotate the running server admin token when another listener fails to bind', async () => {
  const blocked = new PocketServer({
    ...deps,
    auth: undefined,
    config: { ...deps.config, port: server.port },
  });
  await expect(blocked.start()).rejects.toMatchObject({ code: 'EADDRINUSE' });
  await blocked.stop();
  expect(fs.readFileSync(path.join(stateDir(), 'admin.token'), 'utf8')).toBe(admin);
  expect((await adminRequest<AuthStatus>('/api/auth/status')).required).toBe(true);
});

it('includes security headers on malformed WebSocket upgrade errors', async () => {
  const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
    http
      .get(
        `${base}/ws`,
        {
          headers: {
            Connection: 'Upgrade',
            Upgrade: 'websocket',
            'Sec-WebSocket-Version': '13',
            'Sec-WebSocket-Key': 'invalid',
          },
        },
        resolve,
      )
      .on('error', reject);
  });
  response.resume();
  expect(response.statusCode).toBe(400);
  expect(response.headers['x-frame-options']).toBe('DENY');
  expect(response.headers['referrer-policy']).toBe('no-referrer');
});

it.each(['token', 'code'] as const)(
  'pairs by %s, refreshes a private cookie and opens the real fake-agent server',
  async (method) => {
    const { cookie, body, response } = await pair(method);
    expect(body.device.name).toBe('Android · Chrome');
    const setCookie = response.headers.get('set-cookie');
    for (const attribute of ['HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=2592000'])
      expect(setCookie).toContain(attribute);
    expect(setCookie).not.toContain('Secure');
    const status = await fetch(`${base}/api/auth/status`, { headers: { Cookie: cookie } });
    expect(await status.json()).toEqual({ required: true, paired: true, deviceId: body.device.id });
    expect(status.headers.get('set-cookie')).toContain(cookie);
    const shell = await fetch(base, { headers: { Cookie: cookie } });
    expect(shell.headers.get('set-cookie')).toBeNull();
    const health = await fetch(`${base}/api/health`, { headers: { Cookie: cookie } });
    expect(health.status).toBe(200);
    expect(await health.json()).toHaveProperty('agent.phase');
    const ws = await connect(cookie);
    expect(ws.readyState).toBe(WebSocket.OPEN);
  },
);

it('makes grants independent, single use and expired at the deadline', async () => {
  const first = auth.createGrant();
  const second = auth.createGrant();
  expect((await post('/api/auth/pair', { token: first.token })).status).toBe(200);
  expect((await post('/api/auth/pair', { code: first.code })).status).toBe(400);
  now += 10 * 60 * 1000;
  expect((await post('/api/auth/pair', { token: second.token })).status).toBe(400);
});

it('returns 429 after five failed attempts and resets a minute later', async () => {
  for (let i = 0; i < 5; i++)
    expect((await post('/api/auth/pair', { code: 'WRONG' })).status).toBe(400);
  const limited = await post('/api/auth/pair', { code: 'WRONG' });
  expect(limited.status).toBe(429);
  now += 60000;
  expect((await post('/api/auth/pair', { code: 'WRONG' })).status).toBe(400);
});

it('requires JSON and allowed origins, handles malformed bodies, and never caches grants', async () => {
  const grant = auth.createGrant();
  expect(
    (await post('/api/auth/pair', { token: grant.token }, { Origin: 'http://evil.test' })).status,
  ).toBe(403);
  expect(
    (
      await fetch(`${base}/api/auth/pair`, {
        method: 'POST',
        body: JSON.stringify({ token: grant.token }),
      })
    ).status,
  ).toBe(415);
  expect(
    (
      await fetch(`${base}/api/auth/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'bad JSON',
      })
    ).status,
  ).toBe(400);
  expect((await post('/api/auth/pair', { name: 'x'.repeat(5000) })).status).toBe(413);
  expect((await fetch(`${base}/api/health`, { method: 'POST' })).status).toBe(415);
  const paired = await post('/api/auth/pair', { token: grant.token });
  expect(paired.status).toBe(200);
  expect(paired.headers.get('cache-control')).toBe('no-store');
  const cookie = paired.headers.get('set-cookie')?.split(';')[0] ?? '';
  expect(
    (await post('/api/auth/pairings', {}, { Cookie: cookie, Origin: 'http://evil.test' })).status,
  ).toBe(403);
  expect(await rejectedWs({ Cookie: cookie, Origin: 'http://evil.test' })).toBe(403);
});

it('lets paired devices or the loopback administrator create grants and list devices without hashes', async () => {
  expect((await post('/api/auth/pairings', {})).status).toBe(401);
  expect((await post('/api/auth/pairings', {}, { Authorization: 'Bearer wrong' })).status).toBe(
    401,
  );
  const response = await post('/api/auth/pairings', {}, { Authorization: `Bearer ${admin}` });
  const grant = (await response.json()) as PairingResponse;
  expect(response.status).toBe(200);
  expect(grant.urls[0]).toContain(`:${server.port}/#/pair?t=${grant.token}`);
  const paired = await post('/api/auth/pair', { code: grant.code, name: 'My phone' });
  const cookie = paired.headers.get('set-cookie')?.split(';')[0] ?? '';
  const devices = await fetch(`${base}/api/auth/devices`, { headers: { Cookie: cookie } });
  const list = (await devices.json()) as DevicesResponse;
  expect(list.devices).toEqual([expect.objectContaining({ name: 'My phone', current: true })]);
  expect(JSON.stringify(list)).not.toMatch(/tokenHash|dp_device/);
  expect((await post('/api/auth/pairings', {}, { Cookie: cookie })).status).toBe(200);
});

it('immediately closes revoked sockets, keeps current on revoke-all, and logs out', async () => {
  const first = await pair();
  const second = await pair();
  const socket = await connect(second.cookie);
  const closed = once(socket, 'close');
  expect(
    (
      await fetch(`${base}/api/auth/devices`, {
        method: 'DELETE',
        headers: { Cookie: first.cookie, 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
  ).toBe(200);
  await closed;
  expect((await fetch(`${base}/api/health`, { headers: { Cookie: second.cookie } })).status).toBe(
    401,
  );
  expect((await fetch(`${base}/api/health`, { headers: { Cookie: first.cookie } })).status).toBe(
    200,
  );
  const currentSocket = await connect(first.cookie);
  const currentClosed = once(currentSocket, 'close');
  const logout = await post('/api/auth/logout', {}, { Cookie: first.cookie });
  expect(logout.status).toBe(200);
  expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
  await currentClosed;
  expect(
    (
      (await fetch(`${base}/api/auth/status`, { headers: { Cookie: first.cookie } }).then((res) =>
        res.json(),
      )) as AuthStatus
    ).paired,
  ).toBe(false);
});

it('supports revoking one id as admin and returns 404 for missing devices', async () => {
  const paired = await pair();
  const headers = { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' };
  const response = await fetch(`${base}/api/auth/devices/${paired.body.device.id}`, {
    method: 'DELETE',
    headers,
    body: '{}',
  });
  expect(response.status).toBe(200);
  expect((await fetch(`${base}/api/health`, { headers: { Cookie: paired.cookie } })).status).toBe(
    401,
  );
  expect(
    (await fetch(`${base}/api/auth/devices/missing`, { method: 'DELETE', headers, body: '{}' }))
      .status,
  ).toBe(404);
});

it('expires idle device credentials and closes their sockets', async () => {
  const paired = await pair();
  const socket = await connect(paired.cookie);
  const closed = once(socket, 'close');
  now += 30 * 24 * 3600 * 1000;
  const response = await fetch(`${base}/api/health`, { headers: { Cookie: paired.cookie } });
  expect(response.status).toBe(401);
  await closed;
});

it('trusts forwarded HTTPS only on loopback and never trusts forwarded IPs for admin', async (context) => {
  const address = Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .find((entry) => entry.family === 'IPv4' && !entry.internal)?.address;
  if (!address) {
    context.skip();
    return;
  }
  const secure = await post(
    '/api/auth/pair',
    { token: auth.createGrant().token },
    { 'X-Forwarded-Proto': 'https' },
  );
  expect(secure.headers.get('set-cookie')).toContain('; Secure');
  const remote = `http://${address}:${server.port}`;
  const forbidden = await fetch(`${remote}/api/auth/pairings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${admin}`,
      'X-Forwarded-For': '127.0.0.1',
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  expect(forbidden.status).toBe(401);
  const untrusted = await fetch(`${remote}/api/auth/pair`, {
    method: 'POST',
    headers: { 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: auth.createGrant().token }),
  });
  expect(untrusted.headers.get('set-cookie')).not.toContain('; Secure');
});

it('can force pairing on a loopback listener for a future tunnel', async () => {
  await server.stop();
  server = new PocketServer({
    ...deps,
    config: { ...deps.config, host: '127.0.0.1' },
    authRequired: true,
  });
  await server.start();
  base = `http://127.0.0.1:${server.port}`;
  expect((await fetch(`${base}/api/health`)).status).toBe(401);
});

it('keeps loopback mode working but rejects DNS-rebinding Host values for HTTP and WS', async () => {
  await server.stop();
  server = new PocketServer({
    ...deps,
    config: { ...deps.config, host: '127.0.0.1' },
    authRequired: false,
  });
  await server.start();
  base = `http://127.0.0.1:${server.port}`;
  expect((await fetch(`${base}/api/health`)).status).toBe(200);
  expect(await fetch(`${base}/api/auth/status`).then((res) => res.json())).toEqual({
    required: false,
    paired: false,
  });
  expect((await post('/api/auth/pairings', {}, { Authorization: `Bearer ${admin}` })).status).toBe(
    409,
  );
  expect((await connect()).readyState).toBe(WebSocket.OPEN);
  const status = await new Promise<number>((resolve, reject) => {
    http
      .get(`${base}/api/health`, { headers: { Host: 'attacker.example' } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      })
      .on('error', reject);
  });
  expect(status).toBe(403);
  expect(await rejectedWs({ Host: 'attacker.example' })).toBe(403);
});
