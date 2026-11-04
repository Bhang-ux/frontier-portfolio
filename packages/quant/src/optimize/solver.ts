/**
 * Monotone FISTA (Beck & Teboulle 2009) with backtracking line search —
 * a first-order method for  min f(x)  s.t.  x ∈ C  given ∇f and the
 * Euclidean projector onto C.
 *
 * Why not an interior-point QP solver? Our problems are small and smooth,
 * the feasible set has a cheap exact projection, and a ~100-line solver with
 * zero dependencies runs identically in Node, the browser and a Web Worker.
 * O(1/k²) convergence reaches 1e-9 accuracy in a few hundred iterations,
 * which golden tests verify against CVXPY/OSQP solutions.
 */
import type { Vector } from '../linalg';
import type { Projector } from './constraints';

export interface SolverOptions {
  maxIter?: number;
  /** Stop when the iterate moves less than tol (∞-norm). */
  tol?: number;
  /** Initial Lipschitz estimate (1/step size). */
  lipschitz?: number;
}

export interface SolverResult {
  x: Vector;
  value: number;
  iterations: number;
  converged: boolean;
}

export function minimizeProjected(
  f: (x: Vector) => number,
  grad: (x: Vector) => Vector,
  project: Projector,
  x0: Vector,
  opts: SolverOptions = {},
): SolverResult {
  const maxIter = opts.maxIter ?? 5000;
  const tol = opts.tol ?? 1e-10;
  let L = opts.lipschitz && opts.lipschitz > 0 ? opts.lipschitz : 1;
  const n = x0.length;

  let x = project(x0);
  let fx = f(x);
  let y = x.slice();
  let t = 1;
  let converged = false;
  let iter = 0;

  for (iter = 1; iter <= maxIter; iter++) {
    const gy = grad(y);
    const fy = f(y);
    let z: Vector;
    let fz: number;
    // Backtracking: find L with the sufficient-decrease (descent lemma) condition.
    for (let bt = 0; ; bt++) {
      const step = y.map((yi, i) => yi - gy[i] / L);
      z = project(step);
      fz = f(z);
      let lin = 0;
      let quad = 0;
      for (let i = 0; i < n; i++) {
        const d = z[i] - y[i];
        lin += gy[i] * d;
        quad += d * d;
      }
      if (fz <= fy + lin + 0.5 * L * quad + 1e-14 * Math.abs(fy) || bt > 60) break;
      L *= 2;
    }
    // Monotone step: never accept an increase in the objective.
    const xNew = fz <= fx ? z : x;
    const fNew = Math.min(fz, fx);
    const tNew = 0.5 * (1 + Math.sqrt(1 + 4 * t * t));
    let move = 0;
    for (let i = 0; i < n; i++) move = Math.max(move, Math.abs(xNew[i] - x[i]));
    const zMove = z.reduce((m, zi, i) => Math.max(m, Math.abs(zi - y[i])), 0);
    y = xNew.map((xi, i) => xi + (t / tNew) * (z[i] - xi) + ((t - 1) / tNew) * (xi - x[i]));
    x = xNew;
    fx = fNew;
    t = tNew;
    if (move < tol && zMove < tol * 10) {
      converged = true;
      break;
    }
    // Gentle step-size recovery so one bad backtrack doesn't throttle forever.
    L *= 0.95;
  }
  return { x, value: fx, iterations: iter, converged };
}
