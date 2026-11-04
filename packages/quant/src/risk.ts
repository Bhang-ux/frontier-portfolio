/**
 * Portfolio risk decomposition: where does the risk actually come from?
 *
 * The single most useful insight for a beginner is that *money weight ≠ risk
 * weight*: a 10 % position in a volatile, highly-correlated stock can be 30 %
 * of the portfolio's risk. Euler's theorem makes this exact: σₚ = Σ wᵢ·∂σₚ/∂wᵢ.
 */
import { eigenSymmetric, matVec, quadForm, type Matrix, type Vector } from './linalg';
import { covToCorr } from './covariance';

export interface RiskDecomposition {
  volatility: number;
  /** ∂σ/∂wᵢ */
  marginal: Vector;
  /** wᵢ · ∂σ/∂wᵢ — sums to σ */
  component: Vector;
  /** component / σ — sums to 1 */
  percent: Vector;
}

export function riskContributions(w: Vector, cov: Matrix): RiskDecomposition {
  const Sw = matVec(cov, w);
  const variance = w.reduce((s, wi, i) => s + wi * Sw[i], 0);
  const vol = Math.sqrt(Math.max(variance, 0));
  const marginal = Sw.map((v) => (vol > 0 ? v / vol : 0));
  const component = marginal.map((m, i) => m * w[i]);
  const percent = component.map((c) => (vol > 0 ? c / vol : 0));
  return { volatility: vol, marginal, component, percent };
}

export const portfolioVolatility = (w: Vector, cov: Matrix): number =>
  Math.sqrt(Math.max(quadForm(w, cov), 0));
export const portfolioReturn = (w: Vector, mu: Vector): number => w.reduce((s, wi, i) => s + wi * mu[i], 0);

/** Diversification ratio (Choueifaty & Coignard 2008): Σwᵢσᵢ / σₚ ≥ 1. */
export function diversificationRatio(w: Vector, cov: Matrix): number {
  const vol = portfolioVolatility(w, cov);
  const weighted = w.reduce((s, wi, i) => s + wi * Math.sqrt(Math.max(cov[i][i], 0)), 0);
  return vol > 0 ? weighted / vol : 1;
}

/** Effective number of holdings 1/Σw² (inverse Herfindahl index). */
export function effectiveN(w: Vector): number {
  const h = w.reduce((s, x) => s + x * x, 0);
  return h > 0 ? 1 / h : 0;
}

export interface PrincipalComponents {
  /** Eigenvalues of the (annualised) covariance, descending. */
  variances: Vector;
  explained: Vector;
  /** loadings[i][k] — asset i's loading on component k. */
  loadings: Matrix;
}

export function principalComponents(cov: Matrix, useCorrelation = false): PrincipalComponents {
  const M = useCorrelation ? covToCorr(cov).corr : cov;
  const { values, vectors } = eigenSymmetric(M);
  const clipped = values.map((v) => Math.max(v, 0));
  const total = clipped.reduce((a, b) => a + b, 0) || 1;
  return { variances: clipped, explained: clipped.map((v) => v / total), loadings: vectors };
}

/**
 * Effective Number of Bets (Meucci 2009): exponential entropy of the risk
 * contributions of uncorrelated principal portfolios. 1 ⇒ one hidden bet
 * drives everything; n ⇒ perfectly diversified across n independent bets.
 */
export function effectiveNumberOfBets(w: Vector, cov: Matrix): { enb: number; contributions: Vector } {
  const { values, vectors } = eigenSymmetric(cov);
  const n = w.length;
  const exposures = new Array<number>(n).fill(0);
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += vectors[i][k] * w[i];
    exposures[k] = s;
  }
  const raw = exposures.map((e, k) => e * e * Math.max(values[k], 0));
  const total = raw.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return { enb: 1, contributions: raw };
  const p = raw.map((r) => r / total);
  const entropy = -p.reduce((s, pk) => (pk > 0 ? s + pk * Math.log(pk) : s), 0);
  return { enb: Math.exp(entropy), contributions: p };
}

/** Average pairwise correlation among held assets (weighted by wᵢwⱼ). */
export function averageCorrelation(w: Vector, cov: Matrix): number {
  const { corr } = covToCorr(cov);
  let num = 0;
  let den = 0;
  for (let i = 0; i < w.length; i++) {
    for (let j = i + 1; j < w.length; j++) {
      const ww = w[i] * w[j];
      num += ww * corr[i][j];
      den += ww;
    }
  }
  return den > 0 ? num / den : 0;
}
