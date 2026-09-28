import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { estimateCost } from '../shared/cost.js';
import type {
  ClientEnvelope,
  ErrorCode,
  LocalPort,
  ServerMessage,
  ServerSettings,
} from '../shared/protocol.js';
import { PROTOCOL_VERSION } from '../shared/protocol.js';
import type { AgentProcess } from './acp/agent.js';
import { getCatalog, loadCatalog } from './catalog.js';
import { doctorReport } from './doctor.js';
import { browse, browsePath, cwdAllowed, homeDir, search } from './fs-search.js';
import { type Logger, logFiles, readLogs, redact } from './log.js';
import { agentStderrFile, type Config, platformInfo, stateDir, VERSION } from './paths.js';
import { listPorts } from './ports.js';
import type { SessionManager } from './sessions.js';

/** Envelope shape gate before dispatch — unknown cmd.type falls to default ack. */
const Envelope = z.object({
  id: z.string(),
  cmd: z.object({ type: z.string() }).passthrough(),
});

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
  /** agent/server cwd — default folder offered to the UI */
  agentCwd?: string;
}

export class PocketServer {
  private http?: http.Server;
  private wss?: WebSocketServer;
  private clients = new Set<WebSocket>();
  private portsTimer?: NodeJS.Timeout;
  private lastPorts: LocalPort[] = [];

  constructor(private deps: ServerDeps) {}

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

    this.http = http.createServer((req, res) => void this.handleHttp(req, res, root));
    this.wss = new WebSocketServer({
      server: this.http,
      path: '/ws',
      // prompts can carry base64 images (composer caps ~1.5 MB per file)
      maxPayload: 2 * 1024 * 1024,
      verifyClient: (info: { req: http.IncomingMessage }) =>
        this.originAllowed(info.req.headers.origin, info.req.headers.host),
    });
    this.wss.on('connection', (ws) => this.onConnect(ws));

    await new Promise<void>((resolve, reject) => {
      this.http?.once('error', reject);
      this.http?.listen(config.port, config.host, () => resolve());
    });
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
      open: this.deps.sessions.openStates(),
    });
    ws.on('message', (data) => void this.onMessage(ws, data));
    ws.on('close', () => this.clients.delete(ws));
    ws.on('error', () => this.clients.delete(ws));
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
          const list = await sessions.list(cmd.cwd);
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
          const cat = await loadCatalog(true);
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
      if (this.clients.size === 0) return;
      const ports = listPorts(this.deps.config.port);
      if (JSON.stringify(ports) !== JSON.stringify(this.lastPorts)) {
        this.lastPorts = ports;
        this.broadcast({ type: 'ports', ports });
      }
    }, 5000);
    this.portsTimer.unref();
  }

  private async handleHttp(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    root: string,
  ): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
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
      if (url.pathname === '/api/health') {
        return this.json(res, { ok: true, version: VERSION, agent: this.deps.agent.status });
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
        return this.json(res, search(cwd, q, limit));
      }
      if (url.pathname === '/api/workspaces/browse') {
        const p = url.searchParams.get('path') ?? '';
        return this.json(res, { entries: browse(p), path: browsePath(p), home: homeDir() });
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
      this.deps.log.error(`http ${req.method} ${req.url}: ${(e as Error).message}`);
      return this.json(res, { error: (e as Error).message }, 500);
    }
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
    await new Promise<void>((r) => this.wss?.close(() => r()));
    await new Promise<void>((r) => this.http?.close(() => r()));
  }
}
