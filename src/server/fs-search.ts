import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FsEntry, Workspace } from '../shared/protocol.js';

const SKIP = new Set(['node_modules', '.git', 'dist', 'target', '.venv', '__pycache__']);
const MAX_DEPTH = 6;

/** cwd must be inside home or a configured workspace. */
export function cwdAllowed(cwd: string, workspaces: Workspace[]): boolean {
  const home = os.homedir();
  const abs = path.resolve(cwd);
  if (abs === home || abs.startsWith(home + path.sep)) return true;
  return workspaces.some((w) => {
    const wp = path.resolve(w.path);
    return abs === wp || abs.startsWith(wp + path.sep);
  });
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

function walk(root: string, ignores: RegExp[], out: FsEntry[], budget: { n: number }): void {
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  while (queue.length && budget.n > 0) {
    const { dir, depth } = queue.shift()!;
    if (depth > MAX_DEPTH) continue;
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      if (budget.n <= 0) return;
      if (e.name.startsWith('.') && e.name !== '.github') continue;
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full);
      if (SKIP.has(e.name) || ignores.some((r) => r.test(rel))) continue;
      if (e.isDirectory()) {
        out.push({ name: e.name, path: rel, kind: 'dir' });
        queue.push({ dir: full, depth: depth + 1 });
        budget.n--;
      } else if (e.isFile()) {
        let size: number | undefined;
        try {
          size = fs.statSync(full).size;
        } catch {
          size = undefined;
        }
        out.push({ name: e.name, path: rel, kind: 'file', size });
        budget.n--;
      }
    }
  }
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

export function search(
  cwd: string,
  q: string,
  limit: number,
): { entries: FsEntry[]; truncated: boolean } {
  const ignores = gitignoreMatchers(cwd);
  const all: FsEntry[] = [];
  walk(cwd, ignores, all, { n: 20_000 });
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

/** Resolve the browse dir param: empty/relative → home. */
export function browsePath(dir: string): string {
  const abs = dir ? path.resolve(dir) : os.homedir();
  const home = os.homedir();
  return abs === home || abs.startsWith(home + path.sep) ? abs : home;
}

/** List immediate subdirectories of `path`, for the workspace picker. */
export function browse(dir: string): FsEntry[] {
  const abs = browsePath(dir);
  const home = os.homedir();
  if (!(abs === home || abs.startsWith(home + path.sep))) return [];
  try {
    return fs
      .readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name))
      .map((e) => ({ name: e.name, path: path.join(abs, e.name), kind: 'dir' as const }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}
