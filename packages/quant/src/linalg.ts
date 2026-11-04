/**
 * Dense linear algebra for small, symmetric problems (n ≤ ~200 assets).
 *
 * Plain number[][] matrices keep the code readable and serialisable across
 * the Web Worker boundary (structured clone) without conversion. At the sizes
 * a portfolio tool sees, the O(n³) kernels below run in well under 50 ms.
 */

export type Vector = number[];
export type Matrix = number[][];

export const zeros = (n: number): Vector => new Array<number>(n).fill(0);

export const zerosMatrix = (rows: number, cols: number): Matrix =>
  Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

export const identity = (n: number): Matrix => {
  const m = zerosMatrix(n, n);
  for (let i = 0; i < n; i++) m[i][i] = 1;
  return m;
};

export const sum = (v: ArrayLike<number>): number => {
  // Neumaier compensated summation: cheap insurance for long return series.
  let s = 0;
  let c = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    const t = s + x;
    c += Math.abs(s) >= Math.abs(x) ? s - t + x : x - t + s;
    s = t;
  }
  return s + c;
};

export const dot = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

export const add = (a: Vector, b: Vector): Vector => a.map((x, i) => x + b[i]);
export const sub = (a: Vector, b: Vector): Vector => a.map((x, i) => x - b[i]);
export const scale = (a: Vector, k: number): Vector => a.map((x) => x * k);
export const norm2 = (a: Vector): number => Math.sqrt(dot(a, a));
export const normInf = (a: Vector): number => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

export const matVec = (A: Matrix, x: ArrayLike<number>): Vector => {
  const n = A.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const row = A[i];
    let s = 0;
    for (let j = 0; j < row.length; j++) s += row[j] * x[j];
    out[i] = s;
  }
  return out;
};

export const transpose = (A: Matrix): Matrix => {
  if (A.length === 0) return [];
  const r = A.length;
  const c = A[0].length;
  const T = zerosMatrix(c, r);
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) T[j][i] = A[i][j];
  return T;
};

export const matMul = (A: Matrix, B: Matrix): Matrix => {
  const r = A.length;
  const k = B.length;
  const c = B[0]?.length ?? 0;
  const C = zerosMatrix(r, c);
  for (let i = 0; i < r; i++) {
    const Ai = A[i];
    const Ci = C[i];
    for (let p = 0; p < k; p++) {
      const a = Ai[p];
      if (a === 0) continue;
      const Bp = B[p];
      for (let j = 0; j < c; j++) Ci[j] += a * Bp[j];
    }
  }
  return C;
};

/** xᵀ A x */
export const quadForm = (x: ArrayLike<number>, A: Matrix): number => {
  let s = 0;
  for (let i = 0; i < A.length; i++) {
    const row = A[i];
    let ri = 0;
    for (let j = 0; j < row.length; j++) ri += row[j] * x[j];
    s += x[i] * ri;
  }
  return s;
};

export const diag = (A: Matrix): Vector => A.map((row, i) => row[i]);

export const diagMatrix = (v: Vector): Matrix => {
  const m = zerosMatrix(v.length, v.length);
  for (let i = 0; i < v.length; i++) m[i][i] = v[i];
  return m;
};

export const symmetrize = (A: Matrix): Matrix => {
  const n = A.length;
  const S = zerosMatrix(n, n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) S[i][j] = 0.5 * (A[i][j] + A[j][i]);
  return S;
};

export const trace = (A: Matrix): number => A.reduce((s, row, i) => s + row[i], 0);

export const cloneMatrix = (A: Matrix): Matrix => A.map((r) => r.slice());

/** Sub-matrix by index list (rows & cols). */
export const subMatrix = (A: Matrix, idx: number[]): Matrix => idx.map((i) => idx.map((j) => A[i][j]));

/**
 * Cholesky factorisation A = L Lᵀ. Returns null when A is not (numerically)
 * positive definite so callers can decide how to regularise.
 */
export function cholesky(A: Matrix): Matrix | null {
  const n = A.length;
  const L = zerosMatrix(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      const Li = L[i];
      const Lj = L[j];
      for (let k = 0; k < j; k++) s -= Li[k] * Lj[k];
      if (i === j) {
        if (!(s > 0) || !Number.isFinite(s)) return null;
        Li[i] = Math.sqrt(s);
      } else {
        Li[j] = s / Lj[j];
      }
    }
  }
  return L;
}

/**
 * Cholesky with progressive diagonal jitter — the standard fix for sample
 * covariances that are PSD-but-singular (e.g. T < n, or duplicated assets).
 */
export function choleskyRobust(A: Matrix): { L: Matrix; jitter: number } {
  const n = A.length;
  let L = cholesky(A);
  if (L) return { L, jitter: 0 };
  const base = Math.max(trace(A) / Math.max(n, 1), 1e-12);
  for (let e = -10; e <= 0; e++) {
    const jitter = base * Math.pow(10, e);
    const B = A.map((row, i) => row.map((v, j) => (i === j ? v + jitter : v)));
    L = cholesky(B);
    if (L) return { L, jitter };
  }
  throw new Error('choleskyRobust: matrix is not positive semi-definite');
}

export function solveLower(L: Matrix, b: Vector): Vector {
  const n = L.length;
  const y = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  return y;
}

export function solveUpperFromLowerT(L: Matrix, y: Vector): Vector {
  // Solves Lᵀ x = y without materialising Lᵀ.
  const n = L.length;
  const x = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

/** Solve A x = b for symmetric positive-definite A. */
export function solveSPD(A: Matrix, b: Vector): Vector {
  const { L } = choleskyRobust(A);
  return solveUpperFromLowerT(L, solveLower(L, b));
}

/** Solve A X = B (B given column-wise as a matrix n×m) for SPD A. */
export function solveSPDMatrix(A: Matrix, B: Matrix): Matrix {
  const { L } = choleskyRobust(A);
  const cols = B[0]?.length ?? 0;
  const X = zerosMatrix(A.length, cols);
  for (let c = 0; c < cols; c++) {
    const col = B.map((r) => r[c]);
    const x = solveUpperFromLowerT(L, solveLower(L, col));
    for (let i = 0; i < x.length; i++) X[i][c] = x[i];
  }
  return X;
}

export function invertSPD(A: Matrix): Matrix {
  return solveSPDMatrix(A, identity(A.length));
}

/** General square solve with partial pivoting (Gaussian elimination). */
export function solveLinear(A: Matrix, b: Vector): Vector {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-14) throw new Error('solveLinear: singular matrix');
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = zeros(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

export interface Eigen {
  /** Eigenvalues, sorted descending. */
  values: Vector;
  /** Column j of `vectors` is the unit eigenvector for values[j]. */
  vectors: Matrix;
}

/**
 * Cyclic Jacobi eigen-decomposition for real symmetric matrices.
 * Unconditionally stable and accurate to machine precision; O(n³) per sweep
 * with typically 6–10 sweeps — ideal for covariance/correlation matrices.
 */
export function eigenSymmetric(Ain: Matrix, maxSweeps = 100): Eigen {
  const n = Ain.length;
  const A = symmetrize(Ain);
  const V = identity(n);
  const offNorm = () => {
    let s = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) s += A[i][j] * A[i][j];
    return Math.sqrt(s);
  };
  const scaleRef = Math.max(
    1e-300,
    Math.sqrt(A.reduce((s, row) => s + row.reduce((t, v) => t + v * v, 0), 0)),
  );
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    if (offNorm() <= 1e-15 * scaleRef) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p][q];
        if (Math.abs(apq) < 1e-300) continue;
        const app = A[p][p];
        const aqq = A[q][q];
        const theta = (aqq - app) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k][p];
          const akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k];
          const aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p];
          const vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => A[j][j] - A[i][i]);
  const values = order.map((i) => A[i][i]);
  const vectors = zerosMatrix(n, n);
  order.forEach((src, dst) => {
    // Deterministic sign: make the largest-magnitude component positive.
    let big = 0;
    for (let k = 0; k < n; k++) if (Math.abs(V[k][src]) > Math.abs(V[big][src])) big = k;
    const sgn = V[big][src] < 0 ? -1 : 1;
    for (let k = 0; k < n; k++) vectors[k][dst] = sgn * V[k][src];
  });
  return { values, vectors };
}

/** Reconstruct V diag(λ) Vᵀ. */
export function fromEigen(values: Vector, vectors: Matrix): Matrix {
  const n = values.length;
  const M = zerosMatrix(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += vectors[i][k] * values[k] * vectors[j][k];
      M[i][j] = s;
      M[j][i] = s;
    }
  }
  return M;
}

/** Nearest positive semi-definite matrix by eigenvalue clipping (Higham-style repair). */
export function nearestPSD(A: Matrix, minEigen = 1e-12): Matrix {
  const { values, vectors } = eigenSymmetric(A);
  const floor = Math.max(minEigen, 0);
  return fromEigen(
    values.map((v) => Math.max(v, floor)),
    vectors,
  );
}

/** Largest eigenvalue via power iteration — used for gradient step sizes. */
export function largestEigenvalue(A: Matrix, iters = 200): number {
  const n = A.length;
  if (n === 0) return 0;
  let v = new Array<number>(n).fill(1 / Math.sqrt(n));
  let lambda = 0;
  for (let k = 0; k < iters; k++) {
    const w = matVec(A, v);
    const nw = norm2(w);
    if (nw === 0) return 0;
    const next = dot(v, w);
    v = w.map((x) => x / nw);
    if (Math.abs(next - lambda) <= 1e-12 * Math.max(1, Math.abs(next))) return next;
    lambda = next;
  }
  return lambda;
}
