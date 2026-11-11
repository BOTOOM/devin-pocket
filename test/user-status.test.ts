import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { billingFromUserStatus, readBillingCache } from '../src/server/acp/user-status.js';

// minimal protobuf encoder for fixtures
function varint(v: number): number[] {
  let n = BigInt(v);
  const out: number[] = [];
  do {
    let b = Number(n & 0x7fn);
    n >>= 7n;
    if (n > 0n) b |= 0x80;
    out.push(b);
  } while (n > 0n);
  return out;
}
const tag = (f: number, w: number) => varint((f << 3) | w);
const vint = (f: number, v: number) => [...tag(f, 0), ...varint(v)];
const raw = (f: number, b: Uint8Array) => [...tag(f, 2), ...varint(b.length), ...b];
const str = (f: number, s: string) => raw(f, new TextEncoder().encode(s));
const msg = (f: number, inner: number[]) => raw(f, Uint8Array.from(inner));

function payload(opts: { weekly?: number } = {}): Uint8Array {
  const plan = msg(13, [
    ...msg(1, str(2, 'Max')),
    ...vint(14, 100),
    ...(opts.weekly !== undefined ? vint(15, opts.weekly) : []),
    ...vint(16, 10000000),
    ...vint(17, 1791446400),
    ...vint(18, 1791705600),
  ]);
  return Uint8Array.from([...str(7, 'user@example.com'), ...plan]);
}

function writeCache(dir: string, name: string, buf: Uint8Array, fetchedAt = 1791500000): string {
  const file = path.join(dir, name);
  writeFileSync(
    file,
    JSON.stringify({ fetched_at_secs: fetchedAt, payload: Buffer.from(buf).toString('base64') }),
  );
  return file;
}

describe('billingFromUserStatus', () => {
  it('extracts plan status fields from a cached payload', () => {
    const info = billingFromUserStatus(payload({ weekly: 71 }), 1791500000000);
    expect(info).toMatchObject({
      source: 'cache',
      planName: 'Max',
      accountName: 'user@example.com',
      dailyQuotaPct: 100,
      weeklyQuotaPct: 71,
      dailyResetAt: 1791446400,
      weeklyResetAt: 1791705600,
      updatedAt: 1791500000000,
    });
  });

  it('treats absent weekly pct as exhausted (proto3 zero-omit)', () => {
    expect(billingFromUserStatus(payload())?.weeklyQuotaPct).toBe(0);
  });

  it('rejects buffers without a plan-status block', () => {
    expect(billingFromUserStatus(Uint8Array.from(str(7, 'user@example.com')))).toBeNull();
  });

  it('drops out-of-range percents and timestamps', () => {
    const buf = Uint8Array.from([...msg(13, [...vint(14, 300), ...vint(17, 42)])]);
    const info = billingFromUserStatus(buf);
    expect(info?.dailyQuotaPct).toBeUndefined();
    expect(info?.dailyResetAt).toBeUndefined();
  });
});

describe('readBillingCache', () => {
  it('reads the newest user_status.*.bin in the dir', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'user-status-'));
    const stale = writeCache(dir, 'user_status.aaaa.bin', payload({ weekly: 10 }));
    const fresh = writeCache(dir, 'user_status.bbbb.bin', payload({ weekly: 88 }));
    utimesSync(stale, new Date('2026-01-01'), new Date('2026-01-01'));
    utimesSync(fresh, new Date('2026-06-01'), new Date('2026-06-01'));
    writeFileSync(path.join(dir, 'unrelated.bin'), 'x');
    expect(readBillingCache(dir)?.weeklyQuotaPct).toBe(88);
  });

  it('returns null when no cache exists', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'user-status-empty-'));
    expect(readBillingCache(dir)).toBeNull();
    expect(readBillingCache(path.join(dir, 'missing'))).toBeNull();
  });
});
