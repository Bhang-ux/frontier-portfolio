/**
 * Golden tests: the TypeScript engine must reproduce independent Python
 * reference implementations (scikit-learn, PyPortfolioOpt, CVXPY/Clarabel,
 * HiGHS, SciPy) on identical inputs. Regenerate fixtures with
 * `python tools/reference/generate_fixtures.py`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  blackLitterman,
  computeMetrics,
  eigenSymmetric,
  hierarchicalRiskParity,
  ledoitWolfConstantCorrelation,
  ledoitWolfIdentity,
  normCdf,
  normInv,
  ols,
  optimize,
  quadForm,
  sampleCovariance,
  diversificationRatio,
  type Matrix,
} from '../src';

const G = JSON.parse(readFileSync(new URL('./fixtures/golden.json', import.meta.url), 'utf8'));
const X: Matrix = G.returns;
const { mu, cov } = G.optimizer as { mu: number[]; cov: Matrix };
const ub = new Array(G.meta.n).fill(G.meta.ub);
const rf = G.meta.rf;

const maxAbsDiff = (a: number[] | Matrix, b: number[] | Matrix): number => {
  const fa = (a as unknown[]).flat(2) as number[];
  const fb = (b as unknown[]).flat(2) as number[];
  return fa.reduce((m, v, i) => Math.max(m, Math.abs(v - fb[i])), 0);
};
const vol = (w: number[]) => Math.sqrt(quadForm(w, cov));
const ret = (w: number[]) => w.reduce((s, x, i) => s + x * mu[i], 0);
const sharpe = (w: number[]) => (ret(w) - rf) / vol(w);
const histCvar = (w: number[], alpha: number) => {
  const losses = X.map((r) => -r.reduce((s, x, i) => s + x * w[i], 0)).sort((a, b) => a - b);
  const h = (losses.length - 1) * alpha;
  const q = losses[Math.floor(h)] + (h - Math.floor(h)) * (losses[Math.ceil(h)] - losses[Math.floor(h)]);
  const tail = losses.filter((l) => l >= q);
  return tail.reduce((a, b) => a + b, 0) / tail.length;
};

describe('covariance estimators vs Python', () => {
  it('sample covariance matches numpy.cov', () => {
    expect(maxAbsDiff(sampleCovariance(X), G.covariance.sample)).toBeLessThan(1e-15);
  });
  it('Ledoit–Wolf (identity target) matches scikit-learn exactly', () => {
    const r = ledoitWolfIdentity(X);
    expect(r.shrinkage).toBeCloseTo(G.covariance.ledoitWolfIdentity.shrinkage, 12);
    expect(maxAbsDiff(r.cov, G.covariance.ledoitWolfIdentity.cov)).toBeLessThan(1e-15);
  });
  it('Ledoit–Wolf (constant correlation) matches PyPortfolioOpt exactly', () => {
    const r = ledoitWolfConstantCorrelation(X);
    expect(r.shrinkage).toBeCloseTo(G.covariance.ledoitWolfConstantCorrelation.shrinkage, 12);
    expect(maxAbsDiff(r.cov, G.covariance.ledoitWolfConstantCorrelation.cov)).toBeLessThan(1e-15);
  });
});

describe('optimisers vs CVXPY (Clarabel / HiGHS)', () => {
  const constraints = { upper: ub };

  it('minimum variance', () => {
    const r = optimize({ objective: 'min-variance', mu, cov, constraints });
    expect(maxAbsDiff(r.weights, G.optimizer.minVariance)).toBeLessThan(2e-4);
    expect(vol(r.weights)).toBeLessThanOrEqual(vol(G.optimizer.minVariance) * (1 + 1e-6));
  });

  it('maximum utility (λ = 4)', () => {
    const r = optimize({ objective: 'max-utility', mu, cov, constraints, riskAversion: G.meta.lambda });
    const u = (w: number[]) => ret(w) - 0.5 * G.meta.lambda * vol(w) ** 2;
    expect(u(r.weights)).toBeGreaterThanOrEqual(u(G.optimizer.maxUtility) - 1e-9);
    expect(maxAbsDiff(r.weights, G.optimizer.maxUtility)).toBeLessThan(2e-4);
  });

  it('maximum Sharpe (tangency) with weight caps', () => {
    const r = optimize({ objective: 'max-sharpe', mu, cov, constraints, riskFree: rf });
    expect(sharpe(r.weights)).toBeGreaterThanOrEqual(sharpe(G.optimizer.maxSharpe) - 1e-6);
    expect(maxAbsDiff(r.weights, G.optimizer.maxSharpe)).toBeLessThan(2e-3);
  });

  it('target return', () => {
    const { target, weights } = G.optimizer.targetReturn;
    const r = optimize({ objective: 'target-return', mu, cov, constraints, targetReturn: target });
    expect(ret(r.weights)).toBeGreaterThanOrEqual(target - 1e-6);
    expect(vol(r.weights)).toBeLessThanOrEqual(vol(weights) * (1 + 1e-5));
    expect(maxAbsDiff(r.weights, weights)).toBeLessThan(2e-3);
  });

  it('target volatility', () => {
    const { target, weights } = G.optimizer.targetVolatility;
    const r = optimize({ objective: 'target-volatility', mu, cov, constraints, targetVolatility: target });
    expect(vol(r.weights)).toBeLessThanOrEqual(target * (1 + 1e-6));
    expect(ret(r.weights)).toBeGreaterThanOrEqual(ret(weights) - 1e-6);
  });

  it('group (asset-class) constraints via Dykstra projection', () => {
    const { groups, weights } = G.optimizer.grouped;
    const r = optimize({ objective: 'max-utility', mu, cov, riskAversion: G.meta.lambda, constraints: { upper: ub, groups } });
    expect(maxAbsDiff(r.weights, weights)).toBeLessThan(5e-4);
    expect(r.weights[0] + r.weights[1] + r.weights[2]).toBeLessThanOrEqual(0.35 + 1e-6);
    expect(r.weights[5] + r.weights[6]).toBeGreaterThanOrEqual(0.25 - 1e-6);
  });

  it('maximum diversification ratio', () => {
    const r = optimize({ objective: 'max-diversification', mu, cov, constraints });
    expect(diversificationRatio(r.weights, cov)).toBeGreaterThanOrEqual(diversificationRatio(G.optimizer.maxDiversification, cov) - 1e-6);
  });

  it('equal risk contribution (more exact than the interior-point reference)', () => {
    const r = optimize({ objective: 'risk-parity', mu, cov });
    const spread = (p: number[]) => Math.max(...p) - Math.min(...p);
    expect(spread(r.riskContributions)).toBeLessThan(1e-10);
    // Clarabel stops at ~1e-8 duality gap, so its weights are only good to ~1e-5.
    expect(maxAbsDiff(r.weights, G.optimizer.riskParity)).toBeLessThan(2e-5);
  });

  it('minimum CVaR (95%) is within 1% of the exact LP optimum', () => {
    const r = optimize({ objective: 'min-cvar', mu, cov, constraints, scenarios: X, cvarConfidence: 0.95 });
    const ref = histCvar(G.optimizer.minCvar.weights, 0.95);
    expect(histCvar(r.weights, 0.95)).toBeLessThanOrEqual(ref * 1.01);
    expect(r.cvar!).toBeCloseTo(histCvar(r.weights, 0.95), 12);
  });
});

describe('Hierarchical Risk Parity vs PyPortfolioOpt', () => {
  it('reproduces weights and the SciPy linkage matrix', () => {
    const S = sampleCovariance(X);
    const h = hierarchicalRiskParity(S);
    expect(maxAbsDiff(h.weights, G.hrp.weights)).toBeLessThan(1e-12);
    const Z = G.hrp.linkage as number[][];
    h.linkage.forEach((row, k) => {
      expect(row[0]).toBe(Z[k][0]);
      expect(row[1]).toBe(Z[k][1]);
      expect(row[2]).toBeCloseTo(Z[k][2], 12);
      expect(row[3]).toBe(Z[k][3]);
    });
  });
});

describe('Black–Litterman vs PyPortfolioOpt', () => {
  const B = G.blackLitterman;
  const views = (withConf: boolean) =>
    B.P.map((pick: number[], k: number) => ({ pick, value: B.Q[k], confidence: withConf ? B.confidences[k] : undefined }));
  it('Idzorek confidences', () => {
    const r = blackLitterman({ cov, prior: B.pi, views: views(true), tau: B.tau });
    expect(maxAbsDiff(r.posteriorReturns, B.posteriorReturns)).toBeLessThan(1e-13);
    expect(maxAbsDiff(r.posteriorCov, B.posteriorCov)).toBeLessThan(1e-13);
  });
  it('He–Litterman default Ω', () => {
    const r = blackLitterman({ cov, prior: B.pi, views: views(false), tau: B.tau });
    expect(maxAbsDiff(r.posteriorReturns, B.posteriorReturnsDefaultOmega)).toBeLessThan(1e-13);
  });
});

describe('statistics vs NumPy / SciPy / pandas', () => {
  it('performance metrics', () => {
    const m = computeMetrics(G.metrics.returns, { periodsPerYear: 252, riskFree: G.metrics.rf });
    const e = G.metrics.expected;
    expect(m.cagr).toBeCloseTo(e.cagr, 12);
    expect(m.volatility).toBeCloseTo(e.volatility, 12);
    expect(m.sharpe).toBeCloseTo(e.sharpe, 10);
    expect(m.sortino).toBeCloseTo(e.sortino, 10);
    expect(m.maxDrawdown).toBeCloseTo(e.maxDrawdown, 12);
    expect(m.skewness).toBeCloseTo(e.skewness, 10);
    expect(m.kurtosis).toBeCloseTo(e.kurtosis, 10);
    expect(m.varHistorical).toBeCloseTo(e.varHistorical, 14);
  });
  it('OLS coefficients, standard errors and R²', () => {
    const y: number[] = G.metrics.returns;
    const Xr = X.map((row) => [row[0], row[1]]);
    const fit = ols(y, Xr);
    expect(maxAbsDiff(fit.coef, G.ols.coef)).toBeLessThan(1e-12);
    expect(maxAbsDiff(fit.stdErr, G.ols.stdErr)).toBeLessThan(1e-10);
    expect(fit.rSquared).toBeCloseTo(G.ols.rSquared, 10);
  });
  it('symmetric eigenvalues (Jacobi) match LAPACK', () => {
    expect(maxAbsDiff(eigenSymmetric(cov).values, G.eigen.values)).toBeLessThan(1e-14);
  });
  it('normal quantile & CDF', () => {
    G.normal.p.forEach((p: number, i: number) => expect(Math.abs(normInv(p) - G.normal.ppf[i])).toBeLessThan(5e-9 * Math.max(1, Math.abs(G.normal.ppf[i]))));
    G.normal.cdfAt.forEach((x: number, i: number) => expect(Math.abs(normCdf(x) - G.normal.cdf[i])).toBeLessThan(1e-7));
  });
});
