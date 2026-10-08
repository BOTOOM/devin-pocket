/**
 * AgentProcess — owns the `devin acp` child and the ACP connection.
 * Spawn/capability flow ported with attribution from devin-tui
 * src/acp/connection.ts (MIT, Mark Fenner).
 */
import { type ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import {
  type AgentCapabilities,
  type AuthenticateResponse,
  type Client,
  ClientSideConnection,
  type ContentBlock,
  type InitializeResponse,
  type LoadSessionResponse,
  type NewSessionResponse,
  ndJsonStream,
  PROTOCOL_VERSION,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionInfo,
  type SessionNotification,
} from '@agentclientprotocol/sdk';
import type { AgentInfo, AgentStatus, BillingInfo, TurnStat } from '../../shared/protocol.js';
import type { Logger, StderrSink } from '../log.js';
import { VERSION } from '../paths.js';
import { parseBillingInfo } from './billing.js';

export { resolveBin, splitCommand };

/** Use `bin` if it's on PATH; otherwise fall back to ~/.local/bin/<bin>. */
function resolveBin(bin: string): string {
  if (bin.includes('/')) return bin;
  const onPath = (process.env.PATH ?? '')
    .split(path.delimiter)
    .some((d) => d && fs.existsSync(path.join(d, bin)));
  if (onPath) return bin;
  const fallback = path.join(os.homedir(), '.local', 'bin', bin);
  return fs.existsSync(fallback) ? fallback : bin;
}

/** Split a command string like `npx tsx test/fake-agent.ts` respecting quotes. */
function splitCommand(cmd: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null = re.exec(cmd);
  while (m) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '');
    m = re.exec(cmd);
  }
  return out;
}

/** Can we probe auth externally? Only the real `devin` CLI exposes `auth status`. */
export function canProbeAuth(binCmd: string): boolean {
  const bin = splitCommand(binCmd)[0];
  return bin !== undefined && path.basename(bin) === 'devin';
}

/** Probe: `devin auth status` exit 0 → logged in. Only meaningful for the real CLI. */
export function probeAuth(binCmd: string, timeoutMs = 10_000): Promise<boolean> {
  const [bin] = splitCommand(binCmd);
  if (!bin || !canProbeAuth(binCmd)) return Promise.resolve(false); // unverifiable
  const devin = resolveBin(bin);
  const args = ['auth', 'status'];
  return new Promise((resolve) => {
    const child = execFile(devin, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) return resolve(false);
      const out = `${stdout}${stderr}`;
      resolve(!/not logged in|unauthenticated/i.test(out));
    });
    child.on('error', () => resolve(false));
  });
}

/** `_cognition.ai/turn_stats` params → TurnStat (ported from devin-tui spend.ts). */
export function parseTurnStats(params: unknown): { sessionId: string; stat: TurnStat } | null {
  if (typeof params !== 'object' || params === null) return null;
  const p = params as Record<string, unknown>;
  const sessionId = p.sessionId;
  const turnRequestId = p.turnRequestId;
  if (typeof sessionId !== 'string' || typeof turnRequestId !== 'string') return null;
  const stat: TurnStat = { turnRequestId, input: 0, cached: 0, output: 0, extra: [] };
  const CORE = new Set(['agent_messages', 'input_tokens', 'output_tokens', 'cached_input_tokens']);
  const dims = p.responseDimensions;
  if (Array.isArray(dims)) {
    for (const d of dims) {
      if (typeof d !== 'object' || d === null) continue;
      const dim = d as {
        uid?: unknown;
        label?: unknown;
        kind?: { type?: unknown; value?: unknown; tail?: unknown; pluralTail?: unknown };
      };
      if (typeof dim.uid !== 'string' || typeof dim.kind !== 'object' || !dim.kind) continue;
      const kind = dim.kind;
      if (kind.type === 'metric' && typeof kind.value === 'string') {
        if (dim.uid === 'model') stat.model = kind.value;
        continue;
      }
      if (kind.type !== 'cumulativeMetric' || typeof kind.value !== 'number') continue;
      if (dim.uid === 'input_tokens') stat.input = kind.value;
      else if (dim.uid === 'output_tokens') stat.output = kind.value;
      else if (dim.uid === 'cached_input_tokens') stat.cached = kind.value;
      else if (!CORE.has(dim.uid)) {
        stat.extra.push({
          uid: dim.uid,
          label: typeof dim.label === 'string' ? dim.label : dim.uid,
          value: kind.value,
          tail: typeof kind.tail === 'string' ? kind.tail : '',
          pluralTail:
            typeof kind.pluralTail === 'string'
              ? kind.pluralTail
              : typeof kind.tail === 'string'
                ? kind.tail
                : '',
        });
      }
    }
  }
  return { sessionId, stat };
}

export interface AgentEvents {
  onStatus: (status: AgentStatus) => void;
  onSessionNotification: (n: SessionNotification) => void;
  onTurnStats: (sessionId: string, stat: TurnStat) => void;
  onBillingInfo: (info: BillingInfo) => void;
  /** requestId → resolve with the response; caller owns PermissionRequest lifecycle */
  onPermissionRequest: (
    sessionId: string,
    req: RequestPermissionRequest,
  ) => Promise<RequestPermissionResponse>;
  onSessionsReopened: () => void;
  /** live permission request resolvers keyed by requestId (set by sessions.ts) */
}

export class AgentProcess {
  status: AgentStatus = { phase: 'starting' };
  /** latest `_cognition.ai/billingInformation` push, if any */
  billingInfo?: BillingInfo;
  private child?: ChildProcessWithoutNullStreams;
  private conn?: ClientSideConnection;
  private init?: InitializeResponse;
  private restartAttempt = 0;
  private restartTimer?: NodeJS.Timeout;
  private spawnedAt = 0;
  private disposed = false;
  private manualRestart = false;
  private openSessions = new Set<{ sessionId: string; cwd: string }>();

  constructor(
    private opts: { command: string; cwd: string; log: Logger; stderrLog: StderrSink },
    private ev: AgentEvents,
  ) {}

  get running(): boolean {
    return !!this.child && this.child.exitCode === null && !this.child.killed;
  }

  get agentInfo(): AgentInfo | undefined {
    const caps = this.init?.agentCapabilities as AgentCapabilities | undefined;
    if (!this.init) return undefined;
    const meta = (caps?._meta ?? {}) as Record<string, unknown>;
    return {
      name: this.init.agentInfo?.name ?? undefined,
      title: this.init.agentInfo?.title ?? undefined,
      version: this.init.agentInfo?.version ?? undefined,
      caps: {
        loadSession: caps?.loadSession === true,
        listSessions: caps?.sessionCapabilities?.list != null,
        deleteSessions: caps?.sessionCapabilities?.delete != null,
        image: caps?.promptCapabilities?.image === true,
        embeddedContext: caps?.promptCapabilities?.embeddedContext === true,
        rename: meta['cognition.ai/sessionRename'] === true || meta['cognition.ai/rename'] === true,
        editableCommands: meta['cognition.ai/editableCommands'] === true,
        meta,
      },
    };
  }

  get authMethods() {
    return (this.init?.authMethods ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
    }));
  }

  private statusSubs = new Set<(s: AgentStatus) => void>();

  /** Extra status subscribers (SessionManager listens without owning onStatus). */
  onStatus(fn: (s: AgentStatus) => void): () => void {
    this.statusSubs.add(fn);
    return () => this.statusSubs.delete(fn);
  }

  private setStatus(s: AgentStatus): void {
    this.status = s;
    this.ev.onStatus(s);
    for (const fn of this.statusSubs) fn(s);
  }

  /** Track sessions to re-open after a restart. */
  trackOpen(sessionId: string, cwd: string): void {
    this.openSessions.add({ sessionId, cwd });
  }
  untrack(sessionId: string): void {
    for (const s of this.openSessions) if (s.sessionId === sessionId) this.openSessions.delete(s);
  }

  spawn(): void {
    const [rawBin, ...args] = splitCommand(this.opts.command);
    if (!rawBin) throw new Error('empty agent command');
    const bin = resolveBin(rawBin);
    this.opts.log.info(`spawn: ${bin} ${args.join(' ')} (cwd=${this.opts.cwd})`);
    try {
      this.child = spawn(bin, args, {
        cwd: this.opts.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });
    } catch (e) {
      this.setStatus({ phase: 'error', message: (e as Error).message, code: 'spawn_failed' });
      return;
    }
    this.spawnedAt = Date.now();
    this.child.stderr.on('data', (d: Buffer) => this.opts.stderrLog.write(d));
    this.child.on('error', (err) => {
      this.opts.log.error(`agent spawn error: ${err.message}`);
      this.setStatus({ phase: 'error', message: err.message, code: 'spawn_failed' });
    });
    this.child.on('exit', (code, signal) => {
      this.opts.log.info(`agent exited code=${code} signal=${signal}`);
      if (this.disposed) return;
      if (this.manualRestart) {
        this.manualRestart = false;
        this.spawn();
        return;
      }
      this.scheduleRestart(code, signal);
    });
    const stream = ndJsonStream(
      Writable.toWeb(this.child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(this.child.stdout) as ReadableStream<Uint8Array>,
    );
    this.conn = new ClientSideConnection(() => this.clientHandler(), stream);
    void this.conn.closed.then(() => this.opts.log.info('acp connection closed'));
    void this.handshake();
  }

  private clientHandler(): Client {
    return {
      sessionUpdate: (n) => this.ev.onSessionNotification(n),
      requestPermission: (req) =>
        this.ev.onPermissionRequest(req.sessionId, req) as Promise<RequestPermissionResponse>,
      extNotification: (method, params) => {
        if (method === '_cognition.ai/turn_stats') {
          const ts = parseTurnStats(params);
          if (ts) this.ev.onTurnStats(ts.sessionId, ts.stat);
        } else if (method === '_cognition.ai/billingInformation') {
          const info = parseBillingInfo(params);
          if (info) {
            this.billingInfo = info;
            this.ev.onBillingInfo(info);
          }
          // full params → log: the payload shape is undocumented, keep it discoverable
          this.opts.log.info(`billingInformation ${JSON.stringify(params).slice(0, 4000)}`);
        } else {
          const p = params as { channel?: string; message?: string; level?: string };
          if (method === '_cognition.ai/output') {
            this.opts.stderrLog.write(
              `[ext output${p.level ? `/${p.level}` : ''}${p.channel ? ` ${p.channel}` : ''}] ${p.message ?? ''}\n`,
            );
          } else {
            this.opts.log.info(`ext ${method} ${JSON.stringify(params).slice(0, 400)}`);
          }
        }
      },
    };
  }

  private async handshake(): Promise<void> {
    try {
      this.init = await this.conn?.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: { name: 'devin-pocket', title: 'Devin Pocket', version: VERSION },
      });
      this.restartAttempt = 0;
      const methods = this.authMethods;
      if (methods.length === 0) {
        this.setStatus({ phase: 'ready' });
      } else {
        // Only `devin auth status` can be probed; other agents → needsAuth until login.
        const authed = canProbeAuth(this.opts.command) && (await probeAuth(this.opts.command));
        this.setStatus(authed ? { phase: 'ready' } : { phase: 'needsAuth', methods });
      }
      // re-open sessions that survived a restart
      if (this.openSessions.size > 0) this.ev.onSessionsReopened();
    } catch (e) {
      this.opts.log.error(`handshake failed: ${(e as Error).message}`);
      this.setStatus({ phase: 'error', message: (e as Error).message, code: 'acp_protocol' });
    }
  }

  private scheduleRestart(code: number | null, signal: string | null): void {
    const uptime = Date.now() - this.spawnedAt;
    if (uptime > 60_000) this.restartAttempt = 0;
    const delay = Math.min(1000 * 2 ** this.restartAttempt, 30_000);
    this.restartAttempt++;
    this.setStatus({
      phase: 'restarting',
      attempt: this.restartAttempt,
      inMs: delay,
      reason: `exit code ${code} signal ${signal}`,
    });
    this.restartTimer = setTimeout(() => {
      if (!this.disposed) this.spawn();
    }, delay);
  }

  async authenticate(methodId: string): Promise<AuthenticateResponse | undefined> {
    if (!this.conn) return undefined;
    this.setStatus({ phase: 'authenticating', methodId });
    try {
      const res = await this.c.authenticate({ methodId });
      // Trust a successful authenticate for agents we cannot probe externally.
      const authed = canProbeAuth(this.opts.command) ? await probeAuth(this.opts.command) : true;
      this.setStatus(
        authed ? { phase: 'ready' } : { phase: 'needsAuth', methods: this.authMethods },
      );
      return res;
    } catch (e) {
      this.setStatus({
        phase: 'needsAuth',
        methods: this.authMethods,
        error: (e as Error).message,
      });
      throw e;
    }
  }

  async logout(): Promise<void> {
    await this.conn?.logout({}).catch(() => {});
    this.setStatus({ phase: 'needsAuth', methods: this.authMethods });
  }

  markNeedsAuth(message?: string): void {
    this.setStatus({ phase: 'needsAuth', methods: this.authMethods, error: message });
  }

  private get c(): ClientSideConnection {
    if (!this.conn) throw new Error('agent not connected');
    return this.conn;
  }

  // ---- session RPCs (thin wrappers; error surfaces to caller) --------------

  async newSession(cwd: string): Promise<NewSessionResponse> {
    return this.c.newSession({ cwd, mcpServers: [] });
  }

  async loadSession(sessionId: string, cwd: string): Promise<LoadSessionResponse> {
    return this.c.loadSession({ cwd, mcpServers: [], sessionId });
  }

  async listSessions(cwd?: string): Promise<SessionInfo[]> {
    const res = await this.c.listSessions(cwd ? { cwd } : {});
    return res.sessions;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.c.deleteSession({ sessionId });
  }

  async prompt(sessionId: string, blocks: ContentBlock[]): Promise<PromptResponse> {
    return this.c.prompt({ sessionId, prompt: blocks });
  }

  async cancel(sessionId: string): Promise<void> {
    await this.c.cancel({ sessionId });
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    await this.c.setSessionMode({ sessionId, modeId });
  }

  async setConfigOption(
    sessionId: string,
    configId: string,
    value: string,
  ): Promise<SessionConfigOption[] | undefined> {
    const res = await this.c.setSessionConfigOption({ sessionId, configId, value });
    return res.configOptions;
  }

  restart(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.disposed = false;
    this.setStatus({ phase: 'starting' });
    if (this.running) {
      // the exit handler respawns (manualRestart skips backoff)
      this.manualRestart = true;
      try {
        this.child?.kill('SIGTERM');
      } catch {
        this.manualRestart = false;
        this.spawn();
      }
    } else {
      this.spawn();
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    const child = this.child;
    this.child = undefined;
    if (child && child.exitCode === null && !child.killed) {
      try {
        child.kill('SIGTERM');
      } catch {
        // already dead
      }
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // already dead
        }
      }, 1500).unref();
    }
  }
}
