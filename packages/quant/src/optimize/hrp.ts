/**
 * Hierarchical Risk Parity (López de Prado, 2016).
 *
 * 1. Tree clustering: single-linkage on the correlation distance
 *    dᵢⱼ = √(½(1 − ρᵢⱼ)).
 * 2. Quasi-diagonalisation: order assets by the dendrogram's leaves so similar
 *    assets sit next to each other.
 * 3. Recursive bisection: split the ordered list in halves and allocate
 *    between halves inversely to each half's (inverse-variance) cluster risk.
 *
 * No matrix inversion ⇒ no error maximisation: HRP stays stable even when Σ is
 * singular and is a strong out-of-sample baseline. The linkage matrix uses
 * SciPy's conventions (merge ids n+k, smaller id first) so results match
 * PyPortfolioOpt exactly in golden tests.
 */
import type { Matrix, Vector } from '../linalg';
import { covToCorr } from '../covariance';

/** Row k: [clusterA, clusterB, distance, size] — SciPy linkage format. */
export type Linkage = [number, number, number, number][];

export function correlationDistance(corr: Matrix): Matrix {
  return corr.map((row) => row.map((rho) => Math.sqrt(Math.min(1, Math.max(0, (1 - rho) / 2)))));
}

/** Single-linkage agglomerative clustering via Prim's MST + union-find labelling. */
export function singleLinkage(dist: Matrix): Linkage {
  const n = dist.length;
  if (n < 2) return [];
  const inTree = new Array<boolean>(n).fill(false);
  const best = new Array<number>(n).fill(Infinity);
  const parent = new Array<number>(n).fill(-1);
  const edges: { a: number; b: number; d: number; order: number }[] = [];
  let current = 0;
  inTree[0] = true;
  for (let k = 0; k < n - 1; k++) {
    let next = -1;
    let nextD = Infinity;
    for (let i = 0; i < n; i++) {
      if (inTree[i]) continue;
      const d = dist[current][i];
      if (d < best[i]) {
        best[i] = d;
        parent[i] = current;
      }
      if (best[i] < nextD) {
        nextD = best[i];
        next = i;
      }
    }
    inTree[next] = true;
    edges.push({ a: parent[next], b: next, d: nextD, order: k });
    current = next;
  }
  edges.sort((x, y) => x.d - y.d || x.order - y.order); // stable, like mergesort
  // Union-find where every merge creates a new node id n + k.
  const uf = new Array<number>(2 * n - 1).fill(-1);
  const size = new Array<number>(2 * n - 1).fill(1);
  const find = (x: number): number => {
    let r = x;
    while (uf[r] >= 0) r = uf[r];
    while (uf[x] >= 0) {
      const p = uf[x];
      uf[x] = r;
      x = p;
    }
    return r;
  };
  const Z: Linkage = [];
  edges.forEach((e, k) => {
    const ra = find(e.a);
    const rb = find(e.b);
    const id = n + k;
    uf[ra] = id;
    uf[rb] = id;
    size[id] = size[ra] + size[rb];
    Z.push([Math.min(ra, rb), Math.max(ra, rb), e.d, size[id]]);
  });
  return Z;
}

/** Leaf order of the dendrogram (left-to-right DFS from the root). */
export function quasiDiagonalOrder(Z: Linkage, n: number): number[] {
  if (n === 1) return [0];
  const out: number[] = [];
  const stack: number[] = [n + Z.length - 1];
  while (stack.length) {
    const node = stack.pop()!;
    if (node < n) out.push(node);
    else {
      const [a, b] = Z[node - n];
      stack.push(b, a); // pop a first ⇒ left-to-right
    }
  }
  return out;
}

function clusterVariance(cov: Matrix, items: number[]): number {
  const ivp = items.map((i) => 1 / cov[i][i]);
  const s = ivp.reduce((a, b) => a + b, 0);
  const w = ivp.map((v) => v / s);
  let v = 0;
  for (let a = 0; a < items.length; a++) for (let b = 0; b < items.length; b++) v += w[a] * w[b] * cov[items[a]][items[b]];
  return v;
}

export interface HrpResult {
  weights: Vector;
  order: number[];
  linkage: Linkage;
}

export function hierarchicalRiskParity(cov: Matrix, corrIn?: Matrix): HrpResult {
  const n = cov.length;
  if (n === 1) return { weights: [1], order: [0], linkage: [] };
  const corr = corrIn ?? covToCorr(cov).corr;
  const Z = singleLinkage(correlationDistance(corr));
  const order = quasiDiagonalOrder(Z, n);
  const w = new Array<number>(n).fill(1);
  let clusters: number[][] = [order];
  while (clusters.length > 0) {
    const next: number[][] = [];
    for (const c of clusters) {
      if (c.length > 1) {
        const h = Math.floor(c.length / 2);
        next.push(c.slice(0, h), c.slice(h));
      }
    }
    clusters = next;
    for (let i = 0; i < clusters.length; i += 2) {
      const a = clusters[i];
      const b = clusters[i + 1];
      const va = clusterVariance(cov, a);
      const vb = clusterVariance(cov, b);
      const alpha = 1 - va / (va + vb);
      for (const k of a) w[k] *= alpha;
      for (const k of b) w[k] *= 1 - alpha;
    }
  }
  return { weights: w, order, linkage: Z };
}
