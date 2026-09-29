import { describe, expect, it } from 'vitest';
import { parseCatalog, parseCatalogDetailed } from '../src/server/catalog.js';

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

describe('parseCatalogDetailed shapes', () => {
  it('accepts a top-level array of variants', () => {
    const { entries, parseError } = parseCatalogDetailed(
      JSON.stringify([
        {
          model_uid: 'swe-1-6',
          label: 'SWE-1.6',
          cost_summary: '$1 / 1M input $4 / 1M output',
        },
      ]),
    );
    expect(parseError).toBeUndefined();
    expect(entries[0]?.prices).toEqual({ input: 1, output: 4, cached: undefined });
  });
  it('accepts { models: [...] }', () => {
    const { entries, parseError } = parseCatalogDetailed(
      JSON.stringify({ models: [{ uid: 'x1', name: 'Model X' }] }),
    );
    expect(parseError).toBeUndefined();
    expect(entries[0]).toMatchObject({ modelUid: 'x1', label: 'Model X' });
  });
  it('reports a parseError with top-level keys on unknown shape', () => {
    const { entries, parseError } = parseCatalogDetailed(JSON.stringify({ data: {}, meta: 1 }));
    expect(entries).toEqual([]);
    expect(parseError).toContain('data');
    expect(parseError).toContain('meta');
  });
  it('reports invalid JSON', () => {
    expect(parseCatalogDetailed('not json').parseError).toBeTruthy();
  });
});
