/**
 * Yahoo Finance chart API (v8) — free, keyless daily and intraday bars.
 *
 * Unofficial and occasionally hostile to datacenter IPs, so this client:
 *  - rotates between query1/query2 hosts,
 *  - retries 429/5xx with backoff (see http.ts),
 *  - transparently performs the cookie + crumb handshake if the endpoint
 *    starts demanding it (HTTP 401/403), as yfinance does,
 *  - validates and cleans every response (nulls, duplicates, bad prints).
 */
import { epochDayFromUnix } from '@frontier/quant';
import { BROWSER_UA, fetchWithRetry, HttpError } from './http';

export interface DailyBars {
  symbol: string;
  currency: string;
  exchangeTimezone: string;
  gmtOffset: number;
  dates: number[];
  close: number[];
  adjClose: number[];
  regularMarketPrice: number | null;
  regularMarketTime: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  longName: string | null;
}

export interface IntradayBars {
  t: number[];
  p: number[];
  previousClose: number;
  currency: string;
}

interface ChartResponse {
  chart: {
    result: ChartResult[] | null;
    error: { code: string; description: string } | null;
  };
}
interface ChartResult {
  meta: {
    currency?: string;
    symbol: string;
    exchangeTimezoneName?: string;
    gmtoffset?: number;
    regularMarketPrice?: number;
    regularMarketTime?: number;
    regularMarketDayHigh?: number;
    regularMarketDayLow?: number;
    regularMarketVolume?: number;
    chartPreviousClose?: number;
    previousClose?: number;
    longName?: string;
    shortName?: string;
  };
  timestamp?: number[];
  indicators: {
    quote: { close?: (number | null)[]; open?: (number | null)[] }[];
    adjclose?: { adjclose?: (number | null)[] }[];
  };
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Parse + clean a daily chart response. Exported for unit tests with recorded fixtures. */
export function parseDaily(json: unknown, symbol: string): DailyBars {
  const body = json as ChartResponse;
  if (!body?.chart) throw new Error(`${symbol}: unexpected response shape`);
  if (body.chart.error)
    throw new Error(`${symbol}: ${body.chart.error.code} — ${body.chart.error.description}`);
  const r = body.chart.result?.[0];
  if (!r) throw new Error(`${symbol}: empty result`);
  const ts = r.timestamp ?? [];
  const closes = r.indicators.quote?.[0]?.close ?? [];
  const adj = r.indicators.adjclose?.[0]?.adjclose ?? closes;
  const off = r.meta.gmtoffset ?? 0;
  const byDay = new Map<number, { c: number; a: number }>();
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    const a = adj[i] ?? c;
    if (!finite(c) || !finite(a) || c <= 0 || a <= 0) continue;
    byDay.set(epochDayFromUnix(ts[i], off), { c, a }); // later duplicates win
  }
  const days = [...byDay.keys()].sort((x, y) => x - y);
  const dates: number[] = [];
  const close: number[] = [];
  const adjClose: number[] = [];
  for (const d of days) {
    const v = byDay.get(d)!;
    dates.push(d);
    close.push(v.c);
    adjClose.push(v.a);
  }
  const cleaned = removeSpikes({ dates, close, adjClose });
  return {
    symbol,
    currency: r.meta.currency ?? 'USD',
    exchangeTimezone: r.meta.exchangeTimezoneName ?? 'UTC',
    gmtOffset: off,
    ...cleaned,
    regularMarketPrice: finite(r.meta.regularMarketPrice) ? r.meta.regularMarketPrice : null,
    regularMarketTime: finite(r.meta.regularMarketTime) ? r.meta.regularMarketTime : null,
    dayHigh: finite(r.meta.regularMarketDayHigh) ? r.meta.regularMarketDayHigh : null,
    dayLow: finite(r.meta.regularMarketDayLow) ? r.meta.regularMarketDayLow : null,
    volume: finite(r.meta.regularMarketVolume) ? r.meta.regularMarketVolume : null,
    longName: r.meta.longName ?? r.meta.shortName ?? null,
  };
}

/**
 * Remove single-day bad prints: a point that jumps > 40 % and fully reverts
 * the next day is almost always a data error, not a market move.
 */
export function removeSpikes<T extends { dates: number[]; close: number[]; adjClose: number[] }>(s: T): T {
  const keep = s.adjClose.map(() => true);
  for (let t = 1; t < s.adjClose.length - 1; t++) {
    const up = s.adjClose[t] / s.adjClose[t - 1] - 1;
    const back = s.adjClose[t + 1] / s.adjClose[t] - 1;
    if (Math.abs(up) > 0.4 && Math.abs((1 + up) * (1 + back) - 1) < 0.1) keep[t] = false;
  }
  return {
    ...s,
    dates: s.dates.filter((_, i) => keep[i]),
    close: s.close.filter((_, i) => keep[i]),
    adjClose: s.adjClose.filter((_, i) => keep[i]),
  };
}

export function parseIntraday(json: unknown, symbol: string): IntradayBars {
  const body = json as ChartResponse;
  if (body?.chart?.error) throw new Error(`${symbol}: ${body.chart.error.description}`);
  const r = body?.chart?.result?.[0];
  if (!r) throw new Error(`${symbol}: empty intraday result`);
  const ts = r.timestamp ?? [];
  const closes = r.indicators.quote?.[0]?.close ?? [];
  const t: number[] = [];
  const p: number[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (finite(c) && c > 0) {
      t.push(ts[i]);
      p.push(c);
    }
  }
  return {
    t,
    p,
    previousClose: r.meta.chartPreviousClose ?? r.meta.previousClose ?? p[0] ?? NaN,
    currency: r.meta.currency ?? 'USD',
  };
}

/** Cookie + crumb session, created lazily only if Yahoo starts requiring it. */
class Session {
  private crumb: string | null = null;
  private cookie: string | null = null;
  private pending: Promise<void> | null = null;
  needed = false;

  async ensure(): Promise<void> {
    if (this.crumb) return;
    this.pending ??= (async () => {
      const r1 = await fetch('https://fc.yahoo.com/', {
        headers: { 'User-Agent': BROWSER_UA },
        redirect: 'manual',
      }).catch(() => null);
      const setCookie = r1?.headers.getSetCookie?.() ?? [];
      this.cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
      const r2 = await fetchWithRetry('https://query2.finance.yahoo.com/v1/test/getcrumb', {
        headers: { Cookie: this.cookie, Accept: 'text/plain' },
        retries: 2,
      });
      this.crumb = (await r2.text()).trim();
    })();
    await this.pending;
  }

  decorate(url: string): { url: string; headers: Record<string, string> } {
    if (!this.needed || !this.crumb) return { url, headers: {} };
    return {
      url: `${url}&crumb=${encodeURIComponent(this.crumb)}`,
      headers: this.cookie ? { Cookie: this.cookie } : {},
    };
  }
}

const session = new Session();
let hostFlip = 0;

async function getJson(path: string): Promise<unknown> {
  const host = hostFlip++ % 2 === 0 ? 'query1' : 'query2';
  const base = `https://${host}.finance.yahoo.com${path}`;
  try {
    const { url, headers } = session.decorate(base);
    const res = await fetchWithRetry(url, { headers });
    return await res.json();
  } catch (e) {
    if (e instanceof HttpError && (e.status === 401 || e.status === 403) && !session.needed) {
      session.needed = true;
      await session.ensure();
      const { url, headers } = session.decorate(base);
      const res = await fetchWithRetry(url, { headers });
      return await res.json();
    }
    throw e;
  }
}

export async function fetchDaily(symbol: string, period1: number, period2: number): Promise<DailyBars> {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&includeAdjustedClose=true&events=div%2Csplit`;
  return parseDaily(await getJson(path), symbol);
}

export async function fetchIntraday(symbol: string): Promise<IntradayBars> {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=5m&includePrePost=false`;
  return parseIntraday(await getJson(path), symbol);
}
