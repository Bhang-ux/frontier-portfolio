/**
 * Feasible sets for long-only portfolio construction and exact Euclidean
 * projections onto them.
 *
 *   C = { w : lᵢ ≤ wᵢ ≤ uᵢ, Σwᵢ = s }  ∩  { group bounds }
 *
 * Projection onto the capped simplex is solved exactly by bisection on the
 * KKT multiplier; group (asset-class) bounds are half-spaces combined with
 * Dykstra's algorithm, which — unlike naive alternating projections —
 * converges to the true projection onto the intersection, preserving the
 * convergence guarantees of projected-gradient methods.
 */
import type { Vector } from '../linalg';

export interface GroupConstraint {
  label?: string;
  members: number[];
  lower?: number;
  upper?: number;
}

export interface Constraints {
  lower: Vector;
  upper: Vector;
  /** Budget, Σw = total (default 1 — fully invested). */
  total: number;
  groups: GroupConstraint[];
}

export function normalizeConstraints(n: number, c: Partial<Constraints> = {}): Constraints {
  const lower = c.lower && c.lower.length === n ? c.lower.slice() : new Array<number>(n).fill(0);
  const upper = c.upper && c.upper.length === n ? c.upper.slice() : new Array<number>(n).fill(1);
  return {
    lower: lower.map((l) => Math.max(0, l)),
    upper: upper.map((u, i) => Math.max(u, lower[i])),
    total: c.total ?? 1,
    groups: (c.groups ?? []).filter((g) => g.members.length > 0),
  };
}

/** Necessary feasibility conditions; returns human-readable problems (empty ⇒ OK). */
export function feasibilityIssues(c: Constraints): string[] {
  const issues: string[] = [];
  const sumL = c.lower.reduce((a, b) => a + b, 0);
  const sumU = c.upper.reduce((a, b) => a + b, 0);
  if (sumL > c.total + 1e-9) issues.push(`Minimum weights add up to ${(sumL * 100).toFixed(1)}% — more than 100%.`);
  if (sumU < c.total - 1e-9)
    issues.push(`Maximum weights add up to only ${(sumU * 100).toFixed(1)}% — raise the per-asset cap.`);
  for (const g of c.groups) {
    const gl = g.members.reduce((a, i) => a + c.lower[i], 0);
    const gu = g.members.reduce((a, i) => a + c.upper[i], 0);
    if (g.upper !== undefined && gl > g.upper + 1e-9)
      issues.push(`${g.label ?? 'A group'}: member minimums exceed the group cap.`);
    if (g.lower !== undefined && gu < g.lower - 1e-9)
      issues.push(`${g.label ?? 'A group'}: member maximums can't reach the group minimum.`);
    if (g.lower !== undefined && g.upper !== undefined && g.lower > g.upper + 1e-9)
      issues.push(`${g.label ?? 'A group'}: minimum is above maximum.`);
  }
  return issues;
}

/**
 * Exact projection onto { l ≤ w ≤ u, Σw = s }:
 *   wᵢ(τ) = clip(vᵢ − τ, lᵢ, uᵢ), with τ chosen so Σwᵢ(τ) = s.
 * g(τ) = Σ wᵢ(τ) is monotone non-increasing, so bisection is globally convergent.
 */
export function projectCappedSimplex(v: Vector, lower: Vector, upper: Vector, total = 1): Vector {
  const n = v.length;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    lo = Math.min(lo, v[i] - upper[i]);
    hi = Math.max(hi, v[i] - lower[i]);
  }
  const g = (tau: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Math.min(upper[i], Math.max(lower[i], v[i] - tau));
    return s;
  };
  for (let it = 0; it < 100; it++) {
    const mid = 0.5 * (lo + hi);
    if (g(mid) > total) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-15 * Math.max(1, Math.abs(mid))) break;
  }
  const tau = 0.5 * (lo + hi);
  const w = v.map((x, i) => Math.min(upper[i], Math.max(lower[i], x - tau)));
  // Distribute the (tiny) residual over free coordinates for an exact budget.
  const resid = total - w.reduce((a, b) => a + b, 0);
  if (Math.abs(resid) > 0) {
    const free = w.map((x, i) => (x > lower[i] + 1e-15 && x < upper[i] - 1e-15 ? i : -1)).filter((i) => i >= 0);
    if (free.length) for (const i of free) w[i] += resid / free.length;
  }
  return w;
}

function projectHalfspace(x: Vector, members: number[], bound: number, kind: 'upper' | 'lower'): Vector {
  let s = 0;
  for (const i of members) s += x[i];
  const viol = kind === 'upper' ? s - bound : bound - s;
  if (viol <= 0) return x;
  const out = x.slice();
  const shift = viol / members.length;
  for (const i of members) out[i] += kind === 'upper' ? -shift : shift;
  return out;
}

export type Projector = (v: Vector) => Vector;

const groupsAreDisjoint = (groups: GroupConstraint[]): boolean => {
  const seen = new Set<number>();
  for (const g of groups) for (const i of g.members) {
    if (seen.has(i)) return false;
    seen.add(i);
  }
  return true;
};

/**
 * Exact projection when group constraints are disjoint (the asset-class case).
 * KKT: wᵢ = clip(vᵢ − τ − λ_G(i), lᵢ, uᵢ). For fixed τ each group's multiplier
 * simply clamps its sum into [lower_G, upper_G], so the total
 *   S(τ) = Σ_G median(lo_G, Σ_{i∈G} clip(vᵢ−τ), hi_G) + Σ_{ungrouped} clip(vᵢ−τ)
 * is monotone in τ: one outer bisection for τ, then one per active group.
 */
function projectDisjointGroups(v: Vector, c: Constraints): Vector {
  const n = v.length;
  const groupOf = new Array<number>(n).fill(-1);
  c.groups.forEach((g, k) => g.members.forEach((i) => (groupOf[i] = k)));
  const ungrouped = v.map((_, i) => i).filter((i) => groupOf[i] < 0);
  const lo = c.groups.map((g) => g.lower ?? -Infinity);
  const hi = c.groups.map((g) => g.upper ?? Infinity);
  const clipAt = (i: number, shift: number) => Math.min(c.upper[i], Math.max(c.lower[i], v[i] - shift));
  const groupSum = (k: number, shift: number) => c.groups[k].members.reduce((s, i) => s + clipAt(i, shift), 0);
  const median = (a: number, x: number, b: number) => Math.min(b, Math.max(a, x));
  const total = (tau: number) => {
    let s = 0;
    for (const i of ungrouped) s += clipAt(i, tau);
    for (let k = 0; k < c.groups.length; k++) s += median(lo[k], groupSum(k, tau), hi[k]);
    return s;
  };
  const bisect = (f: (x: number) => number, target: number, a0: number, b0: number) => {
    let a = a0;
    let b = b0;
    for (let it = 0; it < 200; it++) {
      const m = 0.5 * (a + b);
      if (f(m) > target) a = m;
      else b = m;
      if (b - a <= 1e-16 * Math.max(1, Math.abs(m))) break;
    }
    return 0.5 * (a + b);
  };
  let tLo = Infinity;
  let tHi = -Infinity;
  for (let i = 0; i < n; i++) {
    tLo = Math.min(tLo, v[i] - c.upper[i]);
    tHi = Math.max(tHi, v[i] - c.lower[i]);
  }
  const span = Math.max(tHi - tLo, 1);
  const tau = bisect(total, c.total, tLo - span, tHi + span);
  const w = new Array<number>(n);
  for (const i of ungrouped) w[i] = clipAt(i, tau);
  c.groups.forEach((g, k) => {
    const raw = groupSum(k, tau);
    const target = median(lo[k], raw, hi[k]);
    let shift = tau;
    if (target !== raw) {
      const sLo = Math.min(...g.members.map((i) => v[i] - c.upper[i]));
      const sHi = Math.max(...g.members.map((i) => v[i] - c.lower[i]));
      shift = bisect((s) => groupSum(k, s), target, sLo - span, sHi + span);
    }
    for (const i of g.members) w[i] = clipAt(i, shift);
  });
  return w;
}

/** Build the exact Euclidean projector for a constraint set. */
export function makeProjector(c: Constraints): Projector {
  const base: Projector = (v) => projectCappedSimplex(v, c.lower, c.upper, c.total);
  if (c.groups.length > 0 && groupsAreDisjoint(c.groups)) return (v) => projectDisjointGroups(v, c);
  // Overlapping groups: Dykstra's alternating projections onto the intersection.
  const halfspaces: Projector[] = [];
  for (const g of c.groups) {
    if (g.upper !== undefined) halfspaces.push((x) => projectHalfspace(x, g.members, g.upper!, 'upper'));
    if (g.lower !== undefined) halfspaces.push((x) => projectHalfspace(x, g.members, g.lower!, 'lower'));
  }
  if (halfspaces.length === 0) return base;
  const sets: Projector[] = [...halfspaces, base]; // base last ⇒ output always satisfies box + budget
  return (v: Vector) => {
    const n = v.length;
    let x = v.slice();
    const incr: Vector[] = sets.map(() => new Array<number>(n).fill(0));
    for (let iter = 0; iter < 2000; iter++) {
      const prev = x;
      for (let k = 0; k < sets.length; k++) {
        const z = x.map((xi, i) => xi + incr[k][i]);
        const y = sets[k](z);
        incr[k] = z.map((zi, i) => zi - y[i]);
        x = y;
      }
      let diff = 0;
      for (let i = 0; i < n; i++) diff = Math.max(diff, Math.abs(x[i] - prev[i]));
      if (diff < 1e-13) break;
    }
    return x;
  };
}

/** Max violation of any constraint (0 ⇒ feasible). */
export function constraintViolation(w: Vector, c: Constraints): number {
  let v = Math.abs(w.reduce((a, b) => a + b, 0) - c.total);
  w.forEach((x, i) => {
    v = Math.max(v, c.lower[i] - x, x - c.upper[i]);
  });
  for (const g of c.groups) {
    const s = g.members.reduce((a, i) => a + w[i], 0);
    if (g.upper !== undefined) v = Math.max(v, s - g.upper);
    if (g.lower !== undefined) v = Math.max(v, g.lower - s);
  }
  return Math.max(v, 0);
}
