import { describe, expect, it } from 'vitest';
import { type PricedModel, relativeModelCosts } from '../src/shared/model-cost.js';

const model = (value: string, input: number, output: number): PricedModel => ({
  value,
  name: value,
  entry: { modelUid: value, label: value, isNew: false, isBeta: false, prices: { input, output } },
});

describe('relative listed model cost', () => {
  it('weights rates and log1p-normalizes across available models', () => {
    const result = relativeModelCosts([model('a', 1, 4), model('b', 2, 8), model('c', 3, 12)]);
    expect(result.comparable).toBe(true);
    expect(result.points.map((p) => p.cost)).toEqual([1.6, 3.2, 4.800000000000001]);
    expect(result.points[0]?.position).toBe(0);
    expect(result.points[1]?.position).toBeCloseTo(0.5976, 3);
    expect(result.points[2]?.position).toBe(1);
  });
  it('accepts explicit zero prices without dropping free models', () => {
    const result = relativeModelCosts([model('free', 0, 0), model('paid', 1, 4)]);
    expect(result.points[0]).toMatchObject({ cost: 0, position: 0 });
  });
  it('excludes unmatched, missing, negative and non-finite prices', () => {
    const result = relativeModelCosts([
      { value: 'unknown', name: 'Unknown' },
      model('nan', NaN, 1),
      model('infinite', 1, Infinity),
      model('negative', -1, 4),
    ]);
    expect(result).toEqual({ comparable: false, points: [] });
  });
  it('does not invent a scale for empty, single or equal rates', () => {
    for (const models of [[], [model('a', 1, 4)], [model('a', 1, 4), model('b', 1, 4)]]) {
      const result = relativeModelCosts(models);
      expect(result.comparable).toBe(false);
      expect(result.points.every((p) => p.position === undefined)).toBe(true);
    }
  });
  it('preserves positions when rows are searched or reordered', () => {
    const all = [model('a', 1, 4), model('b', 2, 8), model('c', 3, 12)];
    const before = relativeModelCosts(all).points.find((p) => p.value === 'b');
    const query = 'b';
    const visible = all.filter((m) => m.name.includes(query));
    expect(visible).toHaveLength(1);
    expect(
      relativeModelCosts([...all].reverse()).points.find((p) => p.value === visible[0]?.value),
    ).toEqual(before);
  });
});
