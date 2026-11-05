/**
 * Analytics Web Worker. Every heavy computation (covariance estimation,
 * optimisation, frontier tracing, Monte Carlo, walk-forward backtests)
 * runs here so the UI thread never janks. Exposed via Comlink RPC.
 */
import * as Comlink from 'comlink';
import type { Currency } from '@frontier/contracts';
import {
  alignSeries,
  averageCorrelation,
  backtest,
  bayesSteinMean,
  blackLitterman,
  calendarReturns,
  capmReturns,
  computeMetrics,
  convertSeries,
  covToCorr,
  diversificationRatio,
  effectiveN,
  effectiveNumberOfBets,
  efficientFrontier,
  estimateCovariance,
  ewmaMean,
  explain,
  factorRegression,
  fromEpochDay,
  hierarchicalRiskParity,
  historicalMean,
  historicalStress,
  HISTORICAL_SCENARIOS,
  histogram,
  hypotheticalShock,
  impliedReturns,
  lowerBound,
  monteCarlo,
  normPdf,
  optimize,
  portfolioHealth,
  principalComponents,
  randomPortfolios,
  resampleAligned,
  returnsMatrix,
  riskContributions,
  rollingBeta,
  rollingSharpe,
  rollingVolatility,
  sliceSeries,
  std,
  mean,
  walkForward,
  periodsPerYearFromDates,
  type CovarianceMethod,
  type FrontierPoint,
  type HealthReport,
  type Matrix,
  type Metrics,
  type MonteCarloRequest,
  type MonteCarloResult,
  type Objective,
  type OptimizeResult,
  type PeriodReturn,
  type RebalanceRule,
  type Series,
  type StrategySpec,
  type View,
  type FactorModelResult,
  type StressResult,
} from '@frontier/quant';

export interface SeriesInput {
  id: string;
  currency: Currency;
  series: Series;
}

export interface AssetInfo {
  id: string;
  name: string;
  assetClass: string;
  region: string;
}

const YEAR = 365.25;

function toBase(s: SeriesInput, base: Currency, fx?: Series): Series {
  if (s.currency === base || !fx) return s.series;
  return convertSeries(s.series, fx, base === 'INR' ? 'multiply' : 'divide');
}

interface Prepared {
  dates: number[];
  prices: Matrix;
  returns: Matrix;
  ppy: number;
  bench?: number[];
  benchReturns?: number[];
}

function prepare(
  assets: SeriesInput[],
  base: Currency,
  fx: Series | undefined,
  lookbackYears: number,
  benchmark?: SeriesInput,
): Prepared {
  const conv = assets.map((a) => toBase(a, base, fx));
  const all = benchmark ? [...conv, toBase(benchmark, base, fx)] : conv;
  const end = Math.max(...all.map((s) => s.dates[s.dates.length - 1]));
  const start = lookbackYears > 0 ? end - lookbackYears * YEAR : -Infinity;
  const al = alignSeries(all, { start });
  if (al.dates.length < 30)
    throw new Error('Not enough overlapping history between these assets for analysis.');
  const n = assets.length;
  const prices = al.values.map((row) => row.slice(0, n));
  const bench = benchmark ? al.values.map((row) => row[n]) : undefined;
  return {
    dates: al.dates,
    prices,
    returns: returnsMatrix(prices),
    ppy: periodsPerYearFromDates(al.dates),
    bench,
    benchReturns: bench ? bench.slice(1).map((b, i) => b / bench[i] - 1) : undefined,
  };
}

const step = (len: number, target = 700) => Math.max(1, Math.ceil(len / target));
const sample = <T>(arr: T[], k: number): T[] => arr.filter((_, i) => i % k === 0 || i === arr.length - 1);

// ─── Portfolio analysis ───────────────────────────────────────────────────
export interface FactorDef {
  key: string;
  label: string;
  long: string;
  short?: string;
  excess?: boolean;
}

export interface AnalyzeRequest {
  assets: SeriesInput[];
  info: AssetInfo[];
  weights: number[];
  base: Currency;
  fx?: Series;
  benchmark?: SeriesInput;
  benchmarkName?: string;
  lookbackYears: number;
  riskFree: number;
  amount: number;
  covariance: CovarianceMethod;
  /** Full-history series for stress tests (held assets + their proxies). */
  proxies?: Record<string, SeriesInput | undefined>;
  factorSeries?: SeriesInput[];
  factors?: FactorDef[];
  shockDrivers?: { id: string; name: string; shock: number; summary: string; series: SeriesInput }[];
  targetEquity?: number;
}

export interface AnalyzeResult {
  window: { start: string; end: string; years: number; points: number };
  metrics: Metrics;
  benchmarkMetrics?: Metrics;
  equity: { dates: number[]; portfolio: number[]; benchmark?: number[] };
  drawdown: { dates: number[]; portfolio: number[]; benchmark?: number[] };
  rolling: { dates: number[]; vol: number[]; sharpe: number[]; beta?: number[] };
  distribution: { edges: number[]; counts: number[]; normal: number[]; var95: number; cvar95: number };
  monthly: PeriodReturn[];
  yearly: PeriodReturn[];
  risk: {
    volatility: number;
    percent: number[];
    marginal: number[];
    enb: number;
    diversificationRatio: number;
    effectiveN: number;
    avgCorrelation: number;
    explained: number[];
  };
  correlation: { ids: string[]; matrix: number[][] };
  perAsset: {
    id: string;
    weight: number;
    ret: number;
    vol: number;
    sharpe: number;
    riskShare: number;
    maxDrawdown: number;
  }[];
  health: HealthReport;
  stress: StressResult[];
  shocks: { id: string; name: string; summary: string; shock: number; impact: number }[];
  factorModel?: FactorModelResult;
}

function analyze(req: AnalyzeRequest): AnalyzeResult {
  const p = prepare(req.assets, req.base, req.fx, req.lookbackYears, req.benchmark);
  const w = req.weights;
  const n = w.length;
  // Constant-mix (daily-rebalanced) portfolio returns — the standard analytic convention.
  const port = p.returns.map((r) => r.reduce((s, x, i) => s + x * w[i], 0));
  const metrics = computeMetrics(port, {
    periodsPerYear: p.ppy,
    riskFree: req.riskFree,
    benchmark: p.benchReturns,
  });
  const benchmarkMetrics = p.benchReturns
    ? computeMetrics(p.benchReturns, { periodsPerYear: p.ppy, riskFree: req.riskFree })
    : undefined;

  const wealth = [req.amount];
  for (const r of port) wealth.push(wealth[wealth.length - 1] * (1 + r));
  const benchWealth = p.bench ? p.bench.map((b) => (b / p.bench![0]) * req.amount) : undefined;
  const k = step(p.dates.length);
  const dd = (x: number[]) => {
    let peak = -Infinity;
    return x.map((v) => {
      peak = Math.max(peak, v);
      return v / peak - 1;
    });
  };
  const cov = estimateCovariance(p.returns, p.ppy, req.covariance).cov;
  const rc = riskContributions(w, cov);
  const pca = principalComponents(cov);
  const hrp = n > 1 ? hierarchicalRiskParity(cov) : { order: [0], weights: [1], linkage: [] };
  const { corr } = covToCorr(cov);
  const order = hrp.order;

  const perAsset = req.info.map((a, i) => {
    const col = p.returns.map((r) => r[i]);
    const m = computeMetrics(col, { periodsPerYear: p.ppy, riskFree: req.riskFree });
    return {
      id: a.id,
      weight: w[i],
      ret: m.cagr,
      vol: m.volatility,
      sharpe: m.sharpe,
      riskShare: rc.percent[i],
      maxDrawdown: m.maxDrawdown,
    };
  });

  // distribution of daily returns
  const sd = std(port);
  const mu = mean(port);
  const hist = histogram(port, 41, [mu - 4.5 * sd, mu + 4.5 * sd]);
  const binW = hist.edges[1] - hist.edges[0];
  const normal = hist.counts.map((_, b) => {
    const mid = hist.edges[b] + binW / 2;
    return port.length * binW * (normPdf((mid - mu) / sd) / sd);
  });

  const win = Math.min(252, Math.floor(port.length / 3));
  const rv = rollingVolatility(port, win, p.ppy);
  const rs = rollingSharpe(port, win, p.ppy, req.riskFree);
  const rb = p.benchReturns ? rollingBeta(port, p.benchReturns, win) : undefined;
  const rIdx = port.map((_, i) => i).filter((i) => i >= win - 1 && (i % k === 0 || i === port.length - 1));

  const health = portfolioHealth({
    names: req.info.map((a) => a.name),
    weights: w,
    assetClasses: req.info.map((a) => a.assetClass),
    riskShare: rc.percent,
    sharpe: metrics.sharpe,
    volatility: metrics.volatility,
    maxDrawdown: metrics.maxDrawdown,
    enb: effectiveNumberOfBets(w, cov).enb,
    avgCorrelation: averageCorrelation(w, cov),
    benchmark: benchmarkMetrics
      ? {
          sharpe: benchmarkMetrics.sharpe,
          maxDrawdown: benchmarkMetrics.maxDrawdown,
          name: req.benchmarkName ?? 'the benchmark',
        }
      : undefined,
    targetEquity: req.targetEquity,
  });

  // historical stress on full histories (base currency)
  const fullHold = req.assets.map((a, i) => ({
    id: a.id,
    weight: w[i],
    series: toBase(a, req.base, req.fx),
    proxy: req.proxies?.[a.id] ? toBase(req.proxies[a.id]!, req.base, req.fx) : undefined,
  }));
  const stress = HISTORICAL_SCENARIOS.map((sc) => historicalStress(fullHold, sc)).filter(
    (s) => s.totalCoverage >= 0.5,
  );

  // hypothetical shocks (weekly betas, last 3 years)
  const shocks = (req.shockDrivers ?? []).map((d) => {
    const end = p.dates[p.dates.length - 1];
    const al = alignSeries([
      ...req.assets.map((a) => sliceSeries(toBase(a, req.base, req.fx), end - 3 * YEAR)),
      sliceSeries(toBase(d.series, req.base, req.fx), end - 3 * YEAR),
    ]);
    const wk = returnsMatrix(resampleAligned(al, 'W').values);
    const drv = wk.map((r) => r[n]);
    const res = hypotheticalShock(
      req.assets.map((a, i) => ({ id: a.id, weight: w[i], weeklyReturns: wk.map((r) => r[i]) })),
      drv,
      d.shock,
    );
    return { id: d.id, name: d.name, summary: d.summary, shock: d.shock, impact: res.portfolioImpact };
  });

  // factor model on weekly returns
  let factorModel: FactorModelResult | undefined;
  if (req.factors?.length && req.factorSeries?.length) {
    try {
      const fIds = req.factorSeries.map((f) => f.id);
      // End where every input still has real data: academic factors lag by
      // weeks, and forward-filled zeros would bias the betas towards 0.
      const inputs = [
        ...req.assets.map((a) => toBase(a, req.base, req.fx)),
        ...req.factorSeries.map((f) => f.series),
      ];
      const end = Math.min(...inputs.map((s) => s.dates[s.dates.length - 1]));
      const al = alignSeries(inputs, { start: p.dates[0], end });
      const wk = returnsMatrix(resampleAligned(al, 'W').values);
      const y = wk.map((r) => r.slice(0, n).reduce((s, x, i) => s + x * w[i], 0));
      const col = (id: string) => wk.map((r) => r[n + fIds.indexOf(id)]);
      const fac = req.factors
        .filter((f) => fIds.includes(f.long) && (!f.short || fIds.includes(f.short)))
        .map((f) => {
          const L = col(f.long);
          const S = f.short ? col(f.short) : undefined;
          return { key: f.key, label: f.label, returns: S ? L.map((v, i) => v - S[i]) : L };
        });
      if (wk.length > 60 && fac.length) {
        factorModel = factorRegression(y, fac, {
          periodsPerYear: 52,
          riskFree: req.riskFree,
          excessFactorKeys: req.factors.filter((f) => f.excess).map((f) => f.key),
        });
      }
    } catch {
      factorModel = undefined;
    }
  }

  return {
    window: {
      start: fromEpochDay(p.dates[0]),
      end: fromEpochDay(p.dates[p.dates.length - 1]),
      years: (p.dates[p.dates.length - 1] - p.dates[0]) / YEAR,
      points: p.dates.length,
    },
    metrics,
    benchmarkMetrics,
    equity: {
      dates: sample(p.dates, k),
      portfolio: sample(wealth, k),
      benchmark: benchWealth ? sample(benchWealth, k) : undefined,
    },
    drawdown: {
      dates: sample(p.dates, k),
      portfolio: sample(dd(wealth), k),
      benchmark: benchWealth ? sample(dd(benchWealth), k) : undefined,
    },
    rolling: {
      dates: rIdx.map((i) => p.dates[i + 1]),
      vol: rIdx.map((i) => rv[i]),
      sharpe: rIdx.map((i) => rs[i]),
      beta: rb ? rIdx.map((i) => rb[i]) : undefined,
    },
    distribution: {
      edges: hist.edges,
      counts: hist.counts,
      normal,
      var95: metrics.varHistorical,
      cvar95: metrics.cvarHistorical,
    },
    monthly: calendarReturns({ dates: p.dates, values: wealth }, 'M'),
    yearly: calendarReturns({ dates: p.dates, values: wealth }, 'Y'),
    risk: {
      volatility: rc.volatility,
      percent: rc.percent,
      marginal: rc.marginal,
      enb: effectiveNumberOfBets(w, cov).enb,
      diversificationRatio: diversificationRatio(w, cov),
      effectiveN: effectiveN(w),
      avgCorrelation: averageCorrelation(w, cov),
      explained: pca.explained,
    },
    correlation: {
      ids: order.map((i) => req.info[i].id),
      matrix: order.map((i) => order.map((j) => corr[i][j])),
    },
    perAsset,
    health,
    stress,
    shocks,
    factorModel,
  };
}

// ─── Optimisation ──────────────────────────────────────────────────────────
export type ReturnModel = 'historical' | 'shrunk' | 'capm' | 'ewma' | 'equilibrium';

export interface OptimizeRequest {
  assets: SeriesInput[];
  info: AssetInfo[];
  base: Currency;
  fx?: Series;
  lookbackYears: number;
  riskFree: number;
  covariance: CovarianceMethod;
  returnModel: ReturnModel;
  objective: Objective;
  maxWeight: number;
  minWeight: number;
  classCaps?: Record<string, number>;
  currentWeights?: number[];
  riskAversion?: number;
  targetReturn?: number;
  targetVolatility?: number;
  views?: View[];
  market?: SeriesInput;
}

export interface OptimizeResponse {
  result: OptimizeResult;
  frontier: FrontierPoint[];
  cloud: { ret: number; vol: number }[];
  assets: { id: string; ret: number; vol: number }[];
  current?: { ret: number; vol: number; sharpe: number };
  specials: { key: string; label: string; ret: number; vol: number; weights: number[] }[];
  mu: number[];
  window: { start: string; end: string; years: number };
  explanation: string[];
}

function estimateMu(
  p: Prepared,
  model: ReturnModel,
  rf: number,
  cov: Matrix,
  market?: number[],
  views?: View[],
): number[] {
  const n = p.returns[0].length;
  let mu: number[];
  switch (model) {
    case 'historical':
      mu = historicalMean(p.returns, p.ppy);
      break;
    case 'ewma':
      mu = ewmaMean(p.returns, p.ppy, 126);
      break;
    case 'capm':
      mu = market ? capmReturns(p.returns, market, p.ppy, rf) : historicalMean(p.returns, p.ppy);
      break;
    case 'equilibrium': {
      // Reverse-optimise from equal weights (no market caps available), then add views.
      const pi = impliedReturns(cov, new Array(n).fill(1 / n), 2.5).map((x) => x + rf);
      mu = pi;
      break;
    }
    case 'shrunk':
    default:
      mu = bayesSteinMean(p.returns, p.ppy).mu;
  }
  if (views && views.length) {
    const prior = mu.map((m) => m - rf);
    const bl = blackLitterman({
      cov,
      prior,
      views: views.map((v) => ({
        ...v,
        value: v.value - (v.pick.reduce((a, b) => a + b, 0) !== 0 ? rf : 0),
      })),
    });
    mu = bl.posteriorReturns.map((x) => x + rf);
  }
  return mu;
}

function runOptimize(req: OptimizeRequest): OptimizeResponse {
  const p = prepare(req.assets, req.base, req.fx, req.lookbackYears, req.market);
  const n = req.assets.length;
  const cov = estimateCovariance(p.returns, p.ppy, req.covariance).cov;
  const mu = estimateMu(p, req.returnModel, req.riskFree, cov, p.benchReturns, req.views);
  const groups = Object.entries(req.classCaps ?? {})
    .map(([cls, cap]) => ({
      label: cls,
      members: req.info.map((a, i) => (a.assetClass === cls ? i : -1)).filter((i) => i >= 0),
      upper: cap,
    }))
    .filter((g) => g.members.length > 0 && g.upper < 1);
  const constraints = {
    lower: new Array(n).fill(req.minWeight),
    upper: new Array(n).fill(req.maxWeight),
    groups,
  };
  const common = { mu, cov, riskFree: req.riskFree, constraints };
  const result = optimize({
    ...common,
    objective: req.objective,
    riskAversion: req.riskAversion,
    targetReturn: req.targetReturn,
    targetVolatility: req.targetVolatility,
    scenarios: req.objective === 'min-cvar' ? p.returns : undefined,
  });
  let frontier: FrontierPoint[] = [];
  try {
    frontier = efficientFrontier(mu, cov, constraints, { points: 40, riskFree: req.riskFree });
  } catch {
    frontier = [];
  }
  const specialDefs: [Objective, string][] = [
    ['min-variance', 'Minimum risk'],
    ['max-sharpe', 'Best risk/return'],
    ['risk-parity', 'Risk parity'],
    ['hrp', 'Hierarchical risk parity'],
    ['equal-weight', 'Equal weight'],
  ];
  const specials = specialDefs.flatMap(([obj, label]) => {
    try {
      const r = obj === req.objective ? result : optimize({ ...common, objective: obj });
      return [{ key: obj, label, ret: r.expectedReturn, vol: r.volatility, weights: r.weights }];
    } catch {
      return [];
    }
  });
  const vol = (w: number[]) =>
    Math.sqrt(
      Math.max(
        w.reduce((s, wi, i) => s + wi * cov[i].reduce((t, c, j) => t + c * w[j], 0), 0),
        0,
      ),
    );
  const current =
    req.currentWeights && req.currentWeights.length === n
      ? (() => {
          const r = req.currentWeights!.reduce((s, x, i) => s + x * mu[i], 0);
          const v = vol(req.currentWeights!);
          return { ret: r, vol: v, sharpe: v > 0 ? (r - req.riskFree) / v : 0 };
        })()
      : undefined;
  const { corr } = covToCorr(cov);
  const explanation = req.currentWeights
    ? explain.explainWeightChanges(
        req.info.map((a, i) => {
          const others = req.info.map((_, j) => j).filter((j) => j !== i);
          return {
            name: a.name,
            from: req.currentWeights![i] ?? 0,
            to: result.weights[i],
            vol: Math.sqrt(cov[i][i]),
            sharpe: (mu[i] - req.riskFree) / Math.sqrt(cov[i][i]),
            avgCorr: others.length ? others.reduce((s, j) => s + corr[i][j], 0) / others.length : 0,
          };
        }),
      )
    : [];
  return {
    result,
    frontier,
    cloud: randomPortfolios(mu, cov, 1500, constraints),
    assets: req.info.map((a, i) => ({ id: a.id, ret: mu[i], vol: Math.sqrt(cov[i][i]) })),
    current,
    specials,
    mu,
    window: {
      start: fromEpochDay(p.dates[0]),
      end: fromEpochDay(p.dates[p.dates.length - 1]),
      years: (p.dates[p.dates.length - 1] - p.dates[0]) / YEAR,
    },
    explanation,
  };
}

// ─── Backtests ─────────────────────────────────────────────────────────────
export interface WalkForwardRequest {
  assets: SeriesInput[];
  base: Currency;
  fx?: Series;
  riskFree: number;
  covariance: CovarianceMethod;
  lookbackDays: number;
  rebalance: 'monthly' | 'quarterly';
  maxWeight: number;
  strategies: StrategySpec[];
  costBps: number;
}

export interface WalkForwardResponse {
  dates: number[];
  curves: { id: string; label: string; equity: number[]; metrics: Metrics; avgTurnover: number }[];
  window: { start: string; end: string };
}

function runWalkForward(req: WalkForwardRequest): WalkForwardResponse {
  const p = prepare(req.assets, req.base, req.fx, 0);
  const wf = walkForward({
    dates: p.dates,
    prices: p.prices,
    strategies: req.strategies,
    lookback: req.lookbackDays,
    rebalance: req.rebalance,
    covariance: req.covariance,
    returns: 'shrunk',
    constraints: { upper: new Array(req.assets.length).fill(req.maxWeight) },
    costBps: req.costBps,
    riskFree: req.riskFree,
  });
  const k = step(wf.dates.length, 500);
  return {
    dates: sample(wf.dates, k),
    curves: wf.curves.map((c) => ({ ...c, equity: sample(c.equity, k) })),
    window: { start: fromEpochDay(wf.dates[0]), end: fromEpochDay(wf.dates[wf.dates.length - 1]) },
  };
}

export interface RebalanceStudyRequest {
  assets: SeriesInput[];
  weights: number[];
  base: Currency;
  fx?: Series;
  lookbackYears: number;
  riskFree: number;
  costBps: number;
  amount: number;
}

export interface RebalanceStudyResponse {
  dates: number[];
  rules: {
    key: string;
    label: string;
    equity: number[];
    metrics: Metrics;
    rebalances: number;
    turnover: number;
    costs: number;
  }[];
}

function runRebalanceStudy(req: RebalanceStudyRequest): RebalanceStudyResponse {
  const p = prepare(req.assets, req.base, req.fx, req.lookbackYears);
  const rules: [string, string, RebalanceRule][] = [
    ['none', 'Never (buy & hold)', 'none'],
    ['monthly', 'Monthly', 'monthly'],
    ['quarterly', 'Quarterly', 'quarterly'],
    ['annually', 'Yearly', 'annually'],
    ['band', 'When off by 5%', { threshold: 0.05 }],
  ];
  const k = step(p.dates.length, 500);
  return {
    dates: sample(p.dates, k),
    rules: rules.map(([key, label, rule]) => {
      const r = backtest({
        dates: p.dates,
        prices: p.prices,
        weights: req.weights,
        rebalance: rule,
        costBps: req.costBps,
        initial: req.amount,
        riskFree: req.riskFree,
      });
      return {
        key,
        label,
        equity: sample(r.equity, k),
        metrics: r.metrics,
        rebalances: r.rebalances,
        turnover: r.turnover,
        costs: r.costs,
      };
    }),
  };
}

/** Monthly portfolio returns (base currency) for the bootstrap simulator. */
function monthlyReturns(req: {
  assets: SeriesInput[];
  weights: number[];
  base: Currency;
  fx?: Series;
  lookbackYears: number;
}): { returns: number[]; mu: number; sigma: number; years: number } {
  const p = prepare(req.assets, req.base, req.fx, req.lookbackYears);
  const wealth = [1];
  for (const r of p.returns)
    wealth.push(wealth[wealth.length - 1] * (1 + r.reduce((s, x, i) => s + x * req.weights[i], 0)));
  const m = calendarReturns({ dates: p.dates, values: wealth }, 'M')
    .filter((r) => !r.partial)
    .map((r) => r.ret);
  const daily = p.returns.map((r) => r.reduce((s, x, i) => s + x * req.weights[i], 0));
  return {
    returns: m,
    mu: mean(daily) * p.ppy,
    sigma: std(daily) * Math.sqrt(p.ppy),
    years: (p.dates[p.dates.length - 1] - p.dates[0]) / YEAR,
  };
}

function simulate(req: MonteCarloRequest): MonteCarloResult {
  return monteCarlo(req);
}

const api = {
  analyze,
  optimize: runOptimize,
  walkForward: runWalkForward,
  rebalanceStudy: runRebalanceStudy,
  monthlyReturns,
  simulate,
  lowerBound,
};
export type QuantApi = typeof api;
Comlink.expose(api);
