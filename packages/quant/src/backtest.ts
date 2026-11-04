/**
 * Backtesting: (1) a fixed-weight portfolio under different rebalancing
 * rules with transaction costs, and (2) walk-forward (out-of-sample)
 * evaluation of optimisation strategies — the honest way to compare them,
 * because in-sample every optimiser looks brilliant.
 */
import { estimateCovariance, type CovarianceMethod } from './covariance';
import { bayesSteinMean, historicalMean } from './expected';
import { computeMetrics, type Metrics } from './metrics';
import { optimize, type Objective } from './optimize';
import type { Constraints } from './optimize/constraints';
import { periodStartIndices, periodsPerYearFromDates, returnsMatrix, type Frequency } from './series';
import type { Matrix, Vector } from './linalg';

export type RebalanceRule = 'none' | 'monthly' | 'quarterly' | 'annually' | { threshold: number };

export interface BacktestRequest {
  dates: number[];
  /** T×n aligned prices in one currency */
  prices: Matrix;
  weights: Vector;
  rebalance: RebalanceRule;
  /** One-way cost in basis points of traded value. */
  costBps?: number;
  initial?: number;
  riskFree?: number;
  benchmark?: Vector; // benchmark prices aligned with dates
}

export interface BacktestResult {
  dates: number[];
  equity: number[];
  benchmarkEquity?: number[];
  metrics: Metrics;
  rebalances: number;
  turnover: number; // average annual one-way turnover
  costs: number; // total cost paid (currency)
  finalWeights: Vector;
}

const freqOf = (r: RebalanceRule): Frequency | null =>
  r === 'monthly' ? 'M' : r === 'quarterly' ? 'Q' : r === 'annually' ? 'Y' : null;

export function backtest(req: BacktestRequest): BacktestResult {
  const { dates, prices } = req;
  const T = dates.length;
  const n = req.weights.length;
  const cost = (req.costBps ?? 0) / 10_000;
  const initial = req.initial ?? 10_000;
  const freq = freqOf(req.rebalance);
  const threshold = typeof req.rebalance === 'object' ? req.rebalance.threshold : null;
  const rebalanceDays = new Set(freq ? periodStartIndices(dates, freq) : []);

  let units = req.weights.map((w, i) => (initial * w * (1 - cost)) / prices[0][i]);
  let costs = initial * cost;
  let traded = initial;
  let rebalances = 0;
  const equity = new Array<number>(T);
  for (let t = 0; t < T; t++) {
    const p = prices[t];
    let value = 0;
    for (let i = 0; i < n; i++) value += units[i] * p[i];
    let doRebalance = rebalanceDays.has(t);
    if (!doRebalance && threshold !== null && t > 0) {
      for (let i = 0; i < n; i++) {
        if (Math.abs((units[i] * p[i]) / value - req.weights[i]) > threshold) {
          doRebalance = true;
          break;
        }
      }
    }
    if (doRebalance && t > 0) {
      let tradeValue = 0;
      for (let i = 0; i < n; i++) tradeValue += Math.abs(req.weights[i] * value - units[i] * p[i]);
      const c = tradeValue * cost;
      const net = value - c;
      units = req.weights.map((w, i) => (net * w) / p[i]);
      costs += c;
      traded += tradeValue;
      value = net;
      rebalances++;
    }
    equity[t] = value;
  }
  const ppy = periodsPerYearFromDates(dates);
  const rets = equity.slice(1).map((v, t) => v / equity[t] - 1);
  let benchmarkEquity: number[] | undefined;
  let benchRets: number[] | undefined;
  if (req.benchmark && req.benchmark.length === T) {
    const b0 = req.benchmark[0];
    benchmarkEquity = req.benchmark.map((b) => (b / b0) * initial);
    benchRets = req.benchmark.slice(1).map((b, t) => b / req.benchmark![t] - 1);
  }
  const last = prices[T - 1];
  const finalValue = units.reduce((s, u, i) => s + u * last[i], 0);
  const years = Math.max((dates[T - 1] - dates[0]) / 365.25, 1e-9);
  return {
    dates,
    equity,
    benchmarkEquity,
    metrics: computeMetrics(rets, { periodsPerYear: ppy, riskFree: req.riskFree, benchmark: benchRets }),
    rebalances,
    turnover: (traded - initial) / 2 / ((equity.reduce((a, b) => a + b, 0) / T) * years),
    costs,
    finalWeights: units.map((u, i) => (u * last[i]) / finalValue),
  };
}

export interface StrategySpec {
  id: string;
  label: string;
  objective: Objective;
  riskAversion?: number;
  /** Fixed weights (e.g. a 60/40 benchmark) — bypasses optimisation. */
  fixedWeights?: Vector;
}

export interface WalkForwardRequest {
  dates: number[];
  prices: Matrix;
  strategies: StrategySpec[];
  /** Estimation window in trading days. */
  lookback: number;
  rebalance: 'monthly' | 'quarterly';
  covariance?: CovarianceMethod;
  returns?: 'historical' | 'shrunk';
  constraints?: Partial<Constraints>;
  costBps?: number;
  riskFree?: number;
}

export interface WalkForwardResult {
  dates: number[];
  curves: { id: string; label: string; equity: number[]; metrics: Metrics; avgTurnover: number }[];
  rebalanceDates: number[];
}

/**
 * Walk-forward test: at every rebalance date t, each strategy sees only data
 * in [t − lookback, t) — no look-ahead — chooses weights, then holds them
 * (drifting with prices) until the next rebalance. Costs are charged on turnover.
 */
export function walkForward(req: WalkForwardRequest): WalkForwardResult {
  const { dates, prices } = req;
  const T = dates.length;
  const n = prices[0]?.length ?? 0;
  const cost = (req.costBps ?? 10) / 10_000;
  const starts = periodStartIndices(dates, req.rebalance === 'monthly' ? 'M' : 'Q').filter(
    (t) => t >= req.lookback,
  );
  if (starts.length < 2)
    throw new Error('Not enough history for a walk-forward test — shorten the lookback.');
  const ppy = periodsPerYearFromDates(dates);
  const t0 = starts[0];
  const outDates = dates.slice(t0);
  const curves = req.strategies.map((s) => ({
    spec: s,
    value: 1,
    units: new Array<number>(n).fill(0),
    equity: [] as number[],
    turnover: 0,
    count: 0,
  }));
  const startSet = new Set(starts);
  for (let t = t0; t < T; t++) {
    const p = prices[t];
    if (startSet.has(t)) {
      const window = prices.slice(t - req.lookback, t);
      const R = returnsMatrix(window);
      const covEst = estimateCovariance(R, ppy, req.covariance ?? 'ledoit-wolf').cov;
      const mu = req.returns === 'historical' ? historicalMean(R, ppy) : bayesSteinMean(R, ppy).mu;
      for (const c of curves) {
        let w: Vector;
        if (c.spec.fixedWeights) w = c.spec.fixedWeights;
        else {
          try {
            w = optimize({
              objective: c.spec.objective,
              mu,
              cov: covEst,
              riskFree: req.riskFree ?? 0,
              riskAversion: c.spec.riskAversion,
              constraints: req.constraints,
              scenarios: c.spec.objective === 'min-cvar' ? R : undefined,
            }).weights;
          } catch {
            w = new Array<number>(n).fill(1 / n);
          }
        }
        const value = c.units.reduce((s, u, i) => s + u * p[i], 0) || c.value;
        let traded = 0;
        for (let i = 0; i < n; i++) traded += Math.abs(w[i] * value - c.units[i] * p[i]);
        const net = value - traded * cost;
        if (c.count > 0) c.turnover += traded / value / 2; // initial purchase isn't turnover
        c.count++;
        c.units = w.map((wi, i) => (net * wi) / p[i]);
      }
    }
    for (const c of curves) {
      c.value = c.units.reduce((s, u, i) => s + u * p[i], 0);
      c.equity.push(c.value);
    }
  }
  const years = Math.max((outDates[outDates.length - 1] - outDates[0]) / 365.25, 1e-9);
  return {
    dates: outDates,
    rebalanceDates: starts.map((i) => dates[i]),
    curves: curves.map((c) => {
      const rets = c.equity.slice(1).map((v, i) => v / c.equity[i] - 1);
      return {
        id: c.spec.id,
        label: c.spec.label,
        equity: c.equity,
        metrics: computeMetrics(rets, { periodsPerYear: ppy, riskFree: req.riskFree }),
        avgTurnover: c.turnover / years,
      };
    }),
  };
}
