/**
 * Glue between stored portfolios, published data and the analytics worker:
 * which histories to load, FX conversion inputs, benchmark & factor choices
 * per base currency, stress proxies, and share-by-URL encoding.
 */
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { useMemo } from 'react';
import type { AssetSnapshot, Currency } from '@frontier/contracts';
import type { Series } from '@frontier/quant';
import { useHistories } from './data';
import type { Holding, Portfolio } from './store';
import type { AssetInfo, FactorDef, SeriesInput } from '../workers/quant.worker';

export const BENCHMARK: Record<Currency, { id: string; name: string }> = {
  INR: { id: 'NIFTY50', name: 'Nifty 50' },
  USD: { id: 'US-LARGE', name: 'US large caps' },
};

/**
 * Factor definitions per base currency. Indian factors are spreads between
 * smart-beta index funds and the Nifty 50, so they update daily; US style
 * factors are the academic Fama–French series (they lag by a few weeks, so
 * the regression window ends at their last print).
 */
export const FACTORS: Record<Currency, FactorDef[]> = {
  USD: [
    { key: 'mkt', label: 'US stock market', long: 'US-LARGE', excess: true },
    { key: 'size', label: 'Small vs large companies', long: 'FF-SMB' },
    { key: 'value', label: 'Value vs growth', long: 'FF-HML' },
    { key: 'mom', label: 'Momentum', long: 'FF-MOM' },
    { key: 'rates', label: 'Interest-rate sensitivity', long: 'UST10Y', short: 'UST2Y' },
    { key: 'gold', label: 'Gold', long: 'GOLD-USD' },
    { key: 'usd', label: 'US dollar', long: 'DOLLAR' },
  ],
  INR: [
    { key: 'mkt', label: 'Indian market (Nifty 50)', long: 'NIFTY50', excess: true },
    { key: 'size', label: 'Small vs large companies', long: 'SMALLCAP250', short: 'NIFTY50' },
    { key: 'value', label: 'Value vs market', long: 'VALUE20', short: 'NIFTY50' },
    { key: 'mom', label: 'Momentum vs market', long: 'MOMENTUM30', short: 'NIFTY50' },
    { key: 'rates', label: 'Interest-rate sensitivity', long: 'GILT10Y', short: 'CASH-INR' },
    { key: 'gold', label: 'Gold', long: 'GOLD-INR' },
    { key: 'global', label: 'US stocks vs Indian market', long: 'SP500-INR', short: 'NIFTY50' },
  ],
};

export const SHOCKS: Record<Currency, { id: string; name: string; shock: number; summary: string }[]> = {
  USD: [
    {
      id: 'US-LARGE',
      name: 'US stocks fall 20%',
      shock: -0.2,
      summary: 'A typical bear-market decline in the S&P 500.',
    },
    {
      id: 'UST30Y',
      name: 'Interest rates jump',
      shock: -0.15,
      summary: 'Long-term Treasuries drop 15%, as in 2022.',
    },
    {
      id: 'GOLD-USD',
      name: 'Gold slumps 15%',
      shock: -0.15,
      summary: 'Gold loses its shine in a strong-dollar boom.',
    },
    {
      id: 'BTC-USD',
      name: 'Crypto crash',
      shock: -0.5,
      summary: 'Bitcoin halves — it has done so several times.',
    },
    { id: 'NIFTY50', name: 'Indian stocks fall 20%', shock: -0.2, summary: 'A sharp Nifty sell-off.' },
  ],
  INR: [
    {
      id: 'NIFTY50',
      name: 'Indian stocks fall 20%',
      shock: -0.2,
      summary: 'A sharp Nifty sell-off, like early 2020.',
    },
    {
      id: 'SP500-INR',
      name: 'US stocks fall 20%',
      shock: -0.2,
      summary: 'A US bear market, measured in rupees.',
    },
    { id: 'GOLD-INR', name: 'Gold slumps 15%', shock: -0.15, summary: 'Gold prices fall in rupee terms.' },
    {
      id: 'USDINR',
      name: 'Rupee strengthens 10%',
      shock: -0.1,
      summary: 'The dollar falls 10% against the rupee — bad for US holdings.',
    },
    { id: 'BTC-USD', name: 'Crypto crash', shock: -0.5, summary: 'Bitcoin halves.' },
  ],
};

export function normalized(holdings: Holding[]): Holding[] {
  const pos = holdings.filter((h) => h.weight > 0);
  const s = pos.reduce((a, b) => a + b.weight, 0);
  return s > 0 ? pos.map((h) => ({ ...h, weight: h.weight / s })) : pos;
}

export const assetInfo = (a: AssetSnapshot): AssetInfo => ({
  id: a.meta.id,
  name: a.meta.short,
  assetClass: a.meta.assetClass,
  region: a.meta.region,
});

/** Load histories for `ids` (+ USD/INR when needed) and package them for the worker. */
export function useSeriesInputs(
  ids: string[],
  assets: Map<string, AssetSnapshot> | undefined,
  base: Currency,
) {
  const needFx = ids.some((id) => assets?.get(id)?.meta.currency !== base);
  const all = useMemo(() => [...new Set([...ids, ...(needFx ? ['USDINR'] : [])])], [ids, needFx]);
  const h = useHistories(all);
  return useMemo(() => {
    const inputs: Record<string, SeriesInput> = {};
    for (const id of ids) {
      const s = h.data[id];
      const a = assets?.get(id);
      if (s && a) inputs[id] = { id, currency: a.meta.currency, series: s };
    }
    const ready = ids.every((id) => inputs[id]) && (!needFx || !!h.data.USDINR);
    return {
      inputs,
      fx: needFx ? (h.data.USDINR as Series | undefined) : undefined,
      ready,
      isLoading: h.isLoading,
      error: h.error,
    };
  }, [h.data, h.isLoading, h.error, ids, assets, needFx]);
}

// ─── share links ────────────────────────────────────────────────────────────
interface SharedPayload {
  n: string;
  c: Currency;
  a: number;
  h: [string, number][];
}

export function encodePortfolio(p: Portfolio): string {
  const payload: SharedPayload = {
    n: p.name,
    c: p.currency,
    a: Math.round(p.amount),
    h: p.holdings.map((h) => [h.id, Math.round(h.weight * 10000) / 10000]),
  };
  return compressToEncodedURIComponent(JSON.stringify(payload));
}

export function decodePortfolio(code: string): Omit<Portfolio, 'id' | 'createdAt' | 'updatedAt'> | null {
  try {
    const raw = decompressFromEncodedURIComponent(code);
    if (!raw) return null;
    const d = JSON.parse(raw) as SharedPayload;
    if (!Array.isArray(d.h) || (d.c !== 'USD' && d.c !== 'INR')) return null;
    const holdings = d.h
      .filter(([id, w]) => typeof id === 'string' && Number.isFinite(w) && w > 0)
      .slice(0, 40)
      .map(([id, weight]) => ({ id, weight }));
    if (!holdings.length) return null;
    return {
      name: String(d.n ?? 'Shared portfolio').slice(0, 80),
      currency: d.c,
      amount: Number.isFinite(d.a) && d.a > 0 ? d.a : 10000,
      holdings,
      origin: 'shared',
    };
  } catch {
    return null;
  }
}

export function shareUrl(p: Portfolio): string {
  return `${location.origin}${import.meta.env.BASE_URL}portfolio#p=${encodePortfolio(p)}`;
}
