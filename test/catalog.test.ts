import { describe, expect, it } from 'vitest';
import { parseCatalog } from '../src/server/catalog.js';

function fixture(variants: { model_uid: string; label: string }[]): string {
  // real labels share the family prefix; the suffix holds level + mods
  return JSON.stringify({
    families: [{ family_label: 'SWE-1.6', family_uid: 'swe-1-6', variants }],
  });
}

describe('parseCatalog mods/level', () => {
  it('plain label: no mods, no level', () => {
    const e = parseCatalog(fixture([{ model_uid: 'swe-1-6', label: 'SWE-1.6' }]))[0]!;
    expect(e.mods).toBeUndefined();
    expect(e.level).toBeUndefined();
    expect(e.label).toBe('SWE-1.6');
  });
  it('"X Fast" → mods [Fast], no level', () => {
    const e = parseCatalog(fixture([{ model_uid: 'swe-1-6-fast', label: 'SWE-1.6 Fast' }]))[0]!;
    expect(e.mods).toEqual(['Fast']);
    expect(e.level).toBeUndefined();
  });
  it('"X 1M Fast High" → mods [1M, Fast], level High', () => {
    const e = parseCatalog(
      fixture([{ model_uid: 'swe-1-6-1m-fast-high', label: 'SWE-1.6 1M Fast High' }]),
    )[0]!;
    expect(e.mods).toEqual(['1M', 'Fast']);
    expect(e.level).toBe('High');
  });
});
