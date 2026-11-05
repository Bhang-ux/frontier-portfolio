/**
 * Crypto prices — Binance public market data (data-api.binance.vision is the
 * market-data-only host Binance provides for public consumption; no key).
 * USDT-quoted pairs stand in for USD. Daily candles are paginated (1,000 per
 * request); the in-progress UTC day is included so the latest point is live.
 */
import type { Series } from '@frontier/quant';
import { cleanSeries } from './clean';
import { fetchWithRetry } from './http';

const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
const DAY_MS = 86_400_000;

/** Kline row: [openTime, open, high, low, close, volume, closeTime, …]. */
type Kline = [number, string, string, string, string, string, number, ...unknown[]];

export interface Klines {
  openTime: number[];
  close: number[];
  closeTime: number[];
}

export function parseKlines(json: unknown, symbol: string): Klines {
  if (!Array.isArray(json)) throw new Error(`Binance ${symbol}: unexpected response`);
  const out: Klines = { openTime: [], close: [], closeTime: [] };
  for (const row of json as Kline[]) {
    const c = Number(row?.[4]);
    if (!Array.isArray(row) || !Number.isFinite(row[0]) || !Number.isFinite(c) || c <= 0) continue;
    out.openTime.push(row[0]);
    out.close.push(c);
    out.closeTime.push(Number(row[6]));
  }
  return out;
}

async function getKlines(query: string, symbol: string): Promise<Klines> {
  let last: unknown;
  for (const host of HOSTS) {
    try {
      const res = await fetchWithRetry(`${host}/api/v3/klines?${query}`, { retries: 3, timeoutMs: 20_000 });
      return parseKlines(await res.json(), symbol);
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export interface CryptoDaily {
  series: Series;
  /** Unix ms of the latest price (now, for the in-progress candle). */
  asOf: number;
}

export async function fetchCryptoDaily(
  symbol: string,
  startDay: number,
  now = Date.now(),
): Promise<CryptoDaily> {
  const dates: number[] = [];
  const values: number[] = [];
  let from = startDay * DAY_MS;
  for (let page = 0; page < 12; page++) {
    const k = await getKlines(`symbol=${symbol}&interval=1d&limit=1000&startTime=${from}`, symbol);
    if (!k.openTime.length) break;
    for (let i = 0; i < k.openTime.length; i++) {
      dates.push(Math.floor(k.openTime[i] / DAY_MS));
      values.push(k.close[i]);
    }
    const lastOpen = k.openTime[k.openTime.length - 1];
    if (k.openTime.length < 1000 || lastOpen + DAY_MS > now) break;
    from = lastOpen + DAY_MS;
  }
  const series = cleanSeries(dates, values);
  if (series.dates.length < 30) throw new Error(`Binance ${symbol}: only ${series.dates.length} candles`);
  return { series, asOf: Math.min(now, (series.dates[series.dates.length - 1] + 1) * DAY_MS) };
}

export interface CryptoIntraday {
  t: number[];
  p: number[];
  previousClose: number;
}

/** Last 24 h of 5-minute closes; "previous close" = price 24 h ago (crypto never closes). */
export async function fetchCryptoIntraday(symbol: string): Promise<CryptoIntraday> {
  const k = await getKlines(`symbol=${symbol}&interval=5m&limit=288`, symbol);
  if (k.close.length < 3) throw new Error(`Binance ${symbol}: no intraday candles`);
  return {
    t: k.closeTime.map((ms) => Math.floor(Math.min(ms, Date.now()) / 1000)),
    p: k.close,
    previousClose: k.close[0],
  };
}
