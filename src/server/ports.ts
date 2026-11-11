import fs from 'node:fs';
import type { LocalPort } from '../shared/protocol.js';

const LISTEN = '0A';

/** Parse /proc/net/tcp{,6} → [{port, inode}] for LISTEN sockets. */
function listenSockets(): { port: number; inode: string }[] {
  const out: { port: number; inode: string }[] = [];
  for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let text: string;
    try {
      text = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 10) continue;
      if (cols[3] !== LISTEN) continue;
      const local = cols[1] ?? '';
      const port = Number.parseInt(local.split(':')[1] ?? '', 16);
      if (Number.isFinite(port) && port > 0) out.push({ port, inode: cols[9] ?? '' });
    }
  }
  return out;
}

/** inode → pid via /proc/<pid>/fd symlinks (best-effort; proot may deny). */
function inodeToPid(): Map<string, { pid: number; comm: string }> {
  const map = new Map<string, { pid: number; comm: string }>();
  let pids: string[];
  try {
    pids = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d));
  } catch {
    return map;
  }
  const sockInodeRe = /^socket:\[(\d+)\]$/;
  for (const pidStr of pids) {
    let fds: string[];
    try {
      fds = fs.readdirSync(`/proc/${pidStr}/fd`);
    } catch {
      continue; // permission denied / vanished
    }
    let comm = '';
    for (const fd of fds) {
      let link: string;
      try {
        link = fs.readlinkSync(`/proc/${pidStr}/fd/${fd}`);
      } catch {
        continue;
      }
      const m = sockInodeRe.exec(link);
      if (!m) continue;
      if (!comm) {
        try {
          comm = fs.readFileSync(`/proc/${pidStr}/comm`, 'utf8').trim();
        } catch {
          comm = '';
        }
      }
      map.set(m[1] as string, { pid: Number(pidStr), comm });
    }
  }
  return map;
}

/** Snapshot listening TCP ports with owning process names when readable. */
export function listPorts(excludePort?: number): LocalPort[] {
  const socks = listenSockets();
  const inodeMap = inodeToPid();
  const seen = new Set<number>();
  const out: LocalPort[] = [];
  for (const s of socks) {
    if (s.port === excludePort || seen.has(s.port)) continue;
    seen.add(s.port);
    const owner = inodeMap.get(s.inode);
    out.push({ port: s.port, pid: owner?.pid, process: owner?.comm || undefined });
  }
  out.sort((a, b) => a.port - b.port);
  return out;
}
