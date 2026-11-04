/**
 * Risk budgeting / Equal Risk Contribution (ERC).
 *
 * Solves Spinu's (2013) strictly convex reformulation
 *     min_y ½ yᵀΣy − Σ bᵢ ln yᵢ ,  y > 0
 * whose optimum satisfies yᵢ(Σy)ᵢ = bᵢ — i.e. risk contributions proportional
 * to the budgets — then normalises w = y / Σy. Cyclical coordinate descent
 * (Griveau-Billion, Richard & Roncalli 2013) has a closed-form update per
 * coordinate and converges linearly.
 */
import type { Matrix, Vector } from '../linalg';

export function riskBudgeting(
  cov: Matrix,
  budgets?: Vector,
  opts: { maxIter?: number; tol?: number } = {},
): { weights: Vector; iterations: number; converged: boolean } {
  const n = cov.length;
  const b0 = budgets && budgets.length === n ? budgets : new Array<number>(n).fill(1 / n);
  const bs = b0.reduce((a, x) => a + Math.max(x, 0), 0) || 1;
  const b = b0.map((x) => Math.max(x, 1e-12) / bs);
  const maxIter = opts.maxIter ?? 10_000;
  const tol = opts.tol ?? 1e-12;
  // Start from inverse-volatility, a good approximation of ERC.
  const y = cov.map((row, i) => 1 / Math.sqrt(Math.max(row[i], 1e-18)));
  const Sy = cov.map((row) => row.reduce((s, v, j) => s + v * y[j], 0));
  let converged = false;
  let it = 0;
  for (it = 1; it <= maxIter; it++) {
    let maxRel = 0;
    for (let i = 0; i < n; i++) {
      const a = cov[i][i];
      const c = Sy[i] - a * y[i];
      const yi = (-c + Math.sqrt(c * c + 4 * a * b[i])) / (2 * a);
      const d = yi - y[i];
      if (d !== 0) {
        for (let k = 0; k < n; k++) Sy[k] += cov[k][i] * d;
        maxRel = Math.max(maxRel, Math.abs(d) / Math.max(Math.abs(yi), 1e-300));
        y[i] = yi;
      }
    }
    if (maxRel < tol) {
      converged = true;
      break;
    }
  }
  const s = y.reduce((a, x) => a + x, 0);
  return { weights: y.map((x) => x / s), iterations: it, converged };
}

/** Naive risk parity: wᵢ ∝ 1/σᵢ (ignores correlations). */
export function inverseVolatility(cov: Matrix): Vector {
  const iv = cov.map((row, i) => 1 / Math.sqrt(Math.max(row[i], 1e-18)));
  const s = iv.reduce((a, b) => a + b, 0);
  return iv.map((x) => x / s);
}
