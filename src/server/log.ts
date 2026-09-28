import fs from 'node:fs';
import path from 'node:path';
import { agentStderrFile, logFile, stateDir } from './paths.js';

const MAX_BYTES = 5 * 1024 * 1024;
const RING = 500;

/** Scrub secrets before a payload reaches a log line. */
export function redact(input: unknown): unknown {
  if (typeof input === 'string') {
    return input
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-jwt]')
      .replace(
        /("(?:access_token|refresh_token|api_key|id_token)"\s*:\s*")[^"]+"/gi,
        '$1[redacted]"',
      );
  }
  if (Array.isArray(input)) return input.map(redact);
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = /token|secret|password|authorization|api[-_]?key|credential/i.test(k)
        ? '[redacted]'
        : redact(v);
    }
    return out;
  }
  return input;
}

const ring: string[] = [];

export function ringLines(): string[] {
  return [...ring];
}

function line(level: string, msg: string, extra?: unknown): string {
  const base = `${new Date().toISOString()} ${level} ${msg}`;
  return extra === undefined ? base : `${base} ${JSON.stringify(redact(extra))}`;
}

export class Logger {
  private stream?: fs.WriteStream;

  constructor(private file = logFile()) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      this.rotate();
      this.stream = fs.createWriteStream(file, { flags: 'a' });
      this.stream.on('error', () => {
        this.stream = undefined;
      });
    } catch {
      this.stream = undefined;
    }
  }

  private rotate(): void {
    try {
      if (fs.statSync(this.file).size > MAX_BYTES) {
        fs.renameSync(this.file, `${this.file}.1`);
      }
    } catch {
      // missing file / failed rotation — logging must never throw
    }
  }

  private write(level: string, msg: string, extra?: unknown): void {
    const l = line(level, msg, extra);
    ring.push(l);
    if (ring.length > RING) ring.splice(0, ring.length - RING);
    try {
      this.stream?.write(`${l}\n`);
    } catch {
      // never throw
    }
    if (process.env.DEVIN_POCKET_VERBOSE === '1') {
      process.stderr.write(`${l}\n`);
    }
  }

  info(msg: string, extra?: unknown): void {
    this.write('INFO', msg, extra);
  }
  warn(msg: string, extra?: unknown): void {
    this.write('WARN', msg, extra);
  }
  error(msg: string, extra?: unknown): void {
    this.write('ERROR', msg, extra);
  }

  /** authenticate request/response payloads are never logged (rule). */
  auth(msg: string): void {
    this.write('INFO', `[auth] ${msg}`);
  }

  dispose(): void {
    try {
      this.stream?.end();
    } catch {
      // ignore
    }
    this.stream = undefined;
  }
}

/** Tail of the main log file + in-memory ring for /api/logs. */
export function readLogs(maxLines = 200): string[] {
  const file = logFile();
  try {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n').filter(Boolean);
    return lines.slice(-maxLines);
  } catch {
    return ringLines().slice(-maxLines);
  }
}

export function logFiles(): { name: string; size: number }[] {
  const dir = stateDir();
  const out: { name: string; size: number }[] = [];
  for (const name of [
    'devin-pocket.log',
    'devin-pocket.log.1',
    'devin-acp.stderr.log',
    'devin-acp.stderr.log.1',
  ]) {
    try {
      out.push({ name, size: fs.statSync(path.join(dir, name)).size });
    } catch {
      // file missing
    }
  }
  return out;
}

/** Agent stderr sink with the same rotation policy. */
export class StderrSink {
  private stream?: fs.WriteStream;
  constructor(file = agentStderrFile()) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.1`);
    } catch {
      // missing file is fine
    }
    try {
      this.stream = fs.createWriteStream(file, { flags: 'a' });
      this.stream.on('error', () => {
        this.stream = undefined;
      });
    } catch {
      this.stream = undefined;
    }
  }
  write(d: Buffer | string): void {
    try {
      this.stream?.write(d);
    } catch {
      // never throw
    }
  }
  end(): void {
    try {
      this.stream?.end();
    } catch {
      // ignore
    }
    this.stream = undefined;
  }
}
