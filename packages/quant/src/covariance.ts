/**
 * Covariance estimation.
 *
 * Mean–variance optimisers are notorious "error maximisers" (Michaud, 1989):
 * they over-allocate to assets whose risk is *under*-estimated. The sample
 * covariance has O(n²) parameters estimated from T observations, so with
 * 20 assets and 3 years of daily data it is noisy enough to swing weights
 * wildly. Frontier therefore defaults to Ledoit–Wolf shrinkage and offers
 * EWMA and random-matrix-theory denoising as alternatives.
 */
import {
  cholesky,
  eigenSymmetric,
  fromEigen,
  nearestPSD,
  zerosMatrix,
  type Matrix,
  type Vector,
} from './linalg';
import { columnMeans } from './stats';

export type CovarianceMethod = 'sample' | 'ledoit-wolf' | 'ledoit-wolf-identity' | 'ewma' | 'denoised';

/** Sample covariance of a T×n return matrix. ddof=1 (unbiased) by default. */
export function sampleCovariance(X: Matrix, ddof = 1): Matrix {
  const T = X.length;
  const n = X[0]?.length ?? 0;
  const m = columnMeans(X);
  const S = zerosMatrix(n, n);
  for (let t = 0; t < T; t++) {
    const row = X[t];
    for (let i = 0; i < n; i++) {
      const di = row[i] - m[i];
      const Si = S[i];
      for (let j = 0; j <= i; j++) Si[j] += di * (row[j] - m[j]);
    }
  }
  const denom = Math.max(T - ddof, 1);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      S[i][j] /= denom;
      S[j][i] = S[i][j];
    }
  }
  return S;
}

/**
 * Exponentially-weighted covariance (RiskMetrics). λ = 0.94 for daily data
 * gives a half-life of ~11 days — reactive to regime changes, at the cost of
 * higher estimation noise.
 */
export function ewmaCovariance(X: Matrix, lambda = 0.94): Matrix {
  const T = X.length;
  const n = X[0]?.length ?? 0;
  const w = new Array<number>(T);
  let wsum = 0;
  for (let t = 0; t < T; t++) {
    w[t] = Math.pow(lambda, T - 1 - t);
    wsum += w[t];
  }
  const m = new Array<number>(n).fill(0);
  for (let t = 0; t < T; t++) for (let i = 0; i < n; i++) m[i] += (w[t] / wsum) * X[t][i];
  const S = zerosMatrix(n, n);
  for (let t = 0; t < T; t++) {
    const wt = w[t] / wsum;
    const row = X[t];
    for (let i = 0; i < n; i++) {
      const di = row[i] - m[i];
      for (let j = 0; j <= i; j++) S[i][j] += wt * di * (row[j] - m[j]);
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) S[j][i] = S[i][j];
  return S;
}

export interface ShrinkageResult {
  cov: Matrix;
  shrinkage: number;
}

/**
 * Ledoit & Wolf (2004a), "A well-conditioned estimator for large-dimensional
 * covariance matrices": shrink towards μ·I. Implementation mirrors
 * scikit-learn's `ledoit_wolf` exactly (ddof = 0), verified by golden tests.
 */
export function ledoitWolfIdentity(X: Matrix): ShrinkageResult {
  const T = X.length;
  const n = X[0]?.length ?? 0;
  if (n <= 1) return { cov: sampleCovariance(X, 0), shrinkage: 0 };
  const m = columnMeans(X);
  const Xc = X.map((row) => row.map((v, j) => v - m[j]));
  const S = zerosMatrix(n, n); // XᵀX / T
  const X2tX2 = zerosMatrix(n, n);
  for (let t = 0; t < T; t++) {
    const row = Xc[t];
    for (let i = 0; i < n; i++) {
      const xi = row[i];
      const xi2 = xi * xi;
      for (let j = 0; j <= i; j++) {
        S[i][j] += xi * row[j];
        X2tX2[i][j] += xi2 * row[j] * row[j];
      }
    }
  }
  let traceS = 0;
  let deltaRaw = 0; // Σ_ij (XᵀX)²_ij / T²
  let betaRaw = 0; // Σ_ij (X²ᵀX²)_ij
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      S[i][j] /= T;
      S[j][i] = S[i][j];
      const mult = i === j ? 1 : 2;
      deltaRaw += mult * S[i][j] * S[i][j];
      betaRaw += mult * X2tX2[i][j];
    }
    traceS += S[i][i];
  }
  const mu = traceS / n;
  let beta = (1 / (n * T)) * (betaRaw / T - deltaRaw);
  const delta = (deltaRaw - 2 * mu * traceS + n * mu * mu) / n;
  beta = Math.min(beta, delta);
  const shrinkage = beta === 0 || delta === 0 ? 0 : beta / delta;
  const cov = S.map((row, i) => row.map((v, j) => (1 - shrinkage) * v + (i === j ? shrinkage * mu : 0)));
  return { cov, shrinkage };
}

/**
 * Ledoit & Wolf (2004b), "Honey, I shrunk the sample covariance matrix":
 * shrink towards the constant-correlation model, which preserves each asset's
 * own variance and replaces every pairwise correlation by the average one.
 * Mirrors PyPortfolioOpt's `CovarianceShrinkage.ledoit_wolf("constant_correlation")`.
 */
export function ledoitWolfConstantCorrelation(X: Matrix): ShrinkageResult {
  const T = X.length;
  const n = X[0]?.length ?? 0;
  const S = sampleCovariance(X, 1);
  if (n <= 1 || T < 3) return { cov: S, shrinkage: 0 };
  const varr = S.map((row, i) => row[i]);
  const sd = varr.map(Math.sqrt);
  let corrSum = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) corrSum += S[i][j] / (sd[i] * sd[j]);
  const rBar = (corrSum - n) / (n * (n - 1));
  const F = zerosMatrix(n, n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) F[i][j] = i === j ? varr[i] : rBar * sd[i] * sd[j];

  const m = columnMeans(X);
  const Xm = X.map((row) => row.map((v, j) => v - m[j]));
  // Accumulate the needed cross-moments in one pass.
  const y2 = zerosMatrix(n, n); // Σ_t x_i² x_j²
  const xx = zerosMatrix(n, n); // Σ_t x_i x_j
  const x3x = zerosMatrix(n, n); // Σ_t x_i³ x_j
  for (let t = 0; t < T; t++) {
    const row = Xm[t];
    for (let i = 0; i < n; i++) {
      const xi = row[i];
      const xi2 = xi * xi;
      const xi3 = xi2 * xi;
      for (let j = 0; j < n; j++) {
        const xj = row[j];
        y2[i][j] += xi2 * xj * xj;
        xx[i][j] += xi * xj;
        x3x[i][j] += xi3 * xj;
      }
    }
  }
  let piHat = 0;
  let piDiag = 0;
  const help = xx.map((row) => row.map((v) => v / T));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const pij = y2[i][j] / T - (2 * xx[i][j] * S[i][j]) / T + S[i][j] * S[i][j];
      piHat += pij;
      if (i === j) piDiag += pij;
    }
  }
  let thetaSum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const theta = x3x[i][j] / T - help[i][i] * S[i][j] - help[i][j] * varr[i] + varr[i] * S[i][j];
      thetaSum += (sd[j] / sd[i]) * theta;
    }
  }
  const rhoHat = piDiag + rBar * thetaSum;
  let gammaHat = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) gammaHat += (S[i][j] - F[i][j]) ** 2;
  const kappa = gammaHat > 0 ? (piHat - rhoHat) / gammaHat : 0;
  const shrinkage = Math.max(0, Math.min(1, kappa / T));
  const cov = S.map((row, i) => row.map((v, j) => shrinkage * F[i][j] + (1 - shrinkage) * v));
  return { cov, shrinkage };
}

export function covToCorr(cov: Matrix): { corr: Matrix; std: Vector } {
  const sd = cov.map((row, i) => Math.sqrt(Math.max(row[i], 0)));
  const corr = cov.map((row, i) =>
    row.map((v, j) =>
      i === j ? 1 : sd[i] > 0 && sd[j] > 0 ? Math.max(-1, Math.min(1, v / (sd[i] * sd[j]))) : 0,
    ),
  );
  return { corr, std: sd };
}

export function corrToCov(corr: Matrix, sd: Vector): Matrix {
  return corr.map((row, i) => row.map((v, j) => v * sd[i] * sd[j]));
}

/**
 * Random-matrix-theory denoising (Laloux et al. 1999; López de Prado 2020).
 * Eigenvalues of the correlation matrix that fall inside the Marchenko–Pastur
 * band are statistically indistinguishable from noise; we replace them with
 * their average (preserving the trace) and keep the "signal" eigenvalues.
 */
export function denoiseCorrelation(
  corr: Matrix,
  T: number,
): { corr: Matrix; signalFactors: number; lambdaMax: number } {
  const n = corr.length;
  const { values, vectors } = eigenSymmetric(corr);
  const q = T / n;
  const sigma2 = Math.max(1 - values[0] / n, 1e-6); // variance not explained by the market mode
  const lambdaMax = sigma2 * (1 + Math.sqrt(1 / q)) ** 2;
  let k = values.findIndex((v) => v <= lambdaMax);
  if (k < 0) k = n;
  k = Math.max(k, 1);
  const noise = values.slice(k);
  const avg = noise.length ? noise.reduce((a, b) => a + b, 0) / noise.length : 0;
  const cleaned = values.map((v, i) => (i < k ? v : avg));
  const C = fromEigen(cleaned, vectors);
  const d = C.map((row, i) => Math.sqrt(row[i]));
  const out = C.map((row, i) => row.map((v, j) => (i === j ? 1 : v / (d[i] * d[j]))));
  return { corr: out, signalFactors: k, lambdaMax };
}

export interface CovarianceEstimate {
  /** Annualised covariance matrix. */
  cov: Matrix;
  method: CovarianceMethod;
  shrinkage?: number;
  signalFactors?: number;
}

/**
 * One entry point for the UI/worker: estimate an *annualised* covariance from
 * per-period returns with the chosen method, repaired to be PSD.
 */
export function estimateCovariance(
  X: Matrix,
  periodsPerYear: number,
  method: CovarianceMethod = 'ledoit-wolf',
  opts: { lambda?: number } = {},
): CovarianceEstimate {
  let cov: Matrix;
  let shrinkage: number | undefined;
  let signalFactors: number | undefined;
  switch (method) {
    case 'sample':
      cov = sampleCovariance(X);
      break;
    case 'ledoit-wolf-identity': {
      const r = ledoitWolfIdentity(X);
      cov = r.cov;
      shrinkage = r.shrinkage;
      break;
    }
    case 'ewma':
      cov = ewmaCovariance(X, opts.lambda ?? 0.94);
      break;
    case 'denoised': {
      const S = sampleCovariance(X);
      const { corr, std } = covToCorr(S);
      const dn = denoiseCorrelation(corr, X.length);
      cov = corrToCov(dn.corr, std);
      signalFactors = dn.signalFactors;
      break;
    }
    case 'ledoit-wolf':
    default: {
      const r = ledoitWolfConstantCorrelation(X);
      cov = r.cov;
      shrinkage = r.shrinkage;
      break;
    }
  }
  const annual = cov.map((row) => row.map((v) => v * periodsPerYear));
  // Only pay for an eigen-repair when the estimate is not numerically PD.
  const repaired = cholesky(annual) ? annual : nearestPSD(annual, 1e-10);
  return { cov: repaired, method, shrinkage, signalFactors };
}
