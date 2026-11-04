/**
 * Acquisition stage: fetch every instrument with graceful degradation
 *   Yahoo  →  previously deployed copy  →  recorded failure
 * plus risk-free rates and constructed cash instruments.
 */
import type { AssetMeta, Currency, IntradayFile, Quote } from '@frontier/contracts';
import { fromEpochDay, isWeekday, toEpochDay, type Series } from '@frontier/quant';
import { createLimiter } from './sources/http';
import { fetchDaily, fetchIntraday } from './sources/yahoo';
import { fetchFredSeries } from './sources/fred';
import { fetchPreviousHistory } from './sources/previous';
import { syntheticUniverse } from './sources/synthetic';
import { CASH_ASSETS, INTRADAY_IDS, UNIVERSE } from './universe';
import type { Universe } from './build/types';

export interface AcquireOptions {
  synthetic: boolean;
  siteUrl?: string;
  concurrency: number;
  start: string;
  now: Date;
  log: (msg: string) => void;
}

export interface Acquired {
  universe: Universe;
  failures: { id: string; reason: string }[];
  sources: Record<string, number>;
  intraday: IntradayFile['series'];
  riskFree: Record<Currency, { rate: number; source: string; asOf: string }>;
}

const quoteFromSeries = (dates: number[], close: number[], livePrice?: number | null, liveTime?: number | null): Quote => {
  const n = close.length;
  const price = livePrice && Number.isFinite(livePrice) ? livePrice : close[n - 1];
  const previousClose = n >= 2 ? close[n - 2] : close[n - 1];
  return {
    price,
    previousClose,
    change: price - previousClose,
    changePct: previousClose > 0 ? price / previousClose - 1 : 0,
    asOf: liveTime ? new Date(liveTime * 1000).toISOString() : `${fromEpochDay(dates[n - 1])}T00:00:00.000Z`,
  };
};

/**
 * Turn a yield series (percent p.a.) into a cash total-return index that
 * accrues interest on every weekday: P_t = P_{t−1}·(1 + y_{t−1}·Δdays/365).
 */
export function cashIndex(rate: Series, startDay: number, endDay: number): Series {
  const dates: number[] = [];
  const values: number[] = [];
  let p = 0;
  let y = rate.values[0] ?? 0;
  let level = 100;
  let prev = startDay;
  for (let d = startDay; d <= endDay; d++) {
    if (!isWeekday(d)) continue;
    while (p < rate.dates.length && rate.dates[p] <= d) {
      y = rate.values[p];
      p++;
    }
    if (dates.length) level *= 1 + ((Math.max(y, 0) / 100) * (d - prev)) / 365;
    dates.push(d);
    values.push(level);
    prev = d;
  }
  return { dates, values };
}

export async function acquire(o: AcquireOptions): Promise<Acquired> {
  const universe: Universe = new Map();
  const failures: Acquired['failures'] = [];
  const sources: Record<string, number> = {};
  const bump = (k: string) => (sources[k] = (sources[k] ?? 0) + 1);
  const today = Math.floor(o.now.getTime() / 86_400_000);
  const [sy, sm, sd] = o.start.split('-').map(Number);
  const period1 = Math.floor(Date.UTC(sy, sm - 1, sd) / 1000);
  const period2 = Math.floor(o.now.getTime() / 1000) + 86_400;

  if (o.synthetic) {
    const synth = syntheticUniverse(UNIVERSE, today, o.start);
    for (const meta of UNIVERSE) {
      const s = synth.get(meta.id);
      if (!s || s.dates.length < 2) continue;
      universe.set(meta.id, { meta, series: s, close: s.values.slice(), quote: quoteFromSeries(s.dates, s.values), source: 'synthetic' });
      bump('synthetic');
    }
  } else {
    const limit = createLimiter(o.concurrency);
    await Promise.all(
      UNIVERSE.map((meta) =>
        limit(async () => {
          try {
            const bars = await fetchDaily(meta.symbol, period1, period2);
            if (bars.dates.length < 30) throw new Error(`only ${bars.dates.length} bars`);
            universe.set(meta.id, {
              meta,
              series: { dates: bars.dates, values: bars.adjClose },
              close: bars.close,
              quote: {
                ...quoteFromSeries(bars.dates, bars.close, bars.regularMarketPrice, bars.regularMarketTime),
                dayHigh: bars.dayHigh ?? undefined,
                dayLow: bars.dayLow ?? undefined,
                volume: bars.volume ?? undefined,
              },
              source: 'yahoo',
            });
            bump('yahoo');
          } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            if (o.siteUrl) {
              try {
                const prev = await fetchPreviousHistory(o.siteUrl, meta.id);
                universe.set(meta.id, { meta, series: prev, close: prev.values.slice(), quote: quoteFromSeries(prev.dates, prev.values), source: 'previous-deploy' });
                bump('previous-deploy');
                o.log(`  ↺ ${meta.id}: ${reason} — reused previous deploy`);
                return;
              } catch {
                /* fall through */
              }
            }
            failures.push({ id: meta.id, reason });
            o.log(`  ✗ ${meta.id}: ${reason}`);
          }
        }),
      ),
    );
  }

  // ── risk-free rates & constructed cash ────────────────────────────────────
  const start = toEpochDay(o.start);
  const riskFree: Acquired['riskFree'] = {
    USD: { rate: 0.04, source: 'assumption (4.0%)', asOf: o.now.toISOString() },
    INR: { rate: 0.065, source: 'assumption (6.5%)', asOf: o.now.toISOString() },
  };
  let usdRate: Series | null = universe.get('IRX')?.series ?? null;
  if (usdRate) riskFree.USD = { rate: usdRate.values.at(-1)! / 100, source: 'US 13-week T-bill (^IRX)', asOf: `${fromEpochDay(usdRate.dates.at(-1)!)}` };
  let inrRate: Series | null = null;
  if (!o.synthetic) {
    if (!usdRate) {
      try {
        usdRate = await fetchFredSeries('DTB3', o.start);
        riskFree.USD = { rate: usdRate.values.at(-1)! / 100, source: 'FRED DTB3 (3-month T-bill)', asOf: fromEpochDay(usdRate.dates.at(-1)!) };
      } catch (e) {
        o.log(`  ✗ FRED DTB3: ${(e as Error).message}`);
      }
    }
    try {
      inrRate = await fetchFredSeries('IR3TIB01INM156N', o.start);
      riskFree.INR = { rate: inrRate.values.at(-1)! / 100, source: 'FRED/OECD India 3-month interbank rate', asOf: fromEpochDay(inrRate.dates.at(-1)!) };
    } catch (e) {
      o.log(`  ✗ FRED India rate: ${(e as Error).message} — using assumption`);
    }
  } else {
    inrRate = { dates: [start], values: [6.5] };
    riskFree.INR = { rate: 0.065, source: 'synthetic', asOf: o.now.toISOString() };
  }
  const constant = (pct: number): Series => ({ dates: [start], values: [pct] });
  const cashSeries: Record<string, Series> = {
    'CASH-USD': cashIndex(usdRate ?? constant(riskFree.USD.rate * 100), start, today),
    'CASH-INR': cashIndex(inrRate ?? constant(riskFree.INR.rate * 100), start, today),
  };
  for (const meta of CASH_ASSETS as AssetMeta[]) {
    const s = cashSeries[meta.id];
    universe.set(meta.id, { meta, series: s, close: s.values.slice(), quote: quoteFromSeries(s.dates, s.values), source: 'constructed' });
    bump('constructed');
  }

  // ── intraday bars for headline instruments ─────────────────────────────────
  const intraday: IntradayFile['series'] = {};
  if (!o.synthetic) {
    const limit = createLimiter(o.concurrency);
    await Promise.all(
      INTRADAY_IDS.map((id) =>
        limit(async () => {
          const meta = UNIVERSE.find((u) => u.id === id);
          if (!meta) return;
          try {
            const b = await fetchIntraday(meta.symbol);
            if (b.t.length > 2) intraday[id] = { t: b.t, p: b.p.map((v) => Number(v.toPrecision(7))), previousClose: b.previousClose, currency: meta.currency };
          } catch (e) {
            o.log(`  ✗ intraday ${id}: ${(e as Error).message}`);
          }
        }),
      ),
    );
  }
  return { universe, failures, sources, intraday, riskFree };
}
