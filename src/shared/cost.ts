import type { CatalogEntry, CatalogState, TurnStat } from './protocol.js';

export interface CostEstimate {
  amount: number;
  currency: 'USD';
  /** always true — derived from token counts × catalog prices, not agent-reported */
  estimated: true;
  /** turns whose model could not be priced */
  unpriced: number;
}

/** Price per-turn stats by matching turn_stats' model label to catalog entries.
 *  Fusion labels are never priced (a pair's main vs sidekick tokens can't be split). */
export function estimateCost(stats: TurnStat[], catalog: CatalogState): CostEstimate {
  const byLabel = new Map<string, CatalogEntry>();
  if (catalog.status === 'ready') {
    for (const e of catalog.entries) byLabel.set(e.label, e);
  }
  let usd = 0;
  let unpriced = 0;
  for (const t of stats) {
    const label = t.model;
    if (!label || label.startsWith('Fusion (')) {
      unpriced++;
      continue;
    }
    const e = byLabel.get(label);
    if (!e?.prices) {
      // Free tier counts as priced at $0
      if (e?.costTier === 'Free') continue;
      unpriced++;
      continue;
    }
    usd +=
      (t.input * e.prices.input +
        t.cached * (e.prices.cached ?? e.prices.input) +
        t.output * e.prices.output) /
      1e6;
  }
  return { amount: usd, currency: 'USD', estimated: true, unpriced };
}
