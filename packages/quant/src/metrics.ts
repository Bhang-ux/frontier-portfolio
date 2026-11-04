/**
 * Performance & risk metrics for a single return stream, optionally relative
 * to a benchmark. All inputs are *per-period simple returns*; outputs are
 * annualised where conventional. Losses (VaR, CVaR, drawdown) are reported as
 * positive fractions of capital so "bigger = worse" everywhere in the UI.
 */
import {
  kurtosis,
  mean,
  normInv,
  quantileSorted,
  skewness,
  sortedCopy,
  std,
  covariance,
  variance,
} from './stats';
import { drawdownSeries, wealthIndex } from './series';

export interface DrawdownInfo {
  maxDrawdown: number; // positive fraction, e.g. 0.34 = −34 %
  peakIndex: number; // index into wealth (0 = before first return)
  troughIndex: number;
  recoveryIndex: number | null; // null = not yet recovered
  durationPeriods: number; // peak → recovery (or → end if unrecovered)
  currentDrawdown: number;
}

export function drawdownInfo(returns: ArrayLike<number>): DrawdownInfo {
  const w = wealthIndex(returns);
  const dd = drawdownSeries(w);
  let trough = 0;
  for (let t = 1; t < dd.length; t++) if (dd[t] < dd[trough]) trough = t;
  let peak = trough;
  while (peak > 0 && dd[peak] < 0) peak--;
  let recovery: number | null = null;
  for (let t = trough; t < w.length; t++) {
    if (w[t] >= w[peak]) {
      recovery = t;
      break;
    }
  }
  // longest underwater spell
  let longest = 0;
  let runStart = -1;
  for (let t = 0; t < dd.length; t++) {
    if (dd[t] < 0) {
      if (runStart < 0) runStart = t;
      longest = Math.max(longest, t - runStart + 1);
    } else runStart = -1;
  }
  return {
    maxDrawdown: -dd[trough],
    peakIndex: peak,
    troughIndex: trough,
    recoveryIndex: recovery,
    durationPeriods: longest,
    currentDrawdown: -dd[dd.length - 1],
  };
}

export interface MetricsOptions {
  periodsPerYear: number;
  /** Annual risk-free rate (decimal). */
  riskFree?: number;
  /** Benchmark per-period returns aligned with `returns`. */
  benchmark?: ArrayLike<number>;
  /** Confidence level for VaR / CVaR. */
  confidence?: number;
}

export interface Metrics {
  periods: number;
  years: number;
  periodsPerYear: number;
  totalReturn: number;
  cagr: number;
  annualMean: number;
  volatility: number;
  downsideDeviation: number;
  sharpe: number;
  sortino: number;
  calmar: number;
  maxDrawdown: number;
  currentDrawdown: number;
  longestDrawdownPeriods: number;
  drawdownPeak: number;
  drawdownTrough: number;
  drawdownRecovery: number | null;
  ulcerIndex: number;
  varHistorical: number;
  cvarHistorical: number;
  varParametric: number;
  varCornishFisher: number;
  skewness: number;
  kurtosis: number;
  best: number;
  worst: number;
  winRate: number;
  omega: number;
  tailRatio: number;
  gainToPain: number;
  // benchmark-relative
  beta: number | null;
  alpha: number | null;
  correlation: number | null;
  rSquared: number | null;
  trackingError: number | null;
  informationRatio: number | null;
  treynor: number | null;
  upCapture: number | null;
  downCapture: number | null;
}

/** Per-period equivalent of an annual rate: (1+r)^(1/ppy) − 1. */
export const perPeriodRate = (annual: number, ppy: number): number => Math.pow(1 + annual, 1 / ppy) - 1;

export function cagrFromReturns(returns: ArrayLike<number>, ppy: number): number {
  const n = returns.length;
  if (n === 0) return NaN;
  let logSum = 0;
  for (let i = 0; i < n; i++) logSum += Math.log1p(returns[i]);
  return Math.expm1((logSum * ppy) / n);
}

export function annualizedVolatility(returns: ArrayLike<number>, ppy: number): number {
  return std(returns) * Math.sqrt(ppy);
}

export function sharpeRatio(returns: ArrayLike<number>, ppy: number, riskFree = 0): number {
  const rf = perPeriodRate(riskFree, ppy);
  const s = std(returns);
  return s > 0 ? ((mean(returns) - rf) / s) * Math.sqrt(ppy) : 0;
}

/** Cornish–Fisher z for skew S and excess kurtosis K. */
export function cornishFisherZ(z: number, S: number, K: number): number {
  return z + ((z * z - 1) * S) / 6 + ((z * z * z - 3 * z) * K) / 24 - ((2 * z * z * z - 5 * z) * S * S) / 36;
}

export function computeMetrics(returns: ArrayLike<number>, opts: MetricsOptions): Metrics {
  const ppy = opts.periodsPerYear;
  const n = returns.length;
  const conf = opts.confidence ?? 0.95;
  const rfAnnual = opts.riskFree ?? 0;
  const rf = perPeriodRate(rfAnnual, ppy);
  const r = Array.from(returns);
  const m = mean(r);
  const s = std(r);
  const sorted = sortedCopy(r);
  const q = quantileSorted(sorted, 1 - conf);
  const tail = sorted.filter((x) => x <= q);
  const S = skewness(r);
  const K = kurtosis(r);
  const z = normInv(1 - conf);

  let downsideSq = 0;
  let wins = 0;
  let gains = 0;
  let losses = 0;
  for (const x of r) {
    const d = Math.min(x - rf, 0);
    downsideSq += d * d;
    if (x > 0) {
      wins++;
      gains += x;
    } else losses -= x;
  }
  const downsideDeviation = n > 0 ? Math.sqrt(downsideSq / n) * Math.sqrt(ppy) : NaN;

  const dd = drawdownInfo(r);
  const wealth = wealthIndex(r);
  const ddSeries = drawdownSeries(wealth);
  const ulcer = Math.sqrt(ddSeries.reduce((acc, v) => acc + v * v, 0) / ddSeries.length);

  const cagr = cagrFromReturns(r, ppy);
  const vol = s * Math.sqrt(ppy);
  const annualMean = m * ppy;
  const excessAnnual = (m - rf) * ppy;

  const p95 = quantileSorted(sorted, 0.95);
  const p05 = quantileSorted(sorted, 0.05);

  let beta: number | null = null;
  let alpha: number | null = null;
  let corr: number | null = null;
  let rSquared: number | null = null;
  let te: number | null = null;
  let ir: number | null = null;
  let treynor: number | null = null;
  let upCapture: number | null = null;
  let downCapture: number | null = null;
  if (opts.benchmark && opts.benchmark.length === n && n > 2) {
    const b = Array.from(opts.benchmark);
    const vb = variance(b);
    const cov = covariance(r, b);
    beta = vb > 0 ? cov / vb : null;
    const mb = mean(b);
    alpha = beta !== null ? (m - rf - beta * (mb - rf)) * ppy : null;
    const sb = Math.sqrt(vb);
    corr = s > 0 && sb > 0 ? cov / (s * sb) : null;
    rSquared = corr !== null ? corr * corr : null;
    const active = r.map((x, i) => x - b[i]);
    const sa = std(active);
    te = sa * Math.sqrt(ppy);
    ir = sa > 0 ? (mean(active) * ppy) / te : null;
    treynor = beta && Math.abs(beta) > 1e-9 ? (cagr - rfAnnual) / beta : null;
    let upR = 0,
      upB = 0,
      upN = 0,
      dnR = 0,
      dnB = 0,
      dnN = 0;
    for (let i = 0; i < n; i++) {
      if (b[i] > 0) {
        upR += r[i];
        upB += b[i];
        upN++;
      } else if (b[i] < 0) {
        dnR += r[i];
        dnB += b[i];
        dnN++;
      }
    }
    upCapture = upN > 0 && upB !== 0 ? upR / upB : null;
    downCapture = dnN > 0 && dnB !== 0 ? dnR / dnB : null;
  }

  return {
    periods: n,
    years: n / ppy,
    periodsPerYear: ppy,
    totalReturn: wealth[wealth.length - 1] - 1,
    cagr,
    annualMean,
    volatility: vol,
    downsideDeviation,
    sharpe: s > 0 ? excessAnnual / vol : 0,
    sortino: downsideDeviation > 0 ? excessAnnual / downsideDeviation : 0,
    calmar: dd.maxDrawdown > 0 ? cagr / dd.maxDrawdown : 0,
    maxDrawdown: dd.maxDrawdown,
    currentDrawdown: dd.currentDrawdown,
    longestDrawdownPeriods: dd.durationPeriods,
    drawdownPeak: dd.peakIndex,
    drawdownTrough: dd.troughIndex,
    drawdownRecovery: dd.recoveryIndex,
    ulcerIndex: ulcer,
    varHistorical: -q,
    cvarHistorical: tail.length ? -mean(tail) : -q,
    varParametric: -(m + z * s),
    varCornishFisher: -(m + cornishFisherZ(z, Number.isFinite(S) ? S : 0, Number.isFinite(K) ? K : 0) * s),
    skewness: S,
    kurtosis: K,
    best: sorted[n - 1] ?? NaN,
    worst: sorted[0] ?? NaN,
    winRate: n > 0 ? wins / n : NaN,
    omega: losses > 0 ? gains / losses : Infinity,
    tailRatio: p05 !== 0 ? Math.abs(p95 / p05) : NaN,
    gainToPain: losses > 0 ? (gains - losses) / losses : Infinity,
    beta,
    alpha,
    correlation: corr,
    rSquared,
    trackingError: te,
    informationRatio: ir,
    treynor,
    upCapture,
    downCapture,
  };
}

/** Rolling statistic over a trailing window (NaN until the window fills). */
export function rolling(x: ArrayLike<number>, window: number, fn: (slice: number[]) => number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  const arr = Array.from(x);
  for (let t = window - 1; t < arr.length; t++) out[t] = fn(arr.slice(t - window + 1, t + 1));
  return out;
}

/** Fast rolling annualised volatility using running sums (O(T)). */
export function rollingVolatility(x: ArrayLike<number>, window: number, ppy: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  let s1 = 0;
  let s2 = 0;
  for (let t = 0; t < x.length; t++) {
    s1 += x[t];
    s2 += x[t] * x[t];
    if (t >= window) {
      s1 -= x[t - window];
      s2 -= x[t - window] * x[t - window];
    }
    if (t >= window - 1) {
      const v = (s2 - (s1 * s1) / window) / (window - 1);
      out[t] = Math.sqrt(Math.max(v, 0) * ppy);
    }
  }
  return out;
}

/** Rolling beta of x on benchmark b (O(T)). */
export function rollingBeta(x: ArrayLike<number>, b: ArrayLike<number>, window: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  let sx = 0,
    sb = 0,
    sxb = 0,
    sbb = 0;
  for (let t = 0; t < x.length; t++) {
    sx += x[t];
    sb += b[t];
    sxb += x[t] * b[t];
    sbb += b[t] * b[t];
    if (t >= window) {
      const o = t - window;
      sx -= x[o];
      sb -= b[o];
      sxb -= x[o] * b[o];
      sbb -= b[o] * b[o];
    }
    if (t >= window - 1) {
      const cov = sxb - (sx * sb) / window;
      const vb = sbb - (sb * sb) / window;
      out[t] = vb > 0 ? cov / vb : NaN;
    }
  }
  return out;
}

/** Rolling Sharpe ratio over a trailing window. */
export function rollingSharpe(x: ArrayLike<number>, window: number, ppy: number, riskFree = 0): number[] {
  const rf = perPeriodRate(riskFree, ppy);
  const out = new Array<number>(x.length).fill(NaN);
  let s1 = 0;
  let s2 = 0;
  for (let t = 0; t < x.length; t++) {
    s1 += x[t];
    s2 += x[t] * x[t];
    if (t >= window) {
      s1 -= x[t - window];
      s2 -= x[t - window] * x[t - window];
    }
    if (t >= window - 1) {
      const m = s1 / window;
      const v = (s2 - (s1 * s1) / window) / (window - 1);
      const sd = Math.sqrt(Math.max(v, 0));
      out[t] = sd > 0 ? ((m - rf) / sd) * Math.sqrt(ppy) : NaN;
    }
  }
  return out;
}
