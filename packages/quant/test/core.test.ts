import { describe, expect, it } from 'vitest';
import {
  alignSeries,
  calendarReturns,
  cholesky,
  createRng,
  drawdownInfo,
  eigenSymmetric,
  fromEigen,
  fromEpochDay,
  invertSPD,
  isWeekday,
  lttb,
  matMul,
  periodEndIndices,
  periodsPerYearFromDates,
  quantile,
  skewness,
  kurtosis,
  solveSPD,
  toEpochDay,
  transpose,
  weekday,
  computeMetrics,
  rollingVolatility,
  std,
  convertSeries,
  denoiseCorrelation,
  covToCorr,
  sampleCovariance,
  estimateCovariance,
} from '../src';

const randomSPD = (n: number, seed = 1) => {
  const rng = createRng(seed);
  const A = Array.from({ length: n }, () => Array.from({ length: n }, () => rng.normal()));
  const S = matMul(A, transpose(A));
  return S.map((row, i) => row.map((v, j) => v + (i === j ? n : 0)));
};

describe('random', () => {
  it('is deterministic for a seed and roughly standard normal', () => {
    const a = createRng(5);
    const b = createRng(5);
    const xs = Array.from({ length: 20000 }, () => a.normal());
    expect(xs.slice(0, 5)).toEqual(Array.from({ length: 5 }, () => b.normal()));
    const m = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(Math.abs(m)).toBeLessThan(0.03);
    expect(Math.abs(std(xs) - 1)).toBeLessThan(0.03);
  });
  it('student-t is standardised to unit variance with fat tails', () => {
    const r = createRng(9);
    const xs = Array.from({ length: 40000 }, () => r.studentT(5));
    expect(Math.abs(std(xs) - 1)).toBeLessThan(0.06);
    expect(kurtosis(xs)).toBeGreaterThan(2);
  });
});

describe('linear algebra', () => {
  it('cholesky reconstructs and solveSPD solves', () => {
    const S = randomSPD(6);
    const L = cholesky(S)!;
    const LLt = matMul(L, transpose(L));
    S.forEach((row, i) => row.forEach((v, j) => expect(LLt[i][j]).toBeCloseTo(v, 10)));
    const b = [1, 2, 3, 4, 5, 6];
    const x = solveSPD(S, b);
    const Sx = S.map((row) => row.reduce((s, v, j) => s + v * x[j], 0));
    Sx.forEach((v, i) => expect(v).toBeCloseTo(b[i], 10));
    const inv = invertSPD(S);
    const I = matMul(S, inv);
    I.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(i === j ? 1 : 0, 10)));
  });
  it('cholesky rejects indefinite matrices', () => {
    expect(cholesky([[1, 2], [2, 1]])).toBeNull();
  });
  it('Jacobi eigen-decomposition reconstructs the matrix with orthonormal vectors', () => {
    const S = randomSPD(10, 3);
    const { values, vectors } = eigenSymmetric(S);
    const R = fromEigen(values, vectors);
    S.forEach((row, i) => row.forEach((v, j) => expect(R[i][j]).toBeCloseTo(v, 9)));
    const VtV = matMul(transpose(vectors), vectors);
    VtV.forEach((row, i) => row.forEach((v, j) => expect(v).toBeCloseTo(i === j ? 1 : 0, 10)));
    for (let k = 1; k < values.length; k++) expect(values[k]).toBeLessThanOrEqual(values[k - 1]);
  });
});

describe('series & calendars', () => {
  it('round-trips epoch days and knows weekdays', () => {
    expect(fromEpochDay(toEpochDay('2024-02-29'))).toBe('2024-02-29');
    expect(weekday(toEpochDay('2024-06-07'))).toBe(5); // Friday
    expect(isWeekday(toEpochDay('2024-06-08'))).toBe(false);
  });
  it('aligns markets on a weekday calendar with forward fill', () => {
    const d = (s: string) => toEpochDay(s);
    const us = { dates: [d('2024-01-02'), d('2024-01-03'), d('2024-01-05')], values: [100, 101, 103] };
    const crypto = { dates: [d('2024-01-02'), d('2024-01-03'), d('2024-01-04'), d('2024-01-05'), d('2024-01-06')], values: [1, 2, 3, 4, 5] };
    const a = alignSeries([us, crypto]);
    expect(a.dates.map(fromEpochDay)).toEqual(['2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05']);
    expect(a.values.map((r) => r[0])).toEqual([100, 101, 101, 103]); // US holiday forward-filled
    expect(a.values.map((r) => r[1])).toEqual([1, 2, 3, 4]); // Saturday dropped
  });
  it('starts the aligned window when the youngest series begins', () => {
    const a = alignSeries([
      { dates: [1, 2, 5, 6, 7], values: [1, 2, 3, 4, 5] },
      { dates: [5, 6, 7], values: [9, 9, 9] },
    ], { calendar: 'union' });
    expect(a.dates[0]).toBe(5);
  });
  it('period ends & calendar returns', () => {
    const dates = ['2024-01-30', '2024-01-31', '2024-02-01', '2024-02-29', '2024-03-01'].map(toEpochDay);
    expect(periodEndIndices(dates, 'M')).toEqual([1, 3, 4]);
    const cr = calendarReturns({ dates, values: [100, 110, 99, 121, 120] }, 'M');
    expect(cr[1].ret).toBeCloseTo(121 / 110 - 1, 12);
  });
  it('infers periods per year from the calendar', () => {
    const daily = Array.from({ length: 253 }, (_, i) => i * (365.25 / 252));
    expect(periodsPerYearFromDates(daily)).toBeCloseTo(252, 6);
  });
  it('converts currencies with forward-filled FX', () => {
    const out = convertSeries({ dates: [1, 2, 3], values: [10, 11, 12] }, { dates: [1, 3], values: [80, 82] });
    expect(out.values).toEqual([800, 880, 984]);
  });
  it('LTTB keeps endpoints and the requested size', () => {
    const xs = Array.from({ length: 1000 }, (_, i) => i);
    const ys = xs.map((x) => Math.sin(x / 30));
    const idx = lttb(xs, ys, 100);
    expect(idx.length).toBe(100);
    expect(idx[0]).toBe(0);
    expect(idx[99]).toBe(999);
  });
});

describe('metrics', () => {
  it('drawdown info on a known path', () => {
    const r = [0.1, -0.5, 0.2, 1.0, -0.1];
    const d = drawdownInfo(r);
    expect(d.maxDrawdown).toBeCloseTo(0.5, 12);
    expect(d.peakIndex).toBe(1);
    expect(d.troughIndex).toBe(2);
    expect(d.recoveryIndex).toBe(4);
  });
  it('beta of a series against itself is 1 with zero tracking error', () => {
    const rng = createRng(2);
    const r = Array.from({ length: 500 }, () => 0.0005 + 0.01 * rng.normal());
    const m = computeMetrics(r, { periodsPerYear: 252, benchmark: r });
    expect(m.beta).toBeCloseTo(1, 12);
    expect(m.trackingError).toBeCloseTo(0, 12);
    expect(m.upCapture).toBeCloseTo(1, 12);
  });
  it('Cornish–Fisher VaR exceeds Gaussian VaR for negatively skewed returns', () => {
    const rng = createRng(4);
    const r = Array.from({ length: 3000 }, () => (rng.next() < 0.05 ? -0.05 + 0.01 * rng.normal() : 0.002 + 0.008 * rng.normal()));
    const m = computeMetrics(r, { periodsPerYear: 252 });
    expect(skewness(r)).toBeLessThan(0);
    expect(m.varCornishFisher).toBeGreaterThan(m.varParametric);
    expect(m.cvarHistorical).toBeGreaterThan(m.varHistorical);
  });
  it('rolling volatility matches a direct computation', () => {
    const rng = createRng(8);
    const r = Array.from({ length: 300 }, () => 0.01 * rng.normal());
    const rv = rollingVolatility(r, 63, 252);
    expect(rv[299]).toBeCloseTo(std(r.slice(237)) * Math.sqrt(252), 10);
    expect(Number.isNaN(rv[61])).toBe(true);
  });
  it('quantile uses linear interpolation (numpy default)', () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 12);
  });
});

describe('covariance extras', () => {
  it('RMT denoising keeps a valid correlation matrix and the market factor', () => {
    const rng = createRng(12);
    const T = 400;
    const n = 20;
    const X = Array.from({ length: T }, () => {
      const m = rng.normal();
      return Array.from({ length: n }, () => 0.6 * m + rng.normal());
    });
    const { corr } = covToCorr(sampleCovariance(X));
    const dn = denoiseCorrelation(corr, T);
    expect(dn.signalFactors).toBeGreaterThanOrEqual(1);
    dn.corr.forEach((row, i) => expect(row[i]).toBeCloseTo(1, 12));
    expect(cholesky(dn.corr)).not.toBeNull();
  });
  it('every estimator returns an annualised PD matrix', () => {
    const rng = createRng(13);
    const X = Array.from({ length: 120 }, () => Array.from({ length: 5 }, () => 0.01 * rng.normal()));
    for (const m of ['sample', 'ledoit-wolf', 'ledoit-wolf-identity', 'ewma', 'denoised'] as const) {
      const est = estimateCovariance(X, 252, m);
      expect(cholesky(est.cov)).not.toBeNull();
      expect(est.cov[0][0]).toBeGreaterThan(0.005); // ≈ 0.01² × 252
    }
  });
});
