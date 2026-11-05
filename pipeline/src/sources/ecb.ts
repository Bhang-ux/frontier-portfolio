/**
 * Euro foreign-exchange reference rates from the European Central Bank, via
 * Frankfurter (an open-source, keyless JSON API over the ECB feed). The ECB
 * publishes once per TARGET business day around 16:00 CET; Frankfurter
 * cross-calculates USD/INR from the EUR legs.
 */
import { toEpochDay, type Series } from '@frontier/quant';
import { fetchWithRetry } from './http';

interface FrankfurterSeries {
  base?: string;
  rates?: Record<string, Record<string, number>>;
}

export function parseFrankfurter(json: unknown, to: string): Series {
  const body = json as FrankfurterSeries;
  if (!body?.rates || typeof body.rates !== 'object') throw new Error('ECB: unexpected response shape');
  const rows = Object.entries(body.rates)
    .filter(([d, r]) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(r?.[to]) && r[to] > 0)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return { dates: rows.map(([d]) => toEpochDay(d)), values: rows.map(([, r]) => r[to]) };
}

/** Daily USD→INR (or any pair) from `startIso` to today. */
export async function fetchEcbFx(from: string, to: string, startIso: string): Promise<Series> {
  const res = await fetchWithRetry(`https://api.frankfurter.app/${startIso}..?from=${from}&to=${to}`, {
    retries: 3,
    timeoutMs: 30_000,
  });
  const s = parseFrankfurter(await res.json(), to);
  if (!s.dates.length) throw new Error(`ECB ${from}/${to}: no rates`);
  return s;
}
