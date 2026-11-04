import { describe, expect, it } from 'vitest';
import {
  constraintViolation,
  createRng,
  efficientFrontier,
  feasibilityIssues,
  makeProjector,
  normalizeConstraints,
  optimize,
  projectCappedSimplex,
  randomPortfolios,
  riskBudgeting,
  riskContributions,
  hierarchicalRiskParity,
  quasiDiagonalOrder,
  singleLinkage,
  correlationDistance,
  covToCorr,
  backtest,
  walkForward,
  rebalancePlan,
  type Matrix,
} from '../src';

function market(n: number, seed: number) {
  const rng = createRng(seed);
  const vols = Array.from({ length: n }, (_, i) => 0.08 + 0.04 * i);
  const corr = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0.3)));
  const cov: Matrix = corr.map((row, i) => row.map((c, j) => c * vols[i] * vols[j]));
  const mu = vols.map((v) => 0.02 + 0.4 * v + 0.01 * rng.normal());
  return { mu, cov };
}

describe('capped-simplex projection', () => {
  it('is feasible, idempotent and optimal (KKT)', () => {
    const rng = createRng(3);
    for (let trial = 0; trial < 200; trial++) {
      const n = 2 + (trial % 9);
      const v = Array.from({ length: n }, () => rng.normal());
      const l = new Array(n).fill(0);
      const u = new Array(n).fill(Math.max(1 / n + 0.05, 0.3));
      const w = projectCappedSimplex(v, l, u, 1);
      expect(Math.abs(w.reduce((a, b) => a + b, 0) - 1)).toBeLessThan(1e-12);
      w.forEach((x, i) => {
        expect(x).toBeGreaterThanOrEqual(l[i] - 1e-12);
        expect(x).toBeLessThanOrEqual(u[i] + 1e-12);
      });
      const again = projectCappedSimplex(w, l, u, 1);
      again.forEach((x, i) => expect(x).toBeCloseTo(w[i], 10));
      // KKT: free coordinates share the same shift v_i − w_i
      const free = w.map((x, i) => (x > 1e-9 && x < u[i] - 1e-9 ? v[i] - x : NaN)).filter(Number.isFinite);
      if (free.length > 1) expect(Math.max(...free) - Math.min(...free)).toBeLessThan(1e-9);
    }
  });
  it('disjoint-group projection is exact and satisfies all group bounds', () => {
    const c = normalizeConstraints(6, { upper: new Array(6).fill(0.5), groups: [{ members: [0, 1, 2], upper: 0.3 }, { members: [4, 5], lower: 0.4 }] });
    const P = makeProjector(c);
    const rng = createRng(17);
    for (let t = 0; t < 100; t++) {
      const v = Array.from({ length: 6 }, () => rng.normal());
      const w = P(v);
      expect(constraintViolation(w, c)).toBeLessThan(1e-10);
      // projection of a feasible point is itself
      const w2 = P(w);
      w2.forEach((x, i) => expect(x).toBeCloseTo(w[i], 9));
    }
  });
  it('overlapping groups fall back to Dykstra and stay feasible', () => {
    const c = normalizeConstraints(4, { groups: [{ members: [0, 1], upper: 0.4 }, { members: [1, 2], upper: 0.4 }] });
    const w = makeProjector(c)([0.9, 0.9, 0.1, -0.3]);
    expect(constraintViolation(w, c)).toBeLessThan(1e-8);
  });
  it('reports infeasible constraints in plain English', () => {
    const issues = feasibilityIssues(normalizeConstraints(3, { upper: [0.2, 0.2, 0.2] }));
    expect(issues[0]).toMatch(/raise the per-asset cap/);
    expect(() => optimize({ objective: 'min-variance', mu: [0.1, 0.1, 0.1], cov: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], constraints: { upper: [0.2, 0.2, 0.2] } })).toThrow();
  });
});

describe('optimiser behaviour', () => {
  const { mu, cov } = market(6, 1);

  it('frontier is increasing in both risk and return and starts at min-variance', () => {
    const f = efficientFrontier(mu, cov, {}, { points: 30, riskFree: 0.02 });
    for (let i = 1; i < f.length; i++) {
      expect(f[i].vol).toBeGreaterThanOrEqual(f[i - 1].vol - 1e-12);
      expect(f[i].ret).toBeGreaterThan(f[i - 1].ret);
    }
    const gmv = optimize({ objective: 'min-variance', mu, cov });
    expect(f[0].vol).toBeCloseTo(gmv.volatility, 6);
  });

  it('tangency beats every frontier point and every random portfolio', () => {
    const rf = 0.02;
    const t = optimize({ objective: 'max-sharpe', mu, cov, riskFree: rf });
    const f = efficientFrontier(mu, cov, {}, { points: 60, riskFree: rf });
    for (const p of f) expect(t.sharpe).toBeGreaterThanOrEqual(p.sharpe - 1e-7);
    for (const p of randomPortfolios(mu, cov, 2000)) expect(t.sharpe).toBeGreaterThanOrEqual((p.ret - rf) / p.vol - 1e-7);
  });

  it('falls back to min variance with a warning when nothing beats cash', () => {
    const r = optimize({ objective: 'max-sharpe', mu: mu.map(() => 0.01), cov, riskFree: 0.05 });
    expect(r.warnings.join(' ')).toMatch(/risk-free/);
  });

  it('target return is clamped with a readable warning when unreachable', () => {
    const r = optimize({ objective: 'target-return', mu, cov, targetReturn: 5 });
    expect(r.warnings[0]).toMatch(/higher than any allowed portfolio/);
    expect(r.expectedReturn).toBeCloseTo(Math.max(...mu), 8);
  });

  it('risk budgeting matches arbitrary budgets', () => {
    const b = [0.4, 0.2, 0.1, 0.1, 0.1, 0.1];
    const r = riskBudgeting(cov, b);
    const rc = riskContributions(r.weights, cov).percent;
    rc.forEach((x, i) => expect(x).toBeCloseTo(b[i], 8));
  });

  it('HRP: weights positive, sum to one, order is a permutation', () => {
    const h = hierarchicalRiskParity(cov);
    expect(h.weights.every((w) => w > 0)).toBe(true);
    expect(h.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect([...h.order].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    const Z = singleLinkage(correlationDistance(covToCorr(cov).corr));
    expect(quasiDiagonalOrder(Z, 6)).toEqual(h.order);
  });

  it('respects per-asset caps for every objective', () => {
    const upper = new Array(6).fill(0.25);
    for (const objective of ['max-sharpe', 'min-variance', 'max-utility', 'max-diversification', 'risk-parity', 'hrp', 'equal-weight', 'inverse-volatility'] as const) {
      const r = optimize({ objective, mu, cov, constraints: { upper }, riskFree: 0.02 });
      expect(Math.max(...r.weights)).toBeLessThanOrEqual(0.25 + 1e-8);
      expect(r.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 8);
    }
  });
});

describe('backtesting', () => {
  const rng = createRng(21);
  const T = 800;
  const dates = Array.from({ length: T }, (_, i) => 18000 + Math.floor((i * 7) / 5));
  const prices: Matrix = [[100, 100, 100]];
  for (let t = 1; t < T; t++) {
    const m = 0.01 * rng.normal();
    prices.push(prices[t - 1].map((p, i) => p * (1 + 0.0003 + (0.5 + i * 0.5) * m + 0.005 * rng.normal())));
  }
  it('buy-and-hold equals the weighted price path', () => {
    const r = backtest({ dates, prices, weights: [0.5, 0.3, 0.2], rebalance: 'none', initial: 1 });
    const expected = 0.5 * (prices[T - 1][0] / 100) + 0.3 * (prices[T - 1][1] / 100) + 0.2 * (prices[T - 1][2] / 100);
    expect(r.equity[T - 1]).toBeCloseTo(expected, 10);
    expect(r.rebalances).toBe(0);
  });
  it('rebalancing keeps weights on target and costs reduce wealth', () => {
    const cheap = backtest({ dates, prices, weights: [0.5, 0.3, 0.2], rebalance: 'monthly', costBps: 0 });
    const pricey = backtest({ dates, prices, weights: [0.5, 0.3, 0.2], rebalance: 'monthly', costBps: 50 });
    expect(cheap.rebalances).toBeGreaterThan(20);
    expect(pricey.equity[T - 1]).toBeLessThan(cheap.equity[T - 1]);
    const thr = backtest({ dates, prices, weights: [0.5, 0.3, 0.2], rebalance: { threshold: 0.05 } });
    expect(thr.rebalances).toBeLessThan(cheap.rebalances);
  });
  it('walk-forward only uses past data and produces a curve per strategy', () => {
    const wf = walkForward({
      dates,
      prices,
      lookback: 252,
      rebalance: 'quarterly',
      strategies: [
        { id: 'ew', label: 'Equal weight', objective: 'equal-weight' },
        { id: 'mv', label: 'Min variance', objective: 'min-variance' },
        { id: 'hrp', label: 'HRP', objective: 'hrp' },
      ],
    });
    expect(wf.curves).toHaveLength(3);
    expect(wf.rebalanceDates[0]).toBeGreaterThanOrEqual(dates[252]);
    wf.curves.forEach((c) => expect(c.equity.length).toBe(wf.dates.length));
  });
});

describe('rebalance plan', () => {
  it('never overspends with whole shares and gets close to target', () => {
    const plan = rebalancePlan({
      holdings: [{ id: 'A', units: 10, price: 100 }],
      targetWeights: { A: 0.5, B: 0.3, C: 0.2 },
      prices: { A: 100, B: 37, C: 512 },
      cash: 2000,
    });
    expect(plan.cashLeft).toBeGreaterThanOrEqual(-1e-9);
    expect(plan.trackingGap).toBeLessThan(0.1);
    // total 3000 ⇒ A target 1500 = 15 shares; holds 10 ⇒ buy exactly 5
    expect(plan.trades.find((t) => t.id === 'A')).toMatchObject({ side: 'buy', units: 5 });
  });
  it('fractional plans hit targets exactly', () => {
    const plan = rebalancePlan({ holdings: [], targetWeights: { A: 0.6, B: 0.4 }, prices: { A: 13, B: 7 }, cash: 1000, fractional: true });
    expect(plan.trackingGap).toBeLessThan(1e-12);
  });
});
