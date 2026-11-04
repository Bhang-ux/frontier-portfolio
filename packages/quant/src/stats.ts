/**
 * Descriptive statistics, distributions and regression.
 */
import { choleskyRobust, solveLower, solveUpperFromLowerT, type Matrix, type Vector } from './linalg';

export function mean(x: ArrayLike<number>): number {
  const n = x.length;
  if (n === 0) return NaN;
  let s = 0;
  for (let i = 0; i < n; i++) s += x[i];
  return s / n;
}

/** Sample variance (ddof = 1 by default, matching pandas). */
export function variance(x: ArrayLike<number>, ddof = 1): number {
  const n = x.length;
  if (n - ddof <= 0) return NaN;
  const m = mean(x);
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = x[i] - m;
    s += d * d;
  }
  return s / (n - ddof);
}

export const std = (x: ArrayLike<number>, ddof = 1): number => Math.sqrt(variance(x, ddof));

export function covariance(x: ArrayLike<number>, y: ArrayLike<number>, ddof = 1): number {
  const n = Math.min(x.length, y.length);
  if (n - ddof <= 0) return NaN;
  const mx = mean(x);
  const my = mean(y);
  let s = 0;
  for (let i = 0; i < n; i++) s += (x[i] - mx) * (y[i] - my);
  return s / (n - ddof);
}

export function correlation(x: ArrayLike<number>, y: ArrayLike<number>): number {
  const sx = std(x);
  const sy = std(y);
  if (!(sx > 0) || !(sy > 0)) return 0;
  return covariance(x, y) / (sx * sy);
}

/** Bias-corrected sample skewness (adjusted Fisher–Pearson G1, as pandas). */
export function skewness(x: ArrayLike<number>): number {
  const n = x.length;
  if (n < 3) return NaN;
  const m = mean(x);
  let m2 = 0;
  let m3 = 0;
  for (let i = 0; i < n; i++) {
    const d = x[i] - m;
    m2 += d * d;
    m3 += d * d * d;
  }
  m2 /= n;
  m3 /= n;
  if (m2 === 0) return 0;
  const g1 = m3 / Math.pow(m2, 1.5);
  return (Math.sqrt(n * (n - 1)) / (n - 2)) * g1;
}

/** Bias-corrected excess kurtosis (G2, as pandas). Normal ⇒ 0. */
export function kurtosis(x: ArrayLike<number>): number {
  const n = x.length;
  if (n < 4) return NaN;
  const m = mean(x);
  let m2 = 0;
  let m4 = 0;
  for (let i = 0; i < n; i++) {
    const d = x[i] - m;
    const d2 = d * d;
    m2 += d2;
    m4 += d2 * d2;
  }
  m2 /= n;
  m4 /= n;
  if (m2 === 0) return 0;
  const g2 = m4 / (m2 * m2) - 3;
  return ((n - 1) / ((n - 2) * (n - 3))) * ((n + 1) * g2 + 6);
}

export function sortedCopy(x: ArrayLike<number>): number[] {
  return Array.from(x).sort((a, b) => a - b);
}

/** Quantile with linear interpolation (numpy "linear" / Hyndman–Fan type 7). */
export function quantileSorted(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (p <= 0) return sorted[0];
  if (p >= 1) return sorted[n - 1];
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, n - 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export const quantile = (x: ArrayLike<number>, p: number): number => quantileSorted(sortedCopy(x), p);
export const median = (x: ArrayLike<number>): number => quantile(x, 0.5);

/** Fraction of values strictly below v plus half the ties — a mid-rank percentile in [0,1]. */
export function percentileRank(values: ArrayLike<number>, v: number): number {
  const n = values.length;
  if (n === 0) return NaN;
  let below = 0;
  let equal = 0;
  for (let i = 0; i < n; i++) {
    if (values[i] < v) below++;
    else if (values[i] === v) equal++;
  }
  return (below + 0.5 * equal) / n;
}

// ---------------------------------------------------------------------------
// Normal distribution
// ---------------------------------------------------------------------------

const SQRT2PI = Math.sqrt(2 * Math.PI);

export const normPdf = (x: number): number => Math.exp(-0.5 * x * x) / SQRT2PI;

/** Standard normal CDF — Abramowitz & Stegun 26.2.17 (|ε| < 7.5e-8). */
export function normCdf(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * ax);
  const poly =
    t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const tail = normPdf(ax) * poly;
  return x >= 0 ? 1 - tail : tail;
}

/** Inverse standard normal CDF — Acklam's rational approximation (rel. ε ≈ 1.15e-9). */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1,
    2.506628277459239,
  ];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number;
  let r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

// ---------------------------------------------------------------------------
// Matrices of observations
// ---------------------------------------------------------------------------

/** Column means of a T×n observation matrix. */
export function columnMeans(X: Matrix): Vector {
  const T = X.length;
  const n = X[0]?.length ?? 0;
  const m = new Array<number>(n).fill(0);
  for (let t = 0; t < T; t++) for (let j = 0; j < n; j++) m[j] += X[t][j];
  return m.map((v) => v / T);
}

export function column(X: Matrix, j: number): Vector {
  return X.map((row) => row[j]);
}

// ---------------------------------------------------------------------------
// Ordinary least squares
// ---------------------------------------------------------------------------

export interface RegressionResult {
  /** Coefficients; index 0 is the intercept when `intercept` is true. */
  coef: Vector;
  stdErr: Vector;
  tStat: Vector;
  rSquared: number;
  adjRSquared: number;
  residualStd: number;
  residuals: Vector;
  n: number;
  k: number;
}

/**
 * OLS via the normal equations with a Cholesky solve. Regressors are columns of X (T×k).
 */
export function ols(y: Vector, X: Matrix, opts: { intercept?: boolean; ridge?: number } = {}): RegressionResult {
  const intercept = opts.intercept ?? true;
  const T = y.length;
  const Z = intercept ? X.map((row) => [1, ...row]) : X;
  const k = Z[0]?.length ?? 0;
  const XtX: Matrix = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const Xty = new Array<number>(k).fill(0);
  for (let t = 0; t < T; t++) {
    const z = Z[t];
    for (let i = 0; i < k; i++) {
      Xty[i] += z[i] * y[t];
      for (let j = 0; j <= i; j++) XtX[i][j] += z[i] * z[j];
    }
  }
  for (let i = 0; i < k; i++) for (let j = 0; j < i; j++) XtX[j][i] = XtX[i][j];
  // Optional ridge; exact collinearity is otherwise handled by choleskyRobust's jitter.
  const ridge = opts.ridge ?? 0;
  for (let i = 0; i < k; i++) XtX[i][i] += ridge;
  const { L } = choleskyRobust(XtX);
  const coef = solveUpperFromLowerT(L, solveLower(L, Xty));
  const residuals = y.map((yt, t) => yt - Z[t].reduce((s, z, i) => s + z * coef[i], 0));
  const ssr = residuals.reduce((s, e) => s + e * e, 0);
  const my = mean(y);
  const sst = y.reduce((s, v) => s + (v - my) * (v - my), 0);
  const dof = Math.max(T - k, 1);
  const sigma2 = ssr / dof;
  // diag((XᵀX)⁻¹) by solving for unit vectors
  const stdErr = new Array<number>(k);
  for (let i = 0; i < k; i++) {
    const e = new Array<number>(k).fill(0);
    e[i] = 1;
    const col = solveUpperFromLowerT(L, solveLower(L, e));
    stdErr[i] = Math.sqrt(Math.max(sigma2 * col[i], 0));
  }
  const rSquared = sst > 0 ? 1 - ssr / sst : 0;
  const pReg = intercept ? k - 1 : k;
  const adjRSquared = T - pReg - 1 > 0 ? 1 - ((1 - rSquared) * (T - 1)) / (T - pReg - 1) : rSquared;
  return {
    coef,
    stdErr,
    tStat: coef.map((c, i) => (stdErr[i] > 0 ? c / stdErr[i] : 0)),
    rSquared,
    adjRSquared,
    residualStd: Math.sqrt(sigma2),
    residuals,
    n: T,
    k,
  };
}

/** Histogram with `bins` equal-width bins over [min, max]. */
export function histogram(
  x: ArrayLike<number>,
  bins: number,
  range?: [number, number],
): { edges: number[]; counts: number[] } {
  const arr = Array.from(x).filter(Number.isFinite);
  const lo = range?.[0] ?? Math.min(...arr);
  const hi = range?.[1] ?? Math.max(...arr);
  const width = (hi - lo) / bins || 1;
  const counts = new Array<number>(bins).fill(0);
  for (const v of arr) {
    if (v < lo || v > hi) continue;
    let b = Math.floor((v - lo) / width);
    if (b >= bins) b = bins - 1;
    if (b < 0) b = 0;
    counts[b]++;
  }
  const edges = Array.from({ length: bins + 1 }, (_, i) => lo + i * width);
  return { edges, counts };
}

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
