/**
 * Modelled constant-maturity Treasury total-return indices.
 *
 * Treasury ETFs' prices are not freely republishable, but the yields they
 * respond to are public-domain Federal Reserve data (H.15, via FRED). Each
 * day we hold a freshly issued par bond of maturity M (coupon = yesterday's
 * yield), reprice it at today's yield with M − Δt years left, collect the
 * coupon accrued over Δt, and roll into a new par bond:
 *
 *   r_t = P(c = y_{t−1}, y = y_t, n = M − Δt) − 1 + y_{t−1}·Δt
 *
 * This captures carry, duration and convexity exactly — the standard way to
 * build bond-return series from yields (e.g. Swinkels 2019). It ignores fees
 * and the bid/ask of a real fund, and is labelled "modelled" in the app.
 */
import type { Series } from '@frontier/quant';

/** Price per 1 face of a bond paying coupon rate c, f times a year, at yield y, n years to maturity. */
export function parBondPrice(c: number, y: number, n: number, f = 2): number {
  if (n <= 0) return 1;
  if (Math.abs(y) < 1e-10) return 1 + c * n;
  const v = Math.pow(1 + y / f, -f * n);
  return (c / y) * (1 - v) + v;
}

/** Total-return level index from a yield series in percent (e.g. FRED DGS10). */
export function bondIndexFromYields(yields: Series, maturityYears: number, base = 100): Series {
  const dates: number[] = [];
  const values: number[] = [];
  let level = base;
  for (let t = 0; t < yields.dates.length; t++) {
    if (t > 0) {
      const dt = (yields.dates[t] - yields.dates[t - 1]) / 365.25;
      const c = yields.values[t - 1] / 100;
      const y = yields.values[t] / 100;
      const r = parBondPrice(c, y, maturityYears - dt) - 1 + c * dt;
      level *= 1 + r;
    }
    dates.push(yields.dates[t]);
    values.push(level);
  }
  return { dates, values };
}

/** Modified duration (years) of a par bond — for documentation & tests. */
export function modifiedDuration(y: number, n: number, f = 2): number {
  const h = 1e-5;
  return -(parBondPrice(y, y + h, n, f) - parBondPrice(y, y - h, n, f)) / (2 * h);
}
