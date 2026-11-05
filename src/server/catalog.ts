/**
 * Model catalog (pricing + badges) for the model pickers.
 * Ported with attribution from devin-tui src/catalog.ts (MIT, Mark Fenner).
 *
 * Source order:
 *   1. DEVIN_POCKET_MODELS_FILE env — read that JSON directly (tests).
 *   2. `devin models list --format json` → also cached to ~/.cache/devin-pocket/models.json
 *   3. the cache file — when the CLI fails (not logged in, timeout…)
 *   4. unavailable
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { CatalogDebug, CatalogEntry, CatalogState } from '../shared/protocol.js';
import { resolveBin } from './acp/agent.js';
import type { Logger } from './log.js';
import { modelsCacheFile } from './paths.js';

const TIMEOUT_MS = 20_000;
const CACHE_MAX_AGE_MS = 24 * 3600 * 1000;
const LEVEL_NAMES = ['None', 'Low', 'Medium', 'High', 'XHigh', 'Max'];
const LEVEL_RANK = new Map(LEVEL_NAMES.map((n, i) => [n.toLowerCase(), i]));

export function levelRank(name: string): number {
  return LEVEL_RANK.get(name.toLowerCase()) ?? -1;
}

function parsePrices(
  summary: unknown,
): { input: number; cached?: number; output: number } | undefined {
  if (typeof summary !== 'string') return undefined;
  const out: { input?: number; cached?: number; output?: number } = {};
  const re = /\$([\d.]+)\s*\/\s*1M\s+([A-Za-z ]+)/g;
  let m: RegExpExecArray | null = re.exec(summary);
  while (m) {
    const n = Number.parseFloat(m[1] ?? '');
    if (!Number.isFinite(n)) continue;
    const label = (m[2] ?? '').trim().toLowerCase();
    if (label.startsWith('cached')) out.cached = n;
    else if (label === 'input') out.input = n;
    else if (label === 'output') out.output = n;
    m = re.exec(summary);
  }
  return out.input !== undefined && out.output !== undefined
    ? { input: out.input, cached: out.cached, output: out.output }
    : undefined;
}

/** Label tokens that are modifiers, not reasoning levels (e.g. 'SWE-1.6 Fast', 'Opus 1M'). */
const MOD_TOKENS = new Map([
  ['fast', 'Fast'],
  ['1m', '1M'],
]);

/** Extract modifier tokens from the label suffix (before level parsing). */
function parseMods(suffix: string): string[] | undefined {
  const mods = suffix
    .split(/\s+/)
    .map((w) => MOD_TOKENS.get(w.toLowerCase()))
    .filter((m): m is string => m !== undefined);
  return mods.length ? mods : undefined;
}

/** `label` minus the family prefix → normalized `level`. Suffix like
 *  'Medium Thinking' → Medium; 'No Thinking' → None; 'Fast'/'1M' are mods. */
function parseLevel(suffix: string): string | undefined {
  const words = suffix
    .split(/\s+/)
    .filter((w) => w.toLowerCase() !== 'thinking' && !MOD_TOKENS.has(w.toLowerCase()));
  const name = words.join(' ');
  if (name === 'No') return 'None';
  if (!name) return undefined;
  return LEVEL_NAMES.find((l) => l.toLowerCase() === name.toLowerCase());
}

type VariantIn = {
  model_uid?: string;
  modelUid?: string;
  uid?: string;
  id?: string;
  label?: string;
  name?: string;
  cost_tier?: string;
  costTier?: string;
  cost_summary?: string;
  costSummary?: string;
  is_new?: boolean;
  isNew?: boolean;
  is_beta?: boolean;
  isBeta?: boolean;
  max_context_tokens?: number;
  maxContextTokens?: number;
  family_label?: string;
  familyLabel?: string;
  family_uid?: string;
  familyUid?: string;
  family?: string;
};

/**
 * Parse `devin models list --format json` output → entries + optional parseError.
 * Tolerates {families:[]}, {models:[]}, {variants:[]}, or a top-level array.
 */
export function parseCatalogDetailed(text: string): {
  entries: CatalogEntry[];
  parseError?: string;
} {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { entries: [], parseError: (e as Error).message };
  }
  const families: { label: string; uid?: string; variants: VariantIn[] }[] = [];
  if (Array.isArray(data)) {
    families.push({ label: '', variants: data as VariantIn[] });
  } else if (typeof data === 'object' && data !== null) {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.families)) {
      for (const f of d.families as Record<string, unknown>[]) {
        families.push({
          label:
            (f.family_label as string) ??
            (f.familyLabel as string) ??
            (f.label as string) ??
            (f.name as string) ??
            '',
          uid:
            (f.family_uid as string) ?? (f.familyUid as string) ?? (f.uid as string) ?? undefined,
          variants: (f.variants as VariantIn[]) ?? (f.models as VariantIn[]) ?? [],
        });
      }
    } else if (Array.isArray(d.models) || Array.isArray(d.variants)) {
      families.push({
        label: (d.family_label as string) ?? '',
        variants: (d.models as VariantIn[]) ?? (d.variants as VariantIn[]),
      });
    } else {
      return {
        entries: [],
        parseError: `unexpected JSON shape: top-level keys [${Object.keys(d).join(', ')}]`,
      };
    }
  } else {
    return { entries: [], parseError: `unexpected JSON shape: ${typeof data}` };
  }
  const out: CatalogEntry[] = [];
  for (const f of families) {
    for (const v of f.variants) {
      const uid = v.model_uid ?? v.modelUid ?? v.uid ?? v.id;
      if (!uid) continue;
      const label = v.label ?? v.name ?? uid;
      const famLabel = v.family_label ?? v.familyLabel ?? f.label;
      const famUid = v.family_uid ?? v.familyUid ?? v.family ?? f.uid;
      const suffix = label.startsWith(famLabel)
        ? label.slice(famLabel.length).trim()
        : label.trim();
      out.push({
        modelUid: uid,
        label,
        family: famUid,
        familyLabel: famLabel || undefined,
        costTier: v.cost_tier ?? v.costTier,
        prices: parsePrices(v.cost_summary ?? v.costSummary),
        costSummary: v.cost_summary ?? v.costSummary,
        isNew: (v.is_new ?? v.isNew) === true,
        isBeta: (v.is_beta ?? v.isBeta) === true,
        maxContext: v.max_context_tokens ?? v.maxContextTokens,
        level: parseLevel(suffix),
        mods: parseMods(suffix),
      });
    }
  }
  return { entries: out };
}

/** Parse `devin models list --format json` output → entry array. */
export function parseCatalog(text: string): CatalogEntry[] {
  return parseCatalogDetailed(text).entries;
}

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal?: string;
  durationMs: number;
}

function runModelsList(): Promise<CliResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = execFile(
      resolveBin('devin'),
      ['models', 'list', '--format', 'json'],
      { timeout: TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) =>
        resolve({
          stdout: String(stdout),
          stderr: String(stderr),
          exitCode: err
            ? typeof (err as { code?: unknown }).code === 'number'
              ? (err as { code: number }).code
              : null
            : 0,
          signal: (err as { signal?: string } | null)?.signal ?? undefined,
          durationMs: Date.now() - started,
        }),
    );
    child.on('error', (e) =>
      resolve({
        stdout: '',
        stderr: e.message,
        exitCode: null,
        durationMs: Date.now() - started,
      }),
    );
  });
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function cacheAgeMs(cacheFile: string): number | undefined {
  try {
    return Date.now() - fs.statSync(cacheFile).mtimeMs;
  } catch {
    return undefined;
  }
}

let state: CatalogState = { status: 'loading' };
let pending: Promise<CatalogState> | null = null;

export function getCatalog(): CatalogState {
  return state;
}

/**
 * Load the catalog once. Order: fixture env → fresh (<24h) cache → CLI (written
 * to cache) → stale cache → unavailable. `refresh` always runs the CLI.
 * Every path is recorded in `state.debug` for the diagnostics view.
 */
export function loadCatalog(refresh = false, log?: Logger): Promise<CatalogState> {
  if (!refresh && pending) return pending;
  pending = (async (): Promise<CatalogState> => {
    const cacheFile = modelsCacheFile();
    const age = cacheAgeMs(cacheFile);
    const fixture = process.env.DEVIN_POCKET_MODELS_FILE;
    const debug: CatalogDebug = {
      command: fixture ? `read ${fixture}` : `${resolveBin('devin')} models list --format json`,
      exitCode: null,
      durationMs: 0,
      stdoutHead: '',
      stderrHead: '',
      entryCount: 0,
      source: 'none',
      cacheFile,
      cacheAgeMs: age,
    };

    const fromCache = (): CatalogState | null => {
      const text = readText(cacheFile);
      if (text === null) return null;
      const { entries } = parseCatalogDetailed(text);
      if (!entries.length) return null;
      debug.source = 'cache';
      debug.entryCount = entries.length;
      debug.fetchedAt = Date.now();
      return { status: 'ready', entries, fetchedAt: Date.now(), fromCache: true, debug };
    };

    if (fixture) {
      const text = readText(fixture);
      if (text !== null) {
        const { entries, parseError } = parseCatalogDetailed(text);
        debug.exitCode = 0;
        debug.stdoutHead = text.slice(0, 4000);
        debug.entryCount = entries.length;
        debug.parseError = parseError;
        if (!parseError && entries.length) {
          debug.source = 'fixture';
          debug.fetchedAt = Date.now();
          state = { status: 'ready', entries, fetchedAt: Date.now(), fromCache: false, debug };
          return state;
        }
        log?.warn(`catalog fixture parse failed: ${parseError ?? 'no entries'}`);
      } else {
        debug.stderrHead = `cannot read ${fixture}`;
      }
      debug.source = 'fixture';
      state = { status: 'unavailable', reason: `cannot parse ${fixture}`, debug };
      return state;
    }

    if (!refresh && age !== undefined && age < CACHE_MAX_AGE_MS) {
      const cached = fromCache();
      if (cached) {
        state = cached;
        return state;
      }
    }

    const r = await runModelsList();
    debug.exitCode = r.exitCode;
    debug.signal = r.signal;
    debug.durationMs = r.durationMs;
    debug.stdoutHead = r.stdout.slice(0, 4000);
    debug.stderrHead = r.stderr.slice(0, 2000);

    if (r.exitCode === 0 && r.stdout.trim()) {
      const { entries, parseError } = parseCatalogDetailed(r.stdout);
      debug.parseError = parseError;
      if (!parseError && entries.length) {
        try {
          fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
          fs.writeFileSync(cacheFile, r.stdout);
        } catch {
          // cache write best-effort
        }
        debug.source = 'cli';
        debug.entryCount = entries.length;
        debug.fetchedAt = Date.now();
        state = { status: 'ready', entries, fetchedAt: Date.now(), fromCache: false, debug };
        return state;
      }
      log?.warn(`catalog parse failed: ${parseError ?? 'no entries'}`);
    } else {
      log?.warn(
        `devin models list failed (exit ${r.exitCode ?? 'spawn'}${r.signal ? ` ${r.signal}` : ''}): ${r.stderr.split('\n')[0]?.slice(0, 300) ?? ''}`,
      );
    }

    const stale = fromCache();
    if (stale) {
      state = stale;
      return state;
    }
    state = {
      status: 'unavailable',
      reason:
        r.exitCode === 0
          ? (debug.parseError ?? 'no catalog data')
          : r.stderr.split('\n')[0] || 'devin models list failed',
      debug,
    };
    return state;
  })();
  const p = pending;
  void p.finally(() => {
    if (pending === p) pending = null;
  });
  return pending;
}

/** Reasoning levels for a uid: sibling variants in the same family (devin-tui logic). */
export function levelsFor(entries: CatalogEntry[], uid: string): { id: string; name: string }[] {
  const entry = entries.find((e) => e.modelUid === uid);
  if (!entry?.family) return [];
  if (
    entry.family.toLowerCase().startsWith('fusion') ||
    (entry.familyLabel ?? '').startsWith('Fusion')
  )
    return [];
  const names = new Set<string>();
  for (const e of entries) {
    if (e.family === entry.family && e.level) names.add(e.level);
  }
  const out = [...names].sort((a, b) => levelRank(a) - levelRank(b));
  return out.length < 2 ? [] : out.map((name) => ({ id: name.toLowerCase(), name }));
}
