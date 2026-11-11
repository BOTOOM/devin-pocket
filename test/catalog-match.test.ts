import { describe, expect, it } from 'vitest';
import { matchEntry } from '../src/shared/catalog-match.js';
import type { CatalogEntry } from '../src/shared/protocol.js';

const E = (uid: string, label: string): CatalogEntry => ({
  modelUid: uid,
  label,
  isNew: false,
  isBeta: false,
});
const entries = [E('swe-1-6', 'SWE-1.6'), E('swe-1-6-fast', 'SWE-1.6 Fast')];

describe('matchEntry', () => {
  it('matches by exact modelUid (option value)', () => {
    expect(matchEntry({ value: 'swe-1-6-fast', name: 'X' }, entries)?.modelUid).toBe(
      'swe-1-6-fast',
    );
  });
  it('matches by label (option name)', () => {
    expect(matchEntry({ value: 'zzz', name: 'SWE-1.6' }, entries)?.modelUid).toBe('swe-1-6');
  });
  it('matches with spaces/dashes/dots normalized', () => {
    expect(matchEntry({ value: 'SWE_1_6_Fast', name: 'x' }, entries)?.modelUid).toBe(
      'swe-1-6-fast',
    );
    expect(matchEntry({ value: 'x', name: 'Swe 1 6 Fast' }, entries)?.modelUid).toBe(
      'swe-1-6-fast',
    );
  });
  it('returns undefined when nothing matches', () => {
    expect(matchEntry({ value: 'nope', name: 'Nope' }, entries)).toBeUndefined();
  });
});
