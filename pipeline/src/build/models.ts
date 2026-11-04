/**
 * Model portfolios for the beginner Advisor — 5 risk profiles × 2 markets.
 *
 * Deliberately *forecast-free*: expected-return estimates are the noisiest
 * optimiser input, and a beginner's recommendation must not hinge on last
 * decade's winners. Instead:
 *   1. the risk profile sets the strategic split between growth (stocks),
 *      stability (bonds/cash) and gold — the decision that drives ~90 % of
 *      outcomes (Brinson, Hood & Beebower 1986);
 *   2. inside each sleeve, weights equalise *risk contributions* (ERC) using
 *      a Ledoit–Wolf covariance of 5 years of weekly returns;
 *   3. the mix is backtested with monthly rebalancing for honest statistics.
 */
import type { ModelPortfolio } from '@frontier/contracts';
import {
  alignSeries,
  backtest,
  calendarReturns,
  estimateCovariance,
  explain,
  fromEpochDay,
  resampleAligned,
  returnsMatrix,
  riskBudgeting,
  riskContributions,
  sliceSeries,
} from '@frontier/quant';
import type { Universe } from './types';

const PROFILES = [
  { profile: 1, name: 'Conservative', equity: 0.25, gold: 0.1 },
  { profile: 2, name: 'Cautious', equity: 0.4, gold: 0.1 },
  { profile: 3, name: 'Balanced', equity: 0.6, gold: 0.08 },
  { profile: 4, name: 'Growth', equity: 0.75, gold: 0.07 },
  { profile: 5, name: 'Aggressive', equity: 0.9, gold: 0.05 },
] as const;

interface Sleeves {
  equity: (p: number) => string[];
  defensive: (p: number) => string[];
  gold: string;
  currency: 'USD' | 'INR';
}

const MARKETS: Record<'US' | 'IN', Sleeves> = {
  US: {
    equity: (p) => (p >= 4 ? ['SPY', 'QQQ', 'VEA', 'VWO'] : ['SPY', 'VEA', 'VWO']),
    defensive: (p) => (p <= 2 ? ['AGG', 'IEF', 'SHY', 'TIP'] : p === 3 ? ['AGG', 'IEF', 'TIP'] : ['AGG', 'IEF']),
    gold: 'GLD',
    currency: 'USD',
  },
  IN: {
    equity: () => ['NIFTYBEES.NS', 'JUNIORBEES.NS', 'MON100.NS'],
    defensive: () => ['SETF10GILT.NS', 'CASH-INR'],
    gold: 'GOLDBEES.NS',
    currency: 'INR',
  },
};

const YEAR = 365.25;

function ercWeights(ids: string[], universe: Universe, end: number): Map<string, number> {
  // Risk parity between cash (σ≈0) and anything else would put ~100 % in cash,
  // so a cash instrument receives a fixed half of a mixed sleeve instead.
  const cash = ids.filter((id) => universe.get(id)!.meta.kind === 'cash');
  if (cash.length && cash.length < ids.length) {
    const rest = ercWeights(ids.filter((id) => !cash.includes(id)), universe, end);
    const out = new Map<string, number>();
    rest.forEach((w, id) => out.set(id, w * 0.5));
    cash.forEach((id) => out.set(id, 0.5 / cash.length));
    return out;
  }
  const series = ids.map((id) => sliceSeries(universe.get(id)!.series, end - 5 * YEAR));
  const al = alignSeries(series);
  const wk = returnsMatrix(resampleAligned(al, 'W').values);
  const out = new Map<string, number>();
  if (ids.length === 1 || wk.length < 52) {
    ids.forEach((id) => out.set(id, 1 / ids.length));
    return out;
  }
  const cov = estimateCovariance(wk, 52, 'ledoit-wolf').cov;
  riskBudgeting(cov).weights.forEach((w, i) => out.set(ids[i], w));
  return out;
}

export function buildModels(universe: Universe, riskFree: Record<'USD' | 'INR', number>): { models: ModelPortfolio[]; skipped: string[] } {
  const models: ModelPortfolio[] = [];
  const skipped: string[] = [];
  for (const [market, sl] of Object.entries(MARKETS) as ['US' | 'IN', Sleeves][]) {
    for (const pr of PROFILES) {
      // keep only instruments with ≥ 3 years of data
      const ok = (id: string) => {
        const a = universe.get(id);
        if (!a) return false;
        const s = a.series;
        return s.dates.length > 0 && s.dates[s.dates.length - 1] - s.dates[0] > 3 * YEAR;
      };
      const eq = sl.equity(pr.profile).filter(ok);
      let def = sl.defensive(pr.profile).filter(ok);
      const gold = ok(sl.gold) ? [sl.gold] : [];
      if (def.length === 0) def = [`CASH-${sl.currency}`].filter(ok);
      if (eq.length === 0 || def.length === 0) {
        skipped.push(`${market}-${pr.profile}`);
        continue;
      }
      const all = [...eq, ...def, ...gold];
      const end = Math.min(...all.map((id) => universe.get(id)!.series.dates.at(-1)!));
      const eqW = ercWeights(eq, universe, end);
      const defW = ercWeights(def, universe, end);
      const goldShare = gold.length ? pr.gold : 0;
      const defShare = 1 - pr.equity - goldShare;
      const weights = new Map<string, number>();
      eq.forEach((id) => weights.set(id, pr.equity * eqW.get(id)!));
      def.forEach((id) => weights.set(id, defShare * defW.get(id)!));
      gold.forEach((id) => weights.set(id, goldShare));
      // drop dust positions (< 1 %), then round to whole percent preserving the total
      const ids = all.filter((id) => weights.get(id)! >= 0.01);
      const keptSum = ids.reduce((s, id) => s + weights.get(id)!, 0);
      const raw = ids.map((id) => weights.get(id)! / keptSum);
      const pctW = raw.map((w) => Math.round(w * 100));
      pctW[raw.indexOf(Math.max(...raw))] += 100 - pctW.reduce((a, b) => a + b, 0);
      const rounded = pctW.map((p) => p / 100);

      // backtest on the common window
      const al = alignSeries(ids.map((id) => universe.get(id)!.series));
      const bt = backtest({ dates: al.dates, prices: al.values, weights: rounded, rebalance: 'monthly', costBps: 5, riskFree: riskFree[sl.currency] });
      const wk = returnsMatrix(resampleAligned(al, 'W').values);
      const cov = estimateCovariance(wk.slice(-260), 52, 'ledoit-wolf').cov;
      const rc = riskContributions(rounded, cov).percent;
      const yearly = calendarReturns({ dates: al.dates, values: bt.equity }, 'Y').filter((r) => !r.partial);
      const worst = yearly.length ? yearly.reduce((a, b) => (b.ret < a.ret ? b : a)) : null;
      const best = yearly.length ? yearly.reduce((a, b) => (b.ret > a.ret ? b : a)) : null;
      const rf = riskFree[sl.currency];
      const histMu = bt.metrics.annualMean;
      const sigma = bt.metrics.volatility;
      // Shrink the historical mean halfway towards a long-run Sharpe-0.3 prior.
      const mu = 0.5 * histMu + 0.5 * (rf + 0.3 * sigma);
      const holdings = ids.map((id, i) => {
        const meta = universe.get(id)!.meta;
        return {
          id,
          weight: rounded[i],
          riskShare: rc[i],
          why: `${meta.role ?? 'Holding'}: ${meta.description}`,
        };
      });
      const years = (al.dates.at(-1)! - al.dates[0]) / YEAR;
      models.push({
        id: `${market}-${pr.profile}`,
        region: market,
        currency: sl.currency,
        profile: pr.profile,
        profileName: pr.name,
        holdings,
        backtest: {
          start: fromEpochDay(al.dates[0]),
          end: fromEpochDay(al.dates.at(-1)!),
          cagr: bt.metrics.cagr,
          volatility: bt.metrics.volatility,
          sharpe: bt.metrics.sharpe,
          maxDrawdown: bt.metrics.maxDrawdown,
          worstYear: worst ? { year: worst.year, ret: worst.ret } : null,
          bestYear: best ? { year: best.year, ret: best.ret } : null,
        },
        forward: { mu, sigma },
        method: 'Strategic allocation by risk profile; equal risk contribution within each sleeve (Ledoit–Wolf covariance, 5y weekly); monthly rebalancing.',
        summary: `${pr.name}: about ${Math.round(pr.equity * 100)}% in growth assets and ${Math.round((1 - pr.equity) * 100)}% in stabilisers. Over the last ${explain.number(years, 0)} years this mix grew ${explain.pct(bt.metrics.cagr)} a year, with a worst fall of ${explain.pct(bt.metrics.maxDrawdown, 0)}${worst ? ` and a worst calendar year of ${explain.signedPct(worst.ret)} (${worst.year})` : ''}.`,
      });
    }
  }
  return { models, skipped };
}

