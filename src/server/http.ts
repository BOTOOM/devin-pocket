import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { type WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { estimateCost } from '../shared/cost.js';
import type {
  AuthStatus,
  BillingInfo,
  ClientEnvelope,
  ErrorCode,
  LocalPort,
  PairedDevice,
  PairingResponse,
  ServerMessage,
  ServerSettings,
} from '../shared/protocol.js';
import { PROTOCOL_VERSION } from '../shared/protocol.js';
import type { AgentProcess } from './acp/agent.js';
import { readBillingCache } from './acp/user-status.js';
import {
  AuthError,
  AuthStore,
  DEVICE_MAX_AGE,
  defaultDeviceName,
  deviceCookieToken,
} from './auth.js';
import { getCatalog, loadCatalog } from './catalog.js';
import { DictationModels } from './dictation-model.js';
import { doctorReport } from './doctor.js';
import { browse, browsePath, cwdAllowed, homeDir, search } from './fs-search.js';
import { type Logger, logFiles, readLogs, redact } from './log.js';
import { isLoopback, loopbackHostAllowed, pairingUrls } from './network.js';
import { agentStderrFile, type Config, platformInfo, stateDir, VERSION } from './paths.js';
import { listPorts } from './ports.js';
import type { SessionManager } from './sessions.js';
import { cachedUpdate } from './update.js';
import { validateCwd } from './workspace.js';

/** Envelope shape gate before dispatch — unknown cmd.type falls to default ack. */
const Envelope = z.object({
  id: z.string(),
  cmd: z.object({ type: z.string() }).passthrough(),
});

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
};

function requireJson(req: http.IncomingMessage): void {
  if (req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json')
    throw new AuthError(415, 'application/json required');
}

async function jsonBody(req: http.IncomingMessage): Promise<unknown> {
  requireJson(req);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 4096) {
        reject(new AuthError(413, 'request too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > 4096) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new AuthError(400, 'invalid JSON'));
      }
    });
    req.on('error', reject);
    req.on('aborted', () => reject(new AuthError(400, 'aborted request')));
  });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.mjs': 'text/javascript; charset=utf-8',
};

function webRoot(): string {
  // built bundle: dist/server.js → ./web next to it
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const c of [
    path.join(here, 'web'),
    path.join(here, '..', 'dist', 'web'),
    path.join(process.cwd(), 'dist', 'web'),
  ]) {
    if (fs.existsSync(path.join(c, 'index.html'))) return c;
  }
  return path.join(here, 'web');
}

export interface ServerDeps {
  agent: AgentProcess;
  sessions: SessionManager;
  log: Logger;
  config: Config;
  dev: boolean;
  /** Force pairing even when a tunnel listens on loopback. */
  authRequired?: boolean;
  auth?: AuthStore;
  /** agent/server cwd — default folder offered to the UI */
  agentCwd?: string;
}

export class PocketServer {
  private dictationModels = new DictationModels(undefined, undefined, (message) =>
    this.deps.log.info(message),
  );
  private http?: http.Server;
  private wss?: WebSocketServer;
  private clients = new Set<WebSocket>();
  private portsTimer?: NodeJS.Timeout;
  private lastPorts: LocalPort[] = [];
  private lastBillingCache?: BillingInfo | null;
  readonly authRequired: boolean;
  private auth!: AuthStore;
  private deviceClients = new Map<WebSocket, string>();
  private verifiedDevices = new WeakMap<http.IncomingMessage, { id: string; token: string }>();
  private unsubscribeRevoke?: () => void;

  constructor(private deps: ServerDeps) {
    this.authRequired = !!deps.authRequired || !isLoopback(deps.config.host);
  }

  get port(): number {
    const address = this.http?.address();
    return address && typeof address !== 'string' ? address.port : this.deps.config.port;
  }

  /** Public so cli.ts can broadcast agent.status changes. */
  broadcast(msg: ServerMessage): void {
    const raw = JSON.stringify(msg);
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) ws.send(raw);
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private settings(): ServerSettings {
    const c = this.deps.config;
    return {
      version: VERSION,
      cwd: this.deps.agentCwd ?? process.cwd(),
      port: c.port,
      host: c.host,
      logDir: stateDir(),
      agentCommand: c.agentCommand,
      platform: platformInfo(),
    };
  }

  async start(): Promise<void> {
    const { config, sessions, log } = this.deps;
    const root = webRoot();
    this.http = http.createServer((req, res) => {
      for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value);
      void this.handleHttp(req, res, root);
    });
    this.http.requestTimeout = 15000;
    this.http.headersTimeout = 10000;
    const rejectMalformed = (socket: Duplex) => {
      socket.end(
        `HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n${Object.entries(
          SECURITY_HEADERS,
        )
          .map(([key, value]) => `${key}: ${value}\r\n`)
          .join('')}\r\n`,
      );
    };
    this.http.on('clientError', (_error, socket) => rejectMalformed(socket));
    this.wss = new WebSocketServer({
      server: this.http,
      // prompts can carry base64 images (composer caps ~1.5 MB per file)
      maxPayload: 2 * 1024 * 1024,
      verifyClient: (info, done) => {
        const req = info.req;
        if (req.url?.split('?')[0] !== '/ws')
          return done(false, 404, 'Not Found', SECURITY_HEADERS);
        if (
          (!this.authRequired && !loopbackHostAllowed(req.headers.host)) ||
          !this.originAllowed(req.headers.origin, req.headers.host)
        )
          return done(false, 403, 'Forbidden', SECURITY_HEADERS);
        try {
          const token = deviceCookieToken(req.headers.cookie);
          const device = this.auth.authenticate(token);
          if (this.authRequired && !device)
            return done(false, 401, 'Unauthorized', SECURITY_HEADERS);
          if (device && token) this.verifiedDevices.set(req, { id: device.id, token });
          done(true);
        } catch {
          done(false, 503, 'Authentication unavailable', SECURITY_HEADERS);
        }
      },
    });
    this.wss.on('wsClientError', (_error, socket) => rejectMalformed(socket));
    this.wss.on('error', (error) => log.error(`websocket server: ${error.message}`));
    this.wss.on('headers', (headers, req) => {
      for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.push(`${key}: ${value}`);
      const device = this.verifiedDevices.get(req);
      if (device) headers.push(`Set-Cookie: ${this.deviceCookie(req, device.token)}`);
    });
    this.wss.on('connection', (ws, req) => {
      const device = this.verifiedDevices.get(req);
      if (this.authRequired && !device) {
        ws.terminate();
        return;
      }
      if (device) this.deviceClients.set(ws, device.id);
      this.onConnect(ws);
    });

    await new Promise<void>((resolve, reject) => {
      this.http?.once('error', reject);
      this.http?.listen(config.port, config.host, () => resolve());
    });
    try {
      this.auth = this.deps.auth ?? new AuthStore();
      this.unsubscribeRevoke = this.auth.onRevoke((id) => {
        for (const [ws, device] of this.deviceClients) if (device === id) ws.terminate();
      });
    } catch (error) {
      await this.stop();
      throw error;
    }
    log.info(`listening on http://${config.host}:${config.port} (web root ${root})`);

    sessions.onEvent((msg) => this.broadcast(msg));
    this.startPortsPolling();
  }

  /**
   * CSRF/WS-hijack guard: Origin must be absent (same-origin fetch, curl) or
   * match the Host header; dev mode also allows the Vite dev server.
   */
  private originAllowed(origin: string | undefined, host: string | undefined): boolean {
    if (!origin) return true;
    try {
      const o = new URL(origin);
      if (o.host === host) return true;
      return this.deps.dev && o.host === 'localhost:5173';
    } catch {
      return false;
    }
  }

  private onConnect(ws: WebSocket): void {
    this.clients.add(ws);
    const c = this.deps.config;
    this.send(ws, {
      type: 'hello',
      protocol: PROTOCOL_VERSION,
      settings: this.settings(),
      agent: this.deps.agent.status,
      agentInfo: this.deps.agent.agentInfo,
      sessions: this.deps.sessions.summaries(),
      catalog: getCatalog(),
      workspaces: c.workspaces,
      billing: this.deps.agent.billingInfo ?? readBillingCache() ?? undefined,
      open: this.deps.sessions.openStates(),
    });
    ws.on('message', (data) => void this.onMessage(ws, data));
    const remove = () => {
      this.clients.delete(ws);
      this.deviceClients.delete(ws);
    };
    ws.on('close', remove);
    ws.on('error', remove);
  }

  private ack(ws: WebSocket, id: string, ok: boolean, payload?: unknown, code?: ErrorCode): void {
    this.send(
      ws,
      ok
        ? { type: 'ack', id, ok: true, result: payload }
        : { type: 'ack', id, ok: false, error: String(payload), code },
    );
  }

  private async onMessage(ws: WebSocket, data: unknown): Promise<void> {
    const device = this.deviceClients.get(ws);
    try {
      if (this.authRequired && (!device || !this.auth.touch(device))) {
        ws.terminate();
        return;
      }
    } catch {
      ws.terminate();
      return;
    }
    let env: ClientEnvelope;
    try {
      const parsed = Envelope.safeParse(JSON.parse(String(data)));
      if (!parsed.success) return;
      env = parsed.data as ClientEnvelope;
    } catch {
      return;
    }
    const { agent, sessions } = this.deps;
    const cmd = env.cmd;
    try {
      switch (cmd.type) {
        case 'auth.login': {
          await agent.authenticate(cmd.methodId);
          this.ack(ws, env.id, true);
          break;
        }
        case 'auth.logout': {
          await agent.logout();
          this.ack(ws, env.id, true);
          break;
        }
        case 'agent.restart': {
          agent.restart();
          this.ack(ws, env.id, true);
          break;
        }
        case 'sessions.refresh': {
          const list = await sessions.list(cmd.cwd, cmd.query);
          this.ack(ws, env.id, true, list);
          break;
        }
        case 'session.new': {
          const s = await sessions.create(cmd.cwd);
          this.ack(ws, env.id, true, s);
          break;
        }
        case 'session.open': {
          const s = await sessions.open(cmd.sessionId, cmd.cwd);
          this.ack(ws, env.id, true, s);
          break;
        }
        case 'session.close': {
          sessions.close(cmd.sessionId);
          this.ack(ws, env.id, true);
          break;
        }
        case 'session.forceClose': {
          await sessions.forceClose(cmd.sessionId);
          this.ack(ws, env.id, true);
          break;
        }
        case 'session.delete': {
          await sessions.delete(cmd.sessionId);
          this.ack(ws, env.id, true);
          break;
        }
        case 'session.rename': {
          await sessions.rename(cmd.sessionId, cmd.title);
          this.ack(ws, env.id, true);
          break;
        }
        case 'prompt': {
          const r = await sessions.prompt(cmd.sessionId, cmd.blocks);
          this.ack(ws, env.id, true, r);
          break;
        }
        case 'prompt.enqueue': {
          const id = sessions.enqueue(cmd.sessionId, cmd.blocks);
          this.ack(ws, env.id, true, { id });
          break;
        }
        case 'prompt.update': {
          const ok = sessions.updateQueued(cmd.sessionId, cmd.id, cmd.blocks);
          this.ack(ws, env.id, ok, ok ? undefined : 'queued message not found');
          break;
        }
        case 'prompt.remove': {
          const ok = sessions.removeQueued(cmd.sessionId, cmd.id);
          this.ack(ws, env.id, ok, ok ? undefined : 'queued message not found');
          break;
        }
        case 'prompt.sendNow': {
          await sessions.sendNow(cmd.sessionId, cmd.id);
          this.ack(ws, env.id, true);
          break;
        }
        case 'aside.ask': {
          sessions.askAside(cmd.sessionId, cmd.question);
          this.ack(ws, env.id, true);
          break;
        }
        case 'cancel': {
          await sessions.cancel(cmd.sessionId);
          this.ack(ws, env.id, true);
          break;
        }
        case 'mode.set': {
          await sessions.setMode(cmd.sessionId, cmd.modeId);
          this.ack(ws, env.id, true);
          break;
        }
        case 'config.set': {
          await sessions.setConfigOption(cmd.sessionId, cmd.configId, cmd.value);
          this.ack(ws, env.id, true);
          break;
        }
        case 'permission.respond': {
          const ok = sessions.respondPermission(cmd.requestId, cmd.outcome);
          this.ack(ws, env.id, ok, ok ? undefined : 'unknown requestId');
          break;
        }
        case 'catalog.refresh': {
          const cat = await loadCatalog(true, this.deps.log);
          this.broadcast({ type: 'catalog', catalog: cat });
          this.ack(ws, env.id, true, cat);
          break;
        }
        case 'ports.refresh': {
          const ports = listPorts(this.deps.config.port);
          this.broadcast({ type: 'ports', ports });
          this.ack(ws, env.id, true, ports);
          break;
        }
        default:
          this.ack(ws, env.id, false, `unknown command`);
      }
    } catch (e) {
      this.ack(ws, env.id, false, (e as Error).message);
    }
  }

  private startPortsPolling(): void {
    this.portsTimer = setInterval(() => {
      this.auth.sweep();
      if (this.clients.size === 0) return;
      const ports = listPorts(this.deps.config.port);
      if (JSON.stringify(ports) !== JSON.stringify(this.lastPorts)) {
        this.lastPorts = ports;
        this.broadcast({ type: 'ports', ports });
      }
      // the agent never pushes billingInformation on this client — refresh
      // from the local user_status cache (rewritten on each `devin acp` boot)
      if (!this.deps.agent.billingInfo) {
        const b = readBillingCache();
        if (b !== this.lastBillingCache) {
          this.lastBillingCache = b;
          if (b) this.broadcast({ type: 'billing', billing: b });
        }
      }
    }, 5000);
    this.portsTimer.unref();
  }

  private async handleHttp(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    root: string,
  ): Promise<void> {
    if (!this.authRequired && !loopbackHostAllowed(req.headers.host))
      return this.json(res, { error: 'forbidden host' }, 403);
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      return this.json(res, { error: 'invalid URL' }, 400);
    }
    if (url.pathname.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    if (
      url.pathname.startsWith('/api/') &&
      !this.originAllowed(req.headers.origin, req.headers.host)
    ) {
      return this.json(res, { error: 'forbidden origin' }, 403);
    }
    if (this.deps.dev && req.headers.origin?.includes('localhost:5173')) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
      if (req.method === 'OPTIONS') {
        res.writeHead(204).end();
        return;
      }
    }
    try {
      if (url.pathname.startsWith('/api/') && (req.method === 'POST' || req.method === 'DELETE'))
        requireJson(req);
      const token = deviceCookieToken(req.headers.cookie);
      const protectedRoute = url.pathname.startsWith('/api/') || req.url?.startsWith('/models/');
      const device = protectedRoute ? this.auth.authenticate(token) : undefined;
      if (device && token) res.setHeader('Set-Cookie', this.deviceCookie(req, token));
      if (url.pathname.startsWith('/api/auth/'))
        return await this.handleAuth(req, res, url, device);
      if (this.authRequired && protectedRoute && !device)
        return this.json(res, { error: 'unauthorized' }, 401);
      if (req.url?.startsWith('/models/')) return await this.dictationModels.serve(req, res);
      if (url.pathname.startsWith('/api/') && req.method !== 'GET')
        return this.json(res, { error: 'method not allowed' }, 405);
      if (url.pathname === '/api/health') {
        return this.json(res, {
          ok: true,
          version: VERSION,
          agent: this.deps.agent.status,
          update: cachedUpdate(),
        });
      }
      if (url.pathname === '/api/doctor') {
        const r = await doctorReport({
          port: this.deps.config.port,
          host: this.deps.config.host,
          agentCommand: this.deps.config.agentCommand,
          ownsPort: true,
        });
        return this.json(res, r);
      }
      if (url.pathname === '/api/logs') {
        const lines = Math.min(Number(url.searchParams.get('lines')) || 200, 500);
        return this.json(res, { files: logFiles(), lines: readLogs(lines) });
      }
      if (url.pathname === '/api/fs') {
        const cwd = url.searchParams.get('cwd') ?? '';
        const q = url.searchParams.get('q') ?? '';
        const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
        if (!cwdAllowed(cwd, this.deps.config.workspaces)) {
          return this.json(res, { error: 'cwd not allowed' }, 403);
        }
        return this.json(
          res,
          await search(validateCwd(cwd, this.deps.config.workspaces), q, limit),
        );
      }
      if (url.pathname === '/api/workspaces/browse') {
        const p = url.searchParams.get('path') ?? '';
        const workspaces = this.deps.config.workspaces;
        return this.json(res, {
          entries: browse(p, workspaces),
          path: browsePath(p, workspaces),
          home: homeDir(),
        });
      }
      if (url.pathname === '/api/catalog') {
        return this.json(res, getCatalog());
      }
      if (url.pathname === '/api/ports') {
        return this.json(res, { ports: listPorts(this.deps.config.port) });
      }
      if (url.pathname === '/api/report') {
        return this.report(res);
      }
      if (url.pathname === '/api/config') {
        return this.json(res, redact(this.deps.config));
      }
      // static / SPA
      return this.serveStatic(url.pathname, res, root);
    } catch (e) {
      if (e instanceof AuthError) return this.json(res, { error: e.message }, e.status);
      this.deps.log.error(`http ${req.method} ${req.url}: ${(e as Error).message}`);
      return this.json(res, { error: (e as Error).message }, 500);
    }
  }

  private deviceCookie(req: http.IncomingMessage, token: string, maxAge = DEVICE_MAX_AGE): string {
    const secure =
      ('encrypted' in req.socket && req.socket.encrypted) ||
      (isLoopback(req.socket.remoteAddress ?? '') && req.headers['x-forwarded-proto'] === 'https');
    return `dp_device=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  }

  private async handleAuth(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
    device?: PairedDevice,
  ): Promise<void> {
    const route = url.pathname;
    if (route === '/api/auth/status' && req.method === 'GET') {
      const status: AuthStatus = {
        required: this.authRequired,
        paired: !!device,
        ...(device ? { deviceId: device.id } : {}),
      };
      return this.json(res, status);
    }
    if (route === '/api/auth/pair' && req.method === 'POST') {
      let body: unknown;
      try {
        body = await jsonBody(req);
      } catch (error) {
        if (error instanceof AuthError && error.status === 400)
          this.auth.redeem({}, req.socket.remoteAddress ?? 'unknown');
        throw error;
      }
      const parsed = z
        .object({
          token: z.string().min(1).max(128).optional(),
          code: z.string().min(1).max(32).optional(),
          name: z.string().max(80).optional(),
        })
        .strict()
        .safeParse(body);
      const paired = this.auth.redeem(
        parsed.success
          ? {
              ...parsed.data,
              name: parsed.data.name ?? defaultDeviceName(req.headers['user-agent']),
            }
          : {},
        req.socket.remoteAddress ?? 'unknown',
      );
      res.setHeader('Set-Cookie', this.deviceCookie(req, paired.token));
      return this.json(res, { device: paired.device });
    }
    const bearer = req.headers.authorization?.match(/^Bearer ([\w-]{43})$/)?.[1];
    const admin =
      isLoopback(req.socket.remoteAddress ?? '') && !!bearer && this.auth.isAdmin(bearer);
    if (!device && !admin) return this.json(res, { error: 'unauthorized' }, 401);
    if (req.method === 'POST' || req.method === 'DELETE') {
      const body = await jsonBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)
        throw new AuthError(400, 'expected empty JSON object');
    }
    if (route === '/api/auth/pairings' && req.method === 'POST') {
      if (!this.authRequired) throw new AuthError(409, 'pairing is not required');
      const grant = this.auth.createGrant();
      const response: PairingResponse = {
        ...grant,
        urls: pairingUrls(this.deps.config.host, this.port, grant.token),
      };
      return this.json(res, response);
    }
    if (route === '/api/auth/devices' && req.method === 'GET')
      return this.json(res, { devices: this.auth.list(device?.id) });
    if (route === '/api/auth/devices' && req.method === 'DELETE') {
      this.auth.revokeOthers(device?.id);
      return this.json(res, { ok: true });
    }
    if (route.startsWith('/api/auth/devices/') && req.method === 'DELETE') {
      if (!this.auth.revoke(decodeURIComponent(route.slice('/api/auth/devices/'.length))))
        throw new AuthError(404, 'device not found');
      if (route.endsWith(`/${device?.id}`))
        res.setHeader('Set-Cookie', this.deviceCookie(req, '', 0));
      return this.json(res, { ok: true });
    }
    if (route === '/api/auth/logout' && req.method === 'POST') {
      if (device) this.auth.revoke(device.id);
      res.setHeader('Set-Cookie', this.deviceCookie(req, '', 0));
      return this.json(res, { ok: true });
    }
    return this.json(res, { error: 'not found' }, 404);
  }

  private report(res: http.ServerResponse): void {
    const open = this.deps.sessions.openStates().map((s) => ({
      sessionId: s.sessionId,
      cwd: s.cwd,
      title: s.title,
      turn: s.turn,
      seq: s.seq,
      // last 100 non-chunk events — replayed items only carry ids; store raw
      itemCount: s.items.length,
      cost: estimateCost(s.turnStats, getCatalog()),
      usage: s.usage,
      error: s.error,
    }));
    const body = {
      at: new Date().toISOString(),
      version: VERSION,
      settings: this.settings(),
      agent: { status: this.deps.agent.status, info: this.deps.agent.agentInfo },
      workspaces: this.deps.config.workspaces,
      openSessions: open,
      logs: readLogs(500),
      agentStderr: agentStderrFile(),
    };
    const name = `devin-pocket-report-${Date.now()}.json`;
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${name}"`,
    });
    res.end(JSON.stringify(redact(body), null, 2));
  }

  private json(res: http.ServerResponse, body: unknown, code = 200): void {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private serveStatic(pathname: string, res: http.ServerResponse, root: string): void {
    let p = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    if (p === '/' || p === '') p = '/index.html';
    let file = path.join(root, p);
    const rel = path.relative(root, file);
    if (rel.startsWith('..') || path.isAbsolute(rel)) file = path.join(root, 'index.html');
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(root, 'index.html');
    }
    if (!fs.existsSync(file)) {
      res.writeHead(404).end('devin-pocket: web build not found (run pnpm run build:web)');
      return;
    }
    const ext = path.extname(file);
    const hashed = /[-.][0-9a-zA-Z_-]{8,}\.(js|css|woff2|png|svg)$/.test(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control':
        path.basename(file) === 'index.html' || ext === '.webmanifest'
          ? 'no-cache'
          : hashed
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  }

  async stop(): Promise<void> {
    if (this.portsTimer) clearInterval(this.portsTimer);
    for (const ws of this.clients) ws.close();
    this.clients.clear();
    this.deviceClients.clear();
    this.unsubscribeRevoke?.();
    await new Promise<void>((r) => this.wss?.close(() => r()));
    await new Promise<void>((r) => this.http?.close(() => r()));
  }
}
