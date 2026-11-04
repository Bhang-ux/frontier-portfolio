/**
 * Portfolio optimisation façade.
 *
 * Every mean–variance-type objective is reduced to one primitive — the
 * long-only, constrained mean–variance problem
 *
 *     w(λ) = argmin_{w ∈ C}  ½λ·wᵀΣw − μᵀw + γ‖w − w̄‖²
 *
 * solved by projected FISTA. The efficient frontier is the path λ ↦ w(λ);
 * tangency (max Sharpe) is a 1-D unimodal search along that path, target
 * return/volatility are 1-D root finds, and max-diversification is
 * max-Sharpe with μ := σ and rf := 0. One well-tested kernel, many products.
 */
import { dot, largestEigenvalue, matVec, quadForm, type Matrix, type Vector } from '../linalg';
import { createRng } from '../random';
import { quantileSorted, sortedCopy } from '../stats';
import { diversificationRatio, riskContributions } from '../risk';
import {
  constraintViolation,
  feasibilityIssues,
  makeProjector,
  normalizeConstraints,
  projectCappedSimplex,
  type Constraints,
  type Projector,
} from './constraints';
import { hierarchicalRiskParity, type Linkage } from './hrp';
import { inverseVolatility, riskBudgeting } from './riskParity';
import { minimizeProjected } from './solver';

export * from './constraints';
export * from './hrp';
export * from './riskParity';
export * from './solver';

export type Objective =
  | 'max-sharpe'
  | 'min-variance'
  | 'max-utility'
  | 'target-return'
  | 'target-volatility'
  | 'risk-parity'
  | 'hrp'
  | 'max-diversification'
  | 'min-cvar'
  | 'equal-weight'
  | 'inverse-volatility';

export interface OptimizeRequest {
  objective: Objective;
  /** Annualised expected returns. */
  mu: Vector;
  /** Annualised covariance. */
  cov: Matrix;
  riskFree?: number;
  constraints?: Partial<Constraints>;
  riskAversion?: number;
  targetReturn?: number;
  targetVolatility?: number;
  /** Risk budgets for risk parity (default equal). */
  budgets?: Vector;
  /** Per-period scenario returns (T×n) for min-CVaR. */
  scenarios?: Matrix;
  cvarConfidence?: number;
  /** L2 regularisation towards equal weight (PyPortfolioOpt-style γ). */
  l2?: number;
  corr?: Matrix;
}

export interface OptimizeResult {
  objective: Objective;
  weights: Vector;
  expectedReturn: number;
  volatility: number;
  sharpe: number;
  diversificationRatio: number;
  riskContributions: Vector;
  converged: boolean;
  warnings: string[];
  /** Historical CVaR of the solution (per period) when scenarios were provided. */
  cvar?: number;
  linkage?: Linkage;
  order?: number[];
}

interface Ctx {
  n: number;
  mu: Vector;
  cov: Matrix;
  project: Projector;
  constraints: Constraints;
  l2: number;
  ref: Vector;
  lmax: number;
}

function makeCtx(mu: Vector, cov: Matrix, c: Constraints, l2 = 0): Ctx {
  const n = mu.length;
  return {
    n,
    mu,
    cov,
    project: makeProjector(c),
    constraints: c,
    l2,
    ref: new Array<number>(n).fill(c.total / n),
    lmax: Math.max(largestEigenvalue(cov), 1e-16),
  };
}

/** argmin_{w∈C} ½λ wᵀΣw − μᵀw + γ‖w − w̄‖² (λ = Infinity ⇒ global minimum variance). */
function solveMV(ctx: Ctx, lambda: number, x0: Vector): Vector {
  const { cov, project, l2, ref } = ctx;
  const gmv = !Number.isFinite(lambda);
  const lam = gmv ? 1 : lambda;
  const mu = gmv ? new Array<number>(ctx.n).fill(0) : ctx.mu;
  const f = (w: Vector) => {
    let reg = 0;
    if (l2 > 0) for (let i = 0; i < w.length; i++) reg += (w[i] - ref[i]) ** 2;
    return 0.5 * lam * quadForm(w, cov) - dot(mu, w) + l2 * reg;
  };
  const grad = (w: Vector) => {
    const Sw = matVec(cov, w);
    return Sw.map((v, i) => lam * v - mu[i] + 2 * l2 * (w[i] - ref[i]));
  };
  const L = lam * ctx.lmax + 2 * l2;
  return minimizeProjected(f, grad, project, x0, { lipschitz: L, tol: 1e-12, maxIter: 20_000 }).x;
}

/** Highest-return feasible portfolio (an LP; greedy is exact without group constraints). */
function maxReturnPortfolio(ctx: Ctx): Vector {
  const { mu, constraints: c } = ctx;
  if (c.groups.length === 0) {
    const w = c.lower.slice();
    let budget = c.total - w.reduce((a, b) => a + b, 0);
    const order = mu.map((_, i) => i).sort((a, b) => mu[b] - mu[a]);
    for (const i of order) {
      if (budget <= 0) break;
      const add = Math.min(c.upper[i] - w[i], budget);
      w[i] += add;
      budget -= add;
    }
    return w;
  }
  const scaleMu = Math.max(...mu.map(Math.abs), 1e-9);
  return solveMV(ctx, (1e-7 * scaleMu) / ctx.lmax, ctx.ref);
}

const stats = (ctx: Ctx, w: Vector, rf: number) => {
  const r = dot(ctx.mu, w);
  const v = Math.sqrt(Math.max(quadForm(w, ctx.cov), 0));
  return { r, v, s: v > 0 ? (r - rf) / v : -Infinity };
};

export interface FrontierPoint {
  lambda: number;
  ret: number;
  vol: number;
  sharpe: number;
  weights: Vector;
}

function lambdaScale(ctx: Ctx): number {
  const avgVar = ctx.cov.reduce((s, row, i) => s + row[i], 0) / ctx.n;
  const spread = Math.max(...ctx.mu) - Math.min(...ctx.mu);
  return Math.max(spread, 1e-6) / Math.max(avgVar, 1e-12);
}

/** Trace the efficient frontier from global-min-variance to max-return. */
export function efficientFrontier(
  mu: Vector,
  cov: Matrix,
  constraints: Partial<Constraints> = {},
  opts: { points?: number; riskFree?: number; l2?: number } = {},
): FrontierPoint[] {
  const c = normalizeConstraints(mu.length, constraints);
  const issues = feasibilityIssues(c);
  if (issues.length) throw new Error(issues.join(' '));
  const ctx = makeCtx(mu, cov, c, opts.l2 ?? 0);
  return traceFrontier(ctx, opts.points ?? 50, opts.riskFree ?? 0);
}

function traceFrontier(ctx: Ctx, points: number, rf: number): FrontierPoint[] {
  const scale = lambdaScale(ctx);
  const out: FrontierPoint[] = [];
  let w = solveMV(ctx, Infinity, ctx.ref);
  const push = (lambda: number, weights: Vector) => {
    const s = stats(ctx, weights, rf);
    out.push({ lambda, ret: s.r, vol: s.v, sharpe: s.s, weights });
  };
  push(Infinity, w);
  // log-spaced λ from "almost GMV" to "almost max-return", warm-started
  const hi = Math.log(scale * 1e4);
  const lo = Math.log(scale * 1e-3);
  for (let k = 0; k < points; k++) {
    const lambda = Math.exp(hi + ((lo - hi) * k) / (points - 1));
    w = solveMV(ctx, lambda, w);
    push(lambda, w);
  }
  push(0, maxReturnPortfolio(ctx));
  // keep the efficient (monotone) part, drop near-duplicates
  out.sort((a, b) => a.vol - b.vol);
  const eff: FrontierPoint[] = [];
  for (const p of out) {
    const last = eff[eff.length - 1];
    if (last && p.ret <= last.ret + 1e-10) continue;
    if (last && Math.abs(p.vol - last.vol) < 1e-7 && Math.abs(p.ret - last.ret) < 1e-7) continue;
    eff.push(p);
  }
  return eff;
}

/** Golden-section search for the tangency portfolio along the λ-path. */
function maxSharpeOnPath(ctx: Ctx, rf: number): { w: Vector; warnings: string[] } {
  const warnings: string[] = [];
  const frontier = traceFrontier(ctx, 24, rf);
  if (frontier.every((p) => p.ret <= rf)) {
    warnings.push('No portfolio is expected to beat the risk-free rate, so Sharpe is undefined — showing minimum variance instead.');
    return { w: frontier[0].weights, warnings };
  }
  let k = 0;
  for (let i = 1; i < frontier.length; i++) if (frontier[i].sharpe > frontier[k].sharpe) k = i;
  const lam = (p: FrontierPoint) => (Number.isFinite(p.lambda) ? Math.max(p.lambda, 1e-300) : 1e300);
  const left = frontier[Math.max(k - 1, 0)];
  const right = frontier[Math.min(k + 1, frontier.length - 1)];
  let a = Math.log(lam(right)); // smaller λ (riskier)
  let b = Math.log(lam(left)); // larger λ (safer)
  if (!Number.isFinite(b) || b > 700) b = Math.log(lambdaScale(ctx) * 1e6);
  if (!Number.isFinite(a) || a < -700) a = Math.log(lambdaScale(ctx) * 1e-6);
  let best = frontier[k];
  let warm = best.weights;
  const evalAt = (t: number) => {
    const w = solveMV(ctx, Math.exp(t), warm);
    warm = w;
    const s = stats(ctx, w, rf);
    if (s.s > best.sharpe) best = { lambda: Math.exp(t), ret: s.r, vol: s.v, sharpe: s.s, weights: w };
    return s.s;
  };
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = evalAt(c);
  let fd = evalAt(d);
  for (let it = 0; it < 60 && Math.abs(b - a) > 1e-6; it++) {
    if (fc > fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = evalAt(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = evalAt(d);
    }
  }
  return { w: best.weights, warnings };
}

/** Find λ so that a monotone (decreasing in λ) frontier statistic hits a target. */
function solveForTarget(ctx: Ctx, target: number, which: 'ret' | 'vol', rf: number): { w: Vector; warnings: string[] } {
  const warnings: string[] = [];
  const gmv = solveMV(ctx, Infinity, ctx.ref);
  const top = maxReturnPortfolio(ctx);
  const sG = stats(ctx, gmv, rf);
  const sT = stats(ctx, top, rf);
  const val = (s: { r: number; v: number }) => (which === 'ret' ? s.r : s.v);
  if (target <= val(sG)) {
    if (target < val(sG) - 1e-9)
      warnings.push(
        which === 'ret'
          ? 'Target return is below what the safest portfolio earns — showing minimum variance.'
          : 'Target volatility is below the lowest achievable risk — showing minimum variance.',
      );
    return { w: gmv, warnings };
  }
  if (target >= val(sT)) {
    if (target > val(sT) + 1e-9)
      warnings.push(
        which === 'ret'
          ? 'Target return is higher than any allowed portfolio can deliver — showing the highest-return portfolio.'
          : 'Target volatility is above the riskiest allowed portfolio — showing the highest-return portfolio.',
      );
    return { w: top, warnings };
  }
  const scale = lambdaScale(ctx);
  let lo = Math.log(scale * 1e-6); // small λ ⇒ high stat
  let hi = Math.log(scale * 1e6); // large λ ⇒ low stat
  let warm = gmv;
  let best = gmv;
  for (let it = 0; it < 80; it++) {
    const mid = 0.5 * (lo + hi);
    const w = solveMV(ctx, Math.exp(mid), warm);
    warm = w;
    best = w;
    const s = val(stats(ctx, w, rf));
    if (Math.abs(s - target) < 1e-9) break;
    if (s > target) lo = mid;
    else hi = mid;
  }
  return { w: best, warnings };
}

/**
 * Rockafellar–Uryasev CVaR minimisation:
 *     CVaRα(w) = min_ζ  ζ + 1/((1−α)T) Σₜ max(ℓₜ(w) − ζ, 0),   ℓₜ = −rₜᵀw
 * The hinge is smoothed with a soft-plus of temperature s (annealed → 0) and
 * ζ is minimised *exactly* inside every evaluation (a monotone 1-D root find),
 * so FISTA only sees the well-conditioned reduced function of w (Danskin's
 * theorem gives its gradient). Losses are scaled to unit RMS for conditioning.
 */
function minCvar(ctx: Ctx, scenarios: Matrix, conf: number): { w: Vector; cvar: number } {
  const T = scenarios.length;
  const n = ctx.n;
  const k = 1 / ((1 - conf) * T);
  const lossesOf = (x: Vector) => scenarios.map((r) => -dot(r, x));
  let w = ctx.project(ctx.ref);
  const sd = Math.sqrt(lossesOf(w).reduce((s, l) => s + l * l, 0) / T) || 1e-3;
  const R = scenarios.map((r) => r.map((v) => v / sd));
  const sigmoid = (x: number) => (x > 35 ? 1 : x < -35 ? 0 : 1 / (1 + Math.exp(-x)));
  const softplus = (x: number) => (x > 35 ? x : Math.log1p(Math.exp(x)));

  for (const s of [0.1, 0.03, 0.01, 0.003]) {
    let cacheX: Vector | null = null;
    let cacheF = 0;
    let cacheG: Vector = [];
    const evaluate = (x: Vector) => {
      if (x === cacheX) return;
      const loss = R.map((r) => -dot(r, x));
      let lo = Math.min(...loss) - 50 * s;
      let hi = Math.max(...loss) + 50 * s;
      // h(ζ) = k Σ σ((ℓ−ζ)/s) − 1 is decreasing in ζ; its root minimises over ζ.
      for (let it = 0; it < 80; it++) {
        const mid = 0.5 * (lo + hi);
        let h = -1;
        for (let t = 0; t < T; t++) h += k * sigmoid((loss[t] - mid) / s);
        if (h > 0) lo = mid;
        else hi = mid;
      }
      const zeta = 0.5 * (lo + hi);
      let acc = 0;
      const g = new Array<number>(n).fill(0);
      for (let t = 0; t < T; t++) {
        const u = (loss[t] - zeta) / s;
        acc += s * softplus(u);
        const sig = sigmoid(u);
        if (sig === 0) continue;
        const r = R[t];
        for (let i = 0; i < n; i++) g[i] -= k * sig * r[i];
      }
      cacheX = x;
      cacheF = zeta + k * acc;
      cacheG = g;
    };
    const f = (x: Vector) => {
      evaluate(x);
      return cacheF;
    };
    const grad = (x: Vector) => {
      evaluate(x);
      return cacheG;
    };
    const res = minimizeProjected(f, grad, ctx.project, w, { maxIter: 4000, tol: 1e-9, lipschitz: 1 / s });
    w = res.x;
  }
  const losses = sortedCopy(lossesOf(w));
  const v = quantileSorted(losses, conf);
  const tail = losses.filter((l) => l >= v);
  const cvar = tail.reduce((a, b) => a + b, 0) / Math.max(tail.length, 1);
  return { w, cvar };
}

function finalize(
  objective: Objective,
  w: Vector,
  ctx: Ctx,
  rf: number,
  warnings: string[],
  extra: Partial<OptimizeResult> = {},
): OptimizeResult {
  const clean = w.map((x) => (Math.abs(x) < 1e-10 ? 0 : x));
  const viol = constraintViolation(clean, ctx.constraints);
  if (viol > 1e-6) warnings.push('Some constraints could not be met exactly; the closest feasible portfolio is shown.');
  const s = stats(ctx, clean, rf);
  const rc = riskContributions(clean, ctx.cov);
  return {
    objective,
    weights: clean,
    expectedReturn: s.r,
    volatility: s.v,
    sharpe: s.v > 0 ? (s.r - rf) / s.v : 0,
    diversificationRatio: diversificationRatio(clean, ctx.cov),
    riskContributions: rc.percent,
    converged: viol <= 1e-6,
    warnings,
    ...extra,
  };
}

/** Optimise a portfolio. Throws on infeasible constraints with a readable message. */
export function optimize(req: OptimizeRequest): OptimizeResult {
  const n = req.mu.length;
  if (n === 0) throw new Error('No assets to optimise.');
  if (req.cov.length !== n) throw new Error('Covariance size does not match expected returns.');
  const rf = req.riskFree ?? 0;
  const c = normalizeConstraints(n, req.constraints);
  const issues = feasibilityIssues(c);
  if (issues.length) throw new Error(issues.join(' '));
  const ctx = makeCtx(req.mu, req.cov, c, req.l2 ?? 0);
  const warnings: string[] = [];
  const respect = (w: Vector, what: string) => {
    const projected = ctx.project(w);
    if (constraintViolation(w, c) > 1e-6) {
      warnings.push(`${what} was adjusted to respect your weight limits, so risk is no longer split exactly evenly.`);
      return projected;
    }
    return w;
  };

  switch (req.objective) {
    case 'equal-weight':
      return finalize(req.objective, ctx.project(new Array<number>(n).fill(c.total / n)), ctx, rf, warnings);
    case 'inverse-volatility':
      return finalize(req.objective, respect(inverseVolatility(req.cov).map((x) => x * c.total), 'Inverse-volatility'), ctx, rf, warnings);
    case 'min-variance':
      return finalize(req.objective, solveMV(ctx, Infinity, ctx.ref), ctx, rf, warnings);
    case 'max-utility': {
      const lambda = Math.max(req.riskAversion ?? 3, 1e-6);
      return finalize(req.objective, solveMV(ctx, lambda, ctx.ref), ctx, rf, warnings);
    }
    case 'max-sharpe': {
      const r = maxSharpeOnPath(ctx, rf);
      return finalize(req.objective, r.w, ctx, rf, [...warnings, ...r.warnings]);
    }
    case 'max-diversification': {
      const sigma = req.cov.map((row, i) => Math.sqrt(Math.max(row[i], 0)));
      const dctx = makeCtx(sigma, req.cov, c, req.l2 ?? 0);
      const r = maxSharpeOnPath(dctx, 0);
      return finalize(req.objective, r.w, ctx, rf, warnings);
    }
    case 'target-return': {
      if (req.targetReturn === undefined) throw new Error('targetReturn is required');
      const r = solveForTarget(ctx, req.targetReturn, 'ret', rf);
      return finalize(req.objective, r.w, ctx, rf, [...warnings, ...r.warnings]);
    }
    case 'target-volatility': {
      if (req.targetVolatility === undefined) throw new Error('targetVolatility is required');
      const r = solveForTarget(ctx, req.targetVolatility, 'vol', rf);
      return finalize(req.objective, r.w, ctx, rf, [...warnings, ...r.warnings]);
    }
    case 'risk-parity': {
      const rb = riskBudgeting(req.cov, req.budgets);
      return finalize(req.objective, respect(rb.weights.map((x) => x * c.total), 'Risk parity'), ctx, rf, warnings);
    }
    case 'hrp': {
      const h = hierarchicalRiskParity(req.cov, req.corr);
      return finalize(req.objective, respect(h.weights.map((x) => x * c.total), 'HRP'), ctx, rf, warnings, {
        linkage: h.linkage,
        order: h.order,
      });
    }
    case 'min-cvar': {
      if (!req.scenarios || req.scenarios.length < 30) throw new Error('min-cvar needs at least 30 return scenarios');
      const r = minCvar(ctx, req.scenarios, req.cvarConfidence ?? 0.95);
      return finalize(req.objective, r.w, ctx, rf, warnings, { cvar: r.cvar });
    }
  }
}

/**
 * Uniformly random feasible portfolios (Dirichlet(1) on the simplex, then
 * projected) — rendered as the "cloud" behind the efficient frontier.
 */
export function randomPortfolios(
  mu: Vector,
  cov: Matrix,
  count: number,
  constraints: Partial<Constraints> = {},
  seed = 7,
): { ret: number; vol: number }[] {
  const n = mu.length;
  const c = normalizeConstraints(n, constraints);
  const project = makeProjector(c);
  const rng = createRng(seed);
  const out: { ret: number; vol: number }[] = [];
  for (let k = 0; k < count; k++) {
    const e = Array.from({ length: n }, () => -Math.log(1 - rng.next()));
    const s = e.reduce((a, b) => a + b, 0);
    let w = e.map((x) => (x / s) * c.total);
    if (constraintViolation(w, c) > 1e-9) w = project(w);
    out.push({ ret: dot(mu, w), vol: Math.sqrt(Math.max(quadForm(w, cov), 0)) });
  }
  return out;
}

export { projectCappedSimplex };
