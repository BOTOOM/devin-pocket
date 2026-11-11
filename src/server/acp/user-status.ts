import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BillingInfo } from '../../shared/protocol.js';

const CACHE_DIR = path.join(os.homedir(), '.cache', 'devin', 'cli');
const FILE_RE = /^user_status\.[0-9a-f]+\.bin$/;

type Fields = Map<string, (number | string)[]>;

function add(out: Fields, p: string, v: number | string): void {
  const arr = out.get(p);
  if (arr) arr.push(v);
  else out.set(p, [v]);
}

function tryUtf8(bytes: Uint8Array): string | null {
  if (bytes.length === 0 || bytes.length > 200) return null;
  let s: string;
  try {
    s = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  for (const c of s) {
    const code = c.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return null;
  }
  return s;
}

/** minimal protobuf wire walker — flattens to dotted-path → scalar values */
function flatten(buf: Uint8Array, prefix: string, out: Fields, depth: number): void {
  if (depth > 8) return;
  let i = 0;
  const varint = (): bigint | null => {
    let v = 0n;
    let sh = 0n;
    while (i < buf.length) {
      const b = buf[i];
      if (b === undefined) return null;
      i += 1;
      v |= BigInt(b & 0x7f) << sh;
      if (!(b & 0x80)) return v;
      sh += 7n;
      if (sh > 70n) return null;
    }
    return null;
  };
  while (i < buf.length) {
    const key = varint();
    if (key === null || key === 0n) return;
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    const p = prefix ? `${prefix}.${field}` : String(field);
    if (wire === 0) {
      const v = varint();
      if (v === null) return;
      if (v <= BigInt(Number.MAX_SAFE_INTEGER)) add(out, p, Number(v));
    } else if (wire === 2) {
      const len = varint();
      if (len === null || i + Number(len) > buf.length) return;
      const bytes = buf.subarray(i, i + Number(len));
      i += Number(len);
      const text = tryUtf8(bytes);
      if (text !== null) add(out, p, text);
      else flatten(bytes, p, out, depth + 1);
    } else if (wire === 1) {
      i += 8;
    } else if (wire === 5) {
      i += 4;
    } else {
      return;
    }
  }
}

/**
 * Decode a cached `GetUserStatus` payload into BillingInfo.
 *
 * Field numbers inferred from longitudinal diffs of real `user_status.*.bin`
 * caches (CLI 3000.11.3): `.13` is the plan-status block; `.13.15` vanished
 * exactly when the weekly quota hit zero (proto3 omits defaults) and came
 * back at 99 after the weekly reset; `.13.17`/`.13.18` advance daily/weekly.
 * Guards below drop any field that stops looking sane after a schema bump.
 */
export function billingFromUserStatus(buf: Uint8Array, updatedAtMs?: number): BillingInfo | null {
  const fields: Fields = new Map();
  flatten(buf, '', fields, 0);
  const num = (p: string): number | undefined => {
    const v = fields.get(p)?.[0];
    return typeof v === 'number' ? v : undefined;
  };
  const str = (p: string): string | undefined => {
    const v = fields.get(p)?.[0];
    return typeof v === 'string' ? v : undefined;
  };
  const pct = (p: string): number | undefined => {
    const n = num(p);
    return n !== undefined && n >= 0 && n <= 100 ? n : undefined;
  };
  const ts = (p: string): number | undefined => {
    const n = num(p);
    return n !== undefined && n > 1e9 && n < 4e9 ? n : undefined;
  };
  if (!fields.has('13.14') && !fields.has('13.17')) return null;
  const info: BillingInfo = {
    updatedAt: updatedAtMs ?? Date.now(),
    source: 'cache',
    planName: str('13.1.2'),
    accountName: str('7'),
    dailyQuotaPct: pct('13.14'),
    // absent weekly pct inside a populated plan-status block = exhausted (0)
    weeklyQuotaPct: fields.has('13.15') ? pct('13.15') : 0,
    dailyResetAt: ts('13.17'),
    weeklyResetAt: ts('13.18'),
  };
  // `.13.16` is a draining balance of unknown units (seen: 1.6e9 → 1.0e7) —
  // deliberately not shown until the real `billingInformation` push names it.
  return info;
}

let memo: { file: string; mtimeMs: number; info: BillingInfo | null } | null = null;

/**
 * The CLI rewrites `user_status.<hash>.bin` on every `devin acp` boot — the
 * newest file belongs to the currently signed-in account. Memoized by
 * file+mtime so callers can poll cheaply.
 */
export function readBillingCache(dir = CACHE_DIR): BillingInfo | null {
  try {
    let newest: { file: string; mtimeMs: number } | null = null;
    for (const f of fs.readdirSync(dir)) {
      if (!FILE_RE.test(f)) continue;
      const st = fs.statSync(path.join(dir, f));
      if (!newest || st.mtimeMs > newest.mtimeMs)
        newest = { file: path.join(dir, f), mtimeMs: st.mtimeMs };
    }
    if (!newest) return null;
    if (memo?.file === newest.file && memo.mtimeMs === newest.mtimeMs) return memo.info;
    const env = JSON.parse(fs.readFileSync(newest.file, 'utf8')) as {
      fetched_at_secs?: number;
      payload?: string;
    };
    const info = env.payload
      ? billingFromUserStatus(
          Buffer.from(env.payload, 'base64'),
          env.fetched_at_secs !== undefined ? env.fetched_at_secs * 1000 : undefined,
        )
      : null;
    memo = { file: newest.file, mtimeMs: newest.mtimeMs, info };
    return info;
  } catch {
    return null;
  }
}
