/**
 * Expected-return estimation and the Black–Litterman model.
 *
 * Expected returns are the single most error-prone optimiser input — a
 * 1 %/yr error in μ moves weights far more than a 1 % error in σ (Chopra &
 * Ziemba 1993). Frontier therefore offers *shrunk* estimators and an
 * equilibrium/Bayesian route (Black–Litterman) in addition to raw history.
 */
import { invertSPD, matVec, quadForm, solveSPD, type Matrix, type Vector } from './linalg';
import { columnMeans, covariance, variance, mean } from './stats';
import { sampleCovariance } from './covariance';

export type ReturnModel = 'historical' | 'geometric' | 'ewma' | 'capm' | 'shrunk' | 'equilibrium';

/** Annualised arithmetic mean of each column. */
export function historicalMean(X: Matrix, ppy: number): Vector {
  return columnMeans(X).map((m) => m * ppy);
}

/** Annualised geometric (compound) return of each column. */
export function geometricMean(X: Matrix, ppy: number): Vector {
  const T = X.length;
  const n = X[0]?.length ?? 0;
  const out = new Array<number>(n).fill(0);
  for (let t = 0; t < T; t++) for (let j = 0; j < n; j++) out[j] += Math.log1p(X[t][j]);
  return out.map((s) => Math.expm1((s * ppy) / T));
}

/** Exponentially-weighted mean with the given half-life (in periods). */
export function ewmaMean(X: Matrix, ppy: number, halfLife = 252): Vector {
  const T = X.length;
  const n = X[0]?.length ?? 0;
  const lambda = Math.pow(0.5, 1 / halfLife);
  const out = new Array<number>(n).fill(0);
  let wsum = 0;
  for (let t = 0; t < T; t++) {
    const w = Math.pow(lambda, T - 1 - t);
    wsum += w;
    for (let j = 0; j < n; j++) out[j] += w * X[t][j];
  }
  return out.map((s) => (s / wsum) * ppy);
}

/**
 * CAPM-implied returns: rf + βᵢ·(E[Rm] − rf). Uses the benchmark's realised
 * excess return unless a forward-looking market premium is supplied.
 */
export function capmReturns(
  X: Matrix,
  market: Vector,
  ppy: number,
  riskFree: number,
  marketPremium?: number,
): Vector {
  const n = X[0]?.length ?? 0;
  const vm = variance(market);
  const premium = marketPremium ?? mean(market) * ppy - riskFree;
  const out: Vector = [];
  for (let j = 0; j < n; j++) {
    const col = X.map((r) => r[j]);
    const beta = vm > 0 ? covariance(col, market) / vm : 1;
    out.push(riskFree + beta * premium);
  }
  return out;
}

/**
 * Bayes–Stein shrinkage (Jorion 1986): pull each sample mean towards the
 * return of the global-minimum-variance portfolio. The shrinkage intensity
 * grows with estimation noise (short samples, many assets).
 */
export function bayesSteinMean(X: Matrix, ppy: number): { mu: Vector; shrinkage: number; target: number } {
  const T = X.length;
  const n = X[0]?.length ?? 0;
  const m = columnMeans(X);
  const S = sampleCovariance(X);
  const ones = new Array<number>(n).fill(1);
  const Sinv1 = solveSPD(S, ones);
  const denom = Sinv1.reduce((a, b) => a + b, 0);
  const mu0 = Sinv1.reduce((a, v, i) => a + v * m[i], 0) / denom;
  const d = m.map((v) => v - mu0);
  const Sinvd = solveSPD(S, d);
  const q = d.reduce((a, v, i) => a + v * Sinvd[i], 0);
  const w = (n + 2) / (n + 2 + T * q);
  const shrinkage = Math.max(0, Math.min(1, w));
  return {
    mu: m.map((v) => ((1 - shrinkage) * v + shrinkage * mu0) * ppy),
    shrinkage,
    target: mu0 * ppy,
  };
}

/** Reverse optimisation: equilibrium excess returns implied by reference weights, π = δΣw. */
export function impliedReturns(cov: Matrix, weights: Vector, riskAversion = 2.5): Vector {
  return matVec(cov, weights).map((v) => riskAversion * v);
}

/** Market-implied risk aversion δ = (E[Rm] − rf) / σm². */
export function impliedRiskAversion(marketReturns: Vector, ppy: number, riskFree: number): number {
  const excess = mean(marketReturns) * ppy - riskFree;
  const v = variance(marketReturns) * ppy;
  return v > 0 ? Math.max(excess / v, 0.5) : 2.5;
}

// ---------------------------------------------------------------------------
// Black–Litterman
// ---------------------------------------------------------------------------

export interface View {
  /** Pick vector over assets: absolute view = one 1; relative view = +1 / −1. */
  pick: Vector;
  /** Expected (annual) return of the view portfolio, e.g. 0.02 = "outperforms by 2 %". */
  value: number;
  /** Idzorek confidence in (0, 1]; omitted ⇒ He–Litterman default Ω. */
  confidence?: number;
}

export interface BlackLittermanInput {
  cov: Matrix; // annualised Σ
  prior: Vector; // equilibrium (excess) returns π
  views: View[];
  tau?: number;
}

export interface BlackLittermanResult {
  posteriorReturns: Vector;
  posteriorCov: Matrix;
  omega: Vector; // diagonal of Ω
  tau: number;
}

/**
 * Posterior returns μ_BL = π + τΣPᵀ(PτΣPᵀ + Ω)⁻¹(Q − Pπ) — the numerically
 * stable "update" form that stays well-defined as Ω → 0 (100 % confidence).
 * Ω is either He & Litterman's diag(P τΣ Pᵀ) or Idzorek's confidence-scaled
 * version via Walters' closed form α = (1−c)/c.
 */
export function blackLitterman({ cov, prior, views, tau = 0.05 }: BlackLittermanInput): BlackLittermanResult {
  const n = cov.length;
  if (views.length === 0) {
    return { posteriorReturns: prior.slice(), posteriorCov: cov.map((r) => r.slice()), omega: [], tau };
  }
  const k = views.length;
  const P = views.map((v) => v.pick);
  const Q = views.map((v) => v.value);
  const tauSigma = cov.map((row) => row.map((v) => v * tau));
  // τΣPᵀ : n×k
  const tSPt: Matrix = Array.from({ length: n }, (_, i) =>
    P.map((p) => p.reduce((s, pj, j) => s + tauSigma[i][j] * pj, 0)),
  );
  const omega = views.map((v, idx) => {
    const base = quadForm(P[idx], tauSigma); // p τΣ pᵀ
    if (v.confidence === undefined) return base;
    const c = Math.min(Math.max(v.confidence, 1e-6), 1);
    if (c >= 1) return 1e-12 * Math.max(base, 1e-12);
    return ((1 - c) / c) * base;
  });
  // A = P τΣ Pᵀ + Ω : k×k
  const A: Matrix = Array.from({ length: k }, (_, a) =>
    Array.from(
      { length: k },
      (_, b) => P[a].reduce((s, pa, i) => s + pa * tSPt[i][b], 0) + (a === b ? omega[a] : 0),
    ),
  );
  const resid = Q.map((q, a) => q - P[a].reduce((s, p, i) => s + p * prior[i], 0));
  const sol = solveSPD(A, resid);
  const posteriorReturns = prior.map((p, i) => p + tSPt[i].reduce((s, v, a) => s + v * sol[a], 0));
  // M = τΣ − τΣPᵀ A⁻¹ PτΣ ; Σ_post = Σ + M
  const Ainv = invertSPD(A);
  const posteriorCov: Matrix = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      let s = 0;
      for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) s += tSPt[i][a] * Ainv[a][b] * tSPt[j][b];
      return cov[i][j] + tauSigma[i][j] - s;
    }),
  );
  return { posteriorReturns, posteriorCov, omega, tau };
}
