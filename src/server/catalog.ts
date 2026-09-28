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
import type { CatalogEntry, CatalogState } from '../shared/protocol.js';
import { resolveBin } from './acp/agent.js';
import { modelsCacheFile } from './paths.js';

const TIMEOUT_MS = 20_000;
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

/** `label` minus the family prefix → normalized `level`. Suffix like
 *  'Medium Thinking' → Medium; 'No Thinking' → None. */
function parseLevel(suffix: string): string | undefined {
  const words = suffix.split(/\s+/).filter((w) => w.toLowerCase() !== 'thinking');
  const name = words.join(' ');
  if (name === 'No') return 'None';
  if (!name) return undefined;
  return LEVEL_NAMES.find((l) => l.toLowerCase() === name.toLowerCase());
}

/** Parse `devin models list --format json` output → entry array. */
export function parseCatalog(text: string): CatalogEntry[] {
  const data = JSON.parse(text) as {
    families?: {
      family_label?: string;
      family_uid?: string;
      variants?: {
        model_uid?: string;
        label?: string;
        cost_tier?: string;
        cost_summary?: string;
        is_new?: boolean;
        is_beta?: boolean;
        max_context_tokens?: number;
      }[];
    }[];
  };
  const out: CatalogEntry[] = [];
  for (const f of data.families ?? []) {
    const famLabel = f.family_label ?? '';
    for (const v of f.variants ?? []) {
      if (!v.model_uid) continue;
      const label = v.label ?? v.model_uid;
      const suffix = label.startsWith(famLabel)
        ? label.slice(famLabel.length).trim()
        : label.trim();
      out.push({
        modelUid: v.model_uid,
        label,
        family: f.family_uid,
        familyLabel: famLabel || undefined,
        costTier: v.cost_tier,
        prices: parsePrices(v.cost_summary),
        costSummary: v.cost_summary,
        isNew: v.is_new === true,
        isBeta: v.is_beta === true,
        maxContext: v.max_context_tokens,
        level: parseLevel(suffix),
      });
    }
  }
  return out;
}

function runModelsList(): Promise<string | null> {
  return new Promise((resolve) => {
    const child = execFile(
      resolveBin('devin'),
      ['models', 'list', '--format', 'json'],
      { timeout: TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => resolve(err || !stdout.trim() ? null : stdout),
    );
    child.on('error', () => resolve(null));
  });
}

function readFileCatalog(file: string): CatalogEntry[] | null {
  try {
    return parseCatalog(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

let state: CatalogState = { status: 'loading' };
let pending: Promise<CatalogState> | null = null;

export function getCatalog(): CatalogState {
  return state;
}

/** Load once; `refresh` re-runs the CLI (e.g. after auth). */
export function loadCatalog(refresh = false): Promise<CatalogState> {
  if (!refresh && pending) return pending;
  pending = (async (): Promise<CatalogState> => {
    const fixture = process.env.DEVIN_POCKET_MODELS_FILE;
    if (fixture) {
      const entries = readFileCatalog(fixture);
      state = entries
        ? { status: 'ready', entries, fetchedAt: Date.now(), fromCache: false }
        : { status: 'unavailable', reason: `cannot parse ${fixture}` };
      return state;
    }
    const text = await runModelsList();
    if (text !== null) {
      try {
        const entries = parseCatalog(text);
        fs.mkdirSync(path.dirname(modelsCacheFile()), { recursive: true });
        fs.writeFileSync(modelsCacheFile(), text);
        state = { status: 'ready', entries, fetchedAt: Date.now(), fromCache: false };
        return state;
      } catch {
        // unparsable — fall through to cache
      }
    }
    const cached = readFileCatalog(modelsCacheFile());
    state = cached
      ? { status: 'ready', entries: cached, fetchedAt: Date.now(), fromCache: true }
      : { status: 'unavailable', reason: 'devin models list failed and no cache' };
    return state;
  })();
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
