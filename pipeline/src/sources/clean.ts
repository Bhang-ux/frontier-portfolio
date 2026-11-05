/**
 * Source-agnostic cleaning and splicing for daily price series.
 *
 * Every adapter funnels its output through `cleanSeries`, so the same rules
 * apply whether a price came from AMFI, FRED, Binance or the ECB:
 *   - sort by date, last duplicate wins, drop non-finite / non-positive prints;
 *   - undo unit splits / re-denominations (a permanent ×k jump at a round k);
 *   - remove single-day bad prints that fully revert the next day.
 */
import { convertSeries, valueAsOf, type Series } from '@frontier/quant';

const finite = (x: number) => Number.isFinite(x);

export function sortDedupe(dates: number[], values: number[]): Series {
  const byDay = new Map<number, number>();
  for (let i = 0; i < dates.length; i++) {
    const v = values[i];
    if (!finite(dates[i]) || !finite(v) || v <= 0) continue;
    byDay.set(dates[i], v); // later duplicates win
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);
  return { dates: days, values: days.map((d) => byDay.get(d)!) };
}

const SPLIT_FACTORS = [5, 10, 20, 25, 50, 100, 1000];

/**
 * Detect re-denominations: a one-day ratio within 3 % of a round factor k ≥ 5
 * (or 1/k) that does NOT revert. Earlier history is rescaled so returns are
 * continuous. A fund NAV never moves ×5 in a day; an ETF whose units are
 * split 1:10 or 1:100 does. Only applied to fund NAVs — a crypto collapse
 * must never be "repaired".
 */
export function fixUnitSplits(s: Series): { series: Series; splits: { date: number; factor: number }[] } {
  const values = s.values.slice();
  const splits: { date: number; factor: number }[] = [];
  for (let t = values.length - 1; t >= 1; t--) {
    const ratio = values[t] / values[t - 1];
    if (ratio > 0.2 && ratio < 5) continue;
    const k = ratio >= 1 ? ratio : 1 / ratio;
    const f = SPLIT_FACTORS.find((c) => Math.abs(k / c - 1) < 0.03);
    if (!f) continue;
    // must persist: the next point (if any) stays near the new level
    if (t + 1 < values.length && Math.abs(values[t + 1] / values[t] - 1) > 0.3) continue;
    const scale = ratio >= 1 ? f : 1 / f;
    for (let i = 0; i < t; i++) values[i] *= scale;
    splits.push({ date: s.dates[t], factor: scale });
  }
  return { series: { dates: s.dates, values }, splits };
}

/**
 * Remove single-day bad prints: a point that jumps > 40 % and fully reverts
 * the next day is almost always a data error, not a market move.
 */
export function removeSpikes(s: Series): Series {
  const keep = s.values.map(() => true);
  for (let t = 1; t < s.values.length - 1; t++) {
    const up = s.values[t] / s.values[t - 1] - 1;
    const back = s.values[t + 1] / s.values[t] - 1;
    if (Math.abs(up) > 0.4 && Math.abs((1 + up) * (1 + back) - 1) < 0.1) keep[t] = false;
  }
  return { dates: s.dates.filter((_, i) => keep[i]), values: s.values.filter((_, i) => keep[i]) };
}

export function cleanSeries(dates: number[], values: number[], opts: { splits?: boolean } = {}): Series {
  const s = sortDedupe(dates, values);
  return removeSpikes(opts.splits ? fixUnitSplits(s).series : s);
}

/**
 * Chain-link a longer `backfill` history in front of `primary`: backfill
 * points strictly before primary's first date are rescaled so the two meet
 * exactly at that date. Returns are preserved on both sides of the seam.
 * Used for Regular-plan NAVs before a fund's Direct plan existed (2013),
 * academic index returns before a fund launched, and FX source changes.
 */
export function spliceBackfill(primary: Series, backfill: Series | null | undefined): Series {
  if (!backfill || !backfill.dates.length || !primary.dates.length) return primary;
  const d0 = primary.dates[0];
  if (backfill.dates[0] >= d0) return primary;
  const anchor = valueAsOf(backfill, d0);
  if (!finite(anchor) || anchor <= 0) return primary;
  const scale = primary.values[0] / anchor;
  const dates: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < backfill.dates.length && backfill.dates[i] < d0; i++) {
    dates.push(backfill.dates[i]);
    values.push(backfill.values[i] * scale);
  }
  return { dates: [...dates, ...primary.dates], values: [...values, ...primary.values] };
}

/** Append points of `tail` dated after `base` ends (e.g. the latest ECB fixings after FRED's last H.10 print). */
export function extendWith(base: Series, tail: Series): Series {
  const end = base.dates[base.dates.length - 1] ?? -Infinity;
  const i = tail.dates.findIndex((d) => d > end);
  if (i < 0) return base;
  return {
    dates: [...base.dates, ...tail.dates.slice(i)],
    values: [...base.values, ...tail.values.slice(i)],
  };
}

/** Express an asset priced in INR in USD (divide by USDINR as of each date). */
export function inrToUsd(series: Series, usdinr: Series): Series {
  return convertSeries(series, usdinr, 'divide');
}

/** Express an asset priced in USD in INR (multiply by USDINR as of each date). */
export function usdToInr(series: Series, usdinr: Series): Series {
  return convertSeries(series, usdinr, 'multiply');
}

/** Rescale a series so its first value is `base` (returns unchanged). */
export function rebase(s: Series, base = 100): Series {
  const k = base / s.values[0];
  return { dates: s.dates, values: s.values.map((v) => v * k) };
}

/** Turn daily simple returns (fractions) into a level index starting at `base`. */
export function levelFromReturns(dates: number[], returns: number[], base = 100): Series {
  const values: number[] = [];
  let level = base;
  for (let i = 0; i < returns.length; i++) {
    level *= 1 + returns[i];
    values.push(level);
  }
  return { dates: dates.slice(), values };
}
