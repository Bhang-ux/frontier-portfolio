/**
 * Gaussian Hidden Markov Model for market-regime detection.
 *
 * Daily returns are modelled as draws from K hidden states (e.g. "calm" and
 * "turbulent"), each with its own mean and volatility, linked by a Markov
 * transition matrix. Parameters are fitted by Baum–Welch (EM) with Rabiner
 * scaling, from several seeded random restarts; states are sorted by
 * volatility so state 0 is always the calmest.
 *
 * The *current* regime uses filtered probabilities P(sₜ | x₁…xₜ) — what an
 * investor could actually have known that day — never the smoothed ones,
 * which peek into the future (a classic look-ahead bias in regime research).
 */
import { createRng } from './random';
import { quantile, variance } from './stats';

export interface HmmParams {
  pi: number[];
  A: number[][];
  means: number[];
  variances: number[];
}

export interface HmmFit {
  params: HmmParams;
  logLikelihood: number;
  iterations: number;
  /** P(state | data up to t) */
  filtered: number[][];
  /** P(state | all data) */
  smoothed: number[][];
  viterbi: number[];
}

const LOG_2PI = Math.log(2 * Math.PI);

function emission(x: number, mu: number, v: number): number {
  return Math.exp(-0.5 * (LOG_2PI + Math.log(v) + ((x - mu) * (x - mu)) / v));
}

function forwardBackward(x: number[], p: HmmParams) {
  const T = x.length;
  const K = p.pi.length;
  const alpha: number[][] = Array.from({ length: T }, () => new Array<number>(K).fill(0));
  const beta: number[][] = Array.from({ length: T }, () => new Array<number>(K).fill(1));
  const B: number[][] = x.map((xt) => p.means.map((m, k) => Math.max(emission(xt, m, p.variances[k]), 1e-300)));
  const c = new Array<number>(T).fill(0);
  for (let k = 0; k < K; k++) alpha[0][k] = p.pi[k] * B[0][k];
  c[0] = alpha[0].reduce((a, b) => a + b, 0) || 1e-300;
  for (let k = 0; k < K; k++) alpha[0][k] /= c[0];
  for (let t = 1; t < T; t++) {
    for (let j = 0; j < K; j++) {
      let s = 0;
      for (let i = 0; i < K; i++) s += alpha[t - 1][i] * p.A[i][j];
      alpha[t][j] = s * B[t][j];
    }
    c[t] = alpha[t].reduce((a, b) => a + b, 0) || 1e-300;
    for (let j = 0; j < K; j++) alpha[t][j] /= c[t];
  }
  for (let t = T - 2; t >= 0; t--) {
    for (let i = 0; i < K; i++) {
      let s = 0;
      for (let j = 0; j < K; j++) s += p.A[i][j] * B[t + 1][j] * beta[t + 1][j];
      beta[t][i] = s / c[t + 1];
    }
  }
  const logLik = c.reduce((s, ct) => s + Math.log(ct), 0);
  return { alpha, beta, B, c, logLik };
}

function baumWelch(x: number[], init: HmmParams, maxIter: number, tol: number) {
  let p = init;
  let prevLL = -Infinity;
  let it = 0;
  const T = x.length;
  const K = init.pi.length;
  const varFloor = Math.max(variance(x) * 1e-3, 1e-12);
  let fb = forwardBackward(x, p);
  for (it = 0; it < maxIter; it++) {
    const { alpha, beta, B, c } = fb;
    const gamma = alpha.map((a, t) => a.map((v, k) => v * beta[t][k]));
    const xiSum = Array.from({ length: K }, () => new Array<number>(K).fill(0));
    for (let t = 0; t < T - 1; t++) {
      for (let i = 0; i < K; i++) {
        for (let j = 0; j < K; j++) {
          xiSum[i][j] += (alpha[t][i] * p.A[i][j] * B[t + 1][j] * beta[t + 1][j]) / c[t + 1];
        }
      }
    }
    const gSum = new Array<number>(K).fill(0);
    const gSumExLast = new Array<number>(K).fill(0);
    const means = new Array<number>(K).fill(0);
    for (let t = 0; t < T; t++) {
      for (let k = 0; k < K; k++) {
        gSum[k] += gamma[t][k];
        if (t < T - 1) gSumExLast[k] += gamma[t][k];
        means[k] += gamma[t][k] * x[t];
      }
    }
    for (let k = 0; k < K; k++) means[k] /= gSum[k] || 1e-300;
    const vars = new Array<number>(K).fill(0);
    for (let t = 0; t < T; t++) for (let k = 0; k < K; k++) vars[k] += gamma[t][k] * (x[t] - means[k]) ** 2;
    for (let k = 0; k < K; k++) vars[k] = Math.max(vars[k] / (gSum[k] || 1e-300), varFloor);
    const A = xiSum.map((row, i) => {
      const s = gSumExLast[i] || 1e-300;
      const r = row.map((v) => v / s);
      const rs = r.reduce((a, b) => a + b, 0) || 1;
      return r.map((v) => v / rs);
    });
    p = { pi: gamma[0].slice(), A, means, variances: vars };
    fb = forwardBackward(x, p);
    if (Math.abs(fb.logLik - prevLL) < tol * Math.max(1, Math.abs(fb.logLik))) {
      prevLL = fb.logLik;
      break;
    }
    prevLL = fb.logLik;
  }
  return { params: p, logLik: prevLL, iterations: it + 1, fb };
}

function viterbi(x: number[], p: HmmParams): number[] {
  const T = x.length;
  const K = p.pi.length;
  const logA = p.A.map((r) => r.map((v) => Math.log(Math.max(v, 1e-300))));
  const delta: number[][] = Array.from({ length: T }, () => new Array<number>(K).fill(-Infinity));
  const psi: number[][] = Array.from({ length: T }, () => new Array<number>(K).fill(0));
  const logB = (t: number, k: number) => -0.5 * (LOG_2PI + Math.log(p.variances[k]) + (x[t] - p.means[k]) ** 2 / p.variances[k]);
  for (let k = 0; k < K; k++) delta[0][k] = Math.log(Math.max(p.pi[k], 1e-300)) + logB(0, k);
  for (let t = 1; t < T; t++) {
    for (let j = 0; j < K; j++) {
      let best = -Infinity;
      let arg = 0;
      for (let i = 0; i < K; i++) {
        const v = delta[t - 1][i] + logA[i][j];
        if (v > best) {
          best = v;
          arg = i;
        }
      }
      delta[t][j] = best + logB(t, j);
      psi[t][j] = arg;
    }
  }
  const path = new Array<number>(T).fill(0);
  path[T - 1] = delta[T - 1].indexOf(Math.max(...delta[T - 1]));
  for (let t = T - 2; t >= 0; t--) path[t] = psi[t + 1][path[t + 1]];
  return path;
}

/** Fit a K-state Gaussian HMM to a 1-D series (e.g. daily log returns × 100). */
export function fitGaussianHmm(
  x: number[],
  K = 2,
  opts: { restarts?: number; maxIter?: number; tol?: number; seed?: number } = {},
): HmmFit {
  if (x.length < 50) throw new Error('HMM needs at least 50 observations');
  const rng = createRng(opts.seed ?? 11);
  const restarts = opts.restarts ?? 4;
  const v = variance(x);
  let best: ReturnType<typeof baumWelch> | null = null;
  for (let r = 0; r < restarts; r++) {
    const means = Array.from({ length: K }, (_, k) => quantile(x, (k + 0.5) / K) * (0.5 + rng.next()));
    const variances = Array.from({ length: K }, (_, k) => v * (0.3 + (1.7 * (k + rng.next())) / K));
    const stay = 0.9 + 0.09 * rng.next();
    const A = Array.from({ length: K }, (_, i) =>
      Array.from({ length: K }, (_, j) => (i === j ? stay : (1 - stay) / Math.max(K - 1, 1))),
    );
    const fit = baumWelch(x, { pi: new Array<number>(K).fill(1 / K), A, means, variances }, opts.maxIter ?? 300, opts.tol ?? 1e-8);
    if (!best || fit.logLik > best.logLik) best = fit;
  }
  const b = best!;
  // sort states by volatility (state 0 = calmest)
  const order = b.params.variances.map((_, k) => k).sort((i, j) => b.params.variances[i] - b.params.variances[j]);
  const params: HmmParams = {
    pi: order.map((k) => b.params.pi[k]),
    A: order.map((i) => order.map((j) => b.params.A[i][j])),
    means: order.map((k) => b.params.means[k]),
    variances: order.map((k) => b.params.variances[k]),
  };
  const fb = forwardBackward(x, params);
  const smoothed = fb.alpha.map((a, t) => {
    const g = a.map((val, k) => val * fb.beta[t][k]);
    const s = g.reduce((p, q) => p + q, 0) || 1;
    return g.map((val) => val / s);
  });
  return {
    params,
    logLikelihood: fb.logLik,
    iterations: b.iterations,
    filtered: fb.alpha,
    smoothed,
    viterbi: viterbi(x, params),
  };
}

/** Expected duration (periods) of each state: 1 / (1 − Aᵢᵢ). */
export const expectedDurations = (A: number[][]): number[] => A.map((row, i) => 1 / Math.max(1 - row[i], 1e-9));

/** Stationary distribution of a transition matrix (power iteration). */
export function stationaryDistribution(A: number[][]): number[] {
  const K = A.length;
  let p = new Array<number>(K).fill(1 / K);
  for (let it = 0; it < 10_000; it++) {
    const q = new Array<number>(K).fill(0);
    for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) q[j] += p[i] * A[i][j];
    const diff = q.reduce((s, v, i) => s + Math.abs(v - p[i]), 0);
    p = q;
    if (diff < 1e-14) break;
  }
  return p;
}

