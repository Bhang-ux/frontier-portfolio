/**
 * Factor exposure analysis: regress portfolio excess returns on factor
 * returns built from liquid ETF long/short spreads (e.g. size = small caps
 * minus large caps). Exposures tell a beginner *why* a portfolio behaves the
 * way it does: "you are really making one big bet on growth stocks".
 */
import { ols } from './stats';
import { perPeriodRate } from './metrics';

export interface FactorSeries {
  key: string;
  label: string;
  returns: number[];
}

export interface FactorExposure {
  key: string;
  label: string;
  beta: number;
  stdErr: number;
  tStat: number;
  significant: boolean;
  /** Share of the portfolio's variance explained by this factor (Euler split of R²). */
  varianceShare: number;
}

export interface FactorModelResult {
  alphaAnnual: number;
  alphaTStat: number;
  rSquared: number;
  exposures: FactorExposure[];
  residualVolAnnual: number;
  observations: number;
}

export function factorRegression(
  portfolio: number[],
  factors: FactorSeries[],
  opts: { periodsPerYear: number; riskFree?: number; excessFactorKeys?: string[] },
): FactorModelResult {
  const T = portfolio.length;
  const rf = perPeriodRate(opts.riskFree ?? 0, opts.periodsPerYear);
  const y = portfolio.map((r) => r - rf);
  const excessKeys = new Set(opts.excessFactorKeys ?? []);
  const X = Array.from({ length: T }, (_, t) => factors.map((f) => f.returns[t] - (excessKeys.has(f.key) ? rf : 0)));
  const fit = ols(y, X, { intercept: true });
  const betas = fit.coef.slice(1);
  // Euler variance split: share_k = β_k · cov(f_k, Σ_j β_j f_j) / var(y)
  const fitted = X.map((row) => row.reduce((s, x, k) => s + x * betas[k], 0));
  const meanFit = fitted.reduce((a, b) => a + b, 0) / T;
  const meanY = y.reduce((a, b) => a + b, 0) / T;
  const varY = y.reduce((s, v) => s + (v - meanY) ** 2, 0) / (T - 1);
  const exposures: FactorExposure[] = factors.map((f, k) => {
    const col = X.map((row) => row[k]);
    const mc = col.reduce((a, b) => a + b, 0) / T;
    let cov = 0;
    for (let t = 0; t < T; t++) cov += (col[t] - mc) * (fitted[t] - meanFit);
    cov /= T - 1;
    const tStat = fit.tStat[k + 1];
    return {
      key: f.key,
      label: f.label,
      beta: betas[k],
      stdErr: fit.stdErr[k + 1],
      tStat,
      significant: Math.abs(tStat) >= 2,
      varianceShare: varY > 0 ? (betas[k] * cov) / varY : 0,
    };
  });
  return {
    alphaAnnual: fit.coef[0] * opts.periodsPerYear,
    alphaTStat: fit.tStat[0],
    rSquared: fit.rSquared,
    exposures,
    residualVolAnnual: fit.residualStd * Math.sqrt(opts.periodsPerYear),
    observations: T,
  };
}

/** Simple single-factor beta (used for hypothetical shocks). */
export function simpleBeta(asset: number[], driver: number[]): { beta: number; r2: number } {
  const fit = ols(asset, driver.map((d) => [d]));
  return { beta: fit.coef[1], r2: fit.rSquared };
}
