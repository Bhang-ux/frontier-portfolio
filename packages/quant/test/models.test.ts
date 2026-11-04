import { describe, expect, it } from 'vitest';
import {
  createRng,
  monteCarlo,
  sipFutureValue,
  fitGaussianHmm,
  expectedDurations,
  stationaryDistribution,
  rsi,
  sma,
  ema,
  technicals,
  compositeSignal,
  portfolioHealth,
  historicalStress,
  HISTORICAL_SCENARIOS,
  hypotheticalShock,
  factorRegression,
  blackLitterman,
  bayesSteinMean,
  explain,
  toEpochDay,
  effectiveNumberOfBets,
  diversificationRatio,
} from '../src';

describe('Monte Carlo', () => {
  it('zero volatility reproduces the closed-form SIP future value', () => {
    const r = monteCarlo({
      method: 'gbm',
      mu: 0.12,
      sigma: 1e-9,
      years: 10,
      initial: 1000,
      monthlyContribution: 100,
      paths: 200,
    });
    // GBM with E[1+r] = 1 + μ/12 per month equals a 12 %/yr nominal (monthly-compounded) SIP
    const monthly = 0.12 / 12;
    let fv = 1000;
    for (let m = 0; m < 120; m++) fv = fv * (1 + monthly) + 100;
    expect(r.final.p50).toBeCloseTo(fv, 2);
    expect(sipFutureValue(100, Math.pow(1 + monthly, 12) - 1, 10, 1000)).toBeCloseTo(fv, 6);
    expect(r.totalInvested).toBe(1000 + 120 * 100);
  });
  it('lognormal median CAGR ≈ μ − σ²/2', () => {
    const r = monteCarlo({
      method: 'gbm',
      mu: 0.08,
      sigma: 0.2,
      years: 30,
      initial: 1,
      paths: 20000,
      seed: 3,
    });
    expect(r.medianCagr).toBeCloseTo(Math.exp(0.08 - 0.02) - 1, 2);
    expect(r.bands.p5[360]).toBeLessThan(r.bands.p50[360]);
    expect(r.bands.p50[360]).toBeLessThan(r.bands.p95[360]);
  });
  it('is reproducible with a seed and probability of goal is monotone in the goal', () => {
    const base = {
      method: 'student-t' as const,
      mu: 0.1,
      sigma: 0.18,
      years: 15,
      initial: 10000,
      monthlyContribution: 500,
      paths: 3000,
      seed: 42,
    };
    const a = monteCarlo({ ...base, goal: 150000 });
    const b = monteCarlo({ ...base, goal: 150000 });
    const c = monteCarlo({ ...base, goal: 300000 });
    expect(a.final.p50).toBe(b.final.p50);
    expect(c.probGoal!).toBeLessThan(a.probGoal!);
  });
  it('bootstrap resamples history and withdrawals can deplete', () => {
    const rng = createRng(1);
    const hist = Array.from({ length: 120 }, () => 0.006 + 0.04 * rng.normal());
    const r = monteCarlo({
      method: 'bootstrap',
      monthlyReturns: hist,
      years: 30,
      initial: 100000,
      monthlyWithdrawal: 1500,
      withdrawalStartYear: 0,
      paths: 2000,
    });
    expect(r.probDepletion).toBeGreaterThan(0);
    expect(r.probDepletion).toBeLessThan(1);
  });
});

describe('Hidden Markov regimes', () => {
  it('recovers calm and turbulent states from synthetic data', () => {
    const rng = createRng(77);
    const x: number[] = [];
    let state = 0;
    for (let t = 0; t < 2500; t++) {
      if (rng.next() < (state === 0 ? 0.01 : 0.03)) state = 1 - state;
      x.push(state === 0 ? 0.05 + 0.6 * rng.normal() : -0.1 + 2.0 * rng.normal());
    }
    const fit = fitGaussianHmm(x, 2, { seed: 3 });
    const vols = fit.params.variances.map(Math.sqrt);
    expect(vols[0]).toBeGreaterThan(0.45);
    expect(vols[0]).toBeLessThan(0.75);
    expect(vols[1]).toBeGreaterThan(1.6);
    expect(vols[1]).toBeLessThan(2.4);
    const durations = expectedDurations(fit.params.A);
    expect(durations[0]).toBeGreaterThan(30);
    const pi = stationaryDistribution(fit.params.A);
    expect(pi[0] + pi[1]).toBeCloseTo(1, 10);
    fit.filtered.forEach((p) => expect(p[0] + p[1]).toBeCloseTo(1, 9));
  });
});

describe('technical signals', () => {
  it('SMA/EMA/RSI basics', () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(sma(up, 5)[4]).toBe(102);
    expect(ema(up, 5)[4]).toBe(102);
    expect(rsi(up, 14)[29]).toBe(100);
  });
  it('a steady uptrend earns a high composite score with reasons', () => {
    const rng = createRng(5);
    const prices = [100];
    for (let t = 1; t < 400; t++) prices.push(prices[t - 1] * (1 + 0.001 + 0.004 * rng.normal()));
    const t = technicals(prices)!;
    expect(t.trend).toBe('up');
    const sig = compositeSignal(t, { momentum: 0.9, sharpe: 0.85 });
    expect(sig.score).toBeGreaterThanOrEqual(75);
    expect(sig.reasons.some((r) => r.key === 'trend-up')).toBe(true);
  });
});

describe('portfolio health', () => {
  const base = {
    names: ['A', 'B', 'C', 'D'],
    assetClasses: ['equity', 'equity', 'bond', 'commodity'],
    sharpe: 0.8,
    volatility: 0.12,
    maxDrawdown: 0.18,
    enb: 3.5,
    avgCorrelation: 0.2,
  };
  it('a diversified mix scores higher than a concentrated one', () => {
    const good = portfolioHealth({
      ...base,
      weights: [0.3, 0.3, 0.3, 0.1],
      riskShare: [0.35, 0.35, 0.2, 0.1],
    });
    const bad = portfolioHealth({
      ...base,
      weights: [0.85, 0.05, 0.05, 0.05],
      riskShare: [0.95, 0.03, 0.01, 0.01],
      enb: 1.2,
      avgCorrelation: 0.8,
      maxDrawdown: 0.55,
      sharpe: 0.2,
    });
    expect(good.score).toBeGreaterThan(bad.score + 25);
    expect(bad.suggestions.length).toBeGreaterThan(0);
    expect(bad.suggestions.join(' ')).toMatch(/A is 85%/);
    expect(['A', 'B']).toContain(good.grade);
  });
});

describe('stress testing', () => {
  it('uses a proxy before inception and reports coverage', () => {
    const d = (s: string) => toEpochDay(s);
    const covid = HISTORICAL_SCENARIOS.find((s) => s.id === 'covid-2020')!;
    const spx = { dates: [d('2020-02-14'), d('2020-02-19'), d('2020-03-23')], values: [100, 100, 66] };
    const young = { dates: [d('2021-01-04')], values: [10] };
    const r = historicalStress(
      [
        { id: 'SPY', weight: 0.5, series: spx },
        { id: 'NEW', weight: 0.5, series: young, proxy: spx },
      ],
      covid,
    );
    expect(r.portfolioReturn).toBeCloseTo(-0.34, 10);
    expect(r.coverage).toBeCloseTo(0.5, 12);
    expect(r.totalCoverage).toBeCloseTo(1, 12);
    expect(r.contributions[1].source).toBe('proxy');
  });
  it('hypothetical shock scales by beta', () => {
    const rng = createRng(6);
    const drv = Array.from({ length: 150 }, () => 0.02 * rng.normal());
    const r = hypotheticalShock(
      [{ id: 'X', weight: 1, weeklyReturns: drv.map((v) => 1.5 * v + 0.001 * rng.normal()) }],
      drv,
      -0.2,
    );
    expect(r.portfolioImpact).toBeCloseTo(-0.3, 2);
  });
});

describe('factor regression', () => {
  it('recovers known exposures', () => {
    const rng = createRng(31);
    const mkt = Array.from({ length: 600 }, () => 0.01 * rng.normal());
    const size = Array.from({ length: 600 }, () => 0.005 * rng.normal());
    const y = mkt.map((m, t) => 1.2 * m - 0.4 * size[t] + 0.002 * rng.normal());
    const r = factorRegression(
      y,
      [
        { key: 'mkt', label: 'Market', returns: mkt },
        { key: 'smb', label: 'Size', returns: size },
      ],
      { periodsPerYear: 252 },
    );
    expect(r.exposures[0].beta).toBeCloseTo(1.2, 1);
    expect(r.exposures[1].beta).toBeCloseTo(-0.4, 1);
    expect(r.rSquared).toBeGreaterThan(0.9);
    expect(r.exposures[0].varianceShare + r.exposures[1].varianceShare).toBeCloseTo(r.rSquared, 2);
  });
});

describe('return models', () => {
  it('Black–Litterman with no views returns the prior; 100% confidence hits the view', () => {
    const cov = [
      [0.04, 0.01],
      [0.01, 0.09],
    ];
    const prior = [0.05, 0.07];
    expect(blackLitterman({ cov, prior, views: [] }).posteriorReturns).toEqual(prior);
    const r = blackLitterman({ cov, prior, views: [{ pick: [1, 0], value: 0.12, confidence: 1 }] });
    expect(r.posteriorReturns[0]).toBeCloseTo(0.12, 8);
  });
  it('Bayes–Stein shrinks dispersion of means', () => {
    const rng = createRng(8);
    const X = Array.from({ length: 250 }, () =>
      Array.from({ length: 6 }, (_, i) => 0.0003 * i + 0.01 * rng.normal()),
    );
    const bs = bayesSteinMean(X, 252);
    expect(bs.shrinkage).toBeGreaterThan(0);
    expect(bs.shrinkage).toBeLessThanOrEqual(1);
  });
});

describe('risk decomposition', () => {
  it('ENB is 1 for one asset and n for uncorrelated equal-risk assets', () => {
    const I = [
      [0.04, 0, 0],
      [0, 0.04, 0],
      [0, 0, 0.04],
    ];
    expect(effectiveNumberOfBets([1, 0, 0], I).enb).toBeCloseTo(1, 10);
    expect(effectiveNumberOfBets([1 / 3, 1 / 3, 1 / 3], I).enb).toBeCloseTo(3, 10);
    expect(diversificationRatio([1 / 3, 1 / 3, 1 / 3], I)).toBeCloseTo(Math.sqrt(3), 10);
  });
});

describe('plain-English formatting', () => {
  it('formats Indian lakhs/crores and signed percentages', () => {
    expect(explain.compactMoney(12_500_000, 'INR')).toBe('₹1.25 Cr');
    expect(explain.compactMoney(450_000, 'INR')).toBe('₹4.5 L');
    expect(explain.compactMoney(2_300_000, 'USD')).toBe('$2.30M');
    expect(explain.signedPct(-0.0123)).toBe('−1.2%');
    expect(explain.money(1234567, 'INR')).toBe('₹12,34,567');
  });
  it('explains metrics with level-appropriate language', () => {
    expect(explain.explainVolatility(0.25).level).toBe('high');
    expect(explain.explainSharpe(-0.1).text).toMatch(/less than cash/);
    expect(explain.odds(0.74)).toBe('about 3 in 4');
    const why = explain.explainWeightChanges([{ name: 'Gold', from: 0, to: 0.12, avgCorr: 0.05 }]);
    expect(why[0]).toMatch(/^Add Gold \(0% → 12%\): it moves differently/);
  });
});
