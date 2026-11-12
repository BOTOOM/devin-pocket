import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FsEntry, Workspace } from '../shared/protocol.js';
import { validateCwd } from './workspace.js';

const SKIP = new Set(['node_modules', '.git', 'dist', 'target', '.venv', '__pycache__']);
const MAX_DEPTH = 6;
const WALK_BUDGET = 20_000;
/** Mention queries re-scan per keystroke otherwise; the tree rarely changes. */
const WALK_TTL_MS = 15_000;
const WALK_CACHE_MAX = 32;

/** cwd must be inside home or a configured workspace. */
export function cwdAllowed(cwd: string, workspaces: Workspace[]): boolean {
  try {
    validateCwd(cwd, workspaces);
    return true;
  } catch {
    return false;
  }
}

/** Root .gitignore globs → regex (simple: basename or path prefix matches). */
function gitignoreMatchers(root: string): RegExp[] {
  try {
    const lines = fs
      .readFileSync(path.join(root, '.gitignore'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('!'));
    return lines.map((l) => {
      const pat = l.replace(/^\//, '').replace(/\/$/, '').replace(/\*/g, '[^/]*');
      return new RegExp(`(^|/)${pat}(/|$)`);
    });
  } catch {
    return [];
  }
}

/** Async BFS so a big tree doesn't stall the event loop; no per-file stat (unused). */
async function walk(root: string, ignores: RegExp[], out: FsEntry[]): Promise<void> {
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  let budget = WALK_BUDGET;
  while (queue.length && budget > 0) {
    const { dir, depth } = queue.shift()!;
    if (depth > MAX_DEPTH) continue;
    let ents: fs.Dirent[];
    try {
      ents = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      if (budget <= 0) return;
      if (e.name.startsWith('.') && e.name !== '.github') continue;
      const rel = path.relative(root, path.join(dir, e.name)).split(path.sep).join('/');
      if (SKIP.has(e.name) || ignores.some((r) => r.test(rel))) continue;
      if (e.isDirectory()) {
        out.push({ name: e.name, path: rel, kind: 'dir' });
        queue.push({ dir: path.join(dir, e.name), depth: depth + 1 });
        budget--;
      } else if (e.isFile()) {
        out.push({ name: e.name, path: rel, kind: 'file' });
        budget--;
      }
    }
  }
}

const walkCache = new Map<string, { at: number; entries: FsEntry[] }>();
const walkInflight = new Map<string, Promise<FsEntry[]>>();

function walkOnce(root: string, ignores: RegExp[]): Promise<FsEntry[]> {
  const inflight = walkInflight.get(root);
  if (inflight) return inflight;
  const p = (async () => {
    const out: FsEntry[] = [];
    await walk(root, ignores, out);
    return out;
  })().finally(() => walkInflight.delete(root));
  walkInflight.set(root, p);
  return p;
}

/** Subsequence fuzzy match of q against s (case-insensitive). */
export function fuzzyMatch(q: string, s: string): number | null {
  if (!q) return 0;
  const ql = q.toLowerCase();
  const sl = s.toLowerCase();
  let qi = 0;
  let score = 0;
  for (let i = 0; i < sl.length && qi < ql.length; i++) {
    if (sl[i] === ql[qi]) {
      score += i === 0 || sl[i - 1] === '/' ? 2 : 1;
      qi++;
    }
  }
  return qi === ql.length ? score : null;
}

export async function search(
  cwd: string,
  q: string,
  limit: number,
): Promise<{ entries: FsEntry[]; truncated: boolean }> {
  // '' resolves like cwdAllowed does — process cwd — so early queries still work.
  const root = path.resolve(cwd);
  const hit = walkCache.get(root);
  let all: FsEntry[];
  if (hit && Date.now() - hit.at < WALK_TTL_MS) {
    all = hit.entries;
  } else {
    all = await walkOnce(root, gitignoreMatchers(root));
    if (walkCache.size >= WALK_CACHE_MAX) walkCache.clear();
    walkCache.set(root, { at: Date.now(), entries: all });
  }
  const scored = all
    .map((e) => ({ e, s: fuzzyMatch(q, e.path) }))
    .filter((x): x is { e: FsEntry; s: number } => x.s !== null)
    .sort(
      (a, b) =>
        b.s - a.s ||
        (a.e.kind === b.e.kind ? 0 : a.e.kind === 'dir' ? -1 : 1) ||
        a.e.path.localeCompare(b.e.path),
    );
  return { entries: scored.slice(0, limit).map((x) => x.e), truncated: scored.length > limit };
}

export function homeDir(): string {
  return os.homedir();
}

/** Invalid or disallowed browse roots fall back to home. */
export function browsePath(dir: string, workspaces: Workspace[] = []): string {
  try {
    return validateCwd(dir || os.homedir(), workspaces);
  } catch {
    return fs.realpathSync(os.homedir());
  }
}

/** List immediate subdirectories of `path`, for the workspace picker. */
export function browse(dir: string, workspaces: Workspace[] = []): FsEntry[] {
  const abs = browsePath(dir, workspaces);
  try {
    return fs
      .readdirSync(abs, { withFileTypes: true })
      .filter(
        (e) =>
          e.isDirectory() &&
          !e.name.startsWith('.') &&
          !SKIP.has(e.name) &&
          cwdAllowed(path.join(abs, e.name), workspaces),
      )
      .map((e) => ({ name: e.name, path: path.join(abs, e.name), kind: 'dir' as const }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}
