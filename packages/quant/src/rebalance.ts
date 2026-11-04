/**
 * Turn target weights into an executable trade list.
 *
 * With whole shares, naive rounding can leave a lot of cash idle or overspend.
 * We floor every target, then greedily buy one more share of whichever asset
 * is furthest below its target (in value) while cash allows — a simple,
 * near-optimal heuristic for this small knapsack-like problem.
 */
export interface RebalanceHolding {
  id: string;
  /** Current number of units held (may be fractional). */
  units: number;
  price: number;
}

export interface RebalanceRequest {
  holdings: RebalanceHolding[];
  targetWeights: Record<string, number>;
  prices: Record<string, number>;
  cash?: number;
  /** Additional money to invest (positive) or withdraw (negative). */
  contribution?: number;
  fractional?: boolean;
  /** Ignore trades smaller than this value. */
  minTrade?: number;
  costBps?: number;
}

export interface Trade {
  id: string;
  side: 'buy' | 'sell';
  units: number;
  value: number;
  fromWeight: number;
  toWeight: number;
}

export interface RebalancePlan {
  trades: Trade[];
  cashLeft: number;
  totalValue: number;
  turnover: number;
  estimatedCost: number;
  trackingGap: number; // Σ|final − target| / 2
}

export function rebalancePlan(req: RebalanceRequest): RebalancePlan {
  const ids = [...new Set([...req.holdings.map((h) => h.id), ...Object.keys(req.targetWeights)])];
  const unitsNow: Record<string, number> = {};
  for (const h of req.holdings) unitsNow[h.id] = (unitsNow[h.id] ?? 0) + h.units;
  const price = (id: string) => req.prices[id] ?? req.holdings.find((h) => h.id === id)?.price ?? NaN;
  const cash0 = (req.cash ?? 0) + (req.contribution ?? 0);
  const holdingsValue = ids.reduce((s, id) => s + (unitsNow[id] ?? 0) * price(id), 0);
  const total = holdingsValue + cash0;
  const wsum = Object.values(req.targetWeights).reduce((a, b) => a + b, 0) || 1;
  const target = Object.fromEntries(ids.map((id) => [id, (req.targetWeights[id] ?? 0) / wsum]));
  const cost = (req.costBps ?? 0) / 10_000;
  const minTrade = req.minTrade ?? 0;

  const final: Record<string, number> = {};
  if (req.fractional) {
    for (const id of ids) final[id] = (target[id] * total * (1 - cost)) / price(id);
  } else {
    let cash = total;
    for (const id of ids) {
      final[id] = Math.floor((target[id] * total) / price(id));
      cash -= final[id] * price(id);
    }
    // greedy top-up by largest shortfall
    for (let guard = 0; guard < 10_000; guard++) {
      let best: string | null = null;
      let bestGap = 0;
      for (const id of ids) {
        const p = price(id);
        if (!(target[id] > 0) || p > cash) continue;
        const gap = target[id] * total - final[id] * p;
        if (gap > bestGap) {
          bestGap = gap;
          best = id;
        }
      }
      if (!best || bestGap < price(best) * 0.5) break;
      final[best] += 1;
      cash -= price(best);
    }
  }
  const trades: Trade[] = [];
  let traded = 0;
  for (const id of ids) {
    const du = final[id] - (unitsNow[id] ?? 0);
    const value = Math.abs(du * price(id));
    if (value < Math.max(minTrade, 1e-9)) {
      final[id] = unitsNow[id] ?? 0;
      continue;
    }
    traded += value;
    trades.push({
      id,
      side: du > 0 ? 'buy' : 'sell',
      units: Math.abs(du),
      value,
      fromWeight: total > 0 ? ((unitsNow[id] ?? 0) * price(id)) / total : 0,
      toWeight: total > 0 ? (final[id] * price(id)) / total : 0,
    });
  }
  trades.sort((a, b) => (a.side === b.side ? b.value - a.value : a.side === 'sell' ? -1 : 1)); // sells first fund buys
  const investedFinal = ids.reduce((s, id) => s + final[id] * price(id), 0);
  const estimatedCost = traded * cost;
  const gap = ids.reduce((s, id) => s + Math.abs((final[id] * price(id)) / (total || 1) - target[id]), 0) / 2;
  return {
    trades,
    cashLeft: total - investedFinal - estimatedCost,
    totalValue: total,
    turnover: total > 0 ? traded / total / 2 : 0,
    estimatedCost,
    trackingGap: gap,
  };
}
