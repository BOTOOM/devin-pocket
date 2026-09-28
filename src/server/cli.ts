#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { AgentStatus } from '../shared/protocol.js';
import { AgentProcess } from './acp/agent.js';
import { type Args, parseArgs } from './args.js';
import { loadCatalog } from './catalog.js';
import { doctorReport } from './doctor.js';
import { PocketServer } from './http.js';
import { Logger, readLogs, StderrSink } from './log.js';
import {
  type Config,
  ensureDirs,
  isTermux,
  loadConfig,
  pidFile,
  stateDir,
  VERSION,
} from './paths.js';
import { SessionManager } from './sessions.js';

function box(lines: string[]): void {
  const w = Math.max(...lines.map((l) => l.length)) + 4;
  const bar = '─'.repeat(w);
  process.stdout.write(`\n╭${bar}╮\n`);
  for (const l of lines) process.stdout.write(`│  ${l.padEnd(w - 2)}│\n`);
  process.stdout.write(`╰${bar}╯\n\n`);
}

function openBrowser(url: string): void {
  const cmds: [string, string[]][] = isTermux()
    ? [['termux-open-url', [url]]]
    : process.platform === 'darwin'
      ? [['open', [url]]]
      : [['xdg-open', [url]]];
  for (const [c, args] of cmds) {
    const r = spawnSync(
      'sh',
      ['-c', `command -v ${c} >/dev/null && ${c} ${args.map((a) => `'${a}'`).join(' ')}`],
      { stdio: 'ignore' },
    );
    if (r.status === 0) return;
  }
}

function wakeLock(): void {
  if (!isTermux()) return;
  try {
    spawn('termux-wake-lock', [], { stdio: 'ignore', detached: true }).unref();
  } catch {
    // termux-api missing — fine
  }
}

function readPid(): number | null {
  try {
    const pid = Number(fs.readFileSync(pidFile(), 'utf8').trim());
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

/** Spawn the detached supervisor (this process exits; supervisor owns the pidfile). */
function daemonize(_args: Args): number {
  ensureDirs();
  const logFile = path.join(stateDir(), 'daemon.out.log');
  const out = fs.openSync(logFile, 'a');
  const env: NodeJS.ProcessEnv = { ...process.env, DEVIN_POCKET_SUPERVISOR: '1' };
  delete env.DEVIN_POCKET_DAEMON;
  const argv = process.argv.slice(1).filter((x) => x !== '--foreground');
  const child = spawn(process.execPath, argv, {
    detached: true,
    stdio: ['ignore', out, out],
    env,
  });
  child.unref();
  fs.writeFileSync(pidFile(), String(child.pid));
  return child.pid ?? 0;
}

/**
 * Supervisor loop (DEVIN_POCKET_SUPERVISOR=1): spawns the real server as a
 * child with --foreground, respawns on crash with 1s→30s backoff (reset after
 * 60s uptime), gives up after 10 consecutive fast failures.
 */
async function supervise(): Promise<void> {
  ensureDirs();
  const logFile = path.join(stateDir(), 'daemon.out.log');
  const out = fs.openSync(logFile, 'a');
  const argv = process.argv.slice(1).filter((x) => x !== '--foreground');
  argv.push('--foreground');
  const env: NodeJS.ProcessEnv = { ...process.env, DEVIN_POCKET_DAEMON: '1' };
  delete env.DEVIN_POCKET_SUPERVISOR;

  wakeLock();
  let failures = 0;
  let backoff = 1000;
  let quitting = false;
  let child: ReturnType<typeof spawn> | null = null;

  process.on('SIGTERM', () => {
    quitting = true;
    child?.kill('SIGTERM');
  });
  process.on('SIGINT', () => {
    quitting = true;
    child?.kill('SIGTERM');
  });

  while (!quitting) {
    const startedAt = Date.now();
    const code = await new Promise<number>((resolve) => {
      child = spawn(process.execPath, argv, { stdio: ['ignore', out, out], env });
      child.on('error', () => resolve(127));
      child.on('exit', (c) => resolve(c ?? 1));
    });
    if (quitting) break;
    if (code === 0) break; // clean shutdown
    const uptime = Date.now() - startedAt;
    if (uptime > 60_000) {
      failures = 0;
      backoff = 1000;
    } else {
      failures += 1;
      backoff = Math.min(backoff * 2, 30_000);
    }
    if (failures >= 10) {
      fs.writeSync(out, `devin-pocket: giving up after ${failures} fast crashes\n`);
      break;
    }
    fs.writeSync(out, `devin-pocket: child exited (${code}), restart in ${backoff}ms\n`);
    await new Promise((r) => setTimeout(r, backoff));
  }
  try {
    fs.unlinkSync(pidFile());
  } catch {
    // ignore
  }
}

interface ServerHandle {
  server: PocketServer;
  agent: AgentProcess;
}

async function runServer(args: Args): Promise<ServerHandle> {
  ensureDirs();
  const { config } = loadConfig();
  const merged: Config = {
    ...config,
    port,
    host,
    agentCommand: args.agent ?? process.env.DEVIN_POCKET_AGENT ?? config.agentCommand,
  };
  const log = new Logger();
  const stderr = new StderrSink();

  // agent.status listeners: SessionManager + (once up) the WS broadcast
  const statusListeners = new Set<(s: AgentStatus) => void>();
  // created after agent — SessionManager takes the agent in its ctor
  let sessions!: SessionManager;
  const agent = new AgentProcess(
    { command: merged.agentCommand, cwd: args.cwd ?? process.cwd(), log, stderrLog: stderr },
    {
      onStatus: (s) => {
        for (const l of statusListeners) l(s);
      },
      onSessionNotification: (n) => sessions.handleNotification(n),
      onTurnStats: (sid, st) => sessions.handleTurnStats(sid, st),
      onPermissionRequest: (sid, req) => sessions.requestPermission(sid, req),
      onSessionsReopened: () => void sessions.reopenAll(),
    },
  );
  sessions = new SessionManager(agent, merged.workspaces, log);

  const server = new PocketServer({
    agent,
    sessions,
    log,
    config: merged,
    dev: args.dev,
    agentCwd: args.cwd ?? process.cwd(),
  });
  statusListeners.add((s) =>
    server.broadcast({ type: 'agent.status', status: s, info: agent.agentInfo }),
  );
  try {
    await server.start();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      log.error(`port ${merged.port} in use`);
      process.stderr.write(`Puerto en uso / Port in use: ${merged.port} — usa / use --port\n`);
      process.exit(2);
    }
    throw e;
  }
  void loadCatalog();
  agent.spawn();

  const shutdown = (): void => {
    log.info('shutting down');
    agent.dispose();
    void server.stop().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return { server, agent };
}

const args = parseArgs(process.argv.slice(2));
const { config: fileConfig } = loadConfig();
const port = args.port ?? fileConfig.port;
const host = args.host ?? fileConfig.host;

switch (args.cmd) {
  case 'start': {
    if (process.env.DEVIN_POCKET_SUPERVISOR === '1') {
      fs.writeFileSync(pidFile(), String(process.pid));
      await supervise();
    } else if (args.foreground || args.dev || process.env.DEVIN_POCKET_DAEMON === '1') {
      const url = `http://${host}:${port}`;
      box(
        [
          `devin-pocket v${VERSION}`,
          `Abre en el navegador / Open in browser:`,
          url,
          isTermux() ? 'Termux detectado — wake lock on' : '',
        ].filter(Boolean),
      );
      if (args.open) openBrowser(url);
      if (!process.env.DEVIN_POCKET_DAEMON) wakeLock();
      await runServer(args);
      if (process.env.DEVIN_POCKET_SUPERVISOR !== '1') {
        fs.writeFileSync(pidFile(), String(process.pid));
      }
    } else {
      const pid = readPid();
      if (pid) {
        process.stdout.write(`Ya corre / Already running (pid ${pid})\n`);
        process.exit(0);
      }
      const pid2 = daemonize(args);
      box([
        `devin-pocket v${VERSION}`,
        `Iniciado / Started (pid ${pid2})`,
        `http://${host}:${port}`,
      ]);
      if (args.open) openBrowser(`http://${host}:${port}`);
    }
    break;
  }
  case 'stop': {
    const pid = readPid();
    if (!pid) {
      process.stdout.write('No está corriendo / Not running\n');
      break;
    }
    process.kill(pid, 'SIGTERM');
    try {
      fs.unlinkSync(pidFile());
    } catch {
      // ignore
    }
    process.stdout.write(`Detenido / Stopped (pid ${pid})\n`);
    break;
  }
  case 'restart': {
    const pid = readPid();
    if (pid) {
      process.kill(pid, 'SIGTERM');
      await new Promise((r) => setTimeout(r, 800));
    }
    const pid2 = daemonize(args);
    process.stdout.write(`Reiniciado / Restarted (pid ${pid2})\n`);
    break;
  }
  case 'status': {
    const pid = readPid();
    process.stdout.write(pid ? `Corriendo / Running (pid ${pid})\n` : 'Detenido / Stopped\n');
    break;
  }
  case 'logs': {
    const lines = readLogs(args.lines);
    for (const l of lines) process.stdout.write(`${l}\n`);
    if (args.follow) {
      const file = path.join(stateDir(), 'devin-pocket.log');
      let size = fs.existsSync(file) ? fs.statSync(file).size : 0;
      setInterval(() => {
        try {
          const st = fs.statSync(file);
          if (st.size > size) {
            const fd = fs.openSync(file, 'r');
            const buf = Buffer.alloc(st.size - size);
            fs.readSync(fd, buf, 0, buf.length, size);
            fs.closeSync(fd);
            process.stdout.write(buf.toString('utf8'));
            size = st.size;
          }
        } catch {
          // ignore
        }
      }, 1000);
    }
    break;
  }
  case 'doctor': {
    const r = await doctorReport({
      port,
      host,
      agentCommand: args.agent ?? process.env.DEVIN_POCKET_AGENT ?? fileConfig.agentCommand,
      serverPid: readPid() ?? undefined,
    });
    const icon = { ok: '✓', warn: '!', fail: '✗', skip: '·' } as const;
    for (const c of r.checks) {
      process.stdout.write(`${icon[c.status]} ${c.label.padEnd(28)} ${c.detail ?? ''}\n`);
      if (c.fix) process.stdout.write(`    → ${c.fix}\n`);
    }
    process.stdout.write(`\nResumen / Summary: ${r.summary}\n`);
    break;
  }
  case 'open': {
    openBrowser(`http://127.0.0.1:${port}`);
    break;
  }
  case 'version':
    process.stdout.write(`devin-pocket ${VERSION}\n`);
    break;
  default:
    process.stdout.write(
      `devin-pocket — Devin en tu navegador / Devin in your browser

Uso / Usage:
  devin-pocket start [--port N] [--host H] [--cwd DIR] [--agent CMD] [--no-open] [--dev] [--foreground]
  devin-pocket stop | restart | status | logs [-f] [-n N] | doctor | open | version | help

Sin comando = start · No command = start
`,
    );
}
