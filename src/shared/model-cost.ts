import type { CatalogEntry } from './protocol.js';

export interface PricedModel {
  value: string;
  name: string;
  entry?: CatalogEntry;
}

export function relativeModelCosts(models: readonly PricedModel[]) {
  const priced = models.flatMap((model) => {
    const prices = model.entry?.prices;
    if (!prices || ![prices.input, prices.output].every((n) => Number.isFinite(n) && n >= 0)) {
      return [];
    }
    return [
      { value: model.value, name: model.name, cost: 0.8 * prices.input + 0.2 * prices.output },
    ];
  });
  const logs = priced.map((model) => Math.log1p(model.cost));
  const min = Math.min(...logs);
  const range = Math.max(...logs) - min;
  const comparable = priced.length > 1 && range > 0;
  return {
    comparable,
    points: priced.map((model, i) => ({
      ...model,
      position: comparable ? ((logs[i] ?? min) - min) / range : undefined,
    })),
  };
}
