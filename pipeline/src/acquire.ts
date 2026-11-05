/**
 * Acquisition stage — every instrument is a memoised async loader, so derived
 * series simply await what they depend on (e.g. US-LARGE awaits SP500-INR and
 * USDINR) and nothing is fetched twice. Per instrument:
 *
 *   source adapter  →  previously deployed copy  →  recorded failure
 *
 * Politeness: AMFI's NAVAll.txt (one request) tells us which funds have a new
 * NAV; full histories are refetched from mfapi.in only for those, or on the
 * weekly full refresh. Everything else is a handful of small CSV/JSON calls.
 */
import type { Currency, IntradayFile, Quote } from '@frontier/contracts';
import { fromEpochDay, isWeekday, lowerBound, toEpochDay, type Series } from '@frontier/quant';
import { createLimiter } from './sources/http';
import { canAppend, fetchNavAll, fetchNavHistory, type LatestNav } from './sources/amfi';
import { fetchCryptoDaily, fetchCryptoIntraday } from './sources/binance';
import { fetchEcbFx } from './sources/ecb';
import { fetchFredSeries } from './sources/fred';
import { FRENCH_FILES, fetchFrenchDaily, type FactorTable } from './sources/french';
import { fetchPreviousHistory } from './sources/previous';
import { syntheticUniverse } from './sources/synthetic';
import { inrToUsd, levelFromReturns, spliceBackfill } from './sources/clean';
import { bondIndexFromYields } from './build/bonds';
import { ALL_ASSETS, INTRADAY_IDS, SOURCES, UNIVERSE, byId, type SourceSpec } from './universe';
import type { LoadedAsset, Universe } from './build/types';

export interface AcquireOptions {
  synthetic: boolean;
  siteUrl?: string;
  start: string;
  now: Date;
  /** Refetch every full history (weekly), instead of extending the previous deploy. */
  fullRefresh?: boolean;
  log: (msg: string) => void;
}

export interface Acquired {
  universe: Universe;
  failures: { id: string; reason: string }[];
  sources: Record<string, number>;
  intraday: IntradayFile['series'];
  riskFree: Record<Currency, { rate: number; source: string; asOf: string }>;
  warnings: string[];
}

const quoteFromSeries = (dates: number[], close: number[], liveTime?: number): Quote => {
  const n = close.length;
  const price = close[n - 1];
  const previousClose = n >= 2 ? close[n - 2] : close[n - 1];
  return {
    price,
    previousClose,
    change: price - previousClose,
    changePct: previousClose > 0 ? price / previousClose - 1 : 0,
    asOf: liveTime ? new Date(liveTime).toISOString() : `${fromEpochDay(dates[n - 1])}T00:00:00.000Z`,
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

/** Annualised trailing return over `days` calendar days (e.g. a liquid fund's yield). */
export function trailingYield(s: Series, days: number): number | null {
  const n = s.dates.length;
  if (n < 2) return null;
  const end = s.dates[n - 1];
  const i = lowerBound(s.dates, end - days);
  if (i >= n - 1 || end - s.dates[i] < days * 0.8) return null;
  const r = s.values[n - 1] / s.values[i];
  return Math.pow(r, 365 / (end - s.dates[i])) - 1;
}

interface Fetched {
  series: Series;
  source: LoadedAsset['source'];
  liveTime?: number;
}

export async function acquire(o: AcquireOptions): Promise<Acquired> {
  const universe: Universe = new Map();
  const failures: Acquired['failures'] = [];
  const warnings: string[] = [];
  const sources: Record<string, number> = {};
  const bump = (k: string) => (sources[k] = (sources[k] ?? 0) + 1);
  const today = Math.floor(o.now.getTime() / 86_400_000);
  const start = toEpochDay(o.start);
  const riskFree: Acquired['riskFree'] = {
    USD: { rate: 0.04, source: 'assumption (4.0%)', asOf: o.now.toISOString() },
    INR: { rate: 0.065, source: 'assumption (6.5%)', asOf: o.now.toISOString() },
  };
  const put = (id: string, f: Fetched) => {
    const meta = byId.get(id)!;
    universe.set(id, {
      meta,
      series: f.series,
      close: f.series.values.slice(),
      quote: quoteFromSeries(f.series.dates, f.series.values, f.liveTime),
      source: f.source,
    });
    bump(f.source);
  };

  if (o.synthetic) {
    const synth = syntheticUniverse(UNIVERSE, today, o.start);
    for (const meta of UNIVERSE) {
      const s = synth.get(meta.id);
      if (s && s.dates.length >= 2) put(meta.id, { series: s, source: 'synthetic' });
    }
    put('CASH-USD', {
      series: cashIndex({ dates: [start], values: [4] }, start, today),
      source: 'constructed',
    });
    put('CASH-INR', {
      series: cashIndex({ dates: [start], values: [6.5] }, start, today),
      source: 'constructed',
    });
    riskFree.USD = { rate: 0.04, source: 'synthetic', asOf: o.now.toISOString() };
    riskFree.INR = { rate: 0.065, source: 'synthetic', asOf: o.now.toISOString() };
    return { universe, failures, sources, intraday: {}, riskFree, warnings };
  }

  // ── shared, memoised inputs ────────────────────────────────────────────────
  const prevMemo = new Map<string, Promise<Series | null>>();
  const previous = (id: string) => {
    let p = prevMemo.get(id);
    if (!p) {
      p = o.siteUrl ? fetchPreviousHistory(o.siteUrl, id).catch(() => null) : Promise.resolve(null);
      prevMemo.set(id, p);
    }
    return p;
  };
  const amfiLimit = createLimiter(1); // mfapi.in rate-limits bursts
  const fredLimit = createLimiter(2);
  const binanceLimit = createLimiter(2);
  const fred = (series: string) => fredLimit(() => fetchFredSeries(series, o.start));

  const navAllP: Promise<Map<number, LatestNav> | null> = fetchNavAll().catch((e) => {
    o.log(`  ✗ AMFI NAVAll: ${(e as Error).message} — will fetch histories from mfapi`);
    return null;
  });

  let frenchP: Promise<Record<keyof typeof FRENCH_FILES, FactorTable>> | null = null;
  const french = () =>
    (frenchP ??= (async () => {
      const [factors, momentum] = await Promise.all([
        fetchFrenchDaily(FRENCH_FILES.factors),
        fetchFrenchDaily(FRENCH_FILES.momentum),
      ]);
      return { factors, momentum };
    })());

  // ── per-source fetchers ────────────────────────────────────────────────────
  async function amfi(id: string, spec: Extract<SourceSpec, { type: 'amfi' }>): Promise<Fetched> {
    const [navAll, prev] = await Promise.all([navAllP, previous(id)]);
    const latest = navAll?.get(spec.code);
    if (latest && latest.plan && !/direct/i.test(latest.plan))
      warnings.push(`${id}: AMFI ${spec.code} is "${latest.plan}", expected a Direct plan`);
    if (!o.fullRefresh && prev && latest && prev.dates.length > 30) {
      const lastDay = prev.dates[prev.dates.length - 1];
      const lastVal = prev.values[prev.values.length - 1];
      const plausible = Math.abs(latest.nav / lastVal - 1) < 0.2;
      if (latest.day <= lastDay) return { series: prev, source: 'amfi' }; // nothing new today
      if (plausible && canAppend(lastDay, latest.day)) {
        return {
          series: { dates: [...prev.dates, latest.day], values: [...prev.values, latest.nav] },
          source: 'amfi',
        };
      }
    }
    const hist = await amfiLimit(() => fetchNavHistory(spec.code));
    let series = hist.series;
    const end = series.dates[series.dates.length - 1];
    if (latest && latest.day > end)
      series = { dates: [...series.dates, latest.day], values: [...series.values, latest.nav] };
    if (spec.backfill) {
      const reuse = !o.fullRefresh && prev && prev.dates[0] < series.dates[0] - 30;
      const back = reuse ? prev : (await amfiLimit(() => fetchNavHistory(spec.backfill!))).series;
      series = spliceBackfill(series, back);
    }
    return { series, source: 'amfi' };
  }

  async function usdinr(): Promise<Fetched> {
    let hist: Series | null = null;
    try {
      hist = await fred('DEXINUS');
    } catch (e) {
      o.log(`  ✗ FRED DEXINUS: ${(e as Error).message} — using ECB history`);
    }
    const ecbStart = hist ? fromEpochDay(today - 120) : o.start;
    try {
      const ecb = await fetchEcbFx('USD', 'INR', ecbStart);
      return { series: spliceBackfill(ecb, hist), source: hist ? 'fred' : 'ecb' };
    } catch (e) {
      if (!hist) throw e;
      o.log(`  ✗ ECB USD/INR: ${(e as Error).message} — FRED only (lags ~1 week)`);
      return { series: hist, source: 'fred' };
    }
  }

  async function frenchLevel(id: string, spec: Extract<SourceSpec, { type: 'french' }>): Promise<Fetched> {
    const prev = await previous(id);
    if (!o.fullRefresh && prev) return { series: prev, source: 'french' }; // monthly data: weekly refresh suffices
    const t = (await french())[spec.file];
    const i0 = lowerBound(t.dates, start);
    const col = t.columns[spec.column];
    if (!col) throw new Error(`French: no column ${spec.column}`);
    return { series: levelFromReturns(t.dates.slice(i0), col.slice(i0)), source: 'french' };
  }

  async function frenchMarket(): Promise<Series> {
    const t = (await french()).factors;
    const i0 = lowerBound(t.dates, start);
    const r = t.columns['Mkt-RF'].slice(i0).map((x, i) => x + t.columns.RF[i0 + i]);
    return levelFromReturns(t.dates.slice(i0), r);
  }

  async function fetchBySpec(id: string, spec: SourceSpec): Promise<Fetched> {
    switch (spec.type) {
      case 'amfi':
        return amfi(id, spec);
      case 'fred':
        return { series: await fred(spec.series), source: 'fred' };
      case 'bond':
        return { series: bondIndexFromYields(await fred(spec.series), spec.maturity), source: 'model' };
      case 'tbill': {
        const y = await fred(spec.series);
        return { series: cashIndex(y, Math.max(start, y.dates[0]), today), source: 'constructed' };
      }
      case 'usdinr':
        return usdinr();
      case 'french':
        return frenchLevel(id, spec);
      case 'binance': {
        const d = await binanceLimit(() => fetchCryptoDaily(spec.symbol, start, o.now.getTime()));
        let series = d.series;
        if (spec.backfill) {
          const [b, fx] = await Promise.all([load(spec.backfill.id), load('USDINR')]);
          if (b && (!spec.backfill.inrToUsd || fx))
            series = spliceBackfill(
              series,
              spec.backfill.inrToUsd ? inrToUsd(b.series, fx!.series) : b.series,
            );
        }
        return { series, source: 'binance', liveTime: d.asOf };
      }
      case 'inr-to-usd': {
        const [inr, fx] = await Promise.all([load(spec.from), load('USDINR')]);
        if (!inr || !fx) throw new Error(`needs ${spec.from} and USDINR`);
        let series = inrToUsd(inr.series, fx.series);
        if (spec.backfill === 'french-mkt') {
          const prev = await previous(id);
          try {
            const back =
              !o.fullRefresh && prev && prev.dates[0] < series.dates[0] - 30 ? prev : await frenchMarket();
            series = spliceBackfill(series, back);
          } catch (e) {
            o.log(`  ⚠ ${id}: no backfill (${(e as Error).message})`);
          }
        }
        return { series, source: 'derived' };
      }
    }
  }

  const memo = new Map<string, Promise<LoadedAsset | null>>();
  async function loadOne(id: string): Promise<LoadedAsset | null> {
    const spec = SOURCES.get(id);
    if (!spec) throw new Error(`no source for ${id}`);
    try {
      const f = await fetchBySpec(id, spec);
      const s = f.series;
      if (s.dates.length < 30) throw new Error(`only ${s.dates.length} observations`);
      const i0 = lowerBound(s.dates, start);
      put(id, { ...f, series: { dates: s.dates.slice(i0), values: s.values.slice(i0) } });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      const prev = await previous(id);
      if (prev && prev.dates.length >= 30) {
        put(id, { series: prev, source: 'previous-deploy' });
        o.log(`  ↺ ${id}: ${reason} — reused previous deploy`);
      } else {
        failures.push({ id, reason });
        o.log(`  ✗ ${id}: ${reason}`);
        return null;
      }
    }
    return universe.get(id)!;
  }
  function load(id: string): Promise<LoadedAsset | null> {
    let p = memo.get(id);
    if (!p) {
      p = loadOne(id);
      memo.set(id, p);
    }
    return p;
  }

  await Promise.all(ALL_ASSETS.map((a) => load(a.id)));

  // ── risk-free rates ────────────────────────────────────────────────────────
  const tb = universe.get('US3M');
  if (tb && tb.source !== 'previous-deploy')
    riskFree.USD = {
      rate: tb.series.values.at(-1)! / 100,
      source: 'US 3-month T-bill (FRED DTB3)',
      asOf: fromEpochDay(tb.series.dates.at(-1)!),
    };
  const liquid = universe.get('CASH-INR');
  const y = liquid ? trailingYield(liquid.series, 91) : null;
  if (liquid && y !== null && y > 0 && y < 0.2)
    riskFree.INR = {
      rate: y,
      source: `${liquid.meta.name}, trailing 3-month return (annualised)`,
      asOf: fromEpochDay(liquid.series.dates.at(-1)!),
    };

  // ── intraday bars (24/7 crypto) ────────────────────────────────────────────
  const intraday: IntradayFile['series'] = {};
  await Promise.all(
    INTRADAY_IDS.map((id) => {
      const spec = SOURCES.get(id);
      if (spec?.type !== 'binance') return null;
      return binanceLimit(async () => {
        try {
          const b = await fetchCryptoIntraday(spec.symbol);
          intraday[id] = {
            t: b.t,
            p: b.p.map((v) => Number(v.toPrecision(7))),
            previousClose: b.previousClose,
            currency: byId.get(id)!.currency,
          };
        } catch (e) {
          o.log(`  ✗ intraday ${id}: ${(e as Error).message}`);
        }
      });
    }),
  );
  return { universe, failures, sources, intraday, riskFree, warnings };
}
