import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import { Readable, Writable } from 'node:stream';
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import type { DoctorCheck, DoctorReport } from '../shared/protocol.js';
import { canProbeAuth, resolveBin, splitCommand } from './acp/agent.js';
import { findExecutable, requireNativeExecutable } from './commands.js';
import { configFile, isProot, isTermux, loadConfig, stateDir, VERSION } from './paths.js';
import { cachedUpdate } from './update.js';

function which(cmd: string): string | null {
  return findExecutable(cmd);
}

function run(
  cmd: string,
  args: string[],
  timeoutMs = 8000,
): Promise<{ code: number; out: string }> {
  return new Promise<{ code: number; out: string }>((resolve) => {
    const child = execFile(
      requireNativeExecutable(cmd),
      args,
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout, stderr) => {
        resolve({ code: err ? -1 : 0, out: `${stdout}${stderr}`.trim() });
      },
    );
    child.on('error', (e) => resolve({ code: -1, out: e.message }));
  }).catch((e: Error) => ({ code: -1, out: e.message }));
}

function portFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, host);
  });
}

/** Spawn the agent, initialize, kill. Confirms the ACP handshake works. */
function acpProbe(command: string, timeoutMs = 15_000): Promise<string | null> {
  return new Promise((resolve) => {
    const [rawBin, ...args] = splitCommand(command);
    if (!rawBin) return resolve('empty agent command');
    const bin = resolveBin(rawBin);
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(requireNativeExecutable(bin), args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
        windowsHide: true,
      });
    } catch (e) {
      return resolve((e as Error).message);
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // dead
      }
      resolve('handshake timed out');
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve(e.message);
    });
    const stdio = child as unknown as import('node:child_process').ChildProcessWithoutNullStreams;
    const stream = ndJsonStream(
      Writable.toWeb(stdio.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(stdio.stdout) as ReadableStream<Uint8Array>,
    );
    const conn = new ClientSideConnection(
      () => ({
        sessionUpdate: () => {},
        requestPermission: async () => ({ outcome: { outcome: 'cancelled' as const } }),
      }),
      stream,
    );
    conn
      .initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'devin-pocket', title: 'Devin Pocket', version: VERSION },
      })
      .then(() => {
        clearTimeout(timer);
        try {
          child.kill('SIGTERM');
        } catch {
          // dead
        }
        resolve(null);
      })
      .catch((e: Error) => {
        clearTimeout(timer);
        try {
          child.kill('SIGKILL');
        } catch {
          // dead
        }
        resolve(e.message);
      });
  });
}

export async function doctorReport(opts: {
  port: number;
  host: string;
  agentCommand: string;
  /** the caller knows it is the listener on `port` (running server) */
  ownsPort?: boolean;
  /** pid of a running devin-pocket daemon (from pidfile) */
  serverPid?: number;
}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const update = cachedUpdate();
  checks.push({
    id: 'pocket-update',
    update,
    label: 'Devin Pocket version',
    status: update.updateAvailable ? 'warn' : 'ok',
    detail: `current ${update.current} · latest known ${update.latest}`,
    fix: update.updateAvailable ? 'Run: devin-pocket update' : undefined,
  });
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push({
    id: 'node',
    label: `Node.js ${process.versions.node}`,
    status: nodeMajor >= 22 ? 'ok' : 'fail',
    detail: nodeMajor >= 22 ? undefined : 'Node 22+ required',
    fix: nodeMajor >= 22 ? undefined : 'Termux: pkg install nodejs-lts · Ubuntu: upgrade Node ≥22',
  });

  const [bin] = splitCommand(opts.agentCommand);
  const devinPath = bin ? resolveBin(bin) : null;
  const devinFound = devinPath ? fs.existsSync(devinPath) || which(devinPath) !== null : false;
  checks.push({
    id: 'devin-bin',
    label: 'Devin CLI binary',
    status: devinFound ? 'ok' : 'fail',
    detail: devinFound
      ? String(devinPath)
      : process.platform === 'win32'
        ? 'not found on PATH'
        : 'not found on PATH or ~/.local/bin',
    fix: devinFound
      ? undefined
      : process.platform === 'win32'
        ? 'PowerShell: irm https://static.devin.ai/cli/setup.ps1 | iex'
        : 'Install: curl -fsSL https://cli.devin.ai/install.sh | bash',
  });

  if (devinFound && canProbeAuth(opts.agentCommand)) {
    const v = await run(devinPath as string, ['--version'], 8000);
    checks.push({
      id: 'devin-version',
      label: 'devin version',
      status: v.code === 0 ? 'ok' : 'warn',
      detail: v.out.split('\n')[0] || `exit ${v.code}`,
    });
    const a = await run(devinPath as string, ['auth', 'status'], 8000);
    const ok = a.code === 0 && !/not logged in|unauthenticated/i.test(a.out);
    checks.push({
      id: 'devin-auth',
      label: 'Devin login',
      status: ok ? 'ok' : 'warn',
      detail: ok ? 'signed in' : a.out.split('\n')[0] || 'not logged in',
      fix: ok ? undefined : 'Run: devin auth login',
    });
  }

  if (devinFound) {
    const err = await acpProbe(opts.agentCommand);
    checks.push({
      id: 'acp-handshake',
      label: 'ACP handshake (devin acp)',
      status: err === null ? 'ok' : 'fail',
      detail: err ?? 'initialize OK',
    });
  }

  const free = opts.ownsPort ? false : await portFree(opts.port, opts.host);
  const ownPid = opts.serverPid ?? (opts.ownsPort ? process.pid : null);
  checks.push({
    id: 'port',
    label: `Port ${opts.port} on ${opts.host}`,
    status: ownPid ? 'ok' : free ? 'ok' : 'warn',
    detail: ownPid
      ? `devin-pocket listening on ${opts.host}:${opts.port}`
      : free
        ? 'free'
        : 'in use by another process',
    fix: ownPid || free ? undefined : `Use another port: --port ${opts.port + 1}`,
  });

  if (isTermux()) {
    const wl = which('termux-wake-lock');
    checks.push({
      id: 'termux-api',
      label: 'Termux:API (wake lock)',
      status: wl ? 'ok' : 'warn',
      detail: wl ? wl : 'termux-api not installed',
      fix: wl ? undefined : 'Run: pkg install termux-api',
    });
  } else {
    checks.push({ id: 'termux', label: 'Termux', status: 'skip', detail: 'not on Android' });
  }
  if (isProot()) {
    checks.push({
      id: 'proot',
      label: 'proot environment',
      status: 'ok',
      detail: 'running under proot',
    });
  }

  try {
    fs.mkdirSync(stateDir(), { recursive: true });
    const st = fs.statfsSync(stateDir());
    const freeMb = Math.floor((st.bavail * st.bsize) / 1e6);
    checks.push({
      id: 'disk',
      label: 'Disk free (state dir)',
      status: freeMb >= 200 ? 'ok' : 'fail',
      detail: `${freeMb} MB`,
      fix: freeMb >= 200 ? undefined : 'Free up disk space',
    });
  } catch (e) {
    checks.push({ id: 'disk', label: 'Disk free', status: 'warn', detail: (e as Error).message });
  }

  const { error: cfgErr } = loadConfig();
  checks.push({
    id: 'config',
    label: 'Config file',
    status: cfgErr ? 'warn' : 'ok',
    detail: cfgErr ?? configFile(),
    fix: cfgErr ? `Check ${configFile()}` : undefined,
  });

  try {
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.accessSync(stateDir(), fs.constants.W_OK);
    checks.push({
      id: 'state-writable',
      label: 'State dir writable',
      status: 'ok',
      detail: stateDir(),
    });
  } catch (e) {
    checks.push({
      id: 'state-writable',
      label: 'State dir writable',
      status: 'fail',
      detail: (e as Error).message,
      fix: `Fix permissions on ${stateDir()}`,
    });
  }

  const summary = checks.some((c) => c.status === 'fail')
    ? 'fail'
    : checks.some((c) => c.status === 'warn')
      ? 'warn'
      : 'ok';
  return { at: Date.now(), checks, summary };
}
