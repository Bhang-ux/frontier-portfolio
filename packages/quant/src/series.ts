/**
 * Time-series plumbing: calendar maths, multi-market alignment, resampling,
 * returns and drawdowns.
 *
 * Dates are integer "epoch days" (days since 1970-01-01 UTC). They are
 * timezone-free, compact in JSON, trivially diffable and sort as numbers.
 */

export interface Series {
  dates: number[];
  values: number[];
}

const MS_PER_DAY = 86_400_000;

export function toEpochDay(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

export function fromEpochDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Exchange-local calendar day for a unix timestamp given the exchange UTC offset (seconds). */
export function epochDayFromUnix(unixSeconds: number, gmtOffsetSeconds = 0): number {
  return Math.floor((unixSeconds + gmtOffsetSeconds) / 86_400);
}

/** 0 = Sunday … 6 = Saturday (1970-01-01 was a Thursday). */
export const weekday = (day: number): number => (((day + 4) % 7) + 7) % 7;
export const isWeekday = (day: number): boolean => {
  const w = weekday(day);
  return w !== 0 && w !== 6;
};

export const yearOf = (day: number): number => new Date(day * MS_PER_DAY).getUTCFullYear();
export const monthOf = (day: number): number => new Date(day * MS_PER_DAY).getUTCMonth(); // 0-11
export const startOfYear = (year: number): number => Math.floor(Date.UTC(year, 0, 1) / MS_PER_DAY);

/** Annualisation factor inferred from the calendar actually present in the data. */
export function periodsPerYearFromDates(dates: ArrayLike<number>): number {
  const n = dates.length;
  if (n < 2) return 252;
  const years = (dates[n - 1] - dates[0]) / 365.25;
  if (years <= 0) return 252;
  return (n - 1) / years;
}

export type Calendar = 'weekdays' | 'union' | 'intersection';

export interface Aligned {
  dates: number[];
  /** values[t][i] — price of series i on dates[t] (forward-filled). */
  values: number[][];
  /** For each series, the number of trailing calendar days it was forward-filled at the end. */
  staleDays: number[];
}

/**
 * Align several price series on one calendar with forward fill.
 *
 * - `weekdays` (default): union of all observation dates restricted to Mon–Fri.
 *   Crypto weekend moves roll into Monday; markets on holiday carry their last
 *   close (zero return) — the convention used by most multi-asset risk systems.
 * - `intersection`: only dates on which every series printed.
 *
 * The window starts when the *last* series begins, so every column is real data.
 */
export function alignSeries(
  series: Series[],
  opts: { calendar?: Calendar; start?: number; end?: number } = {},
): Aligned {
  const calendar = opts.calendar ?? 'weekdays';
  if (series.length === 0) return { dates: [], values: [], staleDays: [] };
  const firstCommon = Math.max(...series.map((s) => s.dates[0] ?? Infinity));
  const lastAny = Math.max(...series.map((s) => s.dates[s.dates.length - 1] ?? -Infinity));
  const start = Math.max(firstCommon, opts.start ?? -Infinity);
  const end = Math.min(lastAny, opts.end ?? Infinity);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return { dates: [], values: [], staleDays: series.map(() => 0) };
  }

  let dates: number[];
  if (calendar === 'intersection') {
    const counts = new Map<number, number>();
    for (const s of series) for (const d of s.dates) if (d >= start && d <= end) counts.set(d, (counts.get(d) ?? 0) + 1);
    dates = [...counts.entries()].filter(([, c]) => c === series.length).map(([d]) => d);
  } else {
    const set = new Set<number>();
    for (const s of series) for (const d of s.dates) if (d >= start && d <= end) set.add(d);
    dates = [...set];
    if (calendar === 'weekdays') dates = dates.filter(isWeekday);
  }
  dates.sort((a, b) => a - b);

  const T = dates.length;
  const n = series.length;
  const values: number[][] = Array.from({ length: T }, () => new Array<number>(n));
  const staleDays = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const s = series[i];
    let p = 0;
    let last = NaN;
    let lastDate = -Infinity;
    // seed `last` with the most recent observation on/before the first aligned date
    while (p < s.dates.length && s.dates[p] <= (dates[0] ?? -Infinity)) {
      last = s.values[p];
      lastDate = s.dates[p];
      p++;
    }
    for (let t = 0; t < T; t++) {
      const d = dates[t];
      while (p < s.dates.length && s.dates[p] <= d) {
        last = s.values[p];
        lastDate = s.dates[p];
        p++;
      }
      values[t][i] = last;
    }
    staleDays[i] = T > 0 ? Math.max(0, dates[T - 1] - lastDate) : 0;
  }
  return { dates, values, staleDays };
}

/** r_t = p_t / p_{t-1} − 1 */
export function simpleReturns(prices: ArrayLike<number>): number[] {
  const out = new Array<number>(Math.max(prices.length - 1, 0));
  for (let t = 1; t < prices.length; t++) out[t - 1] = prices[t] / prices[t - 1] - 1;
  return out;
}

export function logReturns(prices: ArrayLike<number>): number[] {
  const out = new Array<number>(Math.max(prices.length - 1, 0));
  for (let t = 1; t < prices.length; t++) out[t - 1] = Math.log(prices[t] / prices[t - 1]);
  return out;
}

/** Row-wise simple returns of a T×n price matrix → (T−1)×n. */
export function returnsMatrix(prices: number[][]): number[][] {
  const out: number[][] = [];
  for (let t = 1; t < prices.length; t++) {
    const prev = prices[t - 1];
    const cur = prices[t];
    out.push(cur.map((p, i) => p / prev[i] - 1));
  }
  return out;
}

export type Frequency = 'D' | 'W' | 'M' | 'Q' | 'Y';

const periodKey = (day: number, freq: Frequency): number => {
  switch (freq) {
    case 'D':
      return day;
    case 'W':
      return Math.floor((day + 3) / 7); // ISO weeks start Monday
    case 'M':
      return yearOf(day) * 12 + monthOf(day);
    case 'Q':
      return yearOf(day) * 4 + Math.floor(monthOf(day) / 3);
    case 'Y':
      return yearOf(day);
  }
};

/** Index of the last observation in each period. */
export function periodEndIndices(dates: ArrayLike<number>, freq: Frequency): number[] {
  const idx: number[] = [];
  for (let t = 0; t < dates.length; t++) {
    const k = periodKey(dates[t], freq);
    const nextK = t + 1 < dates.length ? periodKey(dates[t + 1], freq) : NaN;
    if (k !== nextK) idx.push(t);
  }
  return idx;
}

/** Index of the first observation of each new period (excluding t=0). */
export function periodStartIndices(dates: ArrayLike<number>, freq: Frequency): number[] {
  const idx: number[] = [];
  for (let t = 1; t < dates.length; t++) {
    if (periodKey(dates[t], freq) !== periodKey(dates[t - 1], freq)) idx.push(t);
  }
  return idx;
}

export function resample(series: Series, freq: Frequency): Series {
  const idx = periodEndIndices(series.dates, freq);
  return { dates: idx.map((i) => series.dates[i]), values: idx.map((i) => series.values[i]) };
}

/** Resample an aligned price matrix to period ends. */
export function resampleAligned(aligned: { dates: number[]; values: number[][] }, freq: Frequency) {
  const idx = periodEndIndices(aligned.dates, freq);
  return { dates: idx.map((i) => aligned.dates[i]), values: idx.map((i) => aligned.values[i]) };
}

/** Wealth index W_0 = start, W_t = W_{t−1}(1 + r_t). Length = returns.length + 1. */
export function wealthIndex(returns: ArrayLike<number>, start = 1): number[] {
  const w = new Array<number>(returns.length + 1);
  w[0] = start;
  for (let t = 0; t < returns.length; t++) w[t + 1] = w[t] * (1 + returns[t]);
  return w;
}

/** Drawdown series: W_t / max_{s≤t} W_s − 1 (≤ 0). */
export function drawdownSeries(wealth: ArrayLike<number>): number[] {
  const dd = new Array<number>(wealth.length);
  let peak = -Infinity;
  for (let t = 0; t < wealth.length; t++) {
    peak = Math.max(peak, wealth[t]);
    dd[t] = peak > 0 ? wealth[t] / peak - 1 : 0;
  }
  return dd;
}

export interface PeriodReturn {
  key: number;
  year: number;
  /** 0-11 for monthly, quarter 0-3 for quarterly, 0 for yearly */
  period: number;
  ret: number;
  /** true if the period is incomplete at either end of the sample */
  partial: boolean;
}

/** Calendar period returns from a price/wealth series (e.g. monthly-returns heatmap). */
export function calendarReturns(series: Series, freq: 'M' | 'Q' | 'Y'): PeriodReturn[] {
  const { dates, values } = series;
  if (dates.length < 2) return [];
  const ends = periodEndIndices(dates, freq);
  const out: PeriodReturn[] = [];
  let prevIdx = 0;
  for (let k = 0; k < ends.length; k++) {
    const e = ends[k];
    if (e === 0) continue;
    const base = k === 0 ? 0 : prevIdx;
    const day = dates[e];
    out.push({
      key: periodKey(day, freq),
      year: yearOf(day),
      period: freq === 'M' ? monthOf(day) : freq === 'Q' ? Math.floor(monthOf(day) / 3) : 0,
      ret: values[e] / values[base] - 1,
      partial: k === 0 || k === ends.length - 1,
    });
    prevIdx = e;
  }
  return out;
}

/** Find the first index with dates[i] >= day (binary search). */
export function lowerBound(dates: ArrayLike<number>, day: number): number {
  let lo = 0;
  let hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (dates[mid] < day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Value on or before `day` (forward-fill lookup); NaN if before the series starts. */
export function valueAsOf(series: Series, day: number): number {
  const i = lowerBound(series.dates, day + 1) - 1;
  return i >= 0 ? series.values[i] : NaN;
}

export function sliceSeries(series: Series, start: number, end = Infinity): Series {
  const a = lowerBound(series.dates, start);
  const b = lowerBound(series.dates, end + 1);
  return { dates: series.dates.slice(a, b), values: series.values.slice(a, b) };
}

/**
 * Convert a local-currency price series into another currency using an FX
 * series quoted as units of target per unit of source (e.g. USDINR for USD→INR).
 * FX is forward-filled onto the asset's own dates.
 */
export function convertSeries(series: Series, fx: Series, mode: 'multiply' | 'divide' = 'multiply'): Series {
  const dates: number[] = [];
  const values: number[] = [];
  let p = 0;
  let last = NaN;
  for (let t = 0; t < series.dates.length; t++) {
    const d = series.dates[t];
    while (p < fx.dates.length && fx.dates[p] <= d) {
      last = fx.values[p];
      p++;
    }
    if (!Number.isFinite(last)) continue; // no FX yet → drop (can't value it)
    dates.push(d);
    values.push(mode === 'multiply' ? series.values[t] * last : series.values[t] / last);
  }
  return { dates, values };
}

/**
 * Largest-Triangle-Three-Buckets downsampling (Steinarsson 2013): keeps the
 * visual shape of a line with a fraction of the points. Used for charts.
 */
export function lttb(xs: ArrayLike<number>, ys: ArrayLike<number>, threshold: number): number[] {
  const n = xs.length;
  if (threshold >= n || threshold < 3) return Array.from({ length: n }, (_, i) => i);
  const out: number[] = [0];
  const every = (n - 2) / (threshold - 2);
  let a = 0;
  for (let i = 0; i < threshold - 2; i++) {
    const rangeStart = Math.floor((i + 1) * every) + 1;
    const rangeEnd = Math.min(Math.floor((i + 2) * every) + 1, n);
    let avgX = 0;
    let avgY = 0;
    const len = rangeEnd - rangeStart;
    for (let j = rangeStart; j < rangeEnd; j++) {
      avgX += xs[j];
      avgY += ys[j];
    }
    avgX /= len || 1;
    avgY /= len || 1;
    const bucketStart = Math.floor(i * every) + 1;
    const bucketEnd = Math.floor((i + 1) * every) + 1;
    let maxArea = -1;
    let next = bucketStart;
    for (let j = bucketStart; j < bucketEnd; j++) {
      const area = Math.abs((xs[a] - avgX) * (ys[j] - ys[a]) - (xs[a] - xs[j]) * (avgY - ys[a]));
      if (area > maxArea) {
        maxArea = area;
        next = j;
      }
    }
    out.push(next);
    a = next;
  }
  out.push(n - 1);
  return out;
}
