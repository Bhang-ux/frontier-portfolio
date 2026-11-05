/**
 * FRED (Federal Reserve Bank of St. Louis) — keyless CSV downloads.
 *
 * Only series FRED tags "Public Domain" or "Copyrighted: Citation Required"
 * are used (Treasury yields, T-bills, USD/INR, the broad dollar index, Brent,
 * VIX). Equity indices such as the S&P 500 and Nasdaq are tagged
 * "Pre-Approval Required" for reproduction, so Frontier does not publish them.
 */
import { toEpochDay, type Series } from '@frontier/quant';
import { fetchWithRetry } from './http';

/** Parse fredgraph CSV. Missing observations are "." (legacy) or empty (current format). */
export function parseFredCsv(csv: string): Series {
  const dates: number[] = [];
  const values: number[] = [];
  for (const line of csv.trim().split(/\r?\n/).slice(1)) {
    const [d, raw] = line.split(',');
    const v = raw?.trim();
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d) || !v || v === '.') continue;
    const x = Number(v);
    if (!Number.isFinite(x)) continue;
    dates.push(toEpochDay(d));
    values.push(x);
  }
  return { dates, values };
}

const cache = new Map<string, Promise<Series>>();

/** Fetch a FRED series once per process (several instruments can share one, e.g. DGS10). */
export function fetchFredSeries(id: string, start = '2005-01-01'): Promise<Series> {
  const key = `${id}@${start}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}&cosd=${start}`;
      const res = await fetchWithRetry(url, { retries: 3, timeoutMs: 30_000 });
      const s = parseFredCsv(await res.text());
      if (s.dates.length < 12) throw new Error(`FRED ${id}: too few observations`);
      return s;
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}
