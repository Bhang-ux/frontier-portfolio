/**
 * Deterministic, seedable pseudo-random numbers.
 *
 * Every stochastic routine in Frontier (Monte Carlo, bootstrap, HMM restarts)
 * takes a seed so results are reproducible across runs, browsers and CI —
 * a hard requirement for golden tests and for users comparing scenarios.
 *
 * Generator: sfc32 (Small Fast Counting, Chris Doty-Humphrey) seeded through
 * splitmix32. Passes PractRand to 2^40+ bytes and is ~3x faster than
 * Math.random() polyfills based on xorshift128+ in V8.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Standard normal N(0, 1). */
  normal(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** Standardised Student-t with `dof` degrees of freedom (unit variance; dof > 2). */
  studentT(dof: number): number;
  /** Gamma(shape, 1) variate. */
  gamma(shape: number): number;
}

function splitmix32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

export function createRng(seed = 42): Rng {
  const init = splitmix32(seed);
  let a = init();
  let b = init();
  let c = init();
  let d = init();

  const next = (): number => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };

  // Warm up: discard the first outputs so nearby seeds decorrelate fully.
  for (let i = 0; i < 12; i++) next();

  let spare: number | null = null;
  const normal = (): number => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    // Marsaglia polar method — exact, no trig calls.
    let u: number, v: number, s: number;
    do {
      u = next() * 2 - 1;
      v = next() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * m;
    return u * m;
  };

  const gamma = (shape: number): number => {
    // Marsaglia & Tsang (2000). For shape < 1 use the boosting identity.
    if (shape < 1) {
      const u = next();
      return gamma(shape + 1) * Math.pow(u === 0 ? Number.MIN_VALUE : u, 1 / shape);
    }
    const dd = shape - 1 / 3;
    const cc = 1 / Math.sqrt(9 * dd);
    for (;;) {
      let x: number, v: number;
      do {
        x = normal();
        v = 1 + cc * x;
      } while (v <= 0);
      v = v * v * v;
      const u = next();
      if (u < 1 - 0.0331 * x * x * x * x) return dd * v;
      if (Math.log(u) < 0.5 * x * x + dd * (1 - v + Math.log(v))) return dd * v;
    }
  };

  const studentT = (dof: number): number => {
    if (!(dof > 2)) throw new Error('studentT requires dof > 2 for finite variance');
    const z = normal();
    const chi2 = 2 * gamma(dof / 2);
    const t = z / Math.sqrt(chi2 / dof);
    return t * Math.sqrt((dof - 2) / dof); // rescale to unit variance
  };

  return {
    next,
    normal,
    gamma,
    studentT,
    int: (n: number) => Math.floor(next() * n),
  };
}
