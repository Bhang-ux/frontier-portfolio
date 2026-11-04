/**
 * FRED (Federal Reserve Bank of St. Louis) — keyless CSV downloads.
 * Used for India's 3-month interbank rate (risk-free proxy for INR) and as a
 * fallback for the US 3-month T-bill rate.
 */
import { toEpochDay, type Series } from '@frontier/quant';
import { fetchWithRetry } from './http';

export function parseFredCsv(csv: string): Series {
  const dates: number[] = [];
  const values: number[] = [];
  for (const line of csv.trim().split(/\r?\n/).slice(1)) {
    const [d, v] = line.split(',');
    const x = Number(v);
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(x)) continue; // FRED uses "." for missing
    dates.push(toEpochDay(d));
    values.push(x);
  }
  return { dates, values };
}

export async function fetchFredSeries(id: string, start = '2005-01-01'): Promise<Series> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}&cosd=${start}`;
  const res = await fetchWithRetry(url, { retries: 3, timeoutMs: 30_000 });
  const s = parseFredCsv(await res.text());
  if (s.dates.length < 12) throw new Error(`FRED ${id}: too few observations`);
  return s;
}
